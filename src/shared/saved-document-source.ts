import {Schema} from 'effect';
import type {ArtifactRef,SourceInput,SourceRef,Task} from '../core/types';
import {readScreenBrief} from '../core/screen-brief';
import {withoutEmbeddedImageData} from './saved-work-search-text';

const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0')));
const reference=Schema.Struct({artifactId:id,revision:Schema.Int.pipe(Schema.positive()),digest:Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/))});
const input=Schema.Struct({taskId:id,ownerTaskId:id,artifact:reference,role:Schema.Literal('fact','style','inspiration'),expectedSnapshot:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200_000),Schema.filter(value=>!value.includes('\0')))});
export type SavedDocumentSourceInput=typeof input.Type;
export type SavedDocumentSourceResult={task:Task;reference:SourceRef;alreadyAdded:boolean};
export const readSavedDocumentSourceInput=(value:unknown):SavedDocumentSourceInput=>Schema.decodeUnknownSync(input,{onExcessProperty:'error'})(value);

/** Explicit saved bytes only. A copy carries no draft, live source or execution authority. */
export function savedDocumentSourcePreview(owner:Task,ref:ArtifactRef,role:SourceInput['role']='fact'){
 const artifacts=owner.artifacts.filter(item=>item.id===ref.artifactId),revisions=artifacts.length===1?artifacts[0].revisions.filter(item=>item.revision===ref.revision&&item.digest===ref.digest):[];
 if(revisions.length!==1)throw Error('This exact saved document revision is no longer available. Choose it again.');
 const revision=revisions[0];
 if(!['text/plain','text/markdown'].includes(revision.mimeType)||revision.encoding==='base64'||readScreenBrief(revision.content,revision.sourceRefs))throw Error('Choose an ordinary saved plain-text or Markdown document.');
 if(!revision.content.trim()||revision.content.length>100_000||revision.content.includes('\0')||revision.sourceRefs.length>100)throw Error('Choose a non-empty saved document up to 100,000 characters and 100 source links.');
 if(withoutEmbeddedImageData(revision.content)!==revision.content)throw Error('This document contains embedded image data or unsupported markup. Copy ordinary text into a source instead.');
 const dependencies=revision.sourceRefs.map(ref=>{
  const matches=owner.sources.filter(source=>source.id===ref.sourceId),source=matches.length===1?matches[0]:undefined,versions=source?.versions.filter(version=>version.version===ref.version&&version.digest===ref.digest),version=versions?.length===1?versions[0]:undefined,current=source?.versions.at(-1);
  const status=!version?'unavailable':source!.freshness!=='fresh'?'refresh-required':source!.currentVersion!==ref.version?'superseded':'current saved version';
  return {...ref,label:version?.label??'Unavailable source',status,freshness:source?.freshness??null,currentVersion:source?.currentVersion??null,currentDigest:current?.digest??null};
 });
 const snapshot=JSON.stringify({ownerTaskId:owner.id,ownerTitle:owner.title,artifact:{artifactId:ref.artifactId,revision:ref.revision,digest:ref.digest},title:revision.title,mimeType:revision.mimeType,content:revision.content,dependencies,role});
 if(snapshot.length>200_000)throw Error('This document and its source details exceed the copy limit.');
 const content=['# Saved document snapshot',`Original task: ${owner.title}\nOriginal task ID: ${owner.id}\nSaved document: ${revision.title}\nArtifact ID: ${ref.artifactId}\nRevision: ${ref.revision}\nDigest: ${ref.digest}`,'This is an independent historical text copy. Original source bodies, unsent edits, live window access and approvals are not copied. Changes to the original do not update this source.',dependencies.length?'## Original source links\n\n'+dependencies.map(item=>`- ${item.label}: version ${item.version} · ${item.status}`).join('\n'):'The saved document has no linked sources.','## Copied document\n\n'+revision.content].join('\n\n');
 const label=(`${revision.title} · revision ${ref.revision}`).slice(0,200).replace(/[\uD800-\uDBFF]$/u,'');
 return {snapshot,content,label,revision,dependencies,ownerTitle:owner.title};
}
