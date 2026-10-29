import {expect,test} from 'vitest';
import {typedProcedure,typedProcedureExample,typedDraftFromProcedure} from '../src/renderer/src/typed-semantic-procedure';
import {runSemanticProcedure} from '../src/learning/semantic-procedure';

test('a user-authored typed procedure combines conditions and copies a fresh input into its result',()=>{
 const draft=typedProcedureExample(),procedure=typedProcedure(draft);
 expect(runSemanticProcedure(procedure,{item:'TRAIN-4',condition:'working',days:12,approved:true,recalled:false})).toMatchObject({status:'completed',output:{item:'TRAIN-4',route:'restock'}});
 expect(runSemanticProcedure(procedure,{item:'FRESH-92',condition:'damaged',days:42,approved:true,recalled:false})).toMatchObject({status:'completed',output:{item:'FRESH-92',route:'repair'}});
 expect(runSemanticProcedure(procedure,{item:'OTHER-7',condition:'working',days:60,approved:true,recalled:false})).toMatchObject({status:'completed',output:{item:'OTHER-7',route:'review'}});
 expect(runSemanticProcedure(procedure,{item:'STOP-1',condition:'working',days:2,approved:true,recalled:true})).toMatchObject({status:'abstained',haltedStepId:'rule-1-stop',code:'explicit-stop'});
 expect(runSemanticProcedure(procedure,{item:'NO-2',condition:'working',days:2,approved:false,recalled:false})).toMatchObject({status:'abstained',haltedStepId:'required-1',code:'precondition'});
 expect(typedDraftFromProcedure(procedure)).toEqual(draft);
});

import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {SemanticHelperStudio} from '../src/renderer/src/components/SemanticHelperStudio';
import {semanticHelper} from '../src/learning/semantic-helper';
import {helperExample} from '../src/learning/helper-example';
test('the public helper exposes a typed teaching path and renders its editable conditions',()=>{
 const initial=semanticHelper.initial(helperExample.id);
 expect(renderToStaticMarkup(createElement(SemanticHelperStudio,{data:helperExample,state:initial,onAction:()=>{}}))).toContain('Teach a typed procedure');
 const state=semanticHelper.update(helperExample.id,initial,{kind:'set-semantic-procedure',procedure:typedProcedure(typedProcedureExample()),expectedRevision:initial.revision});
 const html=renderToStaticMarkup(createElement(SemanticHelperStudio,{data:helperExample,state,onAction:()=>{}}));
 expect(html).toContain('Typed procedure helper');expect(html).toContain('Rule 2 conditions');expect(html).toContain('Expected outcome');expect(html).toContain('Save checked procedure version');
});

