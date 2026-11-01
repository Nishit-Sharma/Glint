import {Schema} from 'effect';

const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0')));
const revision=Schema.Int.pipe(Schema.between(0,Number.MAX_SAFE_INTEGER));
export const RequestInferenceSelectionSchema=Schema.Struct({provider:Schema.Literal('codex'),model:id,effort:id,tier:Schema.Literal('default','priority')});
export type RequestInferenceSelection=typeof RequestInferenceSelectionSchema.Type;
export const RequestInferenceSavedSchema=Schema.Struct({revision,selection:Schema.NullOr(RequestInferenceSelectionSchema)});
export type RequestInferenceSaved=typeof RequestInferenceSavedSchema.Type;
const state=Schema.Struct({taskId:id,...RequestInferenceSavedSchema.fields});
export type RequestInferenceState=typeof state.Type;
export const readRequestInferenceState=Schema.decodeUnknownSync(state,{onExcessProperty:'error'});
export const readRequestInferenceSelection=Schema.decodeUnknownSync(RequestInferenceSelectionSchema,{onExcessProperty:'error'});
const command=Schema.Union(Schema.Struct({type:Schema.Literal('inference.catalog','inference.preview'),taskId:id}),Schema.Struct({type:Schema.Literal('inference.select'),taskId:id,expectedRevision:revision,selection:Schema.NullOr(RequestInferenceSelectionSchema)}));
export type RequestInferenceCommand=typeof command.Type;
export const readRequestInferenceCommand=Schema.decodeUnknownSync(command,{onExcessProperty:'error'});
export type RequestInferenceModel={id:string;label:string;efforts:string[];tiers:Array<{id:'default'|'priority';label:string}>;initialEffort:string;initialTier:'default'|'priority'};
export type RequestInferenceCatalog={kind:'available';models:RequestInferenceModel[];defaultSelection:RequestInferenceSelection}|{kind:'unavailable';message:string};
export const requestInferenceSaved=(session?:{requestInference?:RequestInferenceSaved}):RequestInferenceSaved=>session?.requestInference??{revision:0,selection:null};
export const sameRequestInference=(a:RequestInferenceSelection|null|undefined,b:RequestInferenceSelection|null|undefined)=>JSON.stringify(a??null)===JSON.stringify(b??null);
export function assertAdvertisedInference(selection:RequestInferenceSelection,models:readonly RequestInferenceModel[]){
 const model=models.find(model=>model.id===selection.model);
 if(!model||!model.efforts.includes(selection.effort)||!model.tiers.some(tier=>tier.id===selection.tier))throw Error('The saved model, reasoning effort or speed tier is not advertised by this connection. Choose a supported combination; no fallback was selected.');
}
/** Both preview and the real Codex dispatcher consume these exact fields. */
export function buildCodexInferenceWire(value:RequestInferenceSelection){
 const selection=readRequestInferenceSelection(value);
 return {thread:{model:selection.model,serviceTier:selection.tier,allowProviderModelFallback:false,config:{model_reasoning_effort:selection.effort}},turn:{model:selection.model,effort:selection.effort,serviceTierForTurn:selection.tier}};
}
const advertisedModel=Schema.Struct({model:id,displayName:Schema.optional(id),hidden:Schema.optional(Schema.Boolean),supportedReasoningEfforts:Schema.Array(Schema.Struct({reasoningEffort:id})).pipe(Schema.maxItems(20)),defaultReasoningEffort:Schema.optional(id),serviceTiers:Schema.optional(Schema.Array(Schema.Struct({id,name:id})).pipe(Schema.maxItems(20))),defaultServiceTier:Schema.optional(Schema.NullOr(id))});
export function codexInferenceModels(value:unknown):RequestInferenceModel[]{
 const advertised=Schema.decodeUnknownSync(Schema.Array(advertisedModel).pipe(Schema.maxItems(400)))(value),models:RequestInferenceModel[]=[];
 for(const model of advertised){
  if(model.hidden||models.some(existing=>existing.id===model.model))continue;
  const efforts=[...new Set(model.supportedReasoningEfforts.map(value=>value.reasoningEffort))],tiers:RequestInferenceModel['tiers']=[];
  if(model.defaultServiceTier===null||model.defaultServiceTier==='default'||model.serviceTiers?.some(tier=>tier.id==='default'))tiers.push({id:'default',label:'Standard'});
  const fast=model.serviceTiers?.find(tier=>tier.id==='priority');if(fast)tiers.push({id:'priority',label:fast.name});
  if(!efforts.length||!tiers.length)continue;
  models.push({id:model.model,label:model.displayName??model.model,efforts,tiers,initialEffort:efforts.includes(model.defaultReasoningEffort??'')?model.defaultReasoningEffort!:efforts[0],initialTier:model.defaultServiceTier==='priority'&&fast?'priority':tiers[0].id});
 }
 return models;
}

export function resolveRequestInference(session:{requestInference?:RequestInferenceSaved}|undefined,route:'codex'|'meta',defaults:RequestInferenceSelection,queued?:{inference?:RequestInferenceSelection}){
 const saved=requestInferenceSaved(session),selection=queued?queued.inference:saved.selection??(route==='codex'?defaults:undefined);
 if(selection&&route!=='codex')throw Error(queued?'This queued follow-up keeps a Codex model choice. Reconnect Codex or cancel and recreate this follow-up.':'This task keeps a Codex model choice. Choose the connection default or reconnect Codex before asking.');
 return {selection,...(queued?{}:{revision:saved.revision})};
}
export function requestInferenceScopeFields(inference?:RequestInferenceSelection):RequestInferenceSelection[]{return inference?[inference]:[];}
