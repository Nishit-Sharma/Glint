import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,test,vi} from 'vitest';
import {createCompanion} from '../src/core/companion';
import {createTextHelper} from '../src/core/text-helper-host';
import {editModule} from '../src/core/module-state';
import {parseModuleAnswer,updateModuleState} from '../src/core/interactive-modules';
import {savedHelpers,resolveSavedHelper} from '../src/shared/saved-helpers';
import {pickingPlan,inventory,pickingRequest} from './picking-fixture';
const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{vi.restoreAllMocks();for(const close of cleanups.splice(0))await close();});
export function pickingCases(){return [
 {id:'fresh',role:'held-out',table:{id:'newInventory',rows:[{id:'freshRow',values:['P-42','East tool',7,false]}]},request:{...pickingRequest,key:'P-42',quantity:6,delivery:'courier'},expected:{status:'completed',output:{itemKey:'P-42',label:'East tool',quantity:6,handling:'Prepare for courier'}}},
 {id:'approval',role:'counterexample',table:inventory(),request:{...pickingRequest,reviewed:false},expected:{status:'abstained',haltedStepId:'reviewed',code:'precondition'}},
 {id:'private',role:'exception',table:{id:'privateTable',rows:[{id:'privateRow',values:['K-17','Private',9,true]}]},request:pickingRequest,expected:{status:'abstained',haltedStepId:'protectedStop',code:'explicit-stop'}},
 {id:'stock',role:'exception',table:inventory(),request:{...pickingRequest,quantity:10},expected:{status:'abstained',haltedStepId:'stockStop',code:'explicit-stop'}},
 {id:'delivery',role:'exception',table:inventory(),request:{...pickingRequest,delivery:'airdrop'},expected:{status:'abstained',haltedStepId:'deliveryStop',code:'explicit-stop'}},
 {id:'missing',role:'exception',table:inventory(),request:{...pickingRequest,key:'missing'},expected:{status:'abstained',code:'lookup-missing'}},
 {id:'duplicate',role:'exception',table:{id:'duplicates',rows:[...inventory().rows,{id:'duplicate',values:['K-17','Duplicate',3,false]}]},request:pickingRequest,expected:{status:'abstained',code:'lookup-ambiguous'}},
];}
export async function pickingOwner(){
 const directory=await mkdtemp(join(tmpdir(),'picking-helper-')),core=await createCompanion({dataDir:directory});cleanups.push(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});
 const task=await core.createTask({title:'Owned picking helper'}),created=await createTextHelper(core,{taskId:task.id,requestId:'createPicking'}),artifact=created.task.artifacts.find(a=>a.id===created.artifactId)!,module=parseModuleAnswer(JSON.parse(artifact.revisions[0].content)).modules[0];
 const target={taskId:task.id,artifactId:artifact.id,artifactRevision:1,moduleId:module.id};
 const read=async()=>{const task=await core.getTask(target.taskId);return task.session!.moduleStates[0].state as any;};
 const act=async(action:Record<string,unknown>)=>{const task=await core.getTask(target.taskId),state=task.session?.moduleStates[0]?.state;await editModule(core,{...target,action:{...action,expectedRevision:state?.revision??0} as never});return read();};
 await act({kind:'begin-table-helper'});await act({kind:'picking-candidate',definition:pickingPlan(),reason:'Declare the reviewed stock and delivery rules.'});
 return {directory,core,target,module,act,read};
}
export async function recorded(){
 const f=await pickingOwner();let state=await f.act({kind:'picking-context',table:inventory(),request:pickingRequest});const contextId=state.currentContextId;
 await f.act({kind:'picking-record-start',contextId});await f.act({kind:'picking-select-row',rowId:'chosen'});
 for(const [source,field,output] of [['row','sku','itemKey'],['row','name','label'],['request','quantity','quantity']])await f.act({kind:'picking-copy',source,field,output});
 await f.act({kind:'picking-literal',output:'handling',value:'Collect locally'});await f.act({kind:'picking-record-stop'});await f.act({kind:'picking-propose'});await f.act({kind:'picking-cases',cases:pickingCases()});return f;
}
export async function released(){const f=await recorded();let state=await f.act({kind:'picking-save',note:'First checked recipe'});state=await f.act({kind:'picking-activate',version:1,digest:state.releases[0].digest,generation:0});return f;}
async function fresh(f:Awaited<ReturnType<typeof released>>){const example=pickingCases()[0];return f.act({kind:'picking-context',table:example.table,request:example.request});}
async function prepare(f:Awaited<ReturnType<typeof released>>,id='runOne'){const state=await fresh(f);return f.act({kind:'picking-prepare',runId:id,releaseDigest:state.activation.digest,generation:state.activation.generation,contextId:state.currentContextId,targetRevision:0});}

