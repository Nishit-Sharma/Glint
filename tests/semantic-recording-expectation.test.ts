import {expect,test} from 'vitest';
import {semanticHelper,semanticHelperText} from '../src/learning/semantic-helper';
import {recordProcedure} from '../src/renderer/src/components/SemanticHelperStudio';

const input={amount:1500,approved:true,sensitive:false};
const procedure=(threshold='1000')=>recordProcedure({inputName:'request',numberField:'amount',approvalField:'approved',sensitiveField:'sensitive',outputField:'route',threshold,comparison:'gte',whenTrue:'review',whenFalse:'standard'});
function setup(){
 let state=semanticHelper.initial('owned');
 const act=(action:Record<string,unknown>)=>{state=semanticHelper.update('owned',state,{...action,expectedRevision:state.revision});return state;};
 const evidence=()=>({rationales:[{id:'route-reason',kind:'inferred-rationale',stepId:'threshold',basis:[{recordingId:state.recordings[0].recordingId,traceStepId:'threshold'}],reason:'The amount determines the route.'}],corrections:[],examples:[{id:'different',role:'held-out',input:{amount:3000,approved:true,sensitive:false},expected:{status:'completed',output:{route:'review'}}},{id:'no-approval',role:'counterexample',input:{amount:100,approved:false,sensitive:false},expected:{status:'abstained',code:'precondition',haltedStepId:'approval'}},{id:'private',role:'exception',input:{amount:100,approved:true,sensitive:true},expected:{status:'abstained',code:'explicit-stop',haltedStepId:'sensitive-stop'}}]});
 act({kind:'set-semantic-procedure',procedure:procedure()});act({kind:'record-semantic-input',input});act({kind:'set-semantic-evidence',...evidence()});act({kind:'save-semantic-version',changeNote:'Original route.'});act({kind:'activate-semantic-version',version:1});
 return {get state(){return state;},act,evidence,replace(){act({kind:'replace-semantic-procedure',procedure:procedure('2000'),rationales:[],corrections:[],examples:[]});},correct(expected:unknown={status:'completed',output:{route:'standard'}}){act({kind:'correct-semantic-recording-expectation',recordingId:state.recordings[0].recordingId,expected,reason:'Review is only needed from two thousand.'});}};
}

test('an explicit corrected expectation teaches v2 while the immutable recording and active v1 retain their earlier result',()=>{
 const h=setup(),original=JSON.stringify(h.state.recordings[0]),saved=JSON.stringify(h.state.versions[0]);h.replace();h.correct();
 expect(h.state.recordingCorrections).toMatchObject([{kind:'declared-recording-expectation',helperId:'owned',recordingId:h.state.recordings[0].recordingId,procedureVersion:2,previousCorrectionId:null,before:{status:'completed',output:{route:'review'}},after:{status:'completed',output:{route:'standard'}},reason:'Review is only needed from two thousand.'}]);
 expect(semanticHelper.check(h.state).passed).toBe(false);h.act({kind:'set-semantic-evidence',...h.evidence()});expect(semanticHelper.check(h.state).passed).toBe(true);h.act({kind:'save-semantic-version',changeNote:'Correct the training expectation for the higher threshold.'});
 expect(JSON.stringify(h.state.recordings[0])).toBe(original);expect(JSON.stringify(h.state.versions[0])).toBe(saved);expect(h.state.activeVersion).toBe(1);
 h.act({kind:'run-semantic-active',input:{amount:1600,approved:true,sensitive:false}});expect(h.state.lastRun?.result).toMatchObject({status:'completed',output:{route:'review'}});
 h.act({kind:'activate-semantic-version',version:2});h.act({kind:'run-semantic-active',input:{amount:1600,approved:true,sensitive:false}});expect(h.state.lastRun?.result).toMatchObject({status:'completed',output:{route:'standard'}});
 h.act({kind:'activate-semantic-version',version:1});h.act({kind:'run-semantic-active',input:{amount:1600,approved:true,sensitive:false}});expect(h.state.lastRun?.result).toMatchObject({status:'completed',output:{route:'review'}});
 expect(semanticHelper.parseState('owned',JSON.parse(JSON.stringify(h.state)))).toEqual(h.state);expect(semanticHelperText('owned',h.state)).toContain('Original recorded expectation');expect(semanticHelperText('owned',h.state)).toContain('Corrected expectation for draft');
 h.act({kind:'restore-semantic-version',version:1});expect(h.state.recordingCorrections??[]).toEqual([]);expect(h.state.versions[1].candidate.recordingCorrections).toHaveLength(1);expect(JSON.stringify(h.state.recordings[0])).toBe(original);expect(semanticHelper.check(h.state).passed).toBe(true);
});

