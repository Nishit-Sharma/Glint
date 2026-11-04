import {afterEach,expect,it} from 'vitest';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createCompanion,type Companion} from '../../src/core/companion';
import {TaskViewPreferences} from '../../src/host/task-view-preferences';
import {isTaskUnread,taskActivityBasis,readTaskAttentionCommand} from '../../src/shared/task-attention';
import {taskAttentionLabel,tasksForReviewFilter} from '../../src/renderer/src/task-outcome-review';

const fixtures:{directory:string;core:Companion}[]=[];
afterEach(async()=>{for(const f of fixtures.splice(0)){await f.core.close();await rm(f.directory,{recursive:true,force:true});}});
async function fixture(){const directory=await mkdtemp(join(tmpdir(),'task-attention-')),core=await createCompanion({dataDir:directory});fixtures.push({directory,core});return {directory,core,open:()=>new TaskViewPreferences(directory,async id=>(await core.listTasks()).some(task=>task.id===id),id=>core.getTask(id))};}

it('keeps saved activity unread across restart, reads an exact viewed snapshot and ignores rename/source/editor noise',async()=>{
 const f=await fixture(),task=await f.core.createTask({title:'Plan the museum visit'}),prefs=f.open();
 expect(isTaskUnread(task,await prefs.readAttention())).toBe(false);
 await f.core.runRequest({taskId:task.id,requestId:'question',kind:'explain',prompt:'Which entrance is closest?',sourceIds:[]},async()=>({title:'Entrance',content:'Use the east entrance.'}));
 const answered=await f.core.getTask(task.id);expect(isTaskUnread(answered,await f.open().readAttention())).toBe(true);
 await prefs.changeAttention({kind:'read',taskId:task.id,basis:taskActivityBasis(answered)});
 expect(isTaskUnread(answered,await f.open().readAttention())).toBe(false);
 await f.core.updateTask(task.id,{title:'Renamed visit'});await f.core.putSource(task.id,{kind:'text',label:'Opening hours',content:'Ten o clock',role:'fact'});await f.core.saveComposerDraft(task.id,0,{text:'My private unsent question',kind:'explain'});
 const changed=await f.core.getTask(task.id);expect(isTaskUnread(changed,await prefs.readAttention())).toBe(false);expect(changed.session?.draft).toBe('My private unsent question');
 await prefs.changeAttention({kind:'unread',taskId:task.id});await prefs.changeAttention({kind:'filter',filter:'unread'});
 expect(await f.open().readAttention()).toMatchObject({kind:'available',filter:'unread'});expect(isTaskUnread(changed,await f.open().readAttention())).toBe(true);
});

it('cannot clear a later answer with a delayed view of its running question',async()=>{
 const f=await fixture(),task=await f.core.createTask({title:'An unanswered question'});let release!:(value:{title:string;content:string})=>void,entered!:()=>void;const ready=new Promise<void>(resolve=>entered=resolve);
 const run=f.core.runRequest({taskId:task.id,requestId:'late-answer',kind:'explain',prompt:'What remains unknown?',sourceIds:[]},()=>new Promise(resolve=>{release=resolve;entered();}));
 await ready;
 const running=await f.core.getTask(task.id),prefs=f.open();await prefs.changeAttention({kind:'read',taskId:task.id,basis:taskActivityBasis(running)});
 release({title:'Saved later',content:'A late answer remains new.'});await run;const answered=await f.core.getTask(task.id);
 await expect(prefs.changeAttention({kind:'read',taskId:task.id,basis:taskActivityBasis(running)})).rejects.toThrow('conversation changed');
 expect(isTaskUnread(answered,await f.open().readAttention())).toBe(true);
 await prefs.changeAttention({kind:'read',taskId:task.id,basis:taskActivityBasis(answered)});expect(isTaskUnread(answered,await f.open().readAttention())).toBe(false);
});

it('keeps paused and unanswered work accessible without changing tasks or retrying requests',async()=>{
 const f=await fixture(),task=await f.core.createTask({title:'A question to revisit'});await f.core.runRequest({taskId:task.id,requestId:'failed',kind:'explain',prompt:'Which observation is missing?',sourceIds:[]},async()=>{throw Error('The service stopped.');});await f.core.pause(task.id);
 const current=await f.core.getTask(task.id);expect(taskAttentionLabel(current)).toBe('Paused · 1 failed response');expect(tasksForReviewFilter([current],'needs-attention')).toEqual([current]);expect(tasksForReviewFilter([current],'needs-review')).toEqual([]);
 await f.open().changeAttention({kind:'read',taskId:task.id,basis:taskActivityBasis(current)});expect(tasksForReviewFilter([current],'unread',await f.open().readAttention())).toEqual([]);expect(tasksForReviewFilter([current],'needs-attention')).toEqual([current]);expect(await f.core.getTask(task.id)).toEqual(current);
});

it('preserves the exact task through archive/rename and drops deleted cursor owners without matching replacement titles',async()=>{
 const f=await fixture(),task=await f.core.createTask({title:'Same title'}),prefs=f.open();await prefs.changeAttention({kind:'unread',taskId:task.id});await f.core.pause(task.id);const archived=await f.core.setTaskArchived({taskId:task.id,archived:true,expectedArchiveId:null});
 expect(isTaskUnread(archived,await f.open().readAttention())).toBe(true);await f.core.setTaskArchived({taskId:task.id,archived:false,expectedArchiveId:archived.archive!.id});
 await f.core.deleteTask(task.id);const replacement=await f.core.createTask({title:'Same title'});expect((await prefs.readAttention())).toMatchObject({kind:'available',entries:[]});expect(isTaskUnread(replacement,await prefs.readAttention())).toBe(false);await expect(prefs.changeAttention({kind:'unread',taskId:task.id})).rejects.toThrow('no longer available');
});

it.each(['{broken',JSON.stringify({schemaVersion:2,revision:0,filter:'all',entries:[]}),JSON.stringify({schemaVersion:1,revision:1,filter:'all',entries:[],futureImportant:true})])('keeps unfamiliar read state bytes and ordinary selection working',async raw=>{
 const f=await fixture(),task=await f.core.createTask({title:'Local work'});await writeFile(join(f.directory,'task-attention.json'),raw);const prefs=f.open();expect(await prefs.readAttention()).toMatchObject({kind:'unavailable'});expect(await prefs.changeAttention({kind:'unread',taskId:task.id})).toMatchObject({kind:'unavailable'});expect(await readFile(join(f.directory,'task-attention.json'),'utf8')).toBe(raw);expect(await prefs.select(task.id)).toEqual({kind:'available',taskId:task.id});
});

it('rejects unknown command authority and serializes read, unread and filter choices',async()=>{
 const f=await fixture(),task=await f.core.createTask({title:'Serial choices'}),prefs=f.open();expect(()=>readTaskAttentionCommand({type:'task-attention.get',execute:true})).toThrow();expect(()=>readTaskAttentionCommand({type:'task-attention.change',change:{kind:'filter',filter:'send'}})).toThrow();
 await Promise.all([prefs.changeAttention({kind:'read',taskId:task.id,basis:taskActivityBasis(task)}),prefs.changeAttention({kind:'unread',taskId:task.id}),prefs.changeAttention({kind:'filter',filter:'needs-attention'})]);expect(await f.open().readAttention()).toMatchObject({kind:'available',revision:3,filter:'needs-attention',entries:[{taskId:task.id,basis:null}]});expect(await f.core.getTask(task.id)).toEqual(task);
});
