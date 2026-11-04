import {Schema} from 'effect';
import {pickingDigest} from './picking-digest';
import {copyTableData} from '../learning/semantic-table-procedure';
import type {ArtifactInput,SourceRef,Task} from '../core/types';

export class SourceComparisonError extends Error {}
export interface SourceComparisonNotes {question:string;comparison:string;uncertainty:string}
export function sourceComparisonArtifact(task:Task,refs:readonly (SourceRef|undefined)[],notes:SourceComparisonNotes):ArtifactInput {
 if(task.status!=='active'||task.archive)throw new SourceComparisonError('Resume this task before saving a comparison.');
 if(refs.length!==2||!refs[0]||!refs[1]||refs[0].sourceId===refs[1].sourceId)throw new SourceComparisonError('Choose two different text sources.');
 const selected=[refs[0],refs[1]],versions=selected.map(ref=>{
  const source=task.sources.find(source=>source.id===ref.sourceId),version=source?.versions.find(version=>version.id===ref.sourceId&&version.version===ref.version&&version.digest===ref.digest);
  if(!source||'revoked' in source&&source.revoked||!version||version.kind!=='text'||source.freshness!=='fresh'||source.currentVersion!==ref.version)throw new SourceComparisonError('A selected source changed or needs refresh. Review and explicitly choose its current snapshot; your notes are kept.');
  return version;
 });
 for(const [key,value] of Object.entries(notes))if(typeof value!=='string'||!value.trim()||value.length>(key==='question'?200:6000)||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value))throw new SourceComparisonError('Enter a question, comparison and uncertainty within the shown limits.');
 return {title:notes.question.trim(),mimeType:'text/markdown',sourceRefs:selected.map(ref=>({...ref})),content:[
  'Human source comparison. These are my notes, not an automatic fact check. Agreement does not establish truth; unresolved differences remain uncertain.',
  ...versions.map((version,index)=>`Source ${index+1}: ${version.label} · Version ${version.version}`),
  '## Comparison',notes.comparison,'## Uncertainty and next check',notes.uncertainty,
 ].join('\n\n')};
}

const identity=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0')));
const digest=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/));
export const SourceComparisonIntentSchema=Schema.Struct({id:Schema.String.pipe(Schema.pattern(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)),binding:digest});
const sourceRef=Schema.Struct({sourceId:identity,version:Schema.Int.pipe(Schema.between(1,Number.MAX_SAFE_INTEGER)),digest});
const note=(max:number)=>Schema.String.pipe(Schema.maxLength(max),Schema.filter(value=>!!value.trim()&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)));
const inputSchema=Schema.Struct({taskId:identity,intentId:SourceComparisonIntentSchema.fields.id,binding:digest,refs:Schema.Tuple(sourceRef,sourceRef),notes:Schema.Struct({question:note(200),comparison:note(6000),uncertainty:note(6000)})});
export type SourceComparisonInput=typeof inputSchema.Type;
export type SourceComparisonCommand={type:'comparison.save'|'comparison.inspect'}&SourceComparisonInput;
export type SourceComparisonSaved={kind:'saved';taskId:string;intentId:string;binding:string;artifact:import('../core/types').Artifact;revision:import('../core/types').ArtifactRevision};
export type SourceComparisonInspection=SourceComparisonSaved|{kind:'not-saved';taskId:string;intentId:string;binding:string};
/** Save identity is separate from its exact submitted owner, ordered sources and raw notes. */
export function sourceComparisonBinding(taskId:string,refs:readonly (SourceRef|null|undefined)[],notes:SourceComparisonNotes){return pickingDigest({operation:'source-comparison:v1',taskId,refs:refs.map(ref=>ref?{sourceId:ref.sourceId,version:ref.version,digest:ref.digest}:null),notes:{question:notes.question,comparison:notes.comparison,uncertainty:notes.uncertainty}});}
export function readSourceComparisonInput(raw:unknown):SourceComparisonInput{
 const input=Schema.decodeUnknownSync(inputSchema,{onExcessProperty:'error'})(copyTableData(raw,40000,2000));
 if(input.refs[0].sourceId===input.refs[1].sourceId||input.binding!==sourceComparisonBinding(input.taskId,input.refs,input.notes))throw new SourceComparisonError('The comparison save identity does not match its exact notes and sources.');
 return input;
}
