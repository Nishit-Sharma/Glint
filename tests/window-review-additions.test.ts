import {expect,test} from 'vitest';
import {syntheticCandidate,syntheticOmissionDraft} from './window-learning.fixture';
import {checkWindowWorkflowReview,windowWorkflowReviewSnapshot} from '../src/learning/window-workflow-review';
import {initialWindowReviewForm,addWindowReviewRow} from '../src/renderer/src/window-review-form';
import {parseWindowReviewRaw,windowReviewRawMatches} from '../src/shared/learning-draft-form-policy';

function check(draft:unknown){const candidate=syntheticCandidate();return checkWindowWorkflowReview(candidate,{draft,confirmation:{kind:'reviewed-window-transcription',snapshot:windowWorkflowReviewSnapshot(candidate,draft)}});}
test('human additions use reviewed existing evidence and receive host-derived addition provenance',()=>{
 const candidate=syntheticCandidate(),before=JSON.stringify(candidate),result=check(syntheticOmissionDraft());expect(result.kind).toBe('valid');if(result.kind!=='valid')throw Error('Expected reviewed omissions');
 expect(result.value.practice.rules.at(-1)).toMatchObject({eventId:'reviewer-event-1',toStateId:'reviewer-state-1'});
 expect(result.value.nameInterpretations.filter(name=>name.reviewerAdded)).toHaveLength(2);expect(result.value.ruleInterpretations.at(-1)).toMatchObject({reviewerAdded:true,classification:'reviewed-image-interpretation'});expect(result.value.nameInterpretations[0]).not.toHaveProperty('reviewerAdded');expect(JSON.stringify(candidate)).toBe(before);
});
test('omission corrections cannot forge original identity, OCR classification, evidence, references or duplicate deterministic pairs',()=>{
 const d=syntheticOmissionDraft();
 for(const value of [
  {...d,states:d.states.map((row,i)=>i?row:{...row,id:'reviewer-state-2'})},
  {...d,states:[d.states[1],d.states[0],d.states[2]]},
  {...d,states:d.states.map((row,i)=>i===2?{...row,value:{...row.value,interpretation:'reviewed-transcription'}}:row)},
  {...d,states:d.states.map((row,i)=>i===2?{...row,id:'reviewer-event-1'}:row)},
  {...d,states:d.states.map((row,i)=>i===2?{...row,value:{...row.value,label:'Idle'}}:row)},
  {...d,evidence:d.evidence.filter(row=>row.citationId!=='c-go')},
  {...d,transitions:d.transitions.map((row,i)=>i===2?{...row,value:{...row.value,toStateId:'foreign'}}:row)},
  {...d,transitions:d.transitions.map((row,i)=>i===2?{...row,value:{...row.value,fromStateId:'idle',eventId:'start'}}:row)},
 ])expect(check(value).kind).toBe('invalid');
 expect(()=>windowWorkflowReviewSnapshot(syntheticCandidate(),{...d,transitions:d.transitions.map((row,i)=>i===2?{...row,value:{...row.value,reviewerAdded:false}}:row)})).toThrow();
 const candidate=syntheticCandidate(),confirmation={kind:'reviewed-window-transcription',snapshot:windowWorkflowReviewSnapshot(candidate,d)};expect(checkWindowWorkflowReview(candidate,{draft:{...d,title:'Changed after confirmation'},confirmation})).toMatchObject({kind:'invalid',issues:[{code:'confirmation-stale'}]});
});
test('all original and added rows count toward8 states,8 events,24 rules including excluded rows',()=>{
 const d=syntheticOmissionDraft();
 for(const [category,limit,prefix] of [['states',8,'reviewer-state-'],['events',8,'reviewer-event-'],['transitions',24,'reviewer-rule-']] as const){
  const rows=d[category],full=[...rows,...Array.from({length:limit-rows.length},(_,index)=>({...rows.at(-1)!,id:prefix+(index+2),selected:false}))];
  expect(check({...d,[category]:full}).kind).toBe('valid');expect(()=>windowWorkflowReviewSnapshot(syntheticCandidate(),{...d,[category]:[...full,{...full.at(-1),id:prefix+99}]})).toThrow();
 }
});
test('raw append controls retain original identities and evidence, bound additions and avoid collisions',()=>{
 const candidate=syntheticCandidate(),initial=initialWindowReviewForm(candidate);let form=initial;
 for(const category of ['states','events','transitions'] as const)form=addWindowReviewRow(form,category);
 expect(windowReviewRawMatches(parseWindowReviewRaw(form),candidate)).toBe(true);expect(form.states.at(-1)).toMatchObject({id:'reviewer-state-1',interpretation:'user-interpreted',citationId:'',reason:''});expect(form.evidence).toEqual(initial.evidence);expect(initial.states).toHaveLength(2);
 for(let index=0;index<30;index++)for(const category of ['states','events','transitions'] as const)form=addWindowReviewRow(form,category);
 expect([form.states.length,form.events.length,form.transitions.length]).toEqual([8,8,24]);expect(addWindowReviewRow(form,'states')).toBe(form);
 const collision={...initial,evidence:[...initial.evidence,{...initial.evidence[0],citationId:'reviewer-state-1'}]};expect(addWindowReviewRow(collision,'states').states.at(-1)?.id).toBe('reviewer-state-2');
});
