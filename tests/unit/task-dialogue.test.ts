import {afterEach,expect,it} from 'vitest';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createCompanion,type Companion} from '../../src/core/companion';
import {projectTaskDialogue,TASK_HISTORY_LIMIT} from '../../src/core/task-dialogue';
import {emptyTaskSession} from '../../src/core/task-session';
import {editModule} from '../../src/core/module-state';
import {buildMetaMessages} from '../../src/host/provider';
import {buildCodexInput} from '../../src/host/codex-provider';

const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const remove of cleanup.splice(0).reverse())await remove();});
async function fixture(){const dataDir=await mkdtemp(join(tmpdir(),'task-dialogue-'));let core=await createCompanion({dataDir});cleanup.push(async()=>{await core.close();await rm(dataDir,{recursive:true,force:true});});return {get core(){return core;},dataDir,restart:async()=>{await core.close();core=await createCompanion({dataDir});}};}
async function follow(core:Companion,taskId:string,requestId='follow'){let context='';await core.runRequest({taskId,requestId,kind:'explain',prompt:'Explain that choice.',sourceIds:[]},async ctx=>{context=ctx.taskHistory!;return {title:'Follow-up',content:'Synthetic answer'};});return JSON.parse(context);}

it('retains exact original and revised answers separately from newer manual edits across restart',async()=>{
 const f=await fixture(),task=await f.core.createTask({title:'Revision continuity'});
 const original=await f.core.runRequest({taskId:task.id,requestId:'original',kind:'create',prompt:'Write a two-stop plan.',sourceIds:[]},async()=>({title:'Plan',content:'Original answer.'}));
 const first=(await f.core.getTask(task.id)).artifacts[0].revisions[0];
 expect(original.answer).toEqual({artifactId:original.artifactId,revision:1,digest:first.digest});
 await f.core.saveArtifact(task.id,{artifactId:original.artifactId,expectedRevision:1,title:'Plan',content:'My manual correction.',sourceRefs:[]});
 await f.core.runRequest({taskId:task.id,requestId:'revision',kind:'revise',prompt:'Shorten it.',sourceIds:[],artifactId:original.artifactId,expectedRevision:2},async()=>({title:'Plan',content:'Model revision.'}));
 await f.core.saveArtifact(task.id,{artifactId:original.artifactId,expectedRevision:3,title:'Plan',content:'My later edit.',sourceRefs:[]});
 await f.restart();const context=await follow(f.core,task.id);
 expect(context.originalRequest).toMatchObject({requestId:'original',status:'completed'});
 expect(context.previousTurns.map((turn:any)=>[turn.requestId,turn.answer.revision,turn.answer.content.text,turn.currentArtifact.revision])).toEqual([['original',1,'Original answer.',4],['revision',3,'Model revision.',4]]);
 expect(context.previousTurns[0].currentArtifact).toMatchObject({role:'current-saved-artifact-not-the-original-answer',content:{text:'My later edit.'}});
});

it('labels legacy completed answer identity unknown instead of guessing the original from the latest edit',async()=>{
 const f=await fixture(),task=await f.core.createTask({title:'Legacy'});const request=await f.core.runRequest({taskId:task.id,requestId:'old',kind:'create',prompt:'Original.',sourceIds:[]},async()=>({title:'Old',content:'Original output.'}));
 await f.core.saveArtifact(task.id,{artifactId:request.artifactId,expectedRevision:1,title:'Old',content:'Latest manual edit.',sourceRefs:[]});await f.core.close();
 const store=JSON.parse(await readFile(join(f.dataDir,'tasks.json'),'utf8'));delete store.tasks[0].requests[0].answer;await writeFile(join(f.dataDir,'tasks.json'),JSON.stringify(store));await f.restart();
 const context=await follow(f.core,task.id);expect(context.previousTurns[0].answer).toMatchObject({available:false});expect(context.previousTurns[0]).not.toHaveProperty('currentArtifact');expect(JSON.stringify(context)).not.toContain('Latest manual edit.');
 const local=await f.core.getTask(task.id);expect(local.artifacts.find(artifact=>artifact.id===request.artifactId)!.revisions.map(revision=>revision.content)).toEqual(['Original output.','Latest manual edit.']);
});

