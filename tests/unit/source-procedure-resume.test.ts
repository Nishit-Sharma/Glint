import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../../src/core/companion';
import {sourceResumeContext} from '../../src/core/source-resume';
import {projectTaskDialogue} from '../../src/core/task-dialogue';
import {taskHistoryReview} from '../../src/host/request-review';
import {DocumentSourceFollow} from '../../src/host/document-source-follow';
import type {NativeWindow} from '../../src/host/native';
import type {SourceRef,Task} from '../../src/core/types';

const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
const steps=[{intent:'Private procedure body',target:'Private target',preconditions:[],expectedResult:'Private outcome'}];
const stampA={method:'ax-document',evidence:'foreground-application-correlation',digest:'a'.repeat(64)} as const;
const stampB={...stampA,digest:'b'.repeat(64)};
const native:NativeWindow={id:'window:41',osId:41,title:'Synthetic selected window',owner:{name:'Synthetic app',processId:88},bounds:{x:0,y:0,width:100,height:100},displayId:'1',scaleFactor:1,documentToken:'synthetic-only',requiresExplicitCapture:true};
const sourceRef=(task:Task,index=0):SourceRef=>{const source=task.sources[index],version=source.versions.at(-1)!;return {sourceId:source.id,version:version.version,digest:version.digest};};
async function fixture(kind:'text'|'window'='text'){
 const directory=await mkdtemp(join(tmpdir(),'procedure-resume-'));let core=await createCompanion({dataDir:directory});
 cleanups.push(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});
 let task=await core.createTask({title:'Source-linked procedure'});
 task=await core.putSource(task.id,{kind,label:'Private source label',content:'Private source body',role:'fact',...(kind==='window'?{windowId:native.id,windowProcessId:88,documentToken:native.documentToken,documentStamp:stampA}:{})});
 const ref=sourceRef(task);
 task=await core.saveProcedure(task.id,{title:'Private procedure title',steps,sourceRefs:[ref]});
 return {get core(){return core},task,ref,procedureId:task.procedures[0].id,restart:async()=>{await core.close();core=await createCompanion({dataDir:directory});}};
}
const affected=(task:Task)=>sourceResumeContext(task).affectedProcedures;

it('excludes still-current saved procedure dependencies and leaves the authoritative task unchanged',async()=>{
 const f=await fixture(),before=await f.core.getTask(f.task.id);
 expect(affected(before)).toEqual([]);
 expect(await f.core.checkProcedure(before.id,f.procedureId,{values:{}})).toEqual({ready:true,failures:[],executionAuthorized:false});
 expect(await f.core.getTask(before.id)).toEqual(before);
});

it('discloses exact changed-source procedure revisions without sharing their bodies or relinking them',async()=>{
 const f=await fixture();
 const changed=await f.core.putSource(f.task.id,{id:f.ref.sourceId,kind:'text',label:'Private replacement label',content:'Private replacement body',role:'fact'});
 const before=structuredClone(changed),history=projectTaskDialogue(changed,'next-request',[]),context=JSON.parse(history);
 expect(sourceResumeContext(changed).affectedProcedures).toEqual([{procedureId:f.procedureId,currentRevision:1,revisions:[{revision:1,sourceRefs:[{...f.ref,availability:'available',versionRelation:'superseded',freshness:'fresh'}]}]}]);
 expect(context.sourceResume.affectedProcedures).toEqual([]);
 expect(taskHistoryReview(history)).not.toContain('1 saved procedure');
 expect(context.sourceResume.authority).toContain('do not authorize capture, execution, transmission or replay');
 for(const secret of ['Private procedure body','Private target','Private outcome','Private procedure title','Private source body','Private replacement body'])expect(history).not.toContain(secret);
 expect(await f.core.getTask(changed.id)).toEqual(before);
 expect(await f.core.checkProcedure(changed.id,f.procedureId,{values:{}})).toMatchObject({ready:false,executionAuthorized:false});
});