test('actual module host admits local actions while generic update and caller-supplied observations refuse',async()=>{
 const f=await pickingOwner(),state=await f.act({kind:'picking-context',table:inventory(),request:pickingRequest});
 expect(()=>updateModuleState(f.module.data,state,{kind:'picking-record-start',contextId:state.currentContextId,expectedRevision:state.revision})).toThrow(/host/i);
 await expect(f.act({kind:'picking-record-start',contextId:state.currentContextId,observed:true,result:{status:'completed'}})).rejects.toThrow();
 await f.act({kind:'picking-record-start',contextId:state.currentContextId});await f.act({kind:'picking-select-row',rowId:'chosen'});
 const next=await f.read();expect(next.recording.events.at(-1).step).toMatchObject({kind:'select-row',rowId:'chosen'});expect(next.owner).toMatchObject(f.target);expect(next.recording.events.at(-1)).not.toHaveProperty('physicalHumanVerified');
});
test('checked release pins evaluator/cases/observations, saves inactive, and rollback advances activation',async()=>{
 const f=await recorded();let state=await f.act({kind:'picking-save',note:'First'});expect(state.activation).toEqual({generation:0,version:null,digest:null});const old=JSON.stringify(state.releases[0]);
 expect(state.releases[0]).toMatchObject({capability:'owned-local-manifest:v2',evaluator:{id:'table-procedure',version:2},checks:{passed:true,independentHeldOutVerified:false}});expect(state.releases[0].caseSetDigest).toMatch(/^[a-f0-9]{64}$/);
 state=await f.act({kind:'picking-activate',version:1,digest:state.releases[0].digest,generation:0});await f.act({kind:'picking-save',note:'Second same behavior'});state=await f.read();await f.act({kind:'picking-activate',version:2,digest:state.releases[1].digest,generation:1});state=await f.act({kind:'picking-activate',version:1,digest:state.releases[0].digest,generation:2});
 expect(state.activation).toMatchObject({generation:3,version:1});expect(JSON.stringify(state.releases[0])).toBe(old);await expect(f.act({kind:'picking-activate',version:1,digest:state.releases[0].digest,generation:0})).rejects.toThrow(/generation|changed/i);
});
test('failed declared case blocks save and corrections never rewrite observed actions',async()=>{
 const f=await recorded(),before=await f.read(),observed=JSON.stringify(before.observations);const cases=pickingCases();cases[0].expected={status:'completed',output:{itemKey:'Wrong'}} as any;await f.act({kind:'picking-cases',cases});await expect(f.act({kind:'picking-save',note:'Bad'})).rejects.toThrow(/check/i);expect((await f.read()).releases).toEqual([]);
 await f.act({kind:'picking-candidate',definition:pickingPlan(),reason:'Correct and retain the declared rules.'});expect(JSON.stringify((await f.read()).observations)).toBe(observed);expect((await f.read()).corrections.at(-1).reason).toContain('Correct');
});
test('apply atomically commits local target and receipt; replay never creates a second revision',async()=>{
 const f=await released();let state=await prepare(f);expect(state.attempts[0].status).toBe('prepared');expect(state.contexts.at(-1).target).toMatchObject({revision:0,value:null});
 state=await f.act({kind:'picking-apply',runId:'runOne'});expect(state.contexts.at(-1).target).toMatchObject({revision:1,value:{itemKey:'P-42',label:'East tool',quantity:6,handling:'Prepare for courier'}});expect(state.attempts[0]).toMatchObject({status:'completed',targetRevisionAfter:1});const before=await f.core.getTask(f.target.taskId);
 await f.act({kind:'picking-apply',runId:'runOne'});expect(await f.core.getTask(f.target.taskId)).toEqual(before);
 await expect(f.act({kind:'picking-prepare',runId:'runOne',releaseDigest:state.activation.digest,generation:state.activation.generation,contextId:state.currentContextId,targetRevision:1})).rejects.toThrow(/payload|identity|conflict/i);
});
test('cancel and newer activation retire uncommitted work and old completion cannot rewind',async()=>{
 const f=await released();let state=await prepare(f);state=await f.act({kind:'picking-cancel',runId:'runOne'});expect(state.attempts[0].status).toBe('cancelled');await f.act({kind:'picking-apply',runId:'runOne'});expect((await f.read()).contexts.at(-1).target.revision).toBe(0);
 state=await f.read();await f.act({kind:'picking-prepare',runId:'runTwo',releaseDigest:state.activation.digest,generation:1,contextId:state.currentContextId,targetRevision:0});await f.act({kind:'picking-activate',version:1,digest:state.activation.digest,generation:1});await f.act({kind:'picking-apply',runId:'runTwo'});state=await f.read();expect(state.attempts[1].status).toBe('retired');expect(state.contexts.at(-1).target.revision).toBe(0);
});
test('atomic store failure leaves neither target nor completion, and changed owner blocks commit',async()=>{
 const f=await released();await prepare(f);const before=await f.core.getTask(f.target.taskId),replace=f.core.replaceSession.bind(f.core);
 vi.spyOn(f.core,'replaceSession').mockRejectedValueOnce(Error('Synthetic atomic failure'));await expect(f.act({kind:'picking-apply',runId:'runOne'})).rejects.toThrow('Synthetic atomic failure');expect(await f.core.getTask(f.target.taskId)).toEqual(before);
 vi.spyOn(f.core,'replaceSession').mockImplementationOnce(async(...args)=>{await f.core.saveArtifact(f.target.taskId,{artifactId:f.target.artifactId,expectedRevision:1,title:'Changed owner',content:'Ordinary replacement',sourceRefs:[]});return replace(...args);});await expect(f.act({kind:'picking-apply',runId:'runOne'})).rejects.toThrow(/artifact changed/i);expect((await f.read()).contexts.at(-1).target.revision).toBe(0);
});

