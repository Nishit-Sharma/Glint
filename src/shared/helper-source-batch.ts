import {Schema} from 'effect';
import {copyTableData} from '../learning/semantic-table-procedure';
import type {Task} from '../core/types';
import {parseModuleAnswer} from '../core/interactive-modules';
import {semanticHelper} from '../learning/semantic-helper';
import {parseSourceTable,runSourceTable,sourceTableLimits,type SourceTableRow} from '../learning/source-table-helper';
import {pickingDigest,pickingCanonical} from './picking-digest';
import {MODULE_MIME} from './module-contract';
const id=Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{1,80}$/)),digest=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),positive=Schema.Int.pipe(Schema.positive());
const sourceRef=Schema.Struct({sourceId:id,version:positive,digest});
export const HelperSourceBatchRequestSchema=Schema.Struct({taskId:id,artifactId:id,artifactRevision:positive,artifactDigest:digest,moduleId:id,moduleVersion:positive,helperId:id,stateRevision:Schema.Int.pipe(Schema.between(0,500)),activeVersion:Schema.Int.pipe(Schema.between(1,20)),sourceRef,bindings:Schema.Array(Schema.Struct({field:id,column:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(80))})).pipe(Schema.minItems(1),Schema.maxItems(6))});
export type HelperSourceBatchRequest=typeof HelperSourceBatchRequestSchema.Type;
const save=Schema.Struct({...HelperSourceBatchRequestSchema.fields,binding:digest,confirmed:Schema.Literal('save-reviewed-regular-document')});
const inspect=Schema.Struct({...HelperSourceBatchRequestSchema.fields,binding:digest});
export type HelperSourceBatchSave=typeof save.Type;
export type HelperSourceBatchInspection=typeof inspect.Type;
const decode=<A,I>(schema:Schema.Schema<A,I>,value:unknown)=>Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(copyTableData(value,64000,2000));
export const readHelperSourceBatchRequest=(value:unknown)=>decode(HelperSourceBatchRequestSchema,value);
export const readHelperSourceBatchSave=(value:unknown)=>decode(save,value);
export const readHelperSourceBatchInspection=(value:unknown)=>decode(inspect,value);
export const helperSourceBatchRequestIdentity=(input:HelperSourceBatchRequest)=>pickingDigest(input);
export const HELPER_SOURCE_REPORT_TITLE='Helper table run report';
export const HELPER_SOURCE_REPORT_SHARING='Saving copies exactly the reviewed report into a regular local document. Its contents can be included in later AI or browser context under the existing request and source-sharing controls. Previewing this table stays local.';
const block=(value:string)=>{const fence='`'.repeat(Math.max(3,...(value.match(/`+/g)??[]).map(item=>item.length+1)));return `${fence}text\n${value}\n${fence}`;};
const record=(value:Readonly<Record<string,string|number|boolean>>)=>Object.entries(value).map(([name,item])=>`${name}\n\n${block(String(item))}`).join('\n\n');
export type HelperSourceBatchPreview={request:HelperSourceBatchRequest;binding:string;sourceLabel:string;helperName:string;rows:readonly SourceTableRow[];summary:{completed:number;stopped:number;invalid:number;total:number};content:string;title:string;effectAuthority:'none'};
/** Read-only on one exact selected source and checked active helper; no request, artifact or model context is created. */
export function helperSourceBatchPreview(task:Task,value:unknown):HelperSourceBatchPreview{
 const request=readHelperSourceBatchRequest(value);if(task.id!==request.taskId||task.status!=='active')throw Error('Open and resume the exact owning task before reviewing a table run.');
 const artifact=task.artifacts.find(item=>item.id===request.artifactId),revision=artifact?.revisions.at(-1);if(!revision||revision.revision!==request.artifactRevision||revision.digest!==request.artifactDigest||revision.mimeType!==MODULE_MIME)throw Error('The helper artifact changed. Open its current version.');
 const answer=parseModuleAnswer(JSON.parse(revision.content)),module=answer.modules.find(item=>item.id===request.moduleId&&item.version===request.moduleVersion);if(!module||module.data.kind!=='helper-studio'||module.data.id!==request.helperId)throw Error('This helper owner is unavailable.');
 const matches=task.session?.moduleStates.filter(item=>item.artifactId===artifact!.id&&item.artifactRevision===revision.revision&&(item.moduleId===module.id||(item.moduleId===undefined&&answer.modules.length===1)))??[];if(matches.length!==1)throw Error('The saved helper state is unavailable.');
 const state=semanticHelper.parseState(module.data.id,matches[0].state);if(state.revision!==request.stateRevision||state.activeVersion!==request.activeVersion||state.localWorkspace)throw Error('The active helper or its state changed. Review a new table run.');
 const version=state.versions.find(item=>item.version===state.activeVersion);if(!version)throw Error('Activate a checked saved local record helper first.');
 const source=task.sources.find(item=>item.id===request.sourceRef.sourceId),selected=source?.versions.at(-1);if(!source||source.freshness!=='fresh'||source.currentVersion!==request.sourceRef.version||selected?.version!==request.sourceRef.version||selected.digest!==request.sourceRef.digest||selected.kind!=='text')throw Error('The selected text source changed or needs refresh. Choose its current version explicitly.');
 const rows=runSourceTable(version.candidate.procedure,parseSourceTable(selected.content),request.bindings),summary={completed:rows.filter(item=>item.outcome.status==='completed').length,stopped:rows.filter(item=>item.outcome.status==='stopped').length,invalid:rows.filter(item=>item.outcome.status==='invalid').length,total:rows.length};
 const body=[`# ${HELPER_SOURCE_REPORT_TITLE}`,`This is a local computation with active helper version ${version.version}. It is not a browser, file-system or OS action.`,`${summary.total} records: ${summary.completed} completed; ${summary.stopped} stopped; ${summary.invalid} invalid. Stopped and invalid records are not completed outputs. Every record is listed below.`,`## Selected source — version ${selected.version}`,block(selected.label),'Only mapped columns are copied. Source values are shown exactly; decimal number cells permit surrounding whitespace; yes/no cells require exactly true or false. Record numbers count CSV records including the header, not physical text lines.','## Helper',block(version.candidate.procedure.input.name),'## Column bindings',...request.bindings.map(item=>`${item.field}\n\n${block(item.column)}`),...rows.flatMap(row=>[`## Record ${row.recordNumber} — ${row.outcome.status==='completed'?'Completed':row.outcome.status==='stopped'?'Stopped':'Invalid input'}`,'### Mapped source values',record(row.sourceValues),...(row.outcome.status==='invalid'?['### Why this record did not run',block(row.outcome.reason)]:['### Computed values',record(row.outcome.output),...(row.outcome.status==='stopped'?['### Stop reason',block(row.outcome.reason)]:[])])])].join('\n\n');
 if(body.length>sourceTableLimits.reportCharacters)throw Error('The complete report exceeds 100,000 characters. Choose a smaller source; no partial report was produced.');
 const binding=pickingDigest({request,procedure:version.candidate.procedure,content:body});return {request,binding,sourceLabel:selected.label,helperName:version.candidate.procedure.input.name,rows,summary,content:body,title:HELPER_SOURCE_REPORT_TITLE,effectAuthority:'none'};
}
export type HelperSourceBatchSaved={kind:'saved';taskId:string;binding:string;artifactId:string;revision:number;digest:string;alreadySaved:boolean};
export type HelperSourceBatchSaveInspection=HelperSourceBatchSaved|{kind:'not-saved';taskId:string;binding:string};
export const sameHelperSourceBatchRequest=(left:HelperSourceBatchRequest,right:HelperSourceBatchRequest)=>pickingCanonical(left)===pickingCanonical(right);

const savedReply=Schema.Struct({kind:Schema.Literal('saved'),taskId:id,binding:digest,artifactId:id,revision:positive,digest,alreadySaved:Schema.Boolean});
const saveInspectionReply=Schema.Union(savedReply,Schema.Struct({kind:Schema.Literal('not-saved'),taskId:id,binding:digest}));
export const readHelperSourceBatchSaved=(value:unknown):HelperSourceBatchSaved=>decode(savedReply,value);
export const readHelperSourceBatchSaveInspection=(value:unknown):HelperSourceBatchSaveInspection=>decode(saveInspectionReply,value);
