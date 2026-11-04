import type {WindowWorkflowReviewCandidate} from '../../learning/window-workflow-proposal';
import {serializeLearningDraftJson} from '../../shared/learning-drafts';
/** Raw editing fields only. Neither persisted checkboxes nor model suggestions confirm a review. */
export function initialWindowReviewForm(candidate:WindowWorkflowReviewCandidate){
 const named=(entry:WindowWorkflowReviewCandidate['proposal']['states'][number])=>({id:entry.id,selected:true,unresolved:entry.name.kind==='unresolved',label:entry.name.kind==='unresolved'?'':entry.name.label,citationId:entry.name.kind==='transcribed'?entry.name.citationId:entry.name.citationIds[0]??'',interpretation:entry.name.kind==='transcribed'?'reviewed-transcription':'user-interpreted',reason:''});
 return {title:candidate.proposal.title,states:candidate.proposal.states.map(named),events:candidate.proposal.events.map(named),transitions:candidate.proposal.transitions.map(entry=>({id:entry.id,selected:true,unresolved:entry.candidate.kind==='unresolved',fromStateId:entry.candidate.kind==='inferred'?entry.candidate.fromStateId:'',eventId:entry.candidate.kind==='inferred'?entry.candidate.eventId:'',toStateId:entry.candidate.kind==='inferred'?entry.candidate.toStateId:'',citationIds:entry.candidate.citationIds.join(', '),reason:''})),evidence:candidate.proposal.citations.map(c=>({citationId:c.id,reviewed:false,x:String(c.location.x),y:String(c.location.y),width:String(c.location.width),height:String(c.location.height),quote:c.location.quote,reason:''})),initialStateId:'',eventSequence:'',assumptions:candidate.proposal.assumptions.join('\n'),issueResolutions:candidate.proposal.issues.map(issue=>({issueId:issue.id,resolution:'',reason:''}))};
}
export type WindowReviewForm=ReturnType<typeof initialWindowReviewForm>;
function coordinate(value:string){const text=value.trim();if(!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/iu.test(text))throw Error('A reviewed image region needs explicit numeric coordinates.');const number=Number(text);if(!Number.isFinite(number))throw Error('A reviewed image region needs explicit numeric coordinates.');return number;}
export function windowReviewDraft(candidate:WindowWorkflowReviewCandidate,form:WindowReviewForm){
 const names=(rows:WindowReviewForm['states'])=>rows.map(row=>({id:row.id,selected:row.selected,value:row.unresolved?{kind:'unresolved',reason:row.reason}:{kind:'reviewed-name',label:row.label,citationId:row.citationId,interpretation:row.interpretation,reason:row.reason}}));
 const split=(value:string)=>value.split(',').map(part=>part.trim()).filter(Boolean);
 return {title:form.title,states:names(form.states),events:names(form.events),transitions:form.transitions.map(row=>({id:row.id,selected:row.selected,value:row.unresolved?{kind:'unresolved',reason:row.reason}:{kind:'reviewed-image-interpretation',fromStateId:row.fromStateId,eventId:row.eventId,toStateId:row.toStateId,citationIds:split(row.citationIds),reason:row.reason}})),evidence:form.evidence.filter(row=>row.reviewed).map(row=>{
  const original=candidate.proposal.citations.find(c=>c.id===row.citationId)?.location;
  const location={kind:'image-region',x:coordinate(row.x),y:coordinate(row.y),width:coordinate(row.width),height:coordinate(row.height),quote:row.quote};
  return original&&serializeLearningDraftJson(location)===serializeLearningDraftJson(original)?{citationId:row.citationId,kind:'confirmed-transcription',reason:row.reason}:{citationId:row.citationId,kind:'corrected-transcription',location,reason:row.reason};
 }),initialStateId:form.initialStateId||null,eventIds:split(form.eventSequence),assumptions:form.assumptions.split('\n').map(line=>line.trim()).filter(Boolean),issueResolutions:form.issueResolutions.map(row=>({issueId:row.issueId,kind:row.resolution,reason:row.reason}))};
}

/** Additions start incomplete and need the same reviewed evidence and final confirmation. */
export function addWindowReviewRow(form:WindowReviewForm,category:'states'|'events'|'transitions'):WindowReviewForm{
 const prefix={states:'reviewer-state-',events:'reviewer-event-',transitions:'reviewer-rule-'}[category],limit=category==='transitions'?24:8;
 if(form[category].length>=limit)return form;
 const ids=new Set([...form.states,...form.events,...form.transitions].map(row=>row.id).concat(form.evidence.map(row=>row.citationId),form.issueResolutions.map(row=>row.issueId)));
 let n=1;while(ids.has(prefix+n))n++;
 const id=prefix+n,row=category==='transitions'?{id,selected:true,unresolved:false,fromStateId:'',eventId:'',toStateId:'',citationIds:'',reason:''}:{id,selected:true,unresolved:false,label:'',citationId:'',interpretation:'user-interpreted',reason:''};
 return {...form,[category]:[...form[category],row]};
}

export function windowReviewRowInUse(form:WindowReviewForm,category:'states'|'events',id:string):boolean{
 return category==='states'?form.initialStateId===id||form.transitions.some(row=>row.fromStateId===id||row.toStateId===id):form.eventSequence.split(',').some(value=>value.trim()===id)||form.transitions.some(row=>row.eventId===id);
}