import {typedInput,parseTypedProcedureDraft} from '../src/renderer/src/typed-semantic-procedure';
import {createLearningDrafts} from '../src/renderer/src/learning-drafts';
import {semanticHelperDraftBasis} from '../src/renderer/src/semantic-helper-draft-basis';
import {navigationFormBasis} from '../src/renderer/src/learning-draft-basis';
import {learningDraftKey,type LearningDraftRecord,type LearningDraftOwner} from '../src/shared/learning-drafts';
import {helperDraftMode} from '../src/shared/helper-draft-slots';
test('blank numeric inputs and incompatible comparisons are refused before they can become a learned rule',()=>{
 expect(()=>typedInput([{name:'days',kind:'number'}],{days:''})).toThrow(/finite/);
 const draft=typedProcedureExample();draft.rules[1].conditions[0].operator='gt';expect(()=>typedProcedure(draft)).toThrow(/numbers/);
 draft.rules[1].conditions[0].operator='eq';draft.outputs[0].kind='boolean';expect(()=>typedProcedure(draft)).toThrow(/type/);
});
test('unfinished structural teaching edits survive the existing raw cache without expanding other forms',async()=>{
 const owner={taskId:'t',artifactId:'a',artifactRevision:1,artifactDigest:'d',moduleId:'m',moduleVersion:1},slot='helper:semantic:typedsteps',initial={definitionText:JSON.stringify(typedProcedureExample())};
 const changed=parseTypedProcedureDraft(initial.definitionText);changed.inputs.push({name:'',kind:'boolean'});changed.rules.splice(1,1);changed.rules[0].conditions=[];
 let records:LearningDraftRecord[]=[];
 const transport={read:async()=>({kind:'available' as const,epoch:'initial',records}),save:async(savedOwner:LearningDraftOwner,savedSlot:string,_epoch:string,revision:number,value:LearningDraftRecord['value'])=>{const record={owner:savedOwner,slot:savedSlot,revision:revision+1,value};records=records.filter(item=>learningDraftKey(item.owner,item.slot)!==learningDraftKey(savedOwner,savedSlot));records.push(record);return {kind:'saved' as const,epoch:'initial',record};}};
 const state=semanticHelper.initial('h'),basis=navigationFormBasis(initial,{slot,basisMode:'explicit',basis:semanticHelperDraftBasis(state,'typedsteps')}),cache=createLearningDrafts(transport);await cache.load();
 expect(cache.tryEdit(owner,slot,initial,basis,()=>({definitionText:JSON.stringify(changed)})).kind).toBe('accepted');await cache.flush();
 const reopened=createLearningDrafts(transport);await reopened.load();const restored=reopened.readForm(owner,slot,initial,basis);expect(restored.status).toBe('ready');expect(parseTypedProcedureDraft(restored.value.definitionText)).toEqual(changed);
 expect(helperDraftMode(slot)).toBe('semantic');expect(helperDraftMode(slot+'future')).toBeUndefined();expect(()=>typedProcedure(changed)).toThrow();
 expect(cache.tryEdit(owner,'helper:semantic:steps',{value:'old'},'strict',()=>({other:'new'}) as never).kind).toBe('rejected');
});

import {typedNegativeInput} from '../src/renderer/src/typed-semantic-procedure';
import {TypedProcedureFields} from '../src/renderer/src/components/TypedProcedureFields';
test('text and yes/no procedures can declare a safe invalid-type negative check and activate',()=>{
 const draft=typedProcedureExample();draft.inputs=[{name:'label',kind:'string'},{name:'urgent',kind:'boolean'}];draft.outputs=[{name:'route',kind:'string'}];draft.requirements=[];draft.rules=[];draft.fallback={kind:'return',reason:'',values:[{source:'literal',value:'standard'}]};
 let state=semanticHelper.initial('simple');const act=(action:Record<string,unknown>)=>{state=semanticHelper.update('simple',state,{...action,expectedRevision:state.revision});};
 act({kind:'set-semantic-procedure',procedure:typedProcedure(draft)});act({kind:'record-semantic-input',input:{label:'A-1',urgent:false}});const replay=state.recordings[0];
 const negative=typedNegativeInput(typedProcedure(draft),{label:'A-1',urgent:false},'urgent');expect(negative).toEqual({label:'A-1',urgent:'invalid'});
 act({kind:'set-semantic-evidence',rationales:[{id:'reason',kind:'inferred-rationale',stepId:replay.result.trace[0].stepId,basis:[{recordingId:replay.recordingId,traceStepId:replay.result.trace[0].stepId}],reason:'Return the chosen local route.'}],corrections:[],examples:[{id:'different',role:'held-out',input:{label:'B-2',urgent:true},expected:{status:'completed',output:{route:'standard'}}},{id:'wrong-type',role:'counterexample',input:negative,expected:{status:'invalid-input',stage:'input'}}]});
 expect(semanticHelper.check(state).passed).toBe(true);act({kind:'save-semantic-version',changeNote:'Text and yes/no checks.'});act({kind:'activate-semantic-version',version:1});expect(state.activeVersion).toBe(1);
 const saved=structuredClone(state.versions[0]);draft.fallback.values[0]={source:'literal',value:'changed'};act({kind:'replace-semantic-procedure',procedure:typedProcedure(draft),rationales:[],corrections:[],examples:[]});
 act({kind:'set-semantic-evidence',rationales:replay?[{id:'reason',kind:'inferred-rationale',stepId:replay.result.trace[0].stepId,basis:[{recordingId:replay.recordingId,traceStepId:replay.result.trace[0].stepId}],reason:'The changed fallback is intended.'}]:[],corrections:[],examples:[{id:'different',role:'held-out',input:{label:'B-2',urgent:true},expected:{status:'completed',output:{route:'changed'}}},{id:'wrong-type',role:'counterexample',input:negative,expected:{status:'invalid-input',stage:'input'}}]});
 expect(semanticHelper.check(state).passed).toBe(false);expect(()=>act({kind:'save-semantic-version',changeNote:'Changed original training output.'})).toThrow(/checks/);expect(state.versions[0]).toEqual(saved);expect(state.activeVersion).toBe(1);
 const html=renderToStaticMarkup(createElement(SemanticHelperStudio,{data:{...helperExample,id:'simple'},state,onAction:()=>{}}));expect(html).toContain('An explicit expectation correction is required');expect(html).toContain('older saved versions keep their own checks');
});
test('referenced fields cannot be removed and unavailable copied inputs stay visibly invalid after a type change',()=>{
 const draft=typedProcedureExample();draft.inputs.push({name:'unused',kind:'string'});
 let html=renderToStaticMarkup(createElement(TypedProcedureFields,{value:draft,onChange:()=>{}}));
 expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Remove input field 1<\/button>/);expect(html).toContain('Used by a condition or copied/calculated result. Change those references before removing this field.');expect(html).toMatch(/<button type="button">Remove input field 6<\/button>/);
 draft.inputs[0].kind='number';html=renderToStaticMarkup(createElement(TypedProcedureFields,{value:draft,onChange:()=>{}}));expect(html).toContain('Unavailable input: item');expect(html).toContain('Choose an input with the same type as this result field.');expect(()=>typedProcedure(draft)).toThrow(/type/);
 draft.inputs=draft.inputs.filter(field=>field.name!=='condition');html=renderToStaticMarkup(createElement(TypedProcedureFields,{value:draft,onChange:()=>{}}));expect(html).toContain('Missing field: condition');expect(()=>typedProcedure(draft)).toThrow(/existing input/);
});