test('corrections remain deliberate, ordered, bound to their original recording and gated by conflicting and negative cases',()=>{
 const h=setup();expect(()=>h.correct()).toThrow(/later draft/);h.replace();h.correct();
 const original=JSON.stringify(h.state.recordings),receipt=h.state.recordingCorrections![0];
 h.act({kind:'set-semantic-evidence',...h.evidence(),examples:[...h.evidence().examples,{id:'conflict',role:'held-out',input,expected:{status:'completed',output:{route:'review'}}}]});expect(semanticHelper.check(h.state).passed).toBe(false);expect(()=>h.act({kind:'save-semantic-version',changeNote:'Conflicting expectation.'})).toThrow(/checks/);
 h.act({kind:'set-semantic-evidence',...h.evidence(),examples:h.evidence().examples.filter(item=>item.role!=='counterexample')});expect(semanticHelper.check(h.state).passed).toBe(false);
 h.act({kind:'set-semantic-evidence',...h.evidence()});h.correct({status:'completed',output:{route:'review'}});expect(semanticHelper.check(h.state).passed).toBe(false);h.correct();expect(semanticHelper.check(h.state).passed).toBe(true);expect(h.state.recordingCorrections!.map(item=>item.previousCorrectionId)).toEqual([null,receipt.id,h.state.recordingCorrections![1].id]);
 expect(JSON.stringify(h.state.recordings)).toBe(original);
 for(const change of [{helperId:'foreign'},{atRevision:500},{procedureVersion:1},{previousCorrectionId:'missing'},{before:{status:'completed',output:{route:'forged'}}}]){
  const altered=structuredClone(h.state);altered.recordingCorrections=[{...altered.recordingCorrections![0],...change} as typeof receipt,...altered.recordingCorrections!.slice(1)];expect(()=>semanticHelper.parseState('owned',altered)).toThrow();
 }
 expect(()=>h.act({kind:'correct-semantic-recording-expectation',recordingId:'missing',expected:{status:'completed',output:{route:'standard'}},reason:'Different.'})).toThrow(/recording/);
 expect(()=>h.act({kind:'correct-semantic-recording-expectation',recordingId:receipt.recordingId,expected:{status:'completed',output:{route:'review'}},reason:'Different.',before:receipt.before})).toThrow();
});

