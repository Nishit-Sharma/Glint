import {expect,it} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createCompanion} from '../src/core/companion';
import {DocumentImports} from '../src/host/document-import';

it('adds reviewed local document text without detaching the saved browser route or changing its pending draft',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'document-import-continuity-')),core=await createCompanion({dataDir:join(directory,'store')});
 try{
  const file=join(directory,'research.txt');await writeFile(file,'A cart travels 60 metres.');
  const task=await core.createTask({title:'Existing browser task'}),other=await core.createTask({title:'Another task'}),context={origin:'https://owned.invalid',url:'https://owned.invalid/current',requestId:'existing-browser'};
  await core.saveComposerDraft(task.id,0,{text:'Keep the current browser question',kind:'explain'});
  const drafted=await core.getTask(task.id);await core.replaceSession(task.id,drafted.session!.revision,{...drafted.session!,browserContext:context});
  const before=await core.getTask(task.id),imports=new DocumentImports(core,async()=>file),owner={taskId:task.id,attemptId:randomUUID()},review=await imports.pick(owner,()=>{});
  expect(review.kind).toBe('review');expect(await core.getTask(task.id)).toEqual(before);
  if(review.kind!=='review')throw Error('Document review unavailable.');
  const saved=await imports.add({...owner,label:'Cart research',content:review.text+'\nReviewed correction.',role:'fact'},()=>{});
  expect(saved.task.session?.browserContext).toEqual(context);
  expect(saved.task.session?.draft).toBe(before.session?.draft);expect(saved.task.session?.draftRevision).toBe(before.session?.draftRevision);expect(saved.task.session?.draftKind).toBe(before.session?.draftKind);
  expect(saved.task.sources).toHaveLength(1);expect(saved.task.sources[0].versions[0].content).toContain('Reviewed correction.');expect(saved.task.sources[0].versions[0].content).toContain(review.fileDigest);
  expect(saved.task.requests).toEqual(before.requests);expect(saved.task.actions).toEqual(before.actions);expect(await core.getTask(other.id)).toEqual(other);
  const persisted=await core.getTask(task.id);expect(persisted.session?.browserContext).toEqual(context);expect(persisted.sources[0].id).toBe(saved.reference.sourceId);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
