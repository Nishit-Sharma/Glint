import {Schema} from 'effect';
import type {ArtifactRevision,SourceRef,Task} from '../core/types';
import {readScreenBrief} from '../core/screen-brief';
import {withoutEmbeddedImageData} from './saved-work-search-text';

const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0')));
const artifact=Schema.Struct({artifactId:id,revision:Schema.Int.pipe(Schema.positive()),digest:Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/))});
const selection=Schema.Struct({taskId:id,artifacts:Schema.Array(artifact).pipe(Schema.maxItems(12)),noteIds:Schema.Array(id).pipe(Schema.maxItems(20)),includeGoal:Schema.Boolean});
const save=Schema.Struct({...selection.fields,intentId:Schema.String.pipe(Schema.pattern(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)),binding:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(100_000),Schema.filter(value=>!value.includes('\0'))),confirmed:Schema.Literal('reviewed-task-handoff')});
export type TaskHandoffSelection=typeof selection.Type;
export type TaskHandoffSave=typeof save.Type;
export type TaskHandoffSaved={task:Task;artifactId:string;revision:number;digest:string;alreadySaved:boolean};
export const readTaskHandoffSave=(value:unknown):TaskHandoffSave=>Schema.decodeUnknownSync(save,{onExcessProperty:'error'})(value);
export function taskHandoffSelection(value:TaskHandoffSelection):TaskHandoffSelection{
 const order=(a:string,b:string)=>a<b?-1:a>b?1:0,parsed=Schema.decodeUnknownSync(selection,{onExcessProperty:'error'})(value),artifacts=[...parsed.artifacts].sort((a,b)=>order(a.artifactId,b.artifactId)||a.revision-b.revision||order(a.digest,b.digest)),noteIds=[...parsed.noteIds].sort();
 if(new Set(artifacts.map(ref=>ref.artifactId)).size!==artifacts.length||new Set(noteIds).size!==noteIds.length)throw Error('Choose each saved document and note once.');
 return {taskId:parsed.taskId,artifacts:artifacts.map(ref=>({artifactId:ref.artifactId,revision:ref.revision,digest:ref.digest})),noteIds,includeGoal:parsed.includeGoal};
}
export function taskHandoffIdentity(input:TaskHandoffSave){const {binding}=input;return JSON.stringify({...taskHandoffSelection({taskId:input.taskId,artifacts:input.artifacts,noteIds:input.noteIds,includeGoal:input.includeGoal}),binding});}
function block(value:string){const size=Math.max(2,...Array.from(value.matchAll(/`+/g),match=>match[0].length))+1,fence='`'.repeat(size);return `${fence}text\n${value}\n${fence}`;}
function ordinary(content:string){if(content.includes('\0')||/data\s*:\s*image\s*\//i.test(content)||withoutEmbeddedImageData(content)!==content)throw Error('Choose saved text without embedded image data or unsupported markup.');}
export function taskHandoffDocumentText(revision:ArtifactRevision){if(!['text/plain','text/markdown'].includes(revision.mimeType)||revision.encoding==='base64'||readScreenBrief(revision.content,revision.sourceRefs))throw Error('Choose ordinary saved plain-text or Markdown documents.');ordinary(revision.content);return revision.content;}
export function taskHandoffPreview(task:Task,value:TaskHandoffSelection){
 const selected=taskHandoffSelection(value);if(task.id!==selected.taskId)throw Error('Open the original task before preparing its handoff.');if(!selected.artifacts.length&&!selected.noteIds.length)throw Error('Choose at least one saved document or Activity note.');
 const linked:SourceRef[]=[],parts=['# Task handoff','This is a historical copy of explicitly selected saved work. It does not grant approvals, browser access or instructions to execute. Unsent drafts, unselected saved work, source bodies, browser state and action receipts are excluded.','## Original task\n\n'+block(`${task.title}\nTask ID: ${task.id}`)];
 if(selected.includeGoal){ordinary(task.goal);parts.push('## Selected saved task goal\n\n'+block(task.goal));}
 const documents=selected.artifacts.map(ref=>{
  const artifacts=task.artifacts.filter(item=>item.id===ref.artifactId),revisions=artifacts.length===1?artifacts[0].revisions.filter(revision=>revision.revision===ref.revision&&revision.digest===ref.digest):[];
  if(revisions.length!==1)throw Error('An exact selected saved revision is unavailable. Review the selection again.');const revision=revisions[0],latest=artifacts[0].revisions.at(-1)!;
  taskHandoffDocumentText(revision);linked.push(...revision.sourceRefs);
  parts.push('## Selected saved document\n\n'+block(`${revision.title}\nArtifact ID: ${ref.artifactId}\nSelected revision: ${ref.revision}\nDigest: ${ref.digest}\nLatest saved revision: ${latest.revision}\nLatest digest: ${latest.digest}`)+'\n\n### Exact saved text\n\n'+block(revision.content));return {artifactId:ref.artifactId,revision:ref.revision,title:revision.title};
 });
 const notes=selected.noteIds.map(id=>{const matches=task.checkpoints.filter(note=>note.id===id);if(matches.length!==1)throw Error('A selected Activity note is unavailable. Review the selection again.');const note=matches[0];ordinary(note.note);linked.push(...note.sourceRefs);parts.push('## Selected Activity note\n\n'+block(`Note ID: ${note.id}\nSaved at: ${note.createdAt}`)+'\n\n'+block(note.note));return {id:note.id,note:note.note};});
 const dependencies=[...new Map(linked.map(ref=>[JSON.stringify([ref.sourceId,ref.version,ref.digest]),ref])).values()].map(ref=>{
  const sources=task.sources.filter(source=>source.id===ref.sourceId),source=sources.length===1?sources[0]:undefined,versions=source?.versions.filter(version=>version.version===ref.version&&version.digest===ref.digest),version=versions?.length===1?versions[0]:undefined,current=source?.versions.at(-1);
  return {...ref,label:version?.label??'Unavailable source',status:!version?'unavailable':source!.freshness!=='fresh'?'refresh-required':source!.currentVersion!==ref.version?'superseded':'current saved version',freshness:source?.freshness??null,currentVersion:source?.currentVersion??null,currentDigest:current?.digest??null,reason:source?.staleReason??null};
 });
 if(dependencies.length)parts.push('## Original linked-source status\n\nSaved references and their current recorded status only; current live contents are unknown. No source bodies are copied.\n\n'+block(JSON.stringify(dependencies,null,2)));
 const content=parts.join('\n\n')+'\n';if(content.length>100_000||content.includes('\0'))throw Error('The complete handoff exceeds 100,000 characters. Choose less saved work; nothing was truncated.');
 return {title:('Handoff: '+task.title).slice(0,200).replace(/[\uD800-\uDBFF]$/u,''),content,binding:content,selection:selected,documents,notes,dependencies};
}
