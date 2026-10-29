import {expect,test} from 'vitest';
import {initialWindowReviewForm,windowReviewDraft} from '../src/renderer/src/window-review-form';
import {checkWindowWorkflowReview,windowWorkflowReviewSnapshot} from '../src/learning/window-workflow-review';
import {syntheticCandidate} from './window-learning.fixture';
test('the visible review starts incomplete and maps explicit corrected fields to the same sealed checker',()=>{
 const candidate=syntheticCandidate(),raw=initialWindowReviewForm(candidate);
 expect(checkWindowWorkflowReview(candidate,{draft:windowReviewDraft(candidate,raw),confirmation:null}).kind).toBe('invalid');
 const reviewed={...raw,initialStateId:'idle',eventSequence:'start, finish, start',states:raw.states.map(row=>({...row,reason:'I reviewed this label.'})),events:raw.events.map(row=>({...row,reason:'I reviewed this label.'})),transitions:raw.transitions.map(row=>({...row,reason:'My interpretation of the arrow.'})),evidence:raw.evidence.map(row=>({...row,reviewed:true,reason:'I checked this exact quote and region.'}))};
 reviewed.evidence[0]={...reviewed.evidence[0],quote:'Waiting',x:'0.5'};reviewed.states[0]={...reviewed.states[0],label:'Waiting'};
 const draft=windowReviewDraft(candidate,reviewed),confirmation={kind:'reviewed-window-transcription',snapshot:windowWorkflowReviewSnapshot(candidate,draft)};
 const result=checkWindowWorkflowReview(candidate,{draft,confirmation});expect(result.kind).toBe('valid');
 if(result.kind!=='valid')throw Error('Expected explicit review');expect(result.value.evidence[0]).toMatchObject({original:{quote:'Idle'},reviewed:{quote:'Waiting',x:0.5},classification:'corrected-transcription'});
 const changed=windowReviewDraft(candidate,{...reviewed,title:'Changed while pending'});expect(checkWindowWorkflowReview(candidate,{draft:changed,confirmation})).toMatchObject({kind:'invalid',issues:[{code:'confirmation-stale'}]});
});

function completeForm(){const candidate=syntheticCandidate(),raw=initialWindowReviewForm(candidate);return {candidate,form:{...raw,initialStateId:'idle',eventSequence:'start, finish, start',states:raw.states.map(row=>({...row,reason:'Reviewed label.'})),events:raw.events.map(row=>({...row,reason:'Reviewed label.'})),transitions:raw.transitions.map(row=>({...row,reason:'Reviewed arrow interpretation.'})),evidence:raw.evidence.map(row=>({...row,reviewed:true,reason:'Reviewed exact quote and region.'}))}};}
function publicReviewAccepts(candidate:ReturnType<typeof syntheticCandidate>,form:ReturnType<typeof initialWindowReviewForm>){try{const draft=windowReviewDraft(candidate,form);return checkWindowWorkflowReview(candidate,{draft,confirmation:{kind:'reviewed-window-transcription',snapshot:windowWorkflowReviewSnapshot(candidate,draft)}}).kind==='valid';}catch{return false;}}
test.each(['x','y','width','height'] satisfies readonly ('x'|'y'|'width'|'height')[])('blank %s is an incomplete coordinate, including at the public review boundary',key=>{
 const {candidate,form}=completeForm();expect(publicReviewAccepts(candidate,form)).toBe(true);
 for(const blank of ['', ' \t\n ']){const changed={...form,evidence:form.evidence.map((row,i)=>i?row:{...row,[key]:blank})};expect(()=>windowReviewDraft(candidate,changed)).toThrow('explicit numeric coordinates');expect(publicReviewAccepts(candidate,changed)).toBe(false);}
});
test('intentional zero x/y coordinates remain explicit valid origins',()=>{const {candidate,form}=completeForm(),changed={...form,evidence:form.evidence.map((row,i)=>i?row:{...row,x:'0',y:'0'})};expect(publicReviewAccepts(candidate,changed)).toBe(true);});