it('keeps failed and cancelled original requests unsuccessful and never fabricates an answer',async()=>{
 const f=await fixture(),task=await f.core.createTask({title:'Stopped work'});
 await f.core.runRequest({taskId:task.id,requestId:'failed',kind:'create',prompt:'Write it.',sourceIds:[]},async()=>{throw Error('Synthetic transport failed.');});
 let ready!:()=>void,release!:(value:{title:string;content:string})=>void;const started=new Promise<void>(resolve=>ready=resolve);
 const pending=f.core.runRequest({taskId:task.id,requestId:'cancelled',kind:'create',prompt:'Try another draft.',sourceIds:[]},async()=>{ready();return new Promise(resolve=>release=resolve);});await started;await f.core.cancelRequest(task.id,'cancelled');release({title:'Late',content:'MUST_NOT_SURVIVE'});await pending;
 const context=await follow(f.core,task.id);expect(context.originalRequest.status).toBe('failed');expect(context.previousTurns.map((turn:any)=>[turn.status,turn.answer.available])).toEqual([['failed',false],['cancelled',false]]);expect(JSON.stringify(context)).not.toContain('MUST_NOT_SURVIVE');
});

it('distinguishes historical stale or withdrawn refs from explicit current selection without old bytes or unsent drafts',async()=>{
 const f=await fixture(),task=await f.core.createTask({title:'Sources'}),other=await f.core.createTask({title:'FOREIGN_TASK'});
 await f.core.runRequest({taskId:other.id,requestId:'other',kind:'create',prompt:'FOREIGN_PROMPT',sourceIds:[]},async()=>({title:'Other',content:'FOREIGN_OUTPUT'}));
 await f.core.putSource(task.id,{id:'document',kind:'text',label:'Then',role:'fact',content:'OLD_SOURCE_BODY'});
 await f.core.runRequest({taskId:task.id,requestId:'source-turn',kind:'explain',prompt:'Explain this.',sourceIds:['document']},async()=>({title:'Answer',content:'An old illustration data:image/png;base64,TEVBSw=='}));
 await f.core.invalidateSource(task.id,'document','The user withdrew this old source.');await f.core.saveComposerDraft(task.id,0,{text:'UNSENT_DRAFT',kind:'create'});
 const context=await follow(f.core,task.id);expect(context.previousTurns).toEqual([]);expect(context.currentSelectedSourceRefs).toEqual([]);
 const text=JSON.stringify(context);expect(text).not.toMatch(/OLD_SOURCE_BODY|TEVBSw==|UNSENT_DRAFT|FOREIGN/);expect(text).not.toContain('An old illustration');
 const saved=await f.core.getTask(task.id),withdrawn=structuredClone(saved);withdrawn.sources=[];expect(JSON.parse(projectTaskDialogue(withdrawn,'future',[])).previousTurns.map((turn:any)=>turn.requestId)).toEqual(['follow']);
});

