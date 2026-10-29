import {pickingDefinition,contextTable,type PickingObservation,type PickingContext} from './picking-helper';
import {runTableProcedure,type TableProcedureV2} from './semantic-table-procedure';
import type {SemanticStep,SemanticPredicate} from './semantic-procedure';
import {pickingCanonical} from '../shared/picking-digest';
const same=(left:unknown,right:unknown)=>pickingCanonical(left)===pickingCanonical(right);
const input=(field:string)=>({kind:'input' as const,field}),literal=(value:string|number|boolean)=>({kind:'literal' as const,value});
const compare=(field:string,value:string|number|boolean):SemanticPredicate=>({kind:'compare',operator:'eq',left:input(field),right:literal(value)});
export type PickingContrastRule={delivery:string;handling:string;observations:string[]};
/** A controlled contrast over owned app commands, not an inference of general workflow intent. */
export function inferPickingContrast(definition:TableProcedureV2,observations:readonly PickingObservation[],contexts:readonly PickingContext[]):{definition:TableProcedureV2;rules:readonly PickingContrastRule[];reason:string}{
 if(observations.length<2||observations.length>8)throw Error('Record at least two completed local demonstrations before proposing a contrast.');
 const profile=pickingDefinition(definition),protection=profile.body.root;
 if(!['matchedKey','matchedLabel'].every(role=>profile.lookup.bindings.some(binding=>binding.input===role)))throw Error('Contrast teaching requires the supported matched-key and matched-label input roles. Restore that local profile first.');
 if(protection.kind!=='branch'||protection.then.kind!=='abstain'||!same(protection.predicate,compare('protected',true))||protection.else.kind!=='branch')throw Error('Contrast teaching requires the declared protection and stock guards. Restore that supported local profile first.');
 const stock=protection.else;
 if(stock.then.kind!=='abstain'||!same(stock.predicate,{kind:'compare',operator:'gt',left:input('quantity'),right:input('available')})||!profile.body.preconditions.some(condition=>same(condition.predicate,compare('reviewed',true))))throw Error('Contrast teaching requires declared review, protection and quantity-above-stock guards.');
 let reference:PickingContext|undefined,keyColumn:string|undefined,labelColumn:string|undefined;
 const rules=new Map<string,PickingContrastRule>();
 for(const observation of observations){
  const context=contexts.find(item=>item.id===observation.contextId);if(!context)throw Error('An original demonstrated context is unavailable.');
  const fixed=(item:PickingContext)=>({request:{key:item.request.key,quantity:item.request.quantity,reviewed:item.request.reviewed},columns:profile.table.columns,rows:contextTable(item,profile).rows});
  if(reference&&!same(fixed(reference),fixed(context)))throw Error('Ambiguous demonstrations: keep the table, item, quantity and review the same; vary only delivery and the demonstrated handling instruction.');reference??=context;
  const delivery=context.request.delivery;if(typeof delivery!=='string'||!delivery.trim())throw Error('Demonstrate a nonblank delivery label.');
  const last=(field:string)=>{for(let index=observation.events.length-1;index>=0;index--){const event=observation.events[index];if(event.step.kind!=='select-row'&&event.step.output===field)return {step:event.step,index};}return undefined;};
  const key=last('itemKey'),label=last('label'),quantity=last('quantity'),handling=last('handling'),selected=observation.events.map((event,index)=>({event,index})).filter(item=>item.event.step.kind==='select-row').at(-1)?.index??-1;
  if(!key||key.step.kind!=='copy'||key.step.source!=='row'||key.index<selected||!label||label.step.kind!=='copy'||label.step.source!=='row'||label.index<selected||!quantity||quantity.step.kind!=='copy'||quantity.step.source!=='request'||quantity.step.field!=='quantity'||!handling||handling.step.kind!=='literal'||typeof handling.step.value!=='string')throw Error('Demonstrate row-to-key and row-to-label copies after selecting the row, copy quantity from the saved request, and set a literal handling instruction. Coincidentally equal values cannot establish a copy rule.');
  if(keyColumn&&keyColumn!==key.step.field||labelColumn&&labelColumn!==label.step.field)throw Error('The demonstrations use conflicting copy strategies. Keep the same key and label source columns.');keyColumn=key.step.field;labelColumn=label.step.field;
  const previous=rules.get(delivery);if(previous&&previous.handling!==handling.step.value)throw Error('Conflicting demonstrations give the same delivery label different handling instructions. Original demonstrations are retained; use a new helper to teach a different policy.');
  if(previous)previous.observations.push(observation.id);else rules.set(delivery,{delivery,handling:handling.step.value,observations:[observation.id]});
 }
 const branches=[...rules.values()].sort((a,b)=>a.delivery<b.delivery?-1:a.delivery>b.delivery?1:0);
 if(branches.length<2||branches.length>4||new Set(branches.map(rule=>rule.handling)).size<2)throw Error('Demonstrate two to four different delivery labels with at least two different handling instructions. Repeated identical examples alone do not establish a contrast.');
 const projection=(index:number,handling:string):SemanticStep=>{let next:SemanticStep={kind:'return',id:`observed${index}Done`,intent:'Check the demonstrated projection.'};for(const [field,value] of [['handling',literal(handling)],['quantity',input('quantity')],['label',input('matchedLabel')],['itemKey',input('matchedKey')]] as const)next={kind:'assign',id:`observed${index}${field}`,intent:'Project '+field,field,value,next};return next;};
 let root:SemanticStep={kind:'abstain',id:'deliveryStop',intent:'Stop on an undemonstrated delivery label.',reason:'This delivery label was not demonstrated. Review it before defining another branch.'};
 for(let index=branches.length-1;index>=0;index--){const rule=branches[index];root={kind:'branch',id:`observedDelivery${index+1}`,intent:'Use the demonstrated handling for '+rule.delivery,predicate:compare('delivery',rule.delivery),then:projection(index+1,rule.handling),else:root};}
 const proposed=pickingDefinition({...profile,lookup:{...profile.lookup,column:keyColumn!,bindings:profile.lookup.bindings.map(binding=>binding.input==='matchedKey'?{...binding,column:keyColumn!}:binding.input==='matchedLabel'?{...binding,column:labelColumn!}:binding)},body:{...profile.body,root:{...protection,else:{...stock,else:root}}}});
 for(const observation of observations){const context=contexts.find(item=>item.id===observation.contextId)!;const actual=runTableProcedure(proposed,contextTable(context,proposed),context.request);if(actual.status!=='completed'||!same(actual.output,observation.output))throw Error('The proposed conditional copies do not explain every original demonstration. Review the declared profile and recorded actions.');}
 const reason=`Contrasting app actions ${observations.map(item=>item.id).join(', ')} support proposed delivery-to-handling branches and the recorded copy strategy. Review, protection and stock rules remain declared. Unseen labels stop; generalization and physical gestures are unverified.`;
 if(reason.length>500)throw Error('The demonstration provenance exceeds this local proposal limit. Keep the originals for review.');
 return {definition:proposed,rules:branches,reason};
}
