import {Schema} from 'effect';
import {copyTableData} from '../learning/semantic-table-procedure';
import {pickingDefinition,parsePickingCase} from '../learning/picking-helper';
import {invalidLearningDraft as invalid} from './learning-draft-validation';
export const PICKING_DEFINITION_DRAFT_JSON_BYTES=1024*1024;
export const PICKING_CASE_DRAFT_JSON_BYTES=1536*1024;
const policyBySlot={
 'helper:table:candidate':'picking-helper-candidate','helper:table:context':'picking-helper-context','helper:table:recording':'picking-helper-recording','helper:table:cases':'picking-helper-cases','helper:table:correction':'picking-helper-correction','helper:table:run':'picking-helper-run',
} as const;
export type PickingRawPolicy=typeof policyBySlot[keyof typeof policyBySlot];
export function pickingRawPolicy(slot:string):PickingRawPolicy|undefined{return Object.hasOwn(policyBySlot,slot)?policyBySlot[slot as keyof typeof policyBySlot]:undefined;}
export function isPickingRawPolicy(value:unknown):value is PickingRawPolicy{return Object.values(policyBySlot).some(p=>p===value);}
const string=(max:number)=>Schema.String.pipe(Schema.maxLength(max));
const selectableId=string(80).pipe(Schema.filter(v=>v===''||/^[A-Za-z0-9_-]+$/.test(v)&&!['__proto__','prototype','constructor'].includes(v)));
const candidateSchema=Schema.Struct({definitionText:string(512*1024),changeReason:string(500)});
const contextSchema=Schema.Struct({rows:Schema.Array(Schema.Struct({values:Schema.Array(string(160)).pipe(Schema.minItems(4),Schema.maxItems(4))})).pipe(Schema.minItems(1),Schema.maxItems(12)),key:string(160),quantity:string(160),reviewed:Schema.Boolean,delivery:string(160)});
const recordingSchema=Schema.Struct({rowId:selectableId,source:Schema.Literal('row','request'),field:selectableId,output:Schema.Literal('itemKey','label','quantity','handling'),literal:string(160)});
const casesSchema=Schema.Struct({cases:Schema.Array(Schema.Unknown).pipe(Schema.maxItems(20))});
const correctionSchema=Schema.Struct({reason:string(500)});
const runSchema=Schema.Struct({runId:selectableId,note:string(500)});
const decode=<A,I>(schema:Schema.Schema<A,I>,value:unknown)=>Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(value);
/** Only these known human text fields have a raw unfinished state. Never mutate
 * the stored text or normalize unknown fields; runtime admission remains strict. */
function candidateShape(text:string){
 const inert=copyTableData(JSON.parse(text));if(JSON.stringify(inert)!==text)throw Error('Use compact internal typed data.');
 const root=inert as Record<string,unknown>;
 const fill=(object:unknown,key:string)=>{if(object&&typeof object==='object'&&!Array.isArray(object)&&(object as Record<string,unknown>)[key]==='')(object as Record<string,unknown>)[key]='?';};
 fill(root,'intent');const body=root.body as Record<string,unknown>|undefined;fill(body,'intent');
 for(const group of ['preconditions','postconditions']){const values=body?.[group];if(Array.isArray(values))for(const condition of values)fill(condition,'reason');}
 const step=(value:unknown):void=>{if(!value||typeof value!=='object'||Array.isArray(value))return;const node=value as Record<string,unknown>;fill(node,'intent');if(node.kind==='abstain')fill(node,'reason');if(node.kind==='assign')step(node.next);if(node.kind==='branch'){step(node.then);step(node.else);}};step(body?.root);
 pickingDefinition(root);
}
export function validatePickingRaw(value:unknown,policy:PickingRawPolicy):void{
 try{
  switch(policy){
   case 'picking-helper-candidate':{const raw=decode(candidateSchema,value);candidateShape(raw.definitionText);return;}
   case 'picking-helper-context':decode(contextSchema,value);return;
   case 'picking-helper-recording':decode(recordingSchema,value);return;
   case 'picking-helper-cases':{const raw=decode(casesSchema,value);raw.cases.forEach(parsePickingCase);return;}
   case 'picking-helper-correction':decode(correctionSchema,value);return;
   case 'picking-helper-run':decode(runSchema,value);return;
  }
 }catch{throw invalid('The local helper draft does not match its bounded typed form.');}
}
export function samePickingCaseShape(left:unknown,right:unknown):boolean{validatePickingRaw(left,'picking-helper-cases');validatePickingRaw(right,'picking-helper-cases');return true;}
