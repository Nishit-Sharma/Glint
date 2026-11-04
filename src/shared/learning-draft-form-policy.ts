import {Schema,ParseResult} from 'effect';
import {invalidLearningDraft} from './learning-draft-validation';

/** Inert raw-form limits. These schemas do not confirm a review or admit a module. */
const text=(max:number)=>Schema.String.pipe(Schema.maxLength(max));
const id=Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{1,80}$/));
const choice=Schema.Union(Schema.Literal(''),id);
const reason=text(500);
const named=Schema.Struct({id,selected:Schema.Boolean,unresolved:Schema.Boolean,label:text(160),citationId:choice,interpretation:Schema.Literal('reviewed-transcription','user-interpreted'),reason});
const transition=Schema.Struct({id,selected:Schema.Boolean,unresolved:Schema.Boolean,fromStateId:choice,eventId:choice,toStateId:choice,citationIds:text(326),reason});
// Empty and temporarily incomplete numeric input is raw work, never geometry.
const coordinate=text(64).pipe(Schema.pattern(/^[\x20-\x7e]*$/));
const evidence=Schema.Struct({citationId:id,reviewed:Schema.Boolean,x:coordinate,y:coordinate,width:coordinate,height:coordinate,quote:text(500),reason});
export const WindowReviewRawSchema=Schema.Struct({title:text(160),states:Schema.Array(named).pipe(Schema.maxItems(8)),events:Schema.Array(named).pipe(Schema.maxItems(8)),transitions:Schema.Array(transition).pipe(Schema.maxItems(24)),evidence:Schema.Array(evidence).pipe(Schema.maxItems(48)),initialStateId:choice,eventSequence:text(1200),assumptions:text(6011),issueResolutions:Schema.Array(Schema.Struct({issueId:id,resolution:Schema.Literal('','resolved','excluded'),reason})).pipe(Schema.maxItems(12))});
export const JoinRowRawSchema=Schema.Struct({cells:Schema.Array(Schema.Struct({text:text(32*1024),isNull:Schema.Boolean})).pipe(Schema.minItems(1),Schema.maxItems(4))});
export type WindowReviewRaw=typeof WindowReviewRawSchema.Type;
export type JoinRowRaw=typeof JoinRowRawSchema.Type;
const decode=<A,I>(schema:Schema.Schema<A,I>,value:unknown)=>{try{return Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(value);}catch(error){if(ParseResult.isParseError(error))throw invalidLearningDraft('Draft form fields are invalid.');throw error;}};
export const parseWindowReviewRaw=(value:unknown)=>decode(WindowReviewRawSchema,value);
export const parseJoinRowRaw=(value:unknown)=>decode(JoinRowRawSchema,value);
export function joinRowDraftSlot(slot:string):{side:'left'|'right';rowId:string}|undefined{
 const match=/^join:row:(left|right):([A-Za-z0-9_-]{1,80})$/.exec(slot);
 return match?{side:match[1]==='left'?'left':'right',rowId:match[2]}:undefined;
}
export function windowReviewCandidateId(slot:string):string|undefined{
 const prefix='window-workflow:review:',id=slot.startsWith(prefix)?slot.slice(prefix.length):'';
 return id.length>0&&id.length<=200&&!id.includes('\0')?id:undefined;
}
/** Original rows stay ordered; only explicitly named reviewer additions may follow them. */
export function windowReviewRowsMatch(rows:readonly {id:string}[],original:readonly {id:string}[],category:'states'|'events'|'transitions'):boolean{
 const prefix={states:'reviewer-state-',events:'reviewer-event-',transitions:'reviewer-rule-'}[category];
 return rows.length>=original.length&&original.every((row,index)=>rows[index].id===row.id)&&rows.slice(original.length).every(row=>new RegExp('^'+prefix+'[1-9][0-9]*$').test(row.id))&&new Set(rows.map(row=>row.id)).size===rows.length;
}
/** Raw additions remain inert and source-bound; they never confirm a review. */
export function windowReviewRawMatches(raw:WindowReviewRaw,candidate:{proposal:{states:readonly {id:string}[];events:readonly {id:string}[];transitions:readonly {id:string}[];citations:readonly {id:string}[];issues:readonly {id:string}[]}}):boolean{
 const p=candidate.proposal,same=(rows:readonly string[],ids:readonly string[])=>rows.length===ids.length&&rows.every((id,i)=>id===ids[i]);
 const states=new Set(raw.states.map(row=>row.id)),events=new Set(raw.events.map(row=>row.id)),citations=new Set(p.citations.map(row=>row.id)),choice=(id:string,ids:ReadonlySet<string>)=>id===''||ids.has(id);
 const identities=[...raw.states,...raw.events,...raw.transitions,...p.citations,...p.issues].map(row=>row.id);
 return new Set(identities).size===identities.length&&windowReviewRowsMatch(raw.states,p.states,'states')&&windowReviewRowsMatch(raw.events,p.events,'events')&&windowReviewRowsMatch(raw.transitions,p.transitions,'transitions')&&same(raw.evidence.map(row=>row.citationId),p.citations.map(row=>row.id))&&same(raw.issueResolutions.map(row=>row.issueId),p.issues.map(row=>row.id))&&[...raw.states,...raw.events].every(row=>choice(row.citationId,citations))&&raw.transitions.every(row=>choice(row.fromStateId,states)&&choice(row.toStateId,states)&&choice(row.eventId,events))&&choice(raw.initialStateId,states);
}
export function windowReviewRawKeepsIdentity(initial:WindowReviewRaw,current:WindowReviewRaw):boolean{
 return windowReviewRawMatches(current,{proposal:{states:initial.states,events:initial.events,transitions:initial.transitions,citations:initial.evidence.map(row=>({id:row.citationId})),issues:initial.issueResolutions.map(row=>({id:row.issueId}))}});
}
