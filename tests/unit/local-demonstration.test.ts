import {afterEach,expect,test} from 'vitest';
import {Schema} from 'effect';
import {semanticHelper,type SemanticHelperState} from '../../src/learning/semantic-helper';
import {editModule} from '../../src/core/module-state';
import {taskContext} from '../../src/host/browser/coordinator';
import {modelModuleText,moduleHistoryText,moduleText} from '../../src/core/interactive-modules';
import {parseModuleAction} from '../../src/core/interactive-modules';
import {stagedDraftFromProcedure,stagedProcedure} from '../../src/learning/staged-procedure';
import {runSemanticProcedure,type SemanticExample} from '../../src/learning/semantic-procedure';
import {StoredModuleStateSchema} from '../../src/core/module-registry';
import {SemanticHelperStateSchema as OlderSchema,semanticHelper as olderHelper} from '../fixtures/recording-expectation-source958/src/learning/semantic-helper';
import {demoInput,demoStart,demoSteps,localDemonstrationFixture} from '../support/local-demonstration.fixture';
const close:Array<()=>Promise<void>>=[];afterEach(async()=>{for(const f of close.splice(0))await f();});
async function fixture(){const f=await localDemonstrationFixture();close.push(f.close);return f;}
test('performs heterogeneous ordered actions with exact host owner, authority and before/after receipts, then creates only an inactive editable procedure',async()=>{
 const f=await fixture(),recording=await f.record(),workspace=recording.localWorkspace!;
 expect(workspace).toMatchObject({owner:f.owner,input:demoInput,physicalGestureVerified:false,externalObservationVerified:false,effectAuthority:'none'});expect(workspace.actions).toHaveLength(4);
 expect(workspace.actions[0]).toMatchObject({atRevision:3,authority:{kind:'explicit-local-value-action',expectedRevision:2},before:{},after:{clean:'PRIVATE Box'}});
 expect(workspace.actions[3]).toMatchObject({before:{clean:'PRIVATE Box',total:12},after:{clean:'PRIVATE Box',total:12,labelCopy:'PRIVATE Box'},result:{effectAuthority:'none',status:'completed'}});
 const state=await f.act({kind:'finish-semantic-demonstration',confirmed:'reviewed-inactive-local-procedure'}),procedure=state.definitions[0].procedure;
 expect(state).toMatchObject({activeVersion:null,versions:[],examples:[],localWorkspace:null,draftVersion:1});expect(state.localDemonstrations![0].workspace).toEqual(workspace);expect(semanticHelper.check(state).passed).toBe(false);
 expect(stagedProcedure(stagedDraftFromProcedure(procedure)!,procedure.id)).toEqual(procedure);expect(runSemanticProcedure(procedure,{label:'  New crate  ',quantity:7,size:2})).toMatchObject({status:'completed',effectAuthority:'none',output:{clean:'New crate',total:14,labelCopy:'New crate'}});
 await expect(f.act({kind:'save-semantic-version',changeNote:'Unchecked'})).rejects.toThrow(/Pass the semantic/);await expect(f.act({kind:'activate-semantic-version',version:1})).rejects.toThrow(/unavailable/);
});
test('checks distinct inputs and each exception before save; later edits preserve frozen receipts and checked versions can be activated and rolled back',async()=>{
 const f=await fixture();let state=await f.finish();const frozen=structuredClone(state.localDemonstrations),original=state.definitions[0].procedure;
 const examples:SemanticExample[]=[{id:'fresh',role:'held-out',input:{label:' crate ',quantity:4,size:5},expected:{status:'completed',output:{clean:'crate',total:20,labelCopy:'crate'}}},{id:'invalid',role:'counterexample',input:{label:'x',quantity:'wrong',size:1},expected:{status:'invalid-input',stage:'input'}},{id:'negative',role:'exception',input:{label:'x',quantity:-1,size:2},expected:{status:'abstained',haltedStepId:'stage-3-stop',code:'explicit-stop'}}];
 const evidence={kind:'set-semantic-evidence',rationales:[{id:'why',kind:'inferred-rationale',stepId:'stage-1',basis:[{recordingId:'demonstrated-original',traceStepId:'stage-1'}],reason:'The chosen references and order determine these local results.'}],corrections:[],examples};
 state=await f.act(evidence);expect(semanticHelper.check(state)).toMatchObject({passed:true,independentHeldOutVerified:false,activationAuthorized:false});
 state=await f.act({kind:'save-semantic-version',changeNote:'Checked first version'});state=await f.act({kind:'activate-semantic-version',version:1});
 const draft=stagedDraftFromProcedure(original)!;draft.stages[0].label='Edited reason without changing the original receipt.';
 state=await f.act({kind:'replace-semantic-procedure',procedure:stagedProcedure(draft,original.id),rationales:state.rationales,corrections:state.corrections,examples:state.examples});
 state=await f.act({kind:'save-semantic-version',changeNote:'Reviewed second version'});state=await f.act({kind:'activate-semantic-version',version:2});state=await f.act({kind:'activate-semantic-version',version:1});state=await f.act({kind:'run-semantic-active',input:{label:' fresh ',quantity:5,size:5}});
 expect(state).toMatchObject({activeVersion:1,lastRun:{version:1,result:{status:'completed',output:{clean:'fresh',total:25,labelCopy:'fresh'}}}});expect(state.localDemonstrations).toEqual(frozen);expect(state.definitions[0].procedure).toEqual(original);expect(state.versions[0].candidate.procedure).toEqual(original);
});
test('source/authority are host-derived; injected receipts, external actions, bad references and changes during recording fail closed',async()=>{
 const f=await fixture(),initial=await f.read();expect(()=>semanticHelper.update(f.data.id,initial,{...demoStart,expectedRevision:1})).toThrow(/owned module authority/);
 for(const extra of [{owner:f.owner},{authority:{kind:'browser'}},{localDemonstrations:[]}])expect(()=>parseModuleAction({...demoStart,...extra,expectedRevision:1},f.data)).toThrow();
 await f.act(demoStart);const state=await f.read();for(const kind of ['browser-click','os-keypress','run-code','write-file'])await expect(f.act({kind:'perform-semantic-demonstration-step',stage:{kind}})).rejects.toThrow();
 await expect(f.act({kind:'perform-semantic-demonstration-step',stage:{...demoSteps[0],value:{source:'output',value:'future'}}})).rejects.toThrow();
 await expect(f.act({kind:'set-semantic-evidence',rationales:[],corrections:[],examples:[]})).rejects.toThrow(/Finish or cancel/);expect(await f.read()).toEqual(state);
 expect(()=>semanticHelper.update(f.data.id,state,{kind:'perform-semantic-demonstration-step',stage:demoSteps[0],expectedRevision:state.revision},{...f.owner,artifactDigest:'b'.repeat(64)})).toThrow(/source changed/);
 const performed=await f.act({kind:'perform-semantic-demonstration-step',stage:demoSteps[0]});for(const mutate of [(v:SemanticHelperState)=>{(v.localWorkspace!.actions[0] as any).after.clean='forged';},(v:SemanticHelperState)=>{(v.localWorkspace!.actions[0] as any).authority.expectedRevision=0;},(v:SemanticHelperState)=>{(v.localWorkspace!.owner as any).helperId='foreign';}]){const corrupt=structuredClone(performed);mutate(corrupt);expect(()=>semanticHelper.parseState(f.data.id,corrupt)).toThrow();}
});
test('stopped/intermediate demonstrations cannot become helpers; cancelled receipts survive and a fresh demonstration can start',async()=>{
 const f=await fixture();await f.act({...demoStart,input:{...demoInput,quantity:-3}});await f.act({kind:'perform-semantic-demonstration-step',stage:demoSteps[0]});await f.act({kind:'perform-semantic-demonstration-step',stage:demoSteps[1]});let state=await f.act({kind:'perform-semantic-demonstration-step',stage:demoSteps[2]});expect(state.localWorkspace!.actions.at(-1)!.result.status).toBe('abstained');
 await expect(f.act({kind:'perform-semantic-demonstration-step',stage:demoSteps[3]})).rejects.toThrow(/stopped/);await expect(f.act({kind:'finish-semantic-demonstration',confirmed:'reviewed-inactive-local-procedure'})).rejects.toThrow(/completed/);
 state=await f.act({kind:'cancel-semantic-demonstration'});expect(state).toMatchObject({definitions:[],activeVersion:null,localWorkspace:null,localDemonstrations:[{outcome:'cancelled',definitionVersion:null}]});state=await f.act(demoStart);await expect(f.act({kind:'finish-semantic-demonstration',confirmed:'reviewed-inactive-local-procedure'})).rejects.toThrow(/completed/);expect(state.localWorkspace!.actions).toHaveLength(0);
});
test('duplicate and concurrent exact actions commit once, reject stale review and refuse changed artifacts',async()=>{
 const f=await fixture();await f.act(demoStart);const action={kind:'perform-semantic-demonstration-step',stage:demoSteps[0],expectedRevision:(await f.read()).revision},input={...f.owner,action:action as never};const results=await Promise.allSettled([editModule(f.core,input),editModule(f.core,input)]);expect(results.filter(item=>item.status==='fulfilled')).toHaveLength(1);expect((await f.read()).localWorkspace!.actions).toHaveLength(1);await expect(editModule(f.core,input)).rejects.toThrow();
 const task=await f.core.getTask(f.owner.taskId),revision=task.artifacts[0].revisions[0];await f.core.saveArtifact(f.owner.taskId,{artifactId:f.owner.artifactId,expectedRevision:1,title:'Changed owner',content:revision.content,mimeType:revision.mimeType});await expect(f.act({kind:'cancel-semantic-demonstration'})).rejects.toThrow(/answer changed/);
});
test('private values are omitted from automatic model/history projection; old readers refuse editing and opaque storage preserves exact state',async()=>{
 const f=await fixture(),state=await f.finish(),task=await f.core.getTask(f.owner.taskId),artifact=task.artifacts[0].revisions[0];expect(moduleText(f.data,state)).toContain('PRIVATE Box');
 for(const projection of [modelModuleText(f.data,state),moduleHistoryText(artifact.content,()=>state),taskContext(task,'unrelated-request')]){expect(projection).not.toContain('PRIVATE');expect(projection).not.toContain('private-workflow');expect(projection).toContain('excluded');}
 expect(()=>Schema.decodeUnknownSync(OlderSchema,{onExcessProperty:'error'})(state)).toThrow();expect(()=>olderHelper.update(f.data.id,state,{kind:'deactivate-semantic',expectedRevision:state.revision})).toThrow();expect(Schema.decodeUnknownSync(StoredModuleStateSchema)(state)).toEqual(state);
 await f.core.close();const reopened=await (await import('../../src/core/companion')).createCompanion({dataDir:f.directory});try{const saved=(await reopened.getTask(f.owner.taskId)).session!.moduleStates[0].state;expect(saved).toEqual(state);}finally{await reopened.close();}
});

test('revision capacity and input bounds refuse before opening a workspace',async()=>{
 const f=await fixture(),initial=await f.read();expect(()=>semanticHelper.update(f.data.id,{...initial,revision:493},{...demoStart,expectedRevision:493},f.owner)).toThrow(/revision capacity/);await expect(f.act({...demoStart,input:{...demoInput,label:'x'.repeat(161)}})).rejects.toThrow();expect((await f.read()).localWorkspace).toBeUndefined();
});
