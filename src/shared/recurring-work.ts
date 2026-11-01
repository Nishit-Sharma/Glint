import type {Task} from '../core/types';
import {Schema} from 'effect';
import {RequestInferenceSelectionSchema,assertAdvertisedInference,buildCodexInferenceWire,type RequestInferenceSelection,type RequestInferenceCatalog,requestInferenceSaved,sameRequestInference} from './request-inference';

const revision=Schema.Number.pipe(Schema.int(),Schema.between(0,Number.MAX_SAFE_INTEGER));
const bounded=(max:number)=>Schema.String.pipe(Schema.minLength(1),Schema.maxLength(max),Schema.filter(value=>value.trim().length>0&&!value.includes('\0')));
const timestamp=Schema.String.pipe(Schema.filter(value=>Number.isFinite(Date.parse(value))&&Date.parse(value)<Date.parse('2200-01-01T00:00:00.000Z')&&new Date(value).toISOString()===value));
const timeZone=bounded(100).pipe(Schema.filter(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}}));
const scope={inference:Schema.optional(RequestInferenceSelectionSchema),mode:Schema.optional(Schema.Literal('response')),timeZone:Schema.optional(timeZone)};
const cadence=Schema.Literal(24,168);
export const RECURRING_WORK_LIMIT=40;
export const RECURRING_HISTORY_LIMIT=50;
const history=Schema.mutable(Schema.Struct({taskId:bounded(200),scheduledFor:timestamp,preparedAt:timestamp,skipped:revision,requestId:Schema.optional(bounded(200)),status:Schema.optional(Schema.Literal('running','completed','failed','interrupted')),artifactId:Schema.optional(bounded(200)),error:Schema.optional(bounded(500))}));
export const RecurringWorkSchema=Schema.mutable(Schema.Struct({id:bounded(200),revision,title:bounded(200),instruction:bounded(10_000),intervalHours:cadence,nextDueAt:timestamp,...scope,blockedReason:Schema.optional(bounded(500)),enabled:Schema.Boolean,createdAt:timestamp,updatedAt:timestamp,history:Schema.mutable(Schema.Array(history).pipe(Schema.maxItems(RECURRING_HISTORY_LIMIT)))}));
export const RecurringWorkListSchema=Schema.mutable(Schema.Array(RecurringWorkSchema).pipe(Schema.maxItems(RECURRING_WORK_LIMIT),Schema.filter(items=>new Set(items.map(item=>item.id)).size===items.length)));
export type RecurringWork=typeof RecurringWorkSchema.Type;
const identity={id:bounded(200),expectedRevision:revision};
const save=Schema.Struct({...identity,kind:Schema.Literal('save'),title:bounded(200),instruction:bounded(10_000),intervalHours:cadence,nextDueAt:timestamp,...scope});
export const RecurringWorkChangeSchema=Schema.Union(save,Schema.Struct({...identity,kind:Schema.Literal('pause','resume','delete')}));
export type RecurringWorkChange=typeof RecurringWorkChangeSchema.Type;
export const readRecurringWorkChange=Schema.decodeUnknownSync(RecurringWorkChangeSchema,{onExcessProperty:'error'});
export const readRecurringWorkList=Schema.decodeUnknownSync(RecurringWorkListSchema,{onExcessProperty:'error'});
const runtimeSchema=Schema.Struct({state:Schema.Literal('checking','ready','stopped','error'),message:Schema.String,checkedAt:Schema.optional(timestamp)});
export type RecurringWorkStatus=typeof runtimeSchema.Type;
export const RecurringWorkViewSchema=Schema.Struct({items:RecurringWorkListSchema,runtime:runtimeSchema});
export type RecurringWorkView=typeof RecurringWorkViewSchema.Type;
export const readRecurringWorkView=Schema.decodeUnknownSync(RecurringWorkViewSchema,{onExcessProperty:'error'});

const publicScheduleMessages=new Set([
 'This schedule changed. Reload before saving again.',
 'This schedule changed. Reload schedules before saving again. Your edits are kept.',
 'Wait for the scheduled response to finish before resuming.',
 'Recurring responses were not authorized. The schedule stays paused.',
 'Check the provider connection before authorizing recurring responses.',
 'Connection changed. Resume again to review its current scope.',
 'Connection changed. Resume again to authorize its current scope.',
 'The account or instructions changed. Resume again to authorize the current scope.',
 'Configure a Meta Model API key before authorizing recurring responses.',
 'Codex sign-in metadata is unavailable. Recurring responses cannot be authorized.',
 'Current Codex user instructions could not be bound for recurring responses.',
]);
export function recurringWorkPublicMessage(message:string):string|undefined{return publicScheduleMessages.has(message)?message:undefined;}

const inferenceCommand=Schema.Union(Schema.Struct({type:Schema.Literal('schedules.models')}),Schema.Struct({type:Schema.Literal('schedules.preview'),id:bounded(200),expectedRevision:revision}));
export type RecurringInferenceCommand=typeof inferenceCommand.Type;
export const readRecurringInferenceCommand=Schema.decodeUnknownSync(inferenceCommand,{onExcessProperty:'error'});
/** This exact resolution feeds both inspection and the real recurring grant. No catalog refresh. */
export function recurringInference(item:Pick<RecurringWork,'inference'>,route:'codex'|'meta',defaultSelection:RequestInferenceSelection,catalog:RequestInferenceCatalog):{source:'saved'|'connection-default';route:'codex'|'meta';selection?:RequestInferenceSelection;wire?:ReturnType<typeof buildCodexInferenceWire>}{
 if(item.inference){
  if(route!=='codex')throw Error('This schedule selects Codex. Select the Codex connection before reviewing or resuming it.');
  if(catalog.kind!=='available')throw Error(catalog.message);
  assertAdvertisedInference(item.inference,catalog.models);
 }
 const selection=item.inference??(route==='codex'?defaultSelection:undefined);
 return {source:item.inference?'saved':'connection-default',route,...(selection?{selection:{...selection},wire:buildCodexInferenceWire(selection)}:{})};
}
export type RecurringInferencePreview={id:string;revision:number;configurationDigest:string;authorized:boolean}&ReturnType<typeof recurringInference>;
export const recurringResponseScope=(item:RecurringWork)=>JSON.stringify([item.id,item.title,item.instruction,item.intervalHours,item.mode,item.timeZone,...(item.inference?[item.inference]:[])]);

/** Bind the immutable grant tuple to the exact task prepared from this schedule. */
export function recurringRequestInference(grant:{inference?:RequestInferenceSelection},task:Task){
 const saved=requestInferenceSaved(task.session);
 if(saved.selection&&!sameRequestInference(saved.selection,grant.inference))throw Error('The prepared task model choice differs from the reviewed recurring grant.');
 return {selection:grant.inference,revision:saved.revision};
}
