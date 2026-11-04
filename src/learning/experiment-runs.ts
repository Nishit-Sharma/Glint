import {Schema} from 'effect';
import type {ArtifactRef,ArtifactRevision,ExperimentResult,ExperimentSpec,RequestRecord,SourceRef,Task} from '../core/types';
import {parseModelDraft} from '../core/model-drafts';
import {evaluateExperiment} from '../core/experiments';
import {SOURCE_FORMULA_MIME,reviewedSourceFormula} from './source-formula';
import {copyTableData} from './semantic-table-procedure';
import {pickingCanonical,pickingDigest} from '../shared/picking-digest';

export const EXPERIMENT_RUN_MIME='application/vnd.window-companion.experiment-run+json';
const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200)),ref=Schema.Struct({artifactId:id,revision:Schema.Int.pipe(Schema.positive()),digest:id}),source=Schema.Struct({sourceId:id,version:Schema.Int.pipe(Schema.positive()),digest:id});
const values=Schema.Record({key:Schema.String,value:Schema.Number.pipe(Schema.filter(Number.isFinite))});
const inputSchema=Schema.Struct({shareWithTask:Schema.Literal(true),taskId:id,basis:ref,sourceRefs:Schema.Array(source).pipe(Schema.maxItems(64)),title:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200)),spec:Schema.Unknown,inputs:values,baseline:Schema.optional(values),parent:Schema.optional(ref)});
export type ExperimentRunInput={shareWithTask:true;taskId:string;basis:ArtifactRef;sourceRefs:readonly SourceRef[];title:string;spec:ExperimentSpec;inputs:Record<string,number>;baseline?:Record<string,number>;parent?:ArtifactRef};
export type ExperimentRunPacket={format:'experiment-run-v1';input:ExperimentRunInput;result:ExperimentResult;baselineResult?:ExperimentResult;requestId:string};
export type SavedExperimentRun={reference:ArtifactRef;createdAt:string;packet:ExperimentRunPacket};
const decode=<A,I>(schema:Schema.Schema<A,I>,raw:unknown)=>Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(copyTableData(raw,128000,8000));
export function readExperimentRunInput(raw:unknown):ExperimentRunInput{
 const input=decode(inputSchema,raw),draft=parseModelDraft(JSON.stringify({schemaVersion:1,kind:'experiment',title:input.title,explanation:'An explicitly saved bounded calculation.',spec:input.spec,inputs:input.inputs}),'experiment');
 if(draft.kind!=='experiment')throw Error('Choose a supported arithmetic experiment.');
 if(new Set(input.sourceRefs.map(item=>item.sourceId)).size!==input.sourceRefs.length)throw Error('Choose each source exactly once.');
 if(input.baseline)evaluateExperiment(draft.spec,input.baseline);
 return {...input,spec:draft.spec,inputs:draft.inputs};
}
export function readExperimentRunCommand(raw:unknown){const command=decode(Schema.Struct({input:Schema.Unknown,retryOf:Schema.optional(id)}),raw);return {...command,input:readExperimentRunInput(command.input)};}
export function experimentRunId(input:ExperimentRunInput,index=0){if(!Number.isInteger(index)||index<0||index>=8)throw Error('The saved run retry limit was reached.');return 'experiment-run-v1-'+pickingDigest(input)+(index?'_'+index:'');}
export function makeExperimentRun(input:ExperimentRunInput,index=0):ExperimentRunPacket{return {format:'experiment-run-v1',input,result:evaluateExperiment(input.spec,input.inputs),...(input.baseline?{baselineResult:evaluateExperiment(input.spec,input.baseline)}:{}),requestId:experimentRunId(input,index)};}
export function readExperimentRun(content:string):ExperimentRunPacket{
 if(typeof content!=='string'||content.length>128000)throw Error('The saved run exceeds its supported size.');
 const resultSchema=Schema.Struct({value:Schema.Number.pipe(Schema.filter(Number.isFinite),Schema.between(-1e15,1e15)),unit:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(500)),assumptions:Schema.Array(Schema.String.pipe(Schema.maxLength(500))).pipe(Schema.maxItems(12))});
 const packet=Schema.decodeUnknownSync(Schema.Struct({format:Schema.Literal('experiment-run-v1'),input:Schema.Unknown,result:resultSchema,baselineResult:Schema.optional(resultSchema),requestId:id}),{onExcessProperty:'error'})(JSON.parse(content)),input=readExperimentRunInput(packet.input);
 const index=Array.from({length:8},(_,index)=>index).find(index=>experimentRunId(input,index)===packet.requestId);
 if(index===undefined)throw Error('The saved run identity changed.');
 const expected=makeExperimentRun(input,index);
 if(pickingCanonical(packet.input)!==pickingCanonical(input)||JSON.stringify(packet.result)!==JSON.stringify(expected.result)||JSON.stringify(packet.baselineResult)!==JSON.stringify(expected.baselineResult))throw Error('The saved calculation or its bindings changed.');
 return expected;
}
export function reviewedExperimentRun(task:Task,artifactId:string,revision:ArtifactRevision):ExperimentRunPacket{
 if(revision.mimeType!==EXPERIMENT_RUN_MIME||revision.encoding==='base64')throw Error('Choose a saved experiment run.');
 const packet=readExperimentRun(revision.content),request=task.requests.find(item=>item.id===packet.requestId);
 if(packet.input.taskId!==task.id||request?.status!=='completed'||request.kind!=='experiment'||request.artifactId!==artifactId||request.answer?.artifactId!==artifactId||request.answer.revision!==revision.revision||request.answer.digest!==revision.digest||pickingDigest([...request.sourceRefs].sort((a,b)=>a.sourceId.localeCompare(b.sourceId)))!==pickingDigest([...packet.input.sourceRefs].sort((a,b)=>a.sourceId.localeCompare(b.sourceId)))||pickingCanonical(revision.sourceRefs)!==pickingCanonical(request.sourceRefs))throw Error('The original saved run publication needs inspection.');
 return packet;
}
export function savedExperimentRuns(task:Task,artifactId:string):SavedExperimentRun[]{
 return task.artifacts.flatMap(artifact=>{const revision=artifact.revisions.at(-1);if(revision?.mimeType!==EXPERIMENT_RUN_MIME)return [];try{const packet=reviewedExperimentRun(task,artifact.id,revision);return packet.input.basis.artifactId===artifactId?[{reference:{artifactId:artifact.id,revision:revision.revision,digest:revision.digest},createdAt:revision.createdAt,packet}]:[];}catch{return [];}});
}
export function experimentRunCurrent(task:Task,input:ExperimentRunInput){
 const revision=task.artifacts.find(item=>item.id===input.basis.artifactId)?.revisions.at(-1);
 return task.id===input.taskId&&task.status==='active'&&!task.archive&&!!revision&&revision.revision===input.basis.revision&&revision.digest===input.basis.digest&&pickingCanonical(revision.sourceRefs)===pickingCanonical(input.sourceRefs)&&input.sourceRefs.every(ref=>{const source=task.sources.find(item=>item.id===ref.sourceId);return source?.freshness==='fresh'&&source.currentVersion===ref.version&&source.versions.at(-1)?.digest===ref.digest;});
}
export function admitExperimentRun(task:Task,input:ExperimentRunInput){
 if(!experimentRunCurrent(task,input))throw Error('The experiment or a linked source changed. Review the current source and save a current experiment before recomputing.');
 const revision=task.artifacts.find(item=>item.id===input.basis.artifactId)!.revisions.at(-1)!,draft=revision.mimeType===SOURCE_FORMULA_MIME?reviewedSourceFormula(task,input.basis.artifactId,revision).draft:revision.mimeType==='application/json'?parseModelDraft(revision.content,'experiment'):undefined;
 if(!draft||draft.kind!=='experiment'||pickingCanonical(draft.spec.expression)!==pickingCanonical(input.spec.expression)||pickingCanonical(draft.spec.variables)!==pickingCanonical(input.spec.variables))throw Error('Use the saved experiment formula and input definitions.');
 if(input.parent){const parent=task.artifacts.find(item=>item.id===input.parent!.artifactId)?.revisions.at(-1);if(!parent||parent.revision!==input.parent.revision||parent.digest!==input.parent.digest)throw Error('The parent run changed. Choose it again.');const packet=reviewedExperimentRun(task,input.parent.artifactId,parent);if(pickingCanonical(packet.input.basis)!==pickingCanonical(input.basis)||pickingCanonical(packet.input.sourceRefs)!==pickingCanonical(input.sourceRefs))throw Error('The parent run belongs to a different experiment revision.');}
 return makeExperimentRun(input);
}
/** A saved run is a local record, not a user message. The conversation shows one readable
 * activity line; the exact packet, its request and provenance stay in the task store. */
