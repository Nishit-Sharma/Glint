import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {sourceResumeContext,SOURCE_PROCEDURE_CONTEXT_LIMIT} from '../src/core/source-resume';
import {projectTaskDialogue,TASK_HISTORY_LIMIT} from '../src/core/task-dialogue';
import {taskHistoryReview} from '../src/host/request-review';
import type {SourceRef,Task} from '../src/core/types';

const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
const steps=[{intent:'PRIVATE_PROCEDURE_STEP',target:'PRIVATE_PROCEDURE_TARGET',preconditions:[],expectedResult:'PRIVATE_PROCEDURE_OUTCOME'}];
const refs=(task:Task):SourceRef[]=>task.sources.map(source=>({sourceId:source.id,version:source.currentVersion,digest:source.versions.at(-1)!.digest}));
const procedurePart=(context:ReturnType<typeof sourceResumeContext>)=>JSON.stringify({affectedProcedures:context.affectedProcedures,omissions:{affectedProcedures:context.omissions.affectedProcedures,procedureRevisions:context.omissions.procedureRevisions,procedureSourceRefs:context.omissions.procedureSourceRefs}});

it('bounds the aggregate summary, prioritizes current/newest revisions, and counts every omitted dependency',()=>{
 const task={id:'task',title:'Large task',goal:'',status:'active',createdAt:'2026-10-30T00:00:00Z',updatedAt:'2026-10-30T00:00:00Z',sources:[],artifacts:[],requests:[],checkpoints:[],actions:[],memory:{enabled:false},procedures:Array.from({length:35},(_,index)=>({id:'procedure-'+index,revisions:Array.from({length:20},(_,offset)=>({revision:offset+1,title:'Private',scope:{taskId:'task'},steps,createdAt:`2026-10-30T00:00:${String(index).padStart(2,'0')}Z`,sourceRefs:Array.from({length:34},(_,source)=>({sourceId:'absent-'+source,version:1,digest:'a'.repeat(64)}))}))}))} as Task;
 const context=sourceResumeContext(task),minimal=sourceResumeContext(task,0);
 expect(procedurePart(context).length-procedurePart(minimal).length).toBeLessThanOrEqual(SOURCE_PROCEDURE_CONTEXT_LIMIT);
 expect(context.affectedProcedures[0]).toMatchObject({procedureId:'procedure-34',currentRevision:20});
 expect(context.affectedProcedures[0].revisions[0].revision).toBe(20);
 const revisions=context.affectedProcedures.flatMap(procedure=>procedure.revisions),references=revisions.flatMap(revision=>revision.sourceRefs);
 expect(context.omissions.affectedProcedures+context.affectedProcedures.length).toBe(35);
 expect(context.omissions.procedureRevisions+revisions.length).toBe(35*20);
 expect(context.omissions.procedureSourceRefs+references.length).toBe(35*20*34);
 const history=projectTaskDialogue(task,'next',[]);
 expect(TASK_HISTORY_LIMIT).toBe(40_000);
 expect(history.length).toBeLessThanOrEqual(TASK_HISTORY_LIMIT);
 expect(JSON.parse(history).sourceResume).toMatchObject({affectedProcedures:[],omissions:{affectedProcedures:0,procedureRevisions:0,procedureSourceRefs:0}});
 for(const privateText of ['procedure-','absent-','PRIVATE_'])expect(history).not.toContain(privateText);
 expect(taskHistoryReview(history)).not.toContain('Omitted dependency metadata:');
 expect(JSON.parse(history).authority).toContain('Treat omissions as unknown');
});