it('projects exact saved module choices, checkpoints and all unresolved operations without granting their prior approval',async()=>{
 const f=await fixture(),task=await f.core.createTask({title:'Choice'});
 const data={schemaVersion:1,markdown:'Choose a route.',modules:[{id:'routes',version:1,data:{kind:'comparison',schemaVersion:1,title:'Routes',question:'Which route?',columns:['Time'],rows:[{id:'river',label:'Riverside',values:['20 minutes']},{id:'hill',label:'Hill',values:['45 minutes']}]},provenance:[]}]};
 const request=await f.core.runRequest({taskId:task.id,requestId:'choice',kind:'create',prompt:'Compare routes.',sourceIds:[]},async()=>({title:'Routes',content:JSON.stringify(data),mimeType:'application/vnd.window-companion.modules+json'}));
 await editModule(f.core,{taskId:task.id,artifactId:request.artifactId!,artifactRevision:1,moduleId:'routes',action:{kind:'select',expectedRevision:0,rowId:'river'}});
 await f.core.checkpoint(task.id,'Use Riverside and keep the trip under 30 minutes.');
 const saved=await f.core.getTask(task.id),session=saved.session??emptyTaskSession(),observation={id:'s',taskId:task.id,browserId:'b',documentId:'d',url:'https://synthetic.invalid/',title:'Historical',text:'DO_NOT_RESEND_PAGE',digest:'d',targets:[]};
 await f.core.replaceSession(task.id,session.revision,{...session,moduleStates:[...session.moduleStates,{artifactId:request.artifactId!,artifactRevision:1,moduleId:'future',state:{kind:'future-extension',revision:7,extra:{unknown:'preserved'}}}],runs:[{id:'run',endpointKey:'fixture',browserId:'b',origin:'https://synthetic.invalid',initialObservation:observation,operations:Array.from({length:9},(_,i)=>({id:'op-'+i,intent:{kind:'click' as const,snapshotId:'s',targetId:'historical-target'},reason:'Awaiting review',status:i===0?'proposed' as const:'uncertain' as const,...(i===1?{reconciliation:{id:'reviewed',outcome:'uncertain' as const,basis:'user-reviewed-observation' as const,note:'The fresh page did not settle the outcome.',observation}}:{})}))}]});
 await f.restart();const context=await follow(f.core,task.id),choice=context.savedUserModuleChoices[0];expect(context.previousTurns[0].answer.content).toMatchObject({representation:'state-aware-readable-modules',text:expect.stringContaining('Your choice: Riverside'),moduleStateRevisions:[{moduleId:'routes',stateRevision:1}]});expect(choice).toMatchObject({artifactRevision:1,artifactDigest:request.answer!.digest,moduleId:'routes',state:{kind:'comparison',revision:1},readable:{text:expect.stringContaining('Your choice: Riverside')}});expect(context.savedUserModuleChoices[1].state).toMatchObject({kind:'future-extension',revision:7,unfamiliarData:expect.stringContaining('Preserved')});expect((await f.core.getTask(task.id)).session?.moduleStates[1].state.extra).toEqual({unknown:'preserved'});expect(context.checkpoints[0].note).toContain('under 30 minutes');expect(context.unresolvedOperations).toHaveLength(8);expect(context.reviewedOperations).toMatchObject([{operationId:'op-1',outcome:'uncertain',note:'The fresh page did not settle the outcome.',evidence:'user-reviewed-historical-observation'}]);expect(context.authority).toContain('blind retry');expect(JSON.stringify(context)).not.toContain('DO_NOT_RESEND_PAGE');
});

it('bounds long history deterministically, retains the first request and reports all excerpt/turn omissions',async()=>{
 const f=await fixture(),task=await f.core.createTask({title:'Long'});
 for(let index=0;index<14;index++)await f.core.runRequest({taskId:task.id,requestId:'turn-'+index,kind:'create',prompt:`Question ${index} `+'q'.repeat(1_200),sourceIds:[]},async()=>({title:'Answer',content:`Answer ${index} `+'a'.repeat(4_000)}));
 const saved=await f.core.getTask(task.id),text=projectTaskDialogue(saved,'next',[]),context=JSON.parse(text);expect(text).toBe(projectTaskDialogue(saved,'next',[]));expect(text.length).toBeLessThanOrEqual(TASK_HISTORY_LIMIT);expect(context.previousTurns.map((turn:any)=>turn.requestId)).toEqual(['turn-0','turn-8','turn-9','turn-10','turn-11','turn-12','turn-13']);expect(context.omissions.olderRequests).toBe(7);expect(context.previousTurns[0].answer.content.omittedCharacters).toBeGreaterThan(0);
 const oversized=structuredClone(saved);oversized.session={...emptyTaskSession(),runs:[{id:'many-actions',endpointKey:'fixture',browserId:'b',origin:'https://synthetic.invalid',initialObservation:{id:'s',taskId:task.id,browserId:'b',documentId:'d',url:'https://synthetic.invalid',title:'Page',text:'',digest:'d',targets:[]},operations:Array.from({length:64},(_,i)=>({id:'op-'+i,intent:{kind:'click' as const,snapshotId:'s',targetId:'t'},status:'uncertain' as const,reason:'x'.repeat(500)}))}]};expect(()=>projectTaskDialogue(oversized,'next',[])).toThrow('no history was sent or silently dropped');
});