export type ExperimentRunActivity={artifactId:string;revision:ArtifactRevision;label:string;detail:string;reviewed:boolean};
export function experimentRunQuantity(result:ExperimentResult){return result.value.toLocaleString(undefined,{maximumSignificantDigits:12})+(result.unit==='1'?'':' '+result.unit);}
export function experimentRunActivity(task:Task,artifactId:string,revision:ArtifactRevision):ExperimentRunActivity|undefined{
 if(revision.mimeType!==EXPERIMENT_RUN_MIME)return;
 try{const packet=reviewedExperimentRun(task,artifactId,revision);return {artifactId,revision,label:'Saved calculation run · '+experimentRunQuantity(packet.result),detail:packet.input.title+(packet.baselineResult?' · compared with '+experimentRunQuantity(packet.baselineResult):''),reviewed:true};}
 catch{return {artifactId,revision,label:'Saved calculation run',detail:'This record needs inspection. Its original content is kept.',reviewed:false};}
}
export function savedExperimentRunActivity(task:Task,request:RequestRecord):ExperimentRunActivity|undefined{
 if(request.kind!=='experiment')return;
 const artifactId=request.answer?.artifactId??request.artifactId,revisions=task.artifacts.find(item=>item.id===artifactId)?.revisions,revision=(request.answer&&revisions?.find(item=>item.revision===request.answer!.revision&&item.digest===request.answer!.digest))||revisions?.find(item=>item.revision===1);
 return artifactId&&revision?experimentRunActivity(task,artifactId,revision):undefined;
}
