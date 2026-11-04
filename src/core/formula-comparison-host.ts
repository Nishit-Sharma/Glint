import type {Companion} from './companion';
import type {Task,RequestInput} from './types';
import {SOURCE_FORMULA_MIME,reviewedSourceFormula,sourceFormulaCitationText} from '../learning/source-formula';
import {formulaComparisonIdentity,formulaComparisonPreview,formulaComparisonReport,readFormulaComparisonInput,readFormulaComparisonSubmission,type FormulaComparisonInput,type FormulaComparisonSubmission} from '../learning/formula-comparison';
function basis(task:Task,value:FormulaComparisonInput,current:boolean){
 const artifact=task.artifacts.find(item=>item.id===value.basis.artifactId),revision=artifact?.revisions.find(item=>item.revision===value.basis.revision&&item.digest===value.basis.digest);
 if(task.id!==value.taskId||!revision||revision.mimeType!==SOURCE_FORMULA_MIME||JSON.stringify(revision.sourceRefs)!==JSON.stringify(value.expectedSourceRefs))throw Error('The exact reviewed source formula is unavailable.');
 const packet=reviewedSourceFormula(task,artifact!.id,revision);
 if(current&&(task.status!=='active'||artifact?.revisions.at(-1)!==revision||revision.sourceRefs.some(ref=>{const source=task.sources.find(item=>item.id===ref.sourceId);return source?.freshness!=='fresh'||source.currentVersion!==ref.version||source.versions.at(-1)?.digest!==ref.digest;})))throw Error('The formula or its sources changed. Review current sources before a new comparison.');
 return packet;
}
const requestId=(value:FormulaComparisonSubmission)=>'formula-comparison-v1-'+formulaComparisonIdentity(value);
function requestInput(value:FormulaComparisonSubmission):RequestInput{return {taskId:value.taskId,requestId:requestId(value),kind:'experiment',prompt:'Save an explicitly reviewed bounded alternative-formula comparison.',executionScope:'formula-comparison-v1:'+formulaComparisonIdentity(value),sourceIds:value.expectedSourceRefs.map(ref=>ref.sourceId),expectedSourceRefs:[...value.expectedSourceRefs],expectedArtifacts:[value.basis]};}
function content(task:Task,value:FormulaComparisonSubmission,current:boolean){const packet=basis(task,value,current);return `${formulaComparisonReport(packet.draft,value)}\n\nExact alternative formula:\n${value.formula}\n\nAssumptions:\n${packet.draft.spec.assumptions.join('\n')}\n\n${sourceFormulaCitationText(packet)}\n\nBasis artifact: ${value.basis.artifactId}; revision ${value.basis.revision}; digest ${value.basis.digest}.` ;}
export async function previewFormulaComparison(core:Companion,raw:unknown){const value=readFormulaComparisonInput(raw),packet=basis(await core.getTask(value.taskId),value,true);return {...formulaComparisonPreview(packet.draft,value),binding:formulaComparisonIdentity(value)};}
export function inspectFormulaComparisonTask(task:Task,raw:unknown){
 const value=readFormulaComparisonSubmission(raw),binding=formulaComparisonIdentity(value);basis(task,value,false);
 const request=task.requests.find(item=>item.id===requestId(value));if(!request)return {kind:'not-started' as const,binding};
 const input=requestInput(value),refs=value.expectedSourceRefs;// Historical project guidance is not retained in RequestRecord; bind the payload-derived ID, prompt, exact answer and source snapshots instead.
 if(request.prompt!==input.prompt||JSON.stringify(request.sourceRefs)!==JSON.stringify(refs)||request.kind!=='experiment')throw Error('The original comparison request needs inspection.');
 if(request.status==='running')return {kind:'running' as const,binding};
 if(request.status!=='completed'){if(request.artifactId)throw Error('The unsuccessful comparison has unexpected output.');return {kind:'terminal' as const,binding,status:request.status};}
 const artifact=task.artifacts.find(item=>item.id===request.artifactId),revision=artifact?.revisions.find(item=>item.revision===request.answer?.revision&&item.digest===request.answer?.digest);
 if(!artifact||!revision||request.answer?.artifactId!==artifact.id||revision.mimeType!=='text/plain'||revision.encoding==='base64'||JSON.stringify(revision.sourceRefs)!==JSON.stringify(refs)||revision.content!==content(task,value,false))throw Error('The saved original comparison needs inspection.');
 return {kind:'completed' as const,binding,artifactId:artifact.id,revision:revision.revision,digest:revision.digest,content:revision.content};
}
export async function inspectFormulaComparison(core:Companion,raw:unknown){const value=readFormulaComparisonSubmission(raw);return inspectFormulaComparisonTask(await core.getTask(value.taskId),value);}
export function formulaComparisonPublication(task:Task,value:FormulaComparisonSubmission){
 const prior=inspectFormulaComparisonTask(task,value);if(prior.kind==='completed')return {kind:'existing' as const,result:prior};if(prior.kind!=='not-started')throw Error('The original comparison already started. Inspect its outcome; automatic retries are unsupported.');
 const report=content(task,value,true);if(report.length>64000)throw Error('The complete comparison report exceeds 64,000 characters. Nothing was truncated.');return {kind:'new' as const,request:requestInput(value),artifact:{title:'Bounded formula comparison',mimeType:'text/plain',content:report}};
}
export function saveFormulaComparison(core:Companion,raw:unknown,assertCurrent:()=>void=()=>{}){return core.saveFormulaComparison(raw,assertCurrent);}