it('keeps source uncertainty distinct from a superseded version and preserves it through disk reopen',async()=>{
 const f=await fixture('window');await f.core.saveComposerDraft(f.task.id,0,{text:'Unsent local correction',kind:'explain'});
 await f.restart();const resumed=await f.core.resume(f.task.id);
 expect(resumed.sourceContext.affectedProcedures).toEqual([{procedureId:f.procedureId,currentRevision:1,revisions:[{revision:1,sourceRefs:[{...f.ref,availability:'available',versionRelation:'current',freshness:'refresh-required'}]}]}]);
 expect(resumed.sourceContext.sources[0]).toMatchObject({status:'refresh-required',authority:'new-user-gesture-required'});
 expect(resumed.task.sources[0].documentChange).toBeUndefined();
 expect(resumed.task.session?.draft).toBe('Unsent local correction');expect(resumed.task.procedures).toEqual(f.task.procedures);
 const follow=new DocumentSourceFollow({core:f.core,observe:async()=>{throw Error('No automatic observation on resume');},approve:async()=>{throw Error('No restored grant');},refresh:async()=>{throw Error('No automatic capture');},retire:()=>{},changed:()=>{}});
 expect(follow.read().kind).toBe('off');expect(await follow.poll()).toMatchObject({kind:'off'});
 expect(await f.core.checkProcedure(f.task.id,f.procedureId,{values:{}})).toMatchObject({ready:false,executionAuthorized:false});
});

it('retains historical dependency revisions after an explicitly corrected current procedure',async()=>{
 const f=await fixture();let task=f.task;
 for(const revision of [1,2])task=await f.core.saveProcedure(task.id,{id:f.procedureId,expectedRevision:revision,title:'Earlier revision',steps,sourceRefs:[f.ref]});
 task=await f.core.putSource(f.task.id,{id:f.ref.sourceId,kind:'text',label:'Updated',content:'Updated',role:'fact'});
 task=await f.core.saveProcedure(task.id,{id:f.procedureId,expectedRevision:3,title:'Corrected',steps,sourceRefs:[sourceRef(task)]});
 expect(affected(task)).toEqual([{procedureId:f.procedureId,currentRevision:4,revisions:[3,2,1].map(revision=>({revision,sourceRefs:[{...f.ref,availability:'available',versionRelation:'superseded',freshness:'fresh'}]}))}]);
 expect(JSON.parse(projectTaskDialogue(task,'next',[])).sourceResume.affectedProcedures).toEqual([]);
 expect(taskHistoryReview(projectTaskDialogue(task,'next',[]))).not.toContain('1 saved procedure');
 expect(await f.core.checkProcedure(task.id,f.procedureId,{values:{}})).toMatchObject({ready:true,executionAuthorized:false});
 await f.restart();expect(affected(await f.core.getTask(task.id))).toEqual(affected(task));
});

it('keeps superseded and current version relations separate from source uncertainty',async()=>{
 const f=await fixture();let task=await f.core.putSource(f.task.id,{id:f.ref.sourceId,kind:'text',label:'Updated',content:'Updated',role:'fact'});const current=sourceRef(task);
 task=await f.core.saveProcedure(task.id,{id:f.procedureId,expectedRevision:1,title:'Current dependency',steps,sourceRefs:[current]});
 task=await f.core.invalidateSource(task.id,f.ref.sourceId,'Freshness is unknown');
 expect(affected(task)[0].revisions).toEqual([
  {revision:2,sourceRefs:[{...current,availability:'available',versionRelation:'current',freshness:'refresh-required'}]},
  {revision:1,sourceRefs:[{...f.ref,availability:'available',versionRelation:'superseded',freshness:'refresh-required'}]},
 ]);
});

it.each(['absent','unavailable-version','unavailable-digest','mismatched-record-id'] as const)('projects an unavailable dependency safely: %s',async variant=>{
 const f=await fixture(),task=structuredClone(f.task);
 if(variant==='absent')task.sources=[];
 else if(variant==='unavailable-version')task.procedures[0].revisions[0].sourceRefs[0].version=99;
 else if(variant==='unavailable-digest')task.procedures[0].revisions[0].sourceRefs[0].digest='f'.repeat(64);
 else task.sources[0].versions[0].id='other-source';
 const ref=task.procedures[0].revisions[0].sourceRefs[0],before=structuredClone(task);
 expect(affected(task)).toEqual([{procedureId:f.procedureId,currentRevision:1,revisions:[{revision:1,sourceRefs:[{...ref,availability:'unavailable',versionRelation:'unknown',freshness:variant==='absent'?'unknown':'fresh'}]}]}]);
 expect(task).toEqual(before);
});

