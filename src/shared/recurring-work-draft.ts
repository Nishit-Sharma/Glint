import {Schema} from 'effect';
import {pickingDigest} from './picking-digest';
import type {RecurringWork} from './recurring-work';
import {readRequestInferenceSelection} from './request-inference';

export const RECURRING_DRAFT_SLOT='recurring-work:input';
export const recurringDraftOwner=Object.freeze({kind:'recurring-work-form' as const});
export const recurringEditDraftOwner=(schedule:RecurringWork)=>({kind:'recurring-work-edit' as const,scheduleId:schedule.id,scheduleRevision:schedule.revision,scheduleDigest:pickingDigest(schedule)});
export const RECURRING_EDIT_DRAFT_BASIS='recurring-work-edit:v1';
export const RECURRING_DRAFT_BASIS='recurring-work-form:v1';
const text=(maximum:number)=>Schema.String.pipe(Schema.maxLength(maximum));
const raw=Schema.Struct({id:text(200),title:text(200),instruction:text(10_000),mode:Schema.Literal('response','draft'),intervalHours:Schema.Literal(24,168),next:text(100),timeZone:text(100),model:text(200),effort:text(200),tier:text(200)});
export type RecurringWorkDraft=typeof raw.Type;
export const emptyRecurringDraft:RecurringWorkDraft=Object.freeze({id:'',title:'',instruction:'',mode:'response',intervalHours:24,next:'',timeZone:'',model:'',effort:'',tier:''});
/** Raw fields may be incomplete or invalid; they confer no schedule or request authority. */
export function readRecurringWorkDraft(value:unknown,expectedId?:string):RecurringWorkDraft{
 const parsed=Schema.decodeUnknownSync(raw,{onExcessProperty:'error'})(value);
 if(!parsed.id&&Object.entries(emptyRecurringDraft).some(([key,value])=>parsed[key as keyof RecurringWorkDraft]!==value))throw Error('Schedule draft identity needs review.');
 if(parsed.id&&expectedId!==undefined&&parsed.id!==expectedId)throw Error('Schedule edit identity needs review.');
 if(parsed.id&&expectedId===undefined&&!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(parsed.id))throw Error('Schedule draft identity needs review.');
 if(parsed.model||parsed.effort||parsed.tier)readRequestInferenceSelection({provider:'codex',model:parsed.model,effort:parsed.effort,tier:parsed.tier});
 return parsed;
}
