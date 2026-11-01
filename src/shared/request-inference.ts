import {Schema} from 'effect';

const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0')));
const revision=Schema.Int.pipe(Schema.between(0,Number.MAX_SAFE_INTEGER));
export const RequestInferenceSelectionSchema=Schema.Struct({provider:Schema.Literal('codex'),model:id,effort:id,tier:Schema.Literal('default','priority')});
export type RequestInferenceSelection=typeof RequestInferenceSelectionSchema.Type;
const policy=Schema.Literal('fixed','automatic');
export type RequestInferencePolicy=typeof policy.Type;
export const RequestInferenceSavedSchema=Schema.Struct({revision,selection:Schema.NullOr(RequestInferenceSelectionSchema),policy:Schema.optional(policy)});
export type RequestInferenceSaved=typeof RequestInferenceSavedSchema.Type;
const state=Schema.Struct({taskId:id,...RequestInferenceSavedSchema.fields});
export type RequestInferenceState=typeof state.Type;
export const readRequestInferenceState=Schema.decodeUnknownSync(state,{onExcessProperty:'error'});
export const readRequestInferenceSelection=Schema.decodeUnknownSync(RequestInferenceSelectionSchema,{onExcessProperty:'error'});
const command=Schema.Union(Schema.Struct({type:Schema.Literal('inference.catalog'),taskId:id}),Schema.Struct({type:Schema.Literal('inference.preview'),taskId:id,prompt:Schema.optional(Schema.String.pipe(Schema.maxLength(16_000))),kind:Schema.optional(Schema.Literal('explain','create'))}),Schema.Struct({type:Schema.Literal('inference.select'),taskId:id,expectedRevision:revision,selection:Schema.NullOr(RequestInferenceSelectionSchema),policy:Schema.optional(policy)}));
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

export const AUTOMATIC_ROUTING_RULES={
 routine:{model:'gpt-6-luna',description:'Short questions without a listed reasoning signal use Luna at its lowest advertised reasoning effort.'},
 deliberate:{model:'gpt-6.1-sol',description:'Drafts, prompts over 600 characters, or compare, analyze, reason, debug, prove, design, plan, tradeoff, architecture, or step-by-step requests use Sol at its highest advertised reasoning effort.'},
} as const;
export type RequestRoutingInput={prompt:string;kind:'explain'|'create';models:readonly RequestInferenceModel[]};
export type RequestRoutingDecision={policy:'fixed'|'automatic'|'queued';rule:string;reason:string};
const effortOrder=['none','minimal','low','medium','high','xhigh'];
export function resolveRequestInference(session:{requestInference?:RequestInferenceSaved}|undefined,route:'codex'|'meta',defaults:RequestInferenceSelection,queued?:{inference?:RequestInferenceSelection},input?:RequestRoutingInput){
 const saved=requestInferenceSaved(session),automatic=saved.policy==='automatic';
 let selection=queued?queued.inference:saved.selection??(route==='codex'?defaults:undefined);
 let decision:RequestRoutingDecision={policy:queued?'queued':'fixed',rule:queued?'frozen':'saved',reason:queued?'This pending follow-up keeps its original resolved settings.':saved.selection?'Use the saved fixed model, effort and speed.':'Use the connection default settings.'};
 if(!queued&&automatic){
  if(route!=='codex')throw Error('This task uses Automatic routing through Codex. Reconnect Codex or choose Fixed with the connection default before asking.');
  if(!input?.prompt.trim())throw Error('Enter a question or draft to inspect Automatic routing. Nothing was sent.');
  const prompt=input.prompt.trim(),signal=/\b(compar(?:e|ing|ison)|analy[sz](?:e|ing|is)|reason(?:ing)?|debug(?:ging)?|prov(?:e|ing)|proof|design|plan|tradeoffs?|architecture)\b|step[ -]by[ -]step/i.test(prompt);
  const rule=input.kind==='create'||prompt.length>600||signal?'deliberate':'routine',chosen=AUTOMATIC_ROUTING_RULES[rule];
  const model=input.models.find(model=>model.id===chosen.model&&model.tiers.some(tier=>tier.id===defaults.tier));
  if(!model)throw Error(`Automatic local policy requires advertised ${chosen.model} with the connection's ${defaults.tier} speed tier for this input. Choose Fixed to use another advertised combination. No substitute was selected.`);
  const efforts=effortOrder.filter(effort=>model.efforts.includes(effort)),effort=rule==='deliberate'?efforts.at(-1):efforts[0];
  if(!effort)throw Error('Automatic local policy does not recognize an advertised effort for this model. Choose Fixed to select it explicitly.');
  selection={provider:'codex',model:model.id,effort,tier:defaults.tier};assertAdvertisedInference(selection,input.models);
  decision={policy:'automatic',rule,reason:`Local policy v1: ${input.kind==='create'?'draft request':prompt.length>600?'prompt over 600 characters':signal?'listed reasoning signal':'short question without a listed reasoning signal'}. ${chosen.description} Speed stays at the connection tier. This rule is not a response-quality guarantee.`};
 }
 if(selection&&route!=='codex')throw Error(queued?'This queued follow-up keeps a Codex model choice. Reconnect Codex or cancel and recreate this follow-up.':'This task keeps a Codex model choice. Choose the connection default or reconnect Codex before asking.');
 return {selection,decision,...(queued?{}:{revision:saved.revision})};
}
export function requestInferenceScopeFields(inference?:RequestInferenceSelection):RequestInferenceSelection[]{return inference?[inference]:[];}