it('does not infer a current dependency from an ambiguous latest snapshot owned by another source',async()=>{
 const f=await fixture(),task=structuredClone(f.task);
 task.sources[0].versions.push({...task.sources[0].versions[0],id:'foreign-owner'});
 expect(affected(task)[0].revisions[0].sourceRefs).toEqual([{...f.ref,availability:'available',versionRelation:'unknown',freshness:'fresh'}]);
});

it('does not attribute an unrelated current source to a procedure with one changed dependency',async()=>{
 const f=await fixture();let task=await f.core.putSource(f.task.id,{kind:'text',label:'Unrelated',content:'Unrelated body',role:'fact'});const other=sourceRef(task,1);
 task=await f.core.saveProcedure(task.id,{id:f.procedureId,expectedRevision:1,title:'Two dependencies',steps,sourceRefs:[f.ref,other]});
 task=await f.core.invalidateSource(task.id,f.ref.sourceId,'Explicit uncertainty');
 expect(affected(task)[0].revisions.map(revision=>revision.sourceRefs)).toEqual([[{...f.ref,availability:'available',versionRelation:'current',freshness:'refresh-required'}],[{...f.ref,availability:'available',versionRelation:'current',freshness:'refresh-required'}]]);
 expect(JSON.stringify(affected(task))).not.toContain(other.sourceId);
});

it('keeps procedure dependencies stale when a selected-window follow refresh is cancelled',async()=>{
 const f=await fixture('window');let observation=stampA,release!:()=>void,entered!:()=>void,captures=0;
 const waiting=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>entered=resolve);
 const follow=new DocumentSourceFollow({core:f.core,observe:async(_target,options)=>{options.assertCurrent();return {kind:'document',stamp:observation};},approve:async()=>'address',refresh:async(_binding,_stamp,guard)=>{entered();await waiting;guard();captures++;return null;},retire:()=>{},changed:()=>{}});
 follow.bind({task:f.task,sourceId:f.ref.sourceId,target:native});await follow.enable();observation=stampB;
 const polling=follow.poll();await started;follow.stop('Explicit cancellation');release();await polling;
 const task=await f.core.getTask(f.task.id);
 expect(captures).toBe(0);expect(follow.read().kind).toBe('off');expect(task.sources[0].currentVersion).toBe(1);
 expect(affected(task)[0].revisions[0]).toEqual({revision:1,sourceRefs:[{...f.ref,availability:'available',versionRelation:'current',freshness:'refresh-required'}]});
 expect(task.procedures).toEqual(f.task.procedures);
 await f.restart();expect(affected(await f.core.getTask(task.id))).toEqual(affected(task));
});

it('still reviews older host projections that have no procedure dependency summary',async()=>{
 const f=await fixture(),history=JSON.parse(projectTaskDialogue(f.task,'next',[]));delete history.sourceResume.affectedProcedures;
 expect(taskHistoryReview(JSON.stringify(history))).not.toContain('saved procedures');
});

it('keeps local dependency metadata inspectable while unselected stale context stays out of ordinary requests',async()=>{
 const f=await fixture();await f.core.invalidateSource(f.task.id,f.ref.sourceId,'Current source state is unknown');
 let history='',selectedSources=-1;
 const request=await f.core.runRequest({taskId:f.task.id,requestId:'review-dependencies',kind:'explain',prompt:'Which saved procedure needs review?',sourceIds:[]},async context=>{
  history=context.taskHistory!;selectedSources=context.task.sources.length;
  return {title:'Local test response',content:'Historical dependencies need explicit source review.'};
 });
 expect(request.status).toBe('completed');expect(selectedSources).toBe(0);
 expect(sourceResumeContext(await f.core.getTask(f.task.id)).affectedProcedures[0]).toEqual({procedureId:f.procedureId,currentRevision:1,revisions:[{revision:1,sourceRefs:[{...f.ref,availability:'available',versionRelation:'current',freshness:'refresh-required'}]}]});
 expect(JSON.parse(history).sourceResume.affectedProcedures).toEqual([]);
 expect(history).not.toContain('Private procedure body');expect(history).not.toContain('Private source body');
 expect((await f.core.getTask(f.task.id)).procedures).toEqual(f.task.procedures);
});
