import {Schema} from 'effect';
import type {ArtifactRevision,Expression,Task} from '../core/types';
import {parseModelDraft} from '../core/model-drafts';
import {evaluateExperiment} from '../core/experiments';
import {readExperimentRunInput,type ExperimentRunInput} from './experiment-runs';
import {SOURCE_FORMULA_MIME,reviewedSourceFormula,sourceFormulaCitationText} from './source-formula';
import {compareExperimentSnapshots,experimentComparisonWorkedText,isolatedExperimentWorkedText,type ExperimentSnapshot} from './experiment-comparison';
import {copyTableData} from './semantic-table-procedure';
import {pickingCanonical,pickingDigest} from '../shared/picking-digest';
const uuid=Schema.String.pipe(Schema.pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/));
const schema=Schema.Struct({intentId:uuid,includeTrials:Schema.Boolean,calculation:Schema.Unknown});
export type ExperimentResultInput={intentId:string;includeTrials:boolean;calculation:ExperimentRunInput};
export type ExperimentResultInspection={kind:'not-saved';binding:string}|{kind:'saved';binding:string;artifactId:string;revision:1;digest:string};
export const EXPERIMENT_RESULT_PROMPT='Save an explicitly reviewed deterministic calculation result as task content.';
export function readExperimentResultInput(raw:unknown):ExperimentResultInput{
 const input=Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(copyTableData(raw,128000,8000)),calculation=readExperimentRunInput(input.calculation);
 if(calculation.parent||input.includeTrials&&!calculation.baseline)throw Error('Choose the original calculation and comparison before saving.');
 return {...input,calculation};
}
export const experimentResultId=(input:ExperimentResultInput)=>'experiment-result-v1-'+input.intentId;
export const experimentResultBinding=(input:ExperimentResultInput)=>pickingDigest(input);
export function expressionLabel(expression:Expression,variableLabel:(name:string)=>string=name=>name):string{
 switch(expression.op){case 'constant':return String(expression.value)+(expression.unit&&expression.unit!=='1'?' '+expression.unit:'');case 'variable':return variableLabel(expression.name);case 'power':return '('+expressionLabel(expression.base,variableLabel)+')^'+expression.exponent;default:return '('+expressionLabel(expression.left,variableLabel)+' '+({add:'+',subtract:'−',multiply:'×',divide:'÷'}[expression.op])+' '+expressionLabel(expression.right,variableLabel)+')';}
}
/** Derive bytes from the retained exact basis and bounded inputs, never renderer output. */
export function experimentResultArtifact(task:Task,input:ExperimentResultInput){
 const value=input.calculation,base=task.artifacts.find(item=>item.id===value.basis.artifactId)?.revisions.find(item=>item.revision===value.basis.revision&&item.digest===value.basis.digest);
 if(task.id!==value.taskId||!base||base.encoding==='base64'||pickingCanonical(base.sourceRefs)!==pickingCanonical(value.sourceRefs))throw Error('The original calculation basis is unavailable.');
 const sourcePacket=base.mimeType===SOURCE_FORMULA_MIME?reviewedSourceFormula(task,value.basis.artifactId,base):undefined,draft=sourcePacket?.draft??(base.mimeType==='application/json'?parseModelDraft(base.content,'experiment'):undefined);
 if(!draft||draft.kind!=='experiment'||pickingCanonical(draft.spec.expression)!==pickingCanonical(value.spec.expression)||pickingCanonical(draft.spec.variables)!==pickingCanonical(value.spec.variables))throw Error('Use the saved experiment formula and input definitions.');
 const owner={taskId:task.id,artifact:value.basis,sourceRefs:[...value.sourceRefs]},snapshot:ExperimentSnapshot={title:value.title,spec:value.spec,inputs:value.inputs,result:evaluateExperiment(value.spec,value.inputs),owner},baseline=value.baseline?{...snapshot,inputs:value.baseline,result:evaluateExperiment(value.spec,value.baseline)}:undefined,comparison=baseline?compareExperimentSnapshots(baseline,snapshot):undefined;
 if(comparison?.kind==='incompatible')throw Error(comparison.reason);
 const content=`${snapshot.title}\n\nExperiment: ${draft.title}, revision ${base.revision}\nFormula: ${expressionLabel(snapshot.spec.expression)}\n${baseline&&comparison?.kind==='comparable'?`\nComparison baseline inputs:\n${baseline.spec.variables.map(variable=>`${variable.name} = ${baseline.inputs[variable.name]} ${variable.unit}`).join('\n')}\nBaseline result: ${baseline.result.value} ${baseline.result.unit}\n\n`:''}Inputs:\n${snapshot.spec.variables.map(variable=>`${variable.name} = ${snapshot.inputs[variable.name]} ${variable.unit}`).join('\n')}\n\nResult: ${snapshot.result.value} ${snapshot.result.unit}${baseline&&comparison?.kind==='comparable'?`\nCalculated difference: ${comparison.delta} ${comparison.unit}\nThis comparison uses the same formula and assumptions. It does not establish real-world causation.\n\n${experimentComparisonWorkedText(baseline,snapshot)}${input.includeTrials?`\n\n${isolatedExperimentWorkedText(baseline,snapshot)}`:''}`:''}\n\nAssumptions:\n${snapshot.result.assumptions.map(item=>'- '+item).join('\n')}\n\nTechnical provenance:\nExperiment identity: ${value.basis.artifactId}; digest: ${base.digest}${sourcePacket?`\n\n${sourceFormulaCitationText(sourcePacket)}`:''}`;
 return {title:snapshot.title+' — result',content,mimeType:'text/plain',sourceRefs:[...value.sourceRefs],expectedArtifacts:[value.basis]};
}
export function inspectExperimentResult(task:Task,input:ExperimentResultInput):ExperimentResultInspection{
 const binding=experimentResultBinding(input),records=task.requests.filter(record=>record.id===experimentResultId(input));if(!records.length)return {kind:'not-saved',binding};
 const request=records[0],artifact=task.artifacts.find(item=>item.id===request.artifactId),revision:ArtifactRevision|undefined=artifact?.revisions.find(item=>item.revision===request.answer?.revision&&item.digest===request.answer.digest),expected=experimentResultArtifact(task,input);
 if(records.length!==1||request.status!=='completed'||request.kind!=='experiment'||request.prompt!==EXPERIMENT_RESULT_PROMPT||request.digest!==binding||pickingCanonical(request.contextArtifactRefs)!==pickingCanonical([input.calculation.basis])||!artifact||!revision||revision.revision!==1||request.answer?.artifactId!==artifact.id||revision.title!==expected.title||revision.content!==expected.content||revision.mimeType!==expected.mimeType||revision.encoding||pickingCanonical(revision.sourceRefs)!==pickingCanonical(expected.sourceRefs)||pickingCanonical(request.sourceRefs)!==pickingCanonical(expected.sourceRefs)||revision.contextSourceRefs===undefined||revision.contextSkillRefs===undefined||pickingCanonical(request.contextSourceRefs)!==pickingCanonical(revision.contextSourceRefs)||pickingCanonical(request.contextSkillRefs)!==pickingCanonical(revision.contextSkillRefs))throw Error('The original result save is unavailable or has different input. Check Files before starting another copy.');
 return {kind:'saved',binding,artifactId:artifact.id,revision:1,digest:revision.digest};
}
