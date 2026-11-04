import {afterEach,beforeEach,expect,test} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createCompanion,type Companion} from '../../src/core/companion';
import {getTaskStarters,taskStarterPayload,readSuggestedTaskInput} from '../../src/shared/task-starters';
let root:string,core:Companion;
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'task-starters-'));core=await createCompanion({dataDir:root});});
afterEach(async()=>{await core.close();await rm(root,{recursive:true,force:true});});
test('a pinned original starter atomically creates an independent goal and exact unsent draft while preserving the original task',async()=>{
 const origin=await core.createTask({title:'Owned original',goal:'Keep original goal'});await core.saveComposerDraft(origin.id,0,{text:'Keep original draft\nRésumé 東京731',kind:'create'});const before=await core.getTask(origin.id),starter=getTaskStarters()[0];
 const saved=await core.startSuggestedTask({originTaskId:origin.id,starter:starter.reference},'bot-original');
 expect(saved.created).toBe(true);expect(saved.task.id).not.toBe(origin.id);expect(saved.task).toMatchObject({title:starter.title,goal:starter.goal,assignedBotId:'bot-original',status:'active',session:{draft:starter.prompt,draftKind:'explain',draftRevision:1},requests:[],sources:[],artifacts:[],procedures:[],actions:[]});expect(await core.getTask(origin.id)).toEqual(before);
 for(const template of getTaskStarters())expect(createHash('sha256').update(JSON.stringify(taskStarterPayload(template))).digest('hex')).toBe(template.reference.digest);
 const changed=getTaskStarters();changed[0].prompt='Mutated caller copy';Reflect.set(changed[0].reference,'digest','wrong');expect(getTaskStarters()[0]).toEqual(starter);
});
test('concurrent clicks and lost-ack restart resolve one task without overwriting its customized goal or draft',async()=>{
 const origin=await core.createTask({title:'Original'}),starter=getTaskStarters()[1],input={originTaskId:origin.id,starter:starter.reference};const results=await Promise.all([core.startSuggestedTask(input,'bot-original'),core.startSuggestedTask(input,'new-default'),core.startSuggestedTask(input,'new-default')]);expect(new Set(results.map(result=>result.task.id)).size).toBe(1);expect(results.map(result=>result.created)).toEqual([true,false,false]);
 const id=results[0].task.id;await core.updateTask(id,{title:'Customized starter task',goal:'My later goal'});await core.saveComposerDraft(id,1,{text:'My later unsent edit\n731',kind:'create'});await core.close();core=await createCompanion({dataDir:root});const replay=await core.startSuggestedTask(input,'different-default');expect(replay.created).toBe(false);expect(replay.task).toMatchObject({id,title:'Customized starter task',goal:'My later goal',assignedBotId:'bot-original',session:{draft:'My later unsent edit\n731',draftKind:'create',draftRevision:2},requests:[]});expect(await core.listTasks()).toHaveLength(2);
 const independent=await core.startSuggestedTask({originTaskId:id,starter:starter.reference},'bot-original');expect(independent.task.id).not.toBe(id);expect(independent.created).toBe(true);expect(independent.task.session?.draft).toBe(starter.prompt);
});
test('strict altered references, injected prompt fields and retired host scope fail without consuming a starter identity; existing local receipts coexist',async()=>{
 const legacy=await core.startLocalTask({intentId:'existing-local-text',kind:'text',title:'Original local text',content:'Keep exact text'},'bot-original'),starter=getTaskStarters()[2],input={originTaskId:legacy.task.id,starter:starter.reference};
 for(const value of [{...input,prompt:'Injected'}, {...input,starter:{...starter.reference,digest:'a'.repeat(64)}},{...input,starter:{...starter.reference,version:2}},{...input,starter:{...starter.reference,extra:true}}])expect(()=>readSuggestedTaskInput(value)).toThrow('changed or is unavailable');
 let calls=0;await expect(core.startSuggestedTask(input,'bot-original',()=>{if(++calls===2)throw Error('Retired before commit');})).rejects.toThrow('Retired before commit');expect(await core.listTasks()).toHaveLength(1);const started=await core.startSuggestedTask(input,'bot-original');expect(started.created).toBe(true);const sameLegacy=await core.startLocalTask({intentId:'existing-local-text',kind:'text',title:'Original local text',content:'Keep exact text'},'bot-original');expect(sameLegacy.task.id).toBe(legacy.task.id);expect(await core.getTask(legacy.task.id)).toEqual(legacy.task);
});
test('a first-task starter has a stable identity and a deleted saved target never becomes a replacement task',async()=>{
 const input={originTaskId:null,starter:getTaskStarters()[0].reference},first=await core.startSuggestedTask(input,'bot-original');expect((await core.startSuggestedTask(input,'bot-original')).task.id).toBe(first.task.id);await core.deleteTask(first.task.id);await expect(core.startSuggestedTask(input,'bot-original')).rejects.toThrow('saved task is no longer available');expect(await core.listTasks()).toEqual([]);
});