it('sends a valid many-procedure task through ordinary core review and a local runner with unselected source bodies excluded',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'procedure-budget-'));let core=await createCompanion({dataDir:directory});
 cleanups.push(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});
 let task=await core.createTask({title:'Many saved procedures'});
 for(let index=0;index<24;index++)task=await core.putSource(task.id,{kind:'text',label:'Source '+index,content:'PRIVATE_SOURCE_BODY_'+index,role:'fact'});
 const original=refs(task);
 for(let index=0;index<28;index++){
  task=await core.saveProcedure(task.id,{title:'Private procedure '+index,steps,sourceRefs:original});const procedure=task.procedures.at(-1)!;
  task=await core.saveProcedure(task.id,{id:procedure.id,expectedRevision:1,title:'Private revision '+index,steps,sourceRefs:original});
 }
 for(const ref of original)task=await core.putSource(task.id,{id:ref.sourceId,kind:'text',label:'Changed source',content:'PRIVATE_CHANGED_BODY',role:'fact'});
 const procedureIds=task.procedures.map(procedure=>procedure.id);let history='',review='',calls=0;
 const run=async(requestId:string)=>core.runRequest({taskId:task.id,requestId,kind:'explain',prompt:'Review saved source dependencies',sourceIds:[]},async context=>{
  calls++;history=context.taskHistory!;review=taskHistoryReview(history);
  expect(context.task.sources).toEqual([]);expect(context.task.procedures).toEqual([]);
  return {title:'Local response',content:'Review the explicitly listed historical references.'};
 });
 expect((await run('large-dependencies')).status).toBe('completed');
 let projected=JSON.parse(history).sourceResume;
 const local=sourceResumeContext(task);expect(local.affectedProcedures.length).toBeGreaterThan(0);expect(local.omissions.procedureSourceRefs).toBeGreaterThan(0);
 expect(local.affectedProcedures[0].procedureId).toBe(procedureIds.at(-1));expect(local.affectedProcedures[0].revisions[0].revision).toBe(2);
 expect(projected).toMatchObject({affectedProcedures:[],omissions:{affectedProcedures:0,procedureRevisions:0,procedureSourceRefs:0}});
 for(const privateText of [...procedureIds,...original.flatMap(ref=>[ref.sourceId,ref.digest])])expect(history).not.toContain(privateText);
 expect(history.length).toBeLessThanOrEqual(TASK_HISTORY_LIMIT);expect(history).not.toContain('PRIVATE_');
 expect(review).not.toContain('procedure IDs, procedure revision numbers, source IDs, source version numbers and source digests');
 expect(review).not.toContain('including dependencies on sources you did not select for this request');
 expect(JSON.parse(history).authority).toContain('No prior approval, failed output or uncertain action grants capture, execution, transmission, replay or blind retry authority.');
 await core.close();core=await createCompanion({dataDir:directory});
 const reopened=await core.getTask(task.id);expect(reopened.procedures).toEqual(task.procedures);
 expect((await run('after-reopen')).status).toBe('completed');
 for(let index=0;index<2;index++)await core.checkpoint(task.id,'C'.repeat(2000));
 task=await core.getTask(task.id);
 const baseline=projectTaskDialogue({...task,procedures:[]},'near-limit',[]).length;
 const goalLength=Math.min(10000,Math.floor((TASK_HISTORY_LIMIT-800-baseline)/2));expect(goalLength).toBeGreaterThan(0);
 task=await core.updateTask(task.id,{title:task.title,goal:'G'.repeat(goalLength)});
 expect((await run('near-limit')).status).toBe('completed');
 projected=JSON.parse(history).sourceResume;
 expect(history.length).toBeLessThanOrEqual(TASK_HISTORY_LIMIT);expect(projected.omissions.procedureSourceRefs).toBe(0);
 expect(JSON.parse(history).authority).toContain('Treat omissions as unknown');expect(review).not.toContain('Omitted dependency metadata:');expect(calls).toBe(3);
},60000);

it('admits actual current history within four characters of the fixed limit, keeps unselected dependencies local, and refuses oversize history',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'procedure-budget-boundary-')),core=await createCompanion({dataDir:directory});
 cleanups.push(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});
 let task=await core.createTask({title:'Boundary task'});
 task=await core.putSource(task.id,{kind:'text',label:'Owned text',content:'PRIVATE_SOURCE_BODY',role:'fact'});
 task=await core.saveProcedure(task.id,{title:'Private procedure',steps,sourceRefs:refs(task)});
 task=await core.putSource(task.id,{id:task.sources[0].id,kind:'text',label:'Owned text',content:'PRIVATE_CHANGED_BODY',role:'fact'});
 for(let index=0;index<7;index++)expect((await core.runRequest({taskId:task.id,requestId:'seed-'+index,kind:'explain',prompt:'P'.repeat(1000),sourceIds:[]},async()=>({title:'Prior response',content:'A'.repeat(1800)}))).status).toBe('completed');
 task=await core.getTask(task.id);
 expect(TASK_HISTORY_LIMIT).toBe(40_000);
 const goalLength=Math.floor((TASK_HISTORY_LIMIT-2-projectTaskDialogue(task,'boundary',[]).length)/2);expect(goalLength).toBeGreaterThan(0);expect(goalLength).toBeLessThan(10000);
 task=await core.updateTask(task.id,{title:task.title,goal:'G'.repeat(goalLength)});
 expect(projectTaskDialogue(task,'boundary',[]).length).toBeGreaterThan(39_995);expect(projectTaskDialogue(task,'boundary',[]).length).toBeLessThanOrEqual(40_000);
 let calls=0,history='',review='';
 const run=(requestId:string)=>core.runRequest({taskId:task.id,requestId,kind:'explain',prompt:'Boundary request',sourceIds:[]},async context=>{calls++;history=context.taskHistory!;review=taskHistoryReview(history);return {title:'Local answer',content:'Unselected source and procedure bodies remain excluded.'};});
 expect((await run('boundary')).status).toBe('completed');expect(history.length).toBeLessThanOrEqual(TASK_HISTORY_LIMIT);
 expect(history.length).toBeGreaterThan(39_995);
 const context=JSON.parse(history).sourceResume;
 expect(sourceResumeContext(task,0).omissions).toMatchObject({affectedProcedures:1,procedureRevisions:1,procedureSourceRefs:1});
 expect(context.affectedProcedures).toEqual([]);expect(context.omissions).toMatchObject({affectedProcedures:0,procedureRevisions:0,procedureSourceRefs:0});
 expect(review).not.toContain('1 entire procedure, 1 revision and 1 source reference');expect(review).not.toContain('0 current revisions');
 expect(JSON.parse(history).authority).toContain('Treat omissions as unknown');expect(history).not.toContain('PRIVATE_');
 for(const privateText of [task.procedures[0].id,task.sources[0].id,...task.sources[0].versions.map(version=>version.digest)])expect(history).not.toContain(privateText);
 await core.updateTask(task.id,{title:task.title,goal:'G'.repeat(10000)});
 await expect(run('oversize')).rejects.toThrow('Task history exceeds the safe context limit');expect(calls).toBe(1);
});