test('release provenance and prior unsaved inferred reasons survive correction and draft replacement',async()=>{
 const f=await recorded();let state=await f.act({kind:'picking-save',note:'Before correction'});const first=JSON.stringify(state.releases[0]);expect(state.releases[0].candidate.observationId).toBe(state.observations[0].id);
 const originalReason=state.candidate.currentReason;await f.act({kind:'picking-reason',reason:'Only the selected local row supports these copied fields.'});state=await f.act({kind:'picking-candidate',definition:pickingPlan(),reason:'Retain the reviewed fields.'});expect(state.candidateHistory.some((h:any)=>h.candidate.currentReason===originalReason)).toBe(true);expect(state.candidateHistory.some((h:any)=>h.candidate.currentReason==='Only the selected local row supports these copied fields.')).toBe(true);expect(JSON.stringify(state.releases[0])).toBe(first);
});
test('cancel wins a held precommit apply and the late writer cannot revive the target',async()=>{
 const f=await released();await prepare(f);const replace=f.core.replaceSession.bind(f.core);let entered!:()=>void,release!:()=>void;const arrived=new Promise<void>(r=>{entered=r;}),held=new Promise<void>(r=>{release=r;});
 vi.spyOn(f.core,'replaceSession').mockImplementationOnce(async(...args)=>{entered();await held;return replace(...args);});const applying=f.act({kind:'picking-apply',runId:'runOne'});
 try{await arrived;await f.act({kind:'picking-cancel',runId:'runOne'});release();await expect(applying).rejects.toThrow(/session changed/i);const state=await f.read();expect(state.attempts[0].status).toBe('cancelled');expect(state.contexts.at(-1).target.revision).toBe(0);}finally{release();await applying.catch(()=>{});}
});
test('lost postcommit response remains inspectable and same-ID replay creates no duplicate after reopen',async()=>{
 const f=await released();await prepare(f);const replace=f.core.replaceSession.bind(f.core);vi.spyOn(f.core,'replaceSession').mockImplementationOnce(async(...args)=>{await replace(...args);throw Error('Owned dropped reply after commit');});await expect(f.act({kind:'picking-apply',runId:'runOne'})).rejects.toThrow('Owned dropped reply after commit');const committed=await f.core.getTask(f.target.taskId),state=await f.read();expect(state.attempts[0].status).toBe('completed');
 await f.act({kind:'picking-prepare',runId:'runOne',releaseDigest:state.activation.digest,generation:1,contextId:state.currentContextId,targetRevision:0});expect(await f.core.getTask(f.target.taskId)).toEqual(committed);await f.core.close();const reopened=await createCompanion({dataDir:f.directory});try{const saved=await reopened.getTask(f.target.taskId);expect(saved.session!.moduleStates).toEqual(committed.session!.moduleStates);}finally{await reopened.close();}
});

