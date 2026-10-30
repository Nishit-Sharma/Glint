import {Schema} from 'effect';
import {copyTableData} from './semantic-table-procedure';
import {runSemanticProcedure,type SemanticProcedure,type SemanticRecord,type SemanticRunResult} from './semantic-procedure';
import {pickingCanonical,pickingDigest} from '../shared/picking-digest';

export const sourceHelperLearningLimits=Object.freeze({attempts:8,reasonCharacters:2000,fields:6,characters:160});
const id=Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{1,80}$/)),digest=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),positive=Schema.Int.pipe(Schema.positive());
const scalar=Schema.Union(Schema.String.pipe(Schema.maxLength(160)),Schema.Number.pipe(Schema.between(-1e12,1e12),Schema.filter(Number.isFinite)),Schema.Boolean);
const record=Schema.Record({key:id,value:scalar}).pipe(Schema.filter(value=>Object.keys(value).length<=6));
export const SourceHelperLessonSchema=Schema.Struct({activeVersion:Schema.Int.pipe(Schema.between(1,20)),sourceRef:Schema.Struct({sourceId:id,version:positive,digest}),bindings:Schema.Array(Schema.Struct({field:id,column:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(80))})).pipe(Schema.minItems(1),Schema.maxItems(6)),recordNumber:Schema.Int.pipe(Schema.between(2,33))});
const predictedOutput=Schema.Record({key:id,value:Schema.Union(Schema.String.pipe(Schema.maxLength(4000)),Schema.Number.pipe(Schema.between(-1e12,1e12),Schema.filter(Number.isFinite)),Schema.Boolean)}).pipe(Schema.filter(value=>Object.keys(value).length<=6));
const prediction=Schema.Union(Schema.Struct({status:Schema.Literal('completed'),output:predictedOutput}),Schema.Struct({status:Schema.Literal('abstained')}));
export const SourceHelperPracticeActionSchema=Schema.Struct({kind:Schema.Literal('submit-source-helper-practice'),lesson:SourceHelperLessonSchema,changedInput:record,practiceInput:record,prediction,reasoning:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(2000),Schema.filter(value=>!!value.trim()&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value))),expectedRevision:Schema.Int.pipe(Schema.between(0,499))});
const owner=Schema.Struct({taskId:id,artifactId:id,artifactRevision:positive,artifactDigest:digest,moduleId:id,moduleVersion:positive,helperId:id});
export const SourceHelperPracticeReceiptSchema=Schema.Struct({id:digest,owner,atRevision:Schema.Int.pipe(Schema.between(1,500)),submitted:SourceHelperPracticeActionSchema,sourceValues:Schema.Record({key:id,value:Schema.String.pipe(Schema.maxLength(160))}),exampleInput:record,excludedInputCount:Schema.Int.pipe(Schema.between(1,5000)),exposure:Schema.Literal('unknown')});
export type SourceHelperLesson=typeof SourceHelperLessonSchema.Type;
export type SourceHelperPracticeAction=typeof SourceHelperPracticeActionSchema.Type;
export type SourceHelperPracticeReceipt=typeof SourceHelperPracticeReceiptSchema.Type;
export type SourceHelperLearningOwner=typeof owner.Type;
const decode=<A,I>(schema:Schema.Schema<A,I>,value:unknown)=>Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(copyTableData(value,32000,2000));
export const readSourceHelperLesson=(value:unknown)=>decode(SourceHelperLessonSchema,value);
export const readSourceHelperPracticeAction=(value:unknown)=>decode(SourceHelperPracticeActionSchema,value);
export const sourceHelperPracticeIdentity=(owner:SourceHelperLearningOwner,lesson:SourceHelperLesson)=>pickingDigest({owner,lesson:{...lesson,bindings:[...lesson.bindings].sort((left,right)=>left.field<right.field?-1:left.field>right.field?1:0)}});
export const sameSourceHelperInput=(left:SemanticRecord,right:SemanticRecord)=>pickingCanonical(left)===pickingCanonical(right);
export function sourceHelperLearningRun(procedure:SemanticProcedure,input:SemanticRecord):Exclude<SemanticRunResult,{status:'invalid-input'}>{
 if(procedure.target!=='local-record'||procedure.input.fields.length>6||procedure.output.fields.length>6||Object.values(input).some(value=>typeof value==='string'&&value.length>160))throw Error('Learning supports local record helpers with up to six inputs and outputs and 160 characters per input.');
 const result=runSemanticProcedure(procedure,input);if(result.status==='invalid-input')throw Error(result.reason);return result;
}
/** Pure recomputation only. New receipts require an independent host admission. */
export function validateSourceHelperPracticeReceipt(procedure:SemanticProcedure,value:unknown):SourceHelperPracticeReceipt{
 const receipt=decode(SourceHelperPracticeReceiptSchema,value),action=receipt.submitted;
 if(receipt.id!==sourceHelperPracticeIdentity(receipt.owner,action.lesson)||receipt.atRevision!==action.expectedRevision+1)throw Error('The first practice identity or revision changed.');
 sourceHelperLearningRun(procedure,receipt.exampleInput);sourceHelperLearningRun(procedure,action.changedInput);sourceHelperLearningRun(procedure,action.practiceInput);
 if(sameSourceHelperInput(receipt.exampleInput,action.changedInput))throw Error('Change at least one source input for the hypothetical comparison.');
 if([receipt.exampleInput,action.changedInput].some(input=>sameSourceHelperInput(input,action.practiceInput)))throw Error('Practice inputs must differ from the source and hypothetical examples.');
 if(action.prediction.status==='completed'){
  const fields=procedure.output.fields;
  if(Object.keys(action.prediction.output).length!==fields.length||fields.some(field=>{const value=action.prediction.status==='completed'?action.prediction.output[field.name]:undefined;return field.kind==='string'?typeof value!=='string'||value.length<field.minLength||value.length>field.maxLength:field.kind==='number'?typeof value!=='number'||value<field.minimum||value>field.maximum:typeof value!=='boolean';}))throw Error('Predict every output using its supported type and bounds.');
 }
 if(Object.keys(receipt.sourceValues).length!==procedure.input.fields.length||procedure.input.fields.some(field=>!Object.hasOwn(receipt.sourceValues,field.name)))throw Error('The mapped source values are incomplete.');
 return receipt;
}
export function sourceHelperPracticeFeedback(procedure:SemanticProcedure,receipt:SourceHelperPracticeReceipt){
 const result=sourceHelperLearningRun(procedure,receipt.submitted.practiceInput),prediction=receipt.submitted.prediction;
 const matches=prediction.status===result.status&&(prediction.status!=='completed'||sameSourceHelperInput(prediction.output,result.output));
 return {result,matches,grading:prediction.status==='abstained'?'Only the stopped status was checked; stop location and partial output were not predicted.':'Completed status and every output were compared exactly. Reasoning is retained, not graded.'};
}