import {renameTypedField,typedOutcomeKind} from '../src/renderer/src/typed-semantic-procedure';
test('duplicate field rename refuses the transition before references can migrate to another owner',()=>{
 const draft=typedProcedureExample(),before=structuredClone(draft);
 const rejected=renameTypedField(draft,'inputs',0,'condition');expect(rejected.kind).toBe('refused');expect(draft).toEqual(before);
 const accepted=renameTypedField(draft,'inputs',1,'status');expect(accepted.kind).toBe('accepted');if(accepted.kind!=='accepted')throw Error('Expected an accepted rename.');
 expect(accepted.value.rules[1].conditions[0].field).toBe('status');expect(accepted.value.fallback.values[0]).toEqual({source:'input',value:'item'});
 const ambiguous=structuredClone(draft);ambiguous.inputs[1].name='item';expect(renameTypedField(ambiguous,'inputs',1,'status').kind).toBe('refused');
});
test('changing between stop and return clears hidden bindings so a reintroduced field cannot acquire an old copy',()=>{
 const draft=typedProcedureExample(),prior=draft.rules[1].outcome,stopped=typedOutcomeKind(prior,'stop',draft.outputs);expect(stopped.values).toEqual([{source:'literal',value:''},{source:'literal',value:''}]);
 const returned=typedOutcomeKind({...prior,kind:'stop'},'return',draft.outputs);expect(returned.values.every(item=>item.source==='literal')).toBe(true);
});
test('a selected wrong-type case cannot pass due to a different invalid input',()=>{
 const plan=typedProcedure(typedProcedureExample());expect(()=>typedNegativeInput(plan,{item:'A',condition:'working',days:2000000,approved:true,recalled:false},'approved')).toThrow(/valid input/);
 const invalid=typedNegativeInput(plan,{item:'A',condition:'working',days:12,approved:true,recalled:false},'approved');expect(runSemanticProcedure(plan,invalid)).toMatchObject({status:'invalid-input',stage:'input',reason:'Missing, invalid or out-of-range input field approved.'});
});