test('saved picking release is discoverable only through its exact original owner',async()=>{const f=await released(),task=await f.core.getTask(f.target.taskId),entries=savedHelpers([task]);expect(entries).toHaveLength(1);expect(entries[0]).toMatchObject({scope:'table',activeVersion:1});expect(resolveSavedHelper(task,entries[0]).id).toBe(f.target.artifactId);await f.act({kind:'picking-deactivate'});const changed=await f.core.getTask(f.target.taskId);expect(()=>resolveSavedHelper(changed,entries[0])).toThrow();
});

test('actual observed handling becomes only the visited proposed literal and does not rewrite the other branch',async()=>{
 const f=await pickingOwner();let state=await f.act({kind:'picking-context',table:inventory(),request:pickingRequest});await f.act({kind:'picking-record-start',contextId:state.currentContextId});await f.act({kind:'picking-select-row',rowId:'chosen'});for(const [source,field,output] of [['row','sku','itemKey'],['row','name','label'],['request','quantity','quantity']])await f.act({kind:'picking-copy',source,field,output});await f.act({kind:'picking-literal',output:'handling',value:'Pick at the local desk'});await f.act({kind:'picking-record-stop'});state=await f.act({kind:'picking-propose'});const modulePath='../src/learning/semantic-table-procedure';const {runTableProcedure}=await import(modulePath);
 expect(runTableProcedure(state.candidate.definition,inventory(),pickingRequest)).toMatchObject({status:'completed',output:{handling:'Pick at the local desk'}});expect(runTableProcedure(state.candidate.definition,inventory(),{...pickingRequest,delivery:'courier'})).toMatchObject({status:'completed',output:{handling:'Prepare for courier'}});expect(state.candidate.definition.version).toBe(2);expect(state.contexts[0].definition.version).toBe(1);
});
test('incorrect manual final values stop before commit and are repairable inside the original recording',async()=>{
 const f=await pickingOwner();let state=await f.act({kind:'picking-context',table:inventory(),request:pickingRequest});await f.act({kind:'picking-record-start',contextId:state.currentContextId});await f.act({kind:'picking-select-row',rowId:'distractor'});for(const [source,field,output] of [['row','sku','itemKey'],['row','name','label'],['request','quantity','quantity']])await f.act({kind:'picking-copy',source,field,output});await f.act({kind:'picking-literal',output:'handling',value:'Collect locally'});await expect(f.act({kind:'picking-record-stop'})).rejects.toThrow(/request|outcome|quantity/i);expect((await f.read()).contexts[0].target.revision).toBe(0);await f.act({kind:'picking-select-row',rowId:'chosen'});await f.act({kind:'picking-copy',source:'row',field:'sku',output:'itemKey'});await f.act({kind:'picking-copy',source:'row',field:'name',output:'label'});state=await f.act({kind:'picking-record-stop'});expect(state.observations[0].events.some((e:any)=>e.step.rowId==='distractor')).toBe(true);expect(state.contexts[0].target.value).toMatchObject({itemKey:'K-17',label:'River clamp'});
});
test('receipt inspection is read-only and preparation reserves enough revisions to cancel',async()=>{
 const f=await released();let state=await fresh(f),task=await f.core.getTask(f.target.taskId);const replaceCounter=async(revision:number)=>{task=await f.core.getTask(f.target.taskId);await f.core.replaceSession(f.target.taskId,task.session!.revision,{...task.session!,moduleStates:task.session!.moduleStates.map((m,i)=>i?m:{...m,state:{...m.state,revision}})});};await replaceCounter(499);state=await f.read();await expect(f.act({kind:'picking-prepare',runId:'nearLimit',releaseDigest:state.activation.digest,generation:1,contextId:state.currentContextId,targetRevision:0})).rejects.toThrow(/capacity|revision|limit/i);
 await replaceCounter(498);state=await f.act({kind:'picking-prepare',runId:'nearLimit',releaseDigest:state.activation.digest,generation:1,contextId:state.currentContextId,targetRevision:0});await expect(f.act({kind:'picking-reason',reason:'Do not consume the cancel revision.'})).rejects.toThrow(/capacity|revision|limit/i);state=await f.act({kind:'picking-cancel',runId:'nearLimit'});expect(state.revision).toBe(500);const before=await f.core.getTask(f.target.taskId);await f.act({kind:'picking-inspect',runId:'nearLimit'});expect(await f.core.getTask(f.target.taskId)).toEqual(before);
});