test('saved example projection follows the selected version after an explicit recorded-expectation correction',async()=>{
 const h=setup();h.replace();h.correct();h.act({kind:'set-semantic-evidence',...h.evidence()});h.act({kind:'save-semantic-version',changeNote:'New expected route.'});h.act({kind:'activate-semantic-version',version:2});
 const {savedHelpers}=await import('../src/shared/saved-helpers');const {createCompanion}=await import('../src/core/companion');const {createTextHelper}=await import('../src/core/text-helper-host');const {parseModuleAnswer}=await import('../src/core/interactive-modules');const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const directory=await mkdtemp(join(tmpdir(),'corrected-example-')),core=await createCompanion({dataDir:directory});try{const task=await core.createTask({title:'Catalog owner'}),created=await createTextHelper(core,{taskId:task.id,requestId:'create'}),artifact=created.task.artifacts.find(item=>item.id===created.artifactId)!,module=parseModuleAnswer(JSON.parse(artifact.revisions[0].content)).modules[0];if(module.data.kind!=='helper-studio')throw Error('Expected helper');
  const {editModule}=await import('../src/core/module-state');const identity={taskId:task.id,artifactId:artifact.id,artifactRevision:1,moduleId:module.id};let revision=0;
  const act=async(action:Record<string,unknown>)=>{await editModule(core,{...identity,action:{...action,expectedRevision:revision++} as never});};
  await act({kind:'begin-semantic-helper'});await act({kind:'set-semantic-procedure',procedure:procedure()});await act({kind:'record-semantic-input',input});
  const current=await core.getTask(task.id),state=semanticHelper.parseState(module.data.id,current.session!.moduleStates[0].state),record=state.recordings[0],evidence={...h.evidence(),rationales:[{...h.evidence().rationales[0],basis:[{recordingId:record.recordingId,traceStepId:'threshold'}]}]};
  await act({kind:'set-semantic-evidence',...evidence});await act({kind:'save-semantic-version',changeNote:'Old'});await act({kind:'replace-semantic-procedure',procedure:procedure('2000'),rationales:[],corrections:[],examples:[]});await act({kind:'correct-semantic-recording-expectation',recordingId:record.recordingId,expected:{status:'completed',output:{route:'standard'}},reason:'New review threshold.'});await act({kind:'set-semantic-evidence',...evidence});await act({kind:'save-semantic-version',changeNote:'New'});await act({kind:'activate-semantic-version',version:2});
  expect(savedHelpers([await core.getTask(task.id)])[0].recordExample).toEqual({input,output:{route:'standard'}});await act({kind:'activate-semantic-version',version:1});expect(savedHelpers([await core.getTask(task.id)])[0].recordExample).toEqual({input,output:{route:'review'}});
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {typedProcedure,typedProcedureExample} from '../src/renderer/src/typed-semantic-procedure';
import {SemanticHelperStudio} from '../src/renderer/src/components/SemanticHelperStudio';
import {helperExample} from '../src/learning/helper-example';
test('the public typed helper separates an immutable replay from the later declared expectation controls',()=>{
 let state=semanticHelper.initial(helperExample.id);const act=(action:Record<string,unknown>)=>{state=semanticHelper.update(helperExample.id,state,{...action,expectedRevision:state.revision});};const draft=typedProcedureExample();
 act({kind:'set-semantic-procedure',procedure:typedProcedure(draft)});act({kind:'record-semantic-input',input:{item:'TRAIN-25',condition:'working',days:25,approved:true,recalled:false}});draft.rules[1].conditions[1].value='20';act({kind:'replace-semantic-procedure',procedure:typedProcedure(draft),rationales:[],corrections:[],examples:[]});
 const html=renderToStaticMarkup(createElement(SemanticHelperStudio,{data:helperExample,state,onAction:()=>{}}));expect(html).toContain('Correct an earlier recorded expectation');expect(html).toContain('Original recorded expectation');expect(html).toContain('Corrected expected route');expect(html).toContain('Save declared expectation correction');expect(html).not.toContain('create a separate helper; this editor cannot');
});

test('reclassifying a recorded result as a required stop still needs a completed training example and every stop check',()=>{
 const h=setup(),changed=procedure(),recorded=h.state.recordings[0];
 const revised={...changed,preconditions:[...changed.preconditions,{id:'minimum-review',reason:'Review only amounts of two thousand or more.',predicate:{kind:'compare',operator:'gte',left:{kind:'input',field:'amount'},right:{kind:'literal',value:2000}}}]};
 h.act({kind:'replace-semantic-procedure',procedure:revised,rationales:[],corrections:[],examples:[]});h.correct({status:'abstained',code:'precondition',haltedStepId:'minimum-review'});expect(semanticHelper.check(h.state).recordingExpectations[0].effective.role).toBe('counterexample');
 const cases=h.evidence();cases.examples[2]={...cases.examples[2],input:{amount:2500,approved:true,sensitive:true}};h.act({kind:'set-semantic-evidence',...cases});expect(semanticHelper.check(h.state).issues).toContain('Add a passing positive example.');expect(()=>h.act({kind:'save-semantic-version',changeNote:'No positive record.'})).toThrow(/checks/);
 h.act({kind:'record-semantic-input',input:{amount:2500,approved:true,sensitive:false}});expect(semanticHelper.check(h.state).passed).toBe(true);expect(h.state.recordings[0]).toEqual(recorded);
});

import {createLearningDrafts} from '../src/renderer/src/learning-drafts';
import {navigationFormBasis} from '../src/renderer/src/learning-draft-basis';
import {semanticHelperDraftBasis} from '../src/renderer/src/semantic-helper-draft-basis';
import {serializeLearningDraftJson,learningDraftKey,type LearningDraftRecord,type LearningDraftOwner} from '../src/shared/learning-drafts';
import {recordedExpectationDraft} from '../src/renderer/src/components/RecordedExpectationEditor';
test('correction raw keeps newer typing and becomes review-only after its declared expectation changes, while old unextended bases remain exact',async()=>{
 const h=setup();h.replace();const slot='helper:semantic:typedexpectation',owner={taskId:'t',artifactId:'a',artifactRevision:1,artifactDigest:'d',moduleId:'m',moduleVersion:1},initial=recordedExpectationDraft(h.state.recordings[0].recordingId,{status:'completed',output:{route:'review'}},[{name:'route',kind:'string'}],'approval');
 expect(semanticHelperDraftBasis(h.state,'typedcase')).toBe(serializeLearningDraftJson(['typed-record-editor-v1','typedcase',h.state.draftVersion,h.state.examples.length,h.state.recordings.length]));expect(semanticHelperDraftBasis(h.state,'typedversion')).toBe(serializeLearningDraftJson(['typed-record-editor-v1','typedversion',h.state.draftVersion,h.state.versions.length]));
 let records:LearningDraftRecord[]=[];const transport={read:async()=>({kind:'available' as const,epoch:'initial',records}),save:async(owner:LearningDraftOwner,slot:string,_epoch:string,revision:number,value:LearningDraftRecord['value'])=>{const record={owner,slot,revision:revision+1,value};records=records.filter(item=>learningDraftKey(item.owner,item.slot)!==learningDraftKey(owner,slot));records.push(record);return {kind:'saved' as const,epoch:'initial',record};}},cache=createLearningDrafts(transport);await cache.load();const basis=navigationFormBasis(initial,{slot,basisMode:'explicit',basis:semanticHelperDraftBasis(h.state,'typedexpectation')});
 cache.edit(owner,slot,initial,basis,value=>({...value,output:{route:'standard'},reason:'  First reason  '}));await cache.flush();const token=cache.capture(owner,slot)!;cache.edit(owner,slot,initial,basis,value=>({...value,reason:'  Newer unsent reason  '}));expect(cache.acknowledge(token)).toBe(false);await cache.flush();h.correct();const nextBasis=navigationFormBasis(initial,{slot,basisMode:'explicit',basis:semanticHelperDraftBasis(h.state,'typedexpectation')});const form=cache.readForm(owner,slot,initial,nextBasis);expect(form.status).toBe('recovery');expect(records[0].value?.value).toContain('Newer unsent reason');
});
