import {expect,test} from 'vitest';
import {runSemanticProcedure,type SemanticStep} from '../../src/learning/semantic-procedure';
import {semanticHelper,semanticHelperText} from '../../src/learning/semantic-helper';
import {typedDraftFromProcedure,typedProcedure,typedProcedureExample} from '../../src/renderer/src/typed-semantic-procedure';
import {parseStagedProcedureDraft,stagedProcedure,stagedProcedureExample,stagedDraftFromProcedure,renameStagedField} from '../../src/renderer/src/staged-semantic-procedure';
import {stagedInput,stagedDefinition,stagedEvidence} from '../support/staged-procedure.fixture';

test('a staged walkthrough checks and branches on computed intermediate results',()=>{
 const procedure=stagedDefinition(),ready=runSemanticProcedure(procedure,stagedInput);
 expect(ready).toMatchObject({status:'completed',effectAuthority:'none',output:{available:24,remaining:12,route:'ready'}});
 expect(ready.trace.map(item=>item.stepId)).toEqual(['staged-required-1','stage-1','stage-2','stage-3','stage-4','stage-4-yes','staged-doney','staged-result-1','staged-result-2','staged-result-3']);
 expect(ready.trace.find(item=>item.stepId==='stage-2')?.inspected).toEqual([{source:'output',field:'available',value:24},{source:'literal',field:null,value:0}]);
 expect(runSemanticProcedure(procedure,{...stagedInput,requested:25})).toMatchObject({status:'completed',output:{available:24,remaining:-1,route:'review'}});
 expect(typedDraftFromProcedure(procedure)).toBeNull();expect(stagedDraftFromProcedure(procedure)).toEqual(stagedProcedureExample());
 expect(stagedDraftFromProcedure(typedProcedure(typedProcedureExample()))).toBeNull();
});

test('a failed checkpoint retains prior work and never executes later stages',()=>{
 const stopped=runSemanticProcedure(stagedDefinition(),{...stagedInput,reserved:31});
 expect(stopped).toMatchObject({status:'abstained',code:'explicit-stop',haltedStepId:'stage-2-stop',output:{available:-1},effectAuthority:'none'});
 expect(stopped.trace.map(item=>item.stepId)).toEqual(['staged-required-1','stage-1','stage-2','stage-2-stop']);
 expect(runSemanticProcedure(stagedDefinition(),{...stagedInput,approved:false})).toMatchObject({status:'abstained',code:'precondition',output:{}});
 expect(runSemanticProcedure(stagedDefinition(),{...stagedInput,stock:'30'})).toMatchObject({status:'invalid-input',stage:'input',trace:[]});
});

test('staged boundaries reject unbound, forward, wrong-type and excessive work without weakening existing parsing',()=>{
 const future=stagedProcedureExample(),guard=future.stages[1];if(guard.kind!=='checkpoint')throw Error();guard.condition.field='remaining';expect(()=>stagedProcedure(future)).toThrow(/available/);
 const wrong=stagedProcedureExample(),decision=wrong.stages[3];if(decision.kind!=='decide')throw Error();decision.whenTrue={source:'output',value:'remaining'};expect(()=>stagedProcedure(wrong)).toThrow(/type/);
 const excessive=stagedProcedureExample();for(let i=0;i<2;i++)excessive.stages.push({...decision,field:{name:'route'+i,kind:'string'}});expect(()=>stagedProcedure(excessive)).toThrow(/two decision/);
 const raw=parseStagedProcedureDraft(JSON.stringify({...stagedProcedureExample(),name:''}));expect(raw.name).toBe('');expect(()=>stagedProcedure(raw)).toThrow();
 expect(()=>parseStagedProcedureDraft(JSON.stringify({...stagedProcedureExample(),externalAction:'click'}))).toThrow();
});

test('correlated decision and checkpoint paths refuse before creating untestable exception branches',()=>{
 const draft=stagedProcedureExample(),checkpoint=draft.stages[1],decision=draft.stages[3];if(checkpoint.kind!=='checkpoint'||decision.kind!=='decide')throw Error();
 decision.condition={source:'input',field:'approved',operator:'eq',value:'true'};
 checkpoint.condition={source:'input',field:'approved',operator:'eq',value:'true'};
 draft.stages=[draft.stages[0],draft.stages[2],decision,checkpoint];
 expect(()=>stagedProcedure(draft)).toThrow('Place checkpoints before the first decision.');
 expect(parseStagedProcedureDraft(JSON.stringify(draft))).toEqual(draft);
});