test('a different observed key/projection mapping changes the parameterized lookup instead of replaying declared text',async()=>{
 const f=await pickingOwner(),request={...pickingRequest,key:'River clamp'};let state=await f.act({kind:'picking-context',table:inventory(),request});await f.act({kind:'picking-record-start',contextId:state.currentContextId});await f.act({kind:'picking-select-row',rowId:'chosen'});for(const [source,field,output] of [['row','name','itemKey'],['row','sku','label'],['request','quantity','quantity']])await f.act({kind:'picking-copy',source,field,output});await f.act({kind:'picking-literal',output:'handling',value:'Collect at the assigned desk'});await f.act({kind:'picking-record-stop'});state=await f.act({kind:'picking-propose'});const {runTableProcedure}=await import('../src/learning/semantic-table-procedure');expect(state.candidate.definition.lookup).toMatchObject({column:'name',bindings:expect.arrayContaining([{column:'name',input:'matchedKey'},{column:'sku',input:'matchedLabel'}])});expect(runTableProcedure(state.candidate.definition,inventory(),request)).toMatchObject({status:'completed',output:{itemKey:'River clamp',label:'K-17',handling:'Collect at the assigned desk'}});expect(state.contexts[0].definition.lookup.column).toBe('sku');
});
// Refusal contract: the old unrelated task-note write can no longer happen; the pinned a91 store refuses the provenance-bearing store unchanged.
test('pinned historical task store refuses V2 provenance unchanged while old module execution refuses and current reopen continues the helper',async()=>{
 const f=await released(),before=await f.read(),{Effect}=await import('effect'),oldStore=await import('./fixtures/a91/src/core/store'),oldModules=await import('./fixtures/a91/src/core/interactive-modules'),{expectPinnedReaderRefusal}=await import('./pinned-reader-refusal.fixture'),saved=await f.core.getTask(f.target.taskId);await f.core.close();await expectPinnedReaderRefusal(f.directory,()=>Effect.runPromise(oldStore.readState(f.directory)));expect(()=>oldModules.helperModule.parseState(before)).toThrow();expect(()=>oldModules.updateModuleState(f.module.data as never,before as never,{kind:'run-active',input:'x',expectedRevision:before.revision} as never)).toThrow();const reopened=await createCompanion({dataDir:f.directory});try{const task=await reopened.getTask(f.target.taskId);expect(task.artifacts).toEqual(saved.artifacts);expect(task.requests).toEqual(saved.requests);expect(task.session!.moduleStates).toEqual(saved.session!.moduleStates);expect(task.session!.moduleStates[0].state).toEqual(before);const state=task.session!.moduleStates[0].state;await editModule(reopened,{...f.target,action:{kind:'picking-reason',reason:'Continue the same owned helper after historical preservation.',expectedRevision:state.revision} as never});expect((await reopened.getTask(task.id)).session!.moduleStates[0].state).toMatchObject({candidate:{currentReason:'Continue the same owned helper after historical preservation.'}});}finally{await reopened.close();}
});
test('pause during a held precommit apply prevents the target and receipt commit; inspection stays read-only',async()=>{
 const f=await released();await prepare(f);const {readFile}=await import('node:fs/promises'),used=JSON.parse(await readFile(join(f.directory,'tasks.json'),'utf8')).usedRequestIds,replace=f.core.replaceSession.bind(f.core);vi.spyOn(f.core,'replaceSession').mockImplementationOnce(async(...args)=>{await f.core.pause(f.target.taskId);return replace(...args);});await expect(f.act({kind:'picking-apply',runId:'runOne'})).rejects.toThrow(/active|paused|resume/i);const before=await f.core.getTask(f.target.taskId);expect(before.session!.moduleStates[0].state).toMatchObject({attempts:[{status:'prepared'}]});expect((await f.read()).contexts.at(-1).target.revision).toBe(0);await f.act({kind:'picking-inspect',runId:'runOne'});expect(await f.core.getTask(f.target.taskId)).toEqual(before);await expect(f.act({kind:'picking-apply',runId:'runOne'})).rejects.toThrow(/active|resume/i);expect((await f.core.getTask(f.target.taskId)).session).toEqual(before.session);expect(JSON.parse(await readFile(join(f.directory,'tasks.json'),'utf8')).usedRequestIds).toEqual(used);await f.core.resume(f.target.taskId);const resumed=await f.act({kind:'picking-apply',runId:'runOne'});expect(resumed.attempts[0].status).toBe('completed');expect(resumed.contexts.at(-1).target.revision).toBe(1);expect(JSON.parse(await readFile(join(f.directory,'tasks.json'),'utf8')).usedRequestIds).toEqual(used);
});

