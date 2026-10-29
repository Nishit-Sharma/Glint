import {expect,test} from 'vitest';
import {parseSemanticProcedure,runSemanticProcedure} from '../src/learning/semantic-procedure';
import {semanticHelper,semanticHelperText} from '../src/learning/semantic-helper';
import {typedProcedure,typedDraftFromProcedure,parseTypedProcedureDraft,renameTypedField,moveTypedOutput,typedOutputIsReferenced} from '../src/renderer/src/typed-semantic-procedure';
import {workflowStepsDraft,workflowStepsProcedure,workflowInput,workflowEvidence} from './typed-helper-workflow-steps.fixture';
import {typedProcedure as priorTypedProcedure,typedProcedureExample as priorExample,parseTypedProcedureDraft as priorDraft} from './fixtures/workflow-steps-prior/src/renderer/src/typed-semantic-procedure';
import {arithmeticDraft} from './typed-helper-arithmetic.fixture';

test('a taught local workflow uses exact earlier results in later steps',()=>{
 const result=runSemanticProcedure(workflowStepsProcedure(),workflowInput);
 expect(result).toMatchObject({status:'completed',output:{usable:8,unpacked:6,perBox:2},effectAuthority:'none'});
 expect(result.trace.find(step=>step.stepId==='otherwise-output-2')?.inspected).toEqual([{source:'output',field:'usable',value:8},{source:'input',field:'packed',value:2}]);
 expect(result.trace.find(step=>step.stepId==='otherwise-output-3')?.inspected).toEqual([{source:'output',field:'unpacked',value:6},{source:'input',field:'boxSize',value:3}]);
});

test('a failed earlier calculation stops before later dependent steps and keeps an honest partial trace',()=>{
 const result=runSemanticProcedure(workflowStepsProcedure(),{...workflowInput,requested:1000000,damaged:-1});
 expect(result).toMatchObject({status:'abstained',code:'output-contract',haltedStepId:'otherwise-output-1',output:{}});
 expect(result.trace.map(step=>step.stepId)).toEqual(['required-1','rule-1','otherwise-output-1']);
 const zero=runSemanticProcedure(workflowStepsProcedure(),{...workflowInput,boxSize:0});
 expect(zero).toMatchObject({status:'abstained',haltedStepId:'otherwise-output-3',output:{usable:8,unpacked:6}});
 expect(zero.trace.at(-1)).toMatchObject({decision:false,inspected:[{source:'output',field:'unpacked',value:6},{source:'input',field:'boxSize',value:0}]});
 const middle=workflowStepsDraft(),step=middle.fallback.values[1];if(step.source!=='calculate')throw Error('Calculation');step.operator='divide';const stopped=runSemanticProcedure(typedProcedure(middle),{...workflowInput,packed:0});expect(stopped).toMatchObject({status:'abstained',haltedStepId:'otherwise-output-2',output:{usable:8}});expect(stopped.trace.some(item=>item.stepId==='otherwise-output-3')).toBe(false);
});

test('existing canonical starter and arithmetic definitions keep byte-identical compiled meaning',()=>{
 for(const draft of [priorExample(),...(['add','subtract','multiply','divide'] as const).map(operator=>arithmeticDraft(operator))])expect(JSON.stringify(typedProcedure(draft))).toBe(JSON.stringify(priorTypedProcedure(priorDraft(JSON.stringify(draft)))));
});

test('typed and interpreter boundaries reject missing, future, self, cyclic and wrong-type dependencies',()=>{
 for(const name of ['missing','unpacked','perBox']){const draft=workflowStepsDraft(),value=draft.fallback.values[1];if(value.source!=='calculate')throw Error('Calculation');value.left={source:'output',value:name};expect(()=>typedProcedure(draft)).toThrow();}
 const draft=workflowStepsDraft();draft.outputs[0].kind='string';draft.fallback.values[0]={source:'literal',value:'8'};expect(()=>typedProcedure(draft)).toThrow(/numeric/);
 const early=workflowStepsDraft();early.fallback.values[0]={source:'output',value:'perBox'};expect(()=>typedProcedure(early)).toThrow(/not available/);
 expect(()=>parseSemanticProcedure({...workflowStepsProcedure(),target:'local-export-manifest'})).toThrow(/local record/);
 const completed=runSemanticProcedure(workflowStepsProcedure(),{...workflowInput,requested:'10'});expect(completed).toMatchObject({status:'invalid-input',stage:'input',trace:[]});
});

test('prior-result copies support scalar types and exact compiler round-trip without inventing arithmetic',()=>{
 const draft=workflowStepsDraft();draft.inputs=[{name:'label',kind:'string'}];draft.outputs=[{name:'first',kind:'string'},{name:'second',kind:'string'}];draft.requirements=[];draft.rules=[];draft.fallback.values=[{source:'input',value:'label'},{source:'output',value:'first'}];
 const procedure=typedProcedure(parseTypedProcedureDraft(JSON.stringify(draft)));expect(typedDraftFromProcedure(procedure)).toEqual(draft);
 expect(runSemanticProcedure(procedure,{label:'  Mesa  '})).toMatchObject({status:'completed',output:{first:'  Mesa  ',second:'  Mesa  '}});
});

