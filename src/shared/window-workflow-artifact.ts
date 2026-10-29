import type {SourceRef} from '../core/types';
import {parseWindowWorkflowProposal,type WindowWorkflowReviewCandidate} from '../learning/window-workflow-proposal';
import {serializeLearningDraftJson} from './learning-drafts';
export const WINDOW_WORKFLOW_MIME='application/vnd.window-companion.window-workflow-review+json';
export const WINDOW_WORKFLOW_PROMPT='Review the visible state transitions as a bounded finite sequential model.';
export const WINDOW_WORKFLOW_PROGRESS='Preparing image transcription and state transitions for review…';
export const sameWindowSourceRef=(a:SourceRef,b:SourceRef)=>a.sourceId===b.sourceId&&a.version===b.version&&a.digest===b.digest;
/** Revalidate persisted, inert candidate bytes. No preview or review authority is restored. */
export function readWindowWorkflowCandidate(content:string,sourceRefs:readonly SourceRef[]):WindowWorkflowReviewCandidate|undefined{
 try{
  if(content.length>128*1024)return undefined;
  const input:unknown=JSON.parse(content);
  if(JSON.stringify(input)!==content)return undefined;
  if(!input||typeof input!=='object'||!('proposal' in input)||!('provenance' in input))return undefined;
  const provenance=input.provenance;
  const candidate=parseWindowWorkflowProposal(JSON.stringify(input.proposal),provenance);
  if(candidate.kind!=='window-workflow-review-candidate'||serializeLearningDraftJson(candidate)!==serializeLearningDraftJson(input)||sourceRefs.length!==1||!sameWindowSourceRef(sourceRefs[0],candidate.provenance.source.ref))return undefined;
  return candidate;
 }catch{return undefined;}
}
export function windowWorkflowExtractionPrompt(){return `Read only the supplied S1 image. Propose a small finite sequential state model for human correction, never a module, answer or executable. No task IDs, source refs, permission, targets, transfer or approval fields. Quotes are proposed transcription; arrows are inference. Coordinates are normalized 0..1 x,y,width,height, positive and wholly in the image. Use only these exact JSON shapes and keys:\n${JSON.stringify({schemaVersion:1,kind:'finite-state-proposal',title:'Short title',states:[{id:'state1',name:{kind:'transcribed',label:'State A',citationId:'state-a-quote'}},{id:'state2',name:{kind:'transcribed',label:'State B',citationId:'state-b-quote'}}],events:[{id:'event1',name:{kind:'inferred',label:'Short label',citationIds:['quote1'],reason:'Why inferred'}}],transitions:[{id:'rule1',candidate:{kind:'inferred',fromStateId:'state1',eventId:'event1',toStateId:'state2',citationIds:['quote1'],reason:'Arrow interpretation'}}],initialState:{kind:'unresolved',citationIds:[],reason:'Needs reviewer choice'},assumptions:[],issues:[],citations:[{id:'state-a-quote',source:'S1',location:{kind:'image-region',x:0,y:0,width:0.25,height:0.25,quote:'State A'}},{id:'state-b-quote',source:'S1',location:{kind:'image-region',x:0.5,y:0,width:0.25,height:0.25,quote:'State B'}},{id:'quote1',source:'S1',location:{kind:'image-region',x:0.25,y:0.25,width:0.25,height:0.25,quote:'Event label'}}]})}\nUse unique IDs (1..80 ASCII letters/digits/_/-), at most 8 states,8 events,24 transitions,48 citations,12 issues/assumptions. Labels<=160, quotes/reasons<=500 characters; complete JSON<=64000 characters. Unreadable names/candidates use {"kind":"unresolved","citationIds":[],"reason":"Specific missing evidence"}. Initial state may be inferred with stateId,citationIds,reason. Issues use id,kind,citationIds,reason; kind is ambiguity,unreadable,missing-information,unsupported-timing,unsupported-concurrency,insufficient-diagram. Missing or ambiguous evidence stays unresolved. Do not infer clocking, concurrency, hidden HDL semantics or simulate VHDL. If these features are essential, or no useful finite diagram is visible, return {"schemaVersion":1,"kind":"unsupported-source","code":"insufficient-diagram","reason":"Short plain reason"}, using code unsupported-timing,unsupported-concurrency,insufficient-diagram or unreadable. No Markdown, links, extra keys or invented missing rules.`;}