test('release evaluator and declared-case tampering fail even after content digests are recomputed',async()=>{
 const f=await released(),state=await f.read(),{pickingHelper,releasePayload}=await import('../src/learning/picking-helper'),{pickingDigest}=await import('../src/shared/picking-digest');
 for(const mutate of [(s:any)=>{s.releases[0].evaluator.version=3;s.releases[0].evaluatorDigest=pickingDigest(s.releases[0].evaluator);},(s:any)=>{s.releases[0].cases[0].table.rows[0].values[1]='Unproven new expected source';s.releases[0].caseSetDigest=pickingDigest(s.releases[0].cases);}]){const changed=structuredClone(state);mutate(changed);changed.releases[0].digest=pickingDigest(releasePayload(changed.releases[0]));changed.activation.digest=changed.releases[0].digest;expect(()=>pickingHelper.parseState(f.module.data.kind==='helper-studio'?f.module.data.id:'',changed)).toThrow(/immutable|checked|release|evaluator/i);}
});

test('activation changes during a held precommit apply are covered by the same atomic session CAS',async()=>{
 const f=await released();await prepare(f);let entered!:()=>void,release!:()=>void;const arrived=new Promise<void>(r=>{entered=r;}),held=new Promise<void>(r=>{release=r;}),replace=f.core.replaceSession.bind(f.core);vi.spyOn(f.core,'replaceSession').mockImplementationOnce(async(...args)=>{entered();await held;return replace(...args);});const applying=f.act({kind:'picking-apply',runId:'runOne'});try{await arrived;const before=await f.read();await f.act({kind:'picking-activate',version:1,digest:before.activation.digest,generation:before.activation.generation});release();await expect(applying).rejects.toThrow(/session changed/i);let state=await f.read();expect(state.contexts.at(-1).target.revision).toBe(0);expect(state.attempts[0].status).toBe('prepared');state=await f.act({kind:'picking-apply',runId:'runOne'});expect(state.attempts[0].status).toBe('retired');expect(state.contexts.at(-1).target.revision).toBe(0);}finally{release();await applying.catch(()=>{});}
});