test('renaming updates only result references and dependency-changing moves refuse without mutating the draft',()=>{
 const draft=workflowStepsDraft(),before=structuredClone(draft),renamed=renameTypedField(draft,'outputs',0,'available');expect(renamed.kind).toBe('accepted');if(renamed.kind!=='accepted')throw Error('Rename');
 expect(renamed.value.fallback.values[1]).toMatchObject({left:{source:'output',value:'available'}});expect(runSemanticProcedure(typedProcedure(renamed.value),workflowInput)).toMatchObject({output:{available:8,unpacked:6,perBox:2}});
 expect(typedOutputIsReferenced(draft,'usable')).toBe(true);expect(typedOutputIsReferenced(draft,'perBox')).toBe(false);
 expect(moveTypedOutput(draft,0,1)).toMatchObject({kind:'refused'});expect(moveTypedOutput(draft,2,-1)).toMatchObject({kind:'refused'});expect(draft).toEqual(before);
 const independent=workflowStepsDraft();independent.fallback.values[2]={source:'input',value:'boxSize'};const moved=moveTypedOutput(independent,2,-1);expect(moved.kind).toBe('accepted');if(moved.kind!=='accepted')throw Error('Move');expect(runSemanticProcedure(typedProcedure(moved.value),workflowInput)).toMatchObject({output:{usable:8,perBox:3,unpacked:6}});expect(moved.value.outputs.map(field=>field.name)).toEqual(['usable','perBox','unpacked']);
});

test('checked workflow versions keep old recordings and activation through explicit correction and rollback',()=>{
 const id='ordered-workflow';let state=semanticHelper.initial(id);const act=(action:Record<string,unknown>)=>state=semanticHelper.update(id,state,{...action,expectedRevision:state.revision});
 act({kind:'set-semantic-procedure',procedure:workflowStepsProcedure()});expect(()=>act({kind:'save-semantic-version',changeNote:'Unverified'})).toThrow(/checks/);
 const recordedInput={...workflowInput,requested:14,packed:4,boxSize:4};act({kind:'record-semantic-input',input:recordedInput});const recording=structuredClone(state.recordings[0]),evidence=workflowEvidence(recording.recordingId);
 act({kind:'set-semantic-evidence',...evidence,examples:evidence.examples.filter(item=>item.id!=='recall')});expect(semanticHelper.check(state).passed).toBe(false);expect(()=>act({kind:'save-semantic-version',changeNote:'Missing exception'})).toThrow(/checks/);
 act({kind:'set-semantic-evidence',...evidence});expect(semanticHelper.check(state).passed).toBe(true);act({kind:'save-semantic-version',changeNote:'Three dependent local steps.'});expect(state.activeVersion).toBeNull();act({kind:'activate-semantic-version',version:1});const first=structuredClone(state.versions[0]);
 const revised=workflowStepsDraft(),value=revised.fallback.values[0];if(value.source!=='calculate')throw Error('Calculation');value.operator='add';const nextEvidence={...evidence,examples:evidence.examples.map(item=>item.id==='fresh'?{...item,expected:{status:'completed',output:{usable:22,unpacked:16,perBox:4}}}:item)};
 act({kind:'replace-semantic-procedure',procedure:typedProcedure(revised),...nextEvidence});expect(semanticHelper.check(state).passed).toBe(false);expect(()=>act({kind:'save-semantic-version',changeNote:'Unreviewed edit'})).toThrow(/checks/);
 act({kind:'correct-semantic-recording-expectation',recordingId:recording.recordingId,expected:{status:'completed',output:{usable:16,unpacked:12,perBox:3}},reason:'The first step now adds the reviewed adjustment; later steps use that changed value.'});expect(semanticHelper.check(state).passed).toBe(true);act({kind:'save-semantic-version',changeNote:'Reviewed first-step addition.'});expect(state.activeVersion).toBe(1);
 act({kind:'run-semantic-active',input:recordedInput});expect(state.lastRun?.result).toMatchObject({output:{usable:12,unpacked:8,perBox:2}});act({kind:'activate-semantic-version',version:2});act({kind:'run-semantic-active',input:recordedInput});expect(state.lastRun?.result).toMatchObject({output:{usable:16,unpacked:12,perBox:3}});act({kind:'activate-semantic-version',version:1});act({kind:'run-semantic-active',input:recordedInput});expect(state.lastRun?.result).toMatchObject({output:{usable:12,unpacked:8,perBox:2}});expect(state.versions[0]).toEqual(first);expect(state.recordings[0]).toEqual(recording);expect(semanticHelperText(id,state)).toContain('output usable minus input packed');
});