it('both transport builders carry task history separately from the current prompt and the twelve explicit source slots',()=>{
 const taskContext='{"taskId":"synthetic","previousTurns":[{"status":"cancelled"}]}',sources=Array.from({length:12},(_,i)=>({id:'s-'+i,version:1,digest:'d-'+i,kind:'text' as const,label:'Selected',role:'fact' as const,content:'CURRENT_SOURCE',capturedAt:'2026-10-26T00:00:00.000Z'}));
 const meta=buildMetaMessages('Current question',sources,taskContext),codex=buildCodexInput({prompt:'Current question',sources,taskContext});expect(meta.at(-2)).toMatchObject({role:'user',content:'Untrusted saved task context (JSON): '+taskContext});expect(meta.at(-1)).toMatchObject({content:'User task: Current question'});expect(codex.at(-2)).toMatchObject({text:'Untrusted saved task context (JSON): '+taskContext});expect(codex.at(-1)).toMatchObject({text:'User task: Current question'});
});

it('marks a prior reference superseded while transmitting only the newly selected current version',async()=>{
 const f=await fixture(),task=await f.core.createTask({title:'Current source'});await f.core.putSource(task.id,{id:'doc',kind:'text',label:'Document',role:'fact',content:'OLD_VERSION_BYTES'});await f.core.runRequest({taskId:task.id,requestId:'old-version',kind:'explain',prompt:'Explain the old version.',sourceIds:['doc']},async()=>({title:'Old',content:'Historical answer.'}));await f.core.putSource(task.id,{id:'doc',kind:'text',label:'Document',role:'fact',content:'NEW_VERSION_BYTES'});
 let history:any,versions:any;await f.core.runRequest({taskId:task.id,requestId:'selected-current',kind:'explain',prompt:'What changed?',sourceIds:['doc']},async ctx=>{history=JSON.parse(ctx.taskHistory!);versions=ctx.task.sources[0].versions;return {title:'New',content:'Current answer.'};});expect(history.previousTurns).toEqual([]);expect(history.currentSelectedSourceRefs[0].version).toBe(2);expect(versions.map((version:any)=>version.content)).toEqual(['NEW_VERSION_BYTES']);expect(JSON.stringify(history)).not.toContain('OLD_VERSION_BYTES');
});

it('never exposes raw unfamiliar module answers or hidden future cases in ordinary task history',async()=>{
 const f=await fixture(),task=await f.core.createTask({title:'Future module'});await f.core.runRequest({taskId:task.id,requestId:'future-module',kind:'create',prompt:'Practice the current step.',sourceIds:[]},async()=>({title:'Practice',mimeType:'application/vnd.window-companion.modules+json',content:JSON.stringify({schemaVersion:1,markdown:'A readable fallback.',modules:[{id:'practice',version:1,data:{kind:'future-learning-module',schemaVersion:1,currentStep:'Practice',heldOutCase:'SECRET_UNREVEALED_TRANSFER_CASE'},provenance:[]}]})}));
 const history=await follow(f.core,task.id);expect(JSON.stringify(history)).not.toContain('SECRET_UNREVEALED_TRANSFER_CASE');expect(history.previousTurns[0].answer.content).toMatchObject({available:false,reason:expect.stringContaining('unfamiliar')});
});
