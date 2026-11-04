import {afterEach,expect,it} from 'vitest';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createCompanion,type Companion} from '../../src/core/companion';
import type {Task} from '../../src/core/types';
import {readTaskHistoryPreviewCommand} from '../../src/shared/task-history-preview';

const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
const refs=(task:Task)=>task.sources.filter(source=>!source.revoked).map(source=>({sourceId:source.id,version:source.currentVersion,digest:source.versions.at(-1)!.digest}));
const command=(task:Task)=>({type:'history.preview',taskId:task.id,sourceIds:refs(task).map(ref=>ref.sourceId),expectedSourceRefs:refs(task)});
async function fixture(){const root=resolve('work/continuation/runtime');await mkdir(root,{recursive:true});const directory=await mkdtemp(join(root,'history-'));let core:Companion=await createCompanion({dataDir:directory});cleanups.push(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});return {get core(){return core},directory,restart:async()=>{await core.close();core=await createCompanion({dataDir:directory});}};}

it('inspects the same next-request history after restart without changing durable data or including unsent and other-task text',async()=>{
 const f=await fixture(),task=await f.core.createTask({title:'Trail planning'}),other=await f.core.createTask({title:'OTHER_TASK_PRIVATE'});
 await f.core.runRequest({taskId:task.id,requestId:'history-preview',kind:'explain',prompt:'Keep a fifty dollar budget',sourceIds:[]},async()=>({title:'Budget',content:'Budget stays at fifty dollars.'}));
 await f.core.runRequest({taskId:other.id,requestId:'other',kind:'explain',prompt:'OTHER_TASK_PRIVATE',sourceIds:[]},async()=>({title:'Private',content:'OTHER_TASK_PRIVATE'}));
 await f.core.saveComposerDraft(task.id,0,{text:'UNSENT_PRIVATE',kind:'explain'});await f.core.checkpoint(task.id,'Choose the short route');await f.restart();
 const current=await f.core.getTask(task.id),before=await readFile(join(f.directory,'tasks.json'),'utf8'),preview=await f.core.previewTaskHistory(command(current));
 expect(preview.history).toContain('Keep a fifty dollar budget');expect(preview.history).toContain('Choose the short route');expect(preview.history).not.toMatch(/UNSENT_PRIVATE|OTHER_TASK_PRIVATE/);expect(await readFile(join(f.directory,'tasks.json'),'utf8')).toBe(before);expect(await f.core.getTask(task.id)).toEqual(current);
 await f.core.runRequest({taskId:task.id,requestId:'next',kind:'explain',prompt:'Compare the route',sourceIds:[]},async context=>{expect(context.taskHistory).toBe(preview.history);return {title:'Comparison',content:'A short route.'};});
});

it('uses the shared source privacy projection and preserves withheld history locally across reopen',async()=>{
 const f=await fixture(),task=await f.core.createTask({title:'Scope'});let current=await f.core.putSource(task.id,{id:'source',kind:'text',label:'Synthetic source',role:'fact',content:'SOURCE_PRIVATE'});
 await f.core.runRequest({taskId:task.id,requestId:'with-source',kind:'explain',prompt:'DERIVED_PRIVATE',sourceIds:['source']},async()=>({title:'Answer',content:'DERIVED_PRIVATE'}));current=await f.core.getTask(task.id);
 expect((await f.core.previewTaskHistory(command(current))).history).toContain('DERIVED_PRIVATE');
 const without={...command(current),sourceIds:[],expectedSourceRefs:[]};expect((await f.core.previewTaskHistory(without)).history).not.toContain('DERIVED_PRIVATE');
 current=await f.core.revokeSource(task.id,'source');await f.restart();current=await f.core.getTask(task.id);const before=await readFile(join(f.directory,'tasks.json'),'utf8'),preview=await f.core.previewTaskHistory(command(current));expect(preview.history).not.toMatch(/SOURCE_PRIVATE|DERIVED_PRIVATE/);expect(before).toContain('DERIVED_PRIVATE');expect(await readFile(join(f.directory,'tasks.json'),'utf8')).toBe(before);
 await expect(f.core.previewTaskHistory({...command(current),sourceIds:['source'],expectedSourceRefs:[{sourceId:'source',version:1,digest:current.sources[0].versions[0].digest}]})).rejects.toThrow();
});

it('rejects unknown fields, changed references, foreign source IDs, duplicates and paused tasks without writes',async()=>{
 const f=await fixture(),task=await f.core.createTask({title:'Exact selection'}),current=await f.core.putSource(task.id,{id:'source',kind:'text',label:'Synthetic',role:'fact',content:'First'}),request=command(current),before=await readFile(join(f.directory,'tasks.json'),'utf8');
 expect(()=>readTaskHistoryPreviewCommand({...request,send:true})).toThrow();
 for(const value of [{...request,expectedSourceRefs:[]},{...request,sourceIds:['foreign']},{...request,sourceIds:['source','source']},{...request,expectedSourceRefs:[{...request.expectedSourceRefs[0],digest:'a'.repeat(64)}]}])await expect(f.core.previewTaskHistory(value)).rejects.toThrow();
 expect(await readFile(join(f.directory,'tasks.json'),'utf8')).toBe(before);await f.core.pause(task.id);await expect(f.core.previewTaskHistory(request)).rejects.toThrow('active ordinary text task');
});
