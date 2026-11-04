import {afterEach,expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...((await import('../support/controlled-renderer.fixture')).hooks)}));
const navigation=vi.hoisted(()=>({dirty:false,clear:vi.fn()}));
vi.mock('../../src/renderer/src/draft-navigation',()=>({useNavigationDraft:(dirty:boolean)=>{navigation.dirty=dirty;return navigation.clear;}}));
import {createElement} from 'react';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../../src/core/companion';
import type {Command} from '../../src/shared/bridge';
import {LocalContacts} from '../../src/renderer/src/LocalContacts';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';
afterEach(()=>vi.unstubAllGlobals());

async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'glint-contacts-ui-')),core=await createCompanion({dataDir:directory}),insert=vi.fn(),commands:string[]=[];
 vi.stubGlobal('window',{companion:{invoke:async(command:Command)=>{
  commands.push(command.type);
  if(command.type==='contacts.get')return core.getLocalContacts();
  if(command.type==='contacts.change'){const {type,...input}=command;return core.changeLocalContacts(input);}
  throw Error('Unexpected command '+command.type);
 }}});
 const r=createControlledRenderer(()=>createElement(LocalContacts,{onInsert:insert}));
 const content=(node:ReturnType<typeof r.find>):string=>node.type==='#text'?node.props.text:node.children.map(content).join('');
 const button=(label:string)=>r.find(node=>node.type==='button'&&content(node)===label);
 const field=(label:string)=>{const id=r.find(node=>node.type==='label'&&content(node)===label).props.htmlFor;return r.find(node=>node.props.id===id);};
 const checkbox=(label:string)=>r.find(node=>node.type==='label'&&content(node)===label).children.find(node=>node.type==='input')!;
 async function settle(){await core.getLocalContacts();for(let i=0;i<10;i++)await Promise.resolve();r.render();}
 r.render();await settle();
 return {core,r,content,button,field,checkbox,insert,commands,settle,close:async()=>{await core.close();await rm(directory,{recursive:true,force:true});}};
}
test('contact editor searches, inspects, cancels edits and selection, and inserts only the exact reviewed fields',async()=>{
 const f=await fixture(),{r,button,field,checkbox,content,settle,core}=f;
 try{
  button('Add contact').props.onClick();r.render();
  for(const [label,value] of [['Name','Glint Contact QA732'],['Email (optional)','qa732@example.com'],['Phone (optional)','555-0147'],['Address (optional)','732 Example Lane\nSample City'],['Notes (optional)','Synthetic contact only.']])field(label).props.onChange({target:{value}});
  r.render();expect(navigation.dirty).toBe(true);r.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await settle();expect(navigation.dirty).toBe(false);
  field('Search contacts').props.onChange({target:{value:'no match'}});r.render();expect(r.nodes().some(node=>content(node)==='No contacts match this search.')).toBe(true);
  field('Search contacts').props.onChange({target:{value:'qa732'}});r.render();button('Glint Contact QA732qa732@example.com').props.onClick();r.render();expect(r.nodes().some(node=>node.type==='dd'&&content(node)==='732 Example Lane\nSample City')).toBe(true);
  button('Edit contact').props.onClick();r.render();field('Name').props.onChange({target:{value:'Discard this name'}});r.render();button('Cancel edits').props.onClick();r.render();expect((await core.getLocalContacts()).contacts[0].name).toBe('Glint Contact QA732');
  button('Edit contact').props.onClick();r.render();field('Phone (optional)').props.onChange({target:{value:'555-0199'}});r.render();r.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await settle();
  button('Glint Contact QA732qa732@example.com').props.onClick();r.render();button('Use in message').props.onClick();r.render();expect(content(r.find(node=>node.type==='pre'))).toBe('Selected contact details:\nName: Glint Contact QA732');
  checkbox('Name').props.onChange({target:{checked:false}});checkbox('Email').props.onChange({target:{checked:true}});checkbox('Address').props.onChange({target:{checked:true}});r.render();
  const expected='Selected contact details:\nEmail: qa732@example.com\nAddress: 732 Example Lane\nSample City';expect(content(r.find(node=>node.type==='pre'))).toBe(expected);
  button('Cancel selection').props.onClick();r.render();expect(f.insert).not.toHaveBeenCalled();
  button('Use in message').props.onClick();r.render();checkbox('Name').props.onChange({target:{checked:false}});checkbox('Email').props.onChange({target:{checked:true}});checkbox('Address').props.onChange({target:{checked:true}});r.render();button('Insert into message').props.onClick();await settle();
  expect(f.insert).toHaveBeenCalledExactlyOnceWith(expected);expect((await core.getLocalContacts()).contacts[0].phone).toBe('555-0199');expect(f.commands.every(command=>command==='contacts.get'||command==='contacts.change')).toBe(true);
 }finally{await f.close();}
});
test('stale contact edits remain visible and stale selections never insert',async()=>{
 const f=await fixture(),{r,button,field,settle,core}=f;
 try{
  button('Add contact').props.onClick();r.render();field('Name').props.onChange({target:{value:'Glint Contact QA732'}});field('Email (optional)').props.onChange({target:{value:'qa732@example.com'}});r.render();r.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await settle();
  button('Glint Contact QA732qa732@example.com').props.onClick();r.render();button('Edit contact').props.onClick();r.render();field('Phone (optional)').props.onChange({target:{value:'unsaved edit'}});r.render();
  const saved=await core.getLocalContacts(),contact=saved.contacts[0];await core.changeLocalContacts({expectedRevision:saved.revision,change:{kind:'save',id:contact.id,details:{name:contact.name,email:contact.email,phone:'new saved phone',address:contact.address,notes:contact.notes}}});
  r.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await settle();expect(field('Phone (optional)').props.value).toBe('unsaved edit');expect(r.find(node=>node.props.role==='alert').children.length).toBeGreaterThan(0);
  button('Cancel edits').props.onClick();r.render();button('Use in message').props.onClick();r.render();
  await core.changeLocalContacts({expectedRevision:2,change:{kind:'archive',id:contact.id,archived:true}});button('Insert into message').props.onClick();await settle();expect(f.insert).not.toHaveBeenCalled();expect(f.content(r.find(node=>node.props.role==='alert'))).toContain('This contact changed');
 }finally{await f.close();}
});