test('colliding field renames preserve every field and reference and leave a unique rename possible',()=>{
 const draft=stagedProcedureExample(),before=structuredClone(draft);
 expect(()=>renameStagedField(draft,'input','stock','reserved')).toThrow(/already used/);
 expect(()=>renameStagedField(draft,'output','available','remaining')).toThrow(/already used/);
 expect(draft).toEqual(before);
 expect(stagedDraftFromProcedure(stagedProcedure(renameStagedField(draft,'output','available','usable')))?.stages[0]).toMatchObject({field:{name:'usable'}});
});

test('renaming follows parameter, computation and checkpoint references while exact recognition refuses altered branches',()=>{
 const original=stagedProcedureExample(),renamed=renameStagedField(renameStagedField(original,'output','available','usable'),'input','reserved','held');
 expect(runSemanticProcedure(stagedProcedure(renamed),{stock:30,held:6,requested:12,approved:true})).toMatchObject({output:{usable:24,remaining:12,route:'ready'}});
 expect(original).toEqual(stagedProcedureExample());expect(stagedDraftFromProcedure(stagedProcedure(renamed))).toEqual(renamed);
 const alter=(step:SemanticStep):SemanticStep=>step.kind==='branch'?{...step,then:alter(step.then),else:alter(step.else)}:step.kind==='assign'?{...step,intent:step.id==='stage-4-no'?'Changed action':step.intent,next:alter(step.next)}:step;
 const changed=stagedDefinition();expect(stagedDraftFromProcedure({...changed,root:alter(changed.root)})).toBeNull();
});

test('teaching, exception tests, fresh reuse, correction and rollback share the immutable existing helper authority',()=>{
 const id='staged-walkthrough';let state=semanticHelper.initial(id);const act=(action:Record<string,unknown>)=>state=semanticHelper.update(id,state,{...action,expectedRevision:state.revision});
 act({kind:'set-semantic-procedure',procedure:stagedDefinition()});act({kind:'record-semantic-input',input:stagedInput});const recording=structuredClone(state.recordings[0]),evidence=stagedEvidence(recording.recordingId);
 act({kind:'set-semantic-evidence',...evidence,examples:evidence.examples.filter(item=>item.role!=='exception')});expect(semanticHelper.check(state).passed).toBe(false);expect(()=>act({kind:'save-semantic-version',changeNote:'Missing checkpoint test'})).toThrow(/checks/);
 act({kind:'set-semantic-evidence',...evidence});expect(semanticHelper.check(state).passed).toBe(true);act({kind:'save-semantic-version',changeNote:'Reviewed staged procedure.'});expect(state.activeVersion).toBeNull();act({kind:'activate-semantic-version',version:1});const oldVersion=structuredClone(state.versions[0]);
 act({kind:'run-semantic-active',input:{...stagedInput,stock:42}});expect(state.lastRun?.result).toMatchObject({output:{available:36,remaining:24,route:'ready'}});
 const draft=stagedProcedureExample(),decision=draft.stages[3];if(decision.kind!=='decide')throw Error();decision.whenTrue={source:'literal',value:'dispatch'};act({kind:'replace-semantic-procedure',procedure:stagedProcedure(draft),...stagedEvidence(recording.recordingId,'dispatch')});expect(semanticHelper.check(state).passed).toBe(false);expect(state.activeVersion).toBe(1);
 act({kind:'correct-semantic-recording-expectation',recordingId:recording.recordingId,expected:{status:'completed',output:{available:24,remaining:12,route:'dispatch'}},reason:'Reviewed the changed successful route; the original local recording stays intact.'});expect(semanticHelper.check(state).passed).toBe(true);act({kind:'save-semantic-version',changeNote:'Reviewed dispatch route.'});expect(state.activeVersion).toBe(1);
 act({kind:'activate-semantic-version',version:2});act({kind:'run-semantic-active',input:{...stagedInput,stock:42}});expect(state.lastRun?.result).toMatchObject({output:{route:'dispatch'}});act({kind:'activate-semantic-version',version:1});act({kind:'run-semantic-active',input:{...stagedInput,stock:42}});expect(state.lastRun?.result).toMatchObject({output:{route:'ready'}});expect(state.recordings[0]).toEqual(recording);expect(state.versions[0]).toEqual(oldVersion);
 expect(semanticHelper.parseState(id,JSON.parse(JSON.stringify(state)))).toEqual(state);expect(semanticHelperText(id,state)).toContain('output available gte 0');
});
