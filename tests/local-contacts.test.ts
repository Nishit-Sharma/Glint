import {expect,test} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {appendLocalContactMessage,localContactMessage,readLocalContactsCommand,searchLocalContacts} from '../src/shared/local-contacts';

const details={name:'Glint Contact QA732',email:'qa732@example.com',phone:'+1 202 555 0147',address:'732 Example Lane\nSample City, EX 00000',notes:'Synthetic local contact.'};
test('the host contact command parser accepts only bounded typed contact operations',()=>{
 expect(readLocalContactsCommand({type:'contacts.get'})).toEqual({type:'contacts.get'});
 expect(readLocalContactsCommand({type:'contacts.change',expectedRevision:0,change:{kind:'save',details}})).toEqual({type:'contacts.change',expectedRevision:0,change:{kind:'save',details}});
 expect(()=>readLocalContactsCommand({type:'contacts.get',allCredentials:true})).toThrow();
 expect(()=>readLocalContactsCommand({type:'contacts.change',expectedRevision:0,change:{kind:'save',details:{...details,address:'x'.repeat(1_001)}}})).toThrow();
 expect(()=>readLocalContactsCommand({type:'contacts.send',id:'qa'})).toThrow();
});
test('local contacts save, edit, search and reopen in the authoritative ledger without entering tasks or requests',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-contacts-'));let core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Contact draft'}),original=await core.getTask(task.id);
  expect(await core.getLocalContacts()).toEqual({revision:0,contacts:[]});
  const saved=await core.changeLocalContacts({expectedRevision:0,change:{kind:'save',details}}),contact=saved.current.contacts[0];
  expect(contact).toMatchObject({...details,archived:false,revision:1});
  expect(await core.getTask(task.id)).toEqual(original);
  await core.runRequest({taskId:task.id,requestId:'no-ambient-contact',kind:'explain',prompt:'Write a greeting',sourceIds:[]},async context=>{
   expect(JSON.stringify(context)).not.toContain('qa732@example.com');expect(context.task).not.toHaveProperty('localContacts');
   return {title:'Greeting',content:'Hello.'};
  });
  await core.changeLocalContacts({expectedRevision:1,change:{kind:'save',id:contact.id,details:{...details,phone:'+1 202 555 0199'}}});
  expect(await core.changeLocalContacts({expectedRevision:1,change:{kind:'save',id:contact.id,details:{...details,name:'Stale edit'}}})).toMatchObject({kind:'conflict',current:{revision:2}});
  expect(searchLocalContacts(await core.getLocalContacts(),'SAMPLE qa732').map(item=>item.id)).toEqual([contact.id]);
  await core.close();core=await createCompanion({dataDir:directory});
  expect((await core.getLocalContacts()).contacts[0]).toMatchObject({...details,phone:'+1 202 555 0199',id:contact.id,revision:2});
  expect((await core.getTask(task.id)).requests).toHaveLength(1);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
test('archive is recoverable and bad contact changes preserve the saved ledger',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-contacts-archive-'));let core=await createCompanion({dataDir:directory});
 try{
  const saved=await core.changeLocalContacts({expectedRevision:0,change:{kind:'save',details}}),contact=saved.current.contacts[0];
  await core.changeLocalContacts({expectedRevision:1,change:{kind:'archive',id:contact.id,archived:true}});
  await core.close();core=await createCompanion({dataDir:directory});
  const archived=await core.getLocalContacts();expect(searchLocalContacts(archived,'')).toEqual([]);expect(searchLocalContacts(archived,'QA732',true)).toHaveLength(1);
  expect(localContactMessage(archived.contacts[0],['name','email'])).toBe('');
  await expect(core.changeLocalContacts({expectedRevision:2,change:{kind:'save',id:contact.id,details}})).rejects.toThrow('Restore');
  expect(()=>core.changeLocalContacts({expectedRevision:2,change:{kind:'save',details:{...details,name:' '}}})).toThrow();
  expect(()=>core.changeLocalContacts({expectedRevision:2,change:{kind:'save',details:{...details,email:'invalid'}}})).toThrow();
  expect(()=>core.changeLocalContacts({expectedRevision:2,change:{kind:'save',details,credentials:'no'}})).toThrow();
  expect(await core.getLocalContacts()).toEqual(archived);
  await core.changeLocalContacts({expectedRevision:2,change:{kind:'archive',id:contact.id,archived:false}});
  expect(searchLocalContacts(await core.getLocalContacts(),'qa732')[0]).toMatchObject({...details,archived:false,revision:3});
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
test('only explicitly selected fields become bounded visible message text',()=>{
 const contact={...details,id:'qa',revision:1,archived:false,createdAt:'2026-10-31T00:00:00.000Z',updatedAt:'2026-10-31T00:00:00.000Z'};
 const preview=localContactMessage(contact,['email','address']);
 expect(preview).toBe('Selected contact details:\nEmail: qa732@example.com\nAddress: 732 Example Lane\nSample City, EX 00000');
 expect(preview).not.toContain(contact.name);expect(preview).not.toContain(contact.phone);expect(preview).not.toContain(contact.notes);
 expect(localContactMessage(contact,[])).toBe('');
 expect(appendLocalContactMessage('Draft a note.',preview)).toBe('Draft a note.\n\nSelected contact details:\nEmail: qa732@example.com\nAddress: 732 Example Lane\nSample City, EX 00000');
 expect(()=>appendLocalContactMessage('x'.repeat(100_000),preview)).toThrow('too long');
});
