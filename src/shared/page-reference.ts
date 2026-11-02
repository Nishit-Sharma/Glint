import {Schema} from 'effect';
import type {Artifact,ArtifactRef,Task} from '../core/types';

const Id=Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{1,200}$/));
const Reference=Schema.Struct({taskId:Id,artifactId:Id});
export type PageReference=typeof Reference.Type;
export type PageReferenceSource={taskId:string;artifact:ArtifactRef};
export type PageReferencePreview={reference:PageReference;artifact:ArtifactRef;title:string;content:string;taskTitle:string};
export const readPageReference=Schema.decodeUnknownSync(Reference,{onExcessProperty:'error'});
export const eligibleReferencePage=(artifact:Artifact)=>{const revision=artifact.revisions.at(-1);return !!revision&&['text/plain','text/markdown'].includes(revision.mimeType)&&revision.encoding!=='base64';};
export function resolvePageReference(task:Task,input:PageReference):PageReferencePreview{
 const reference=readPageReference(input),matches=task.artifacts.filter(item=>item.id===reference.artifactId),artifact=matches.length===1?matches[0]:undefined;
 if(task.id!==reference.taskId||task.archive||task.provenance==='local-example'||!artifact||!eligibleReferencePage(artifact))throw Error('This saved page is unavailable. Its original reference is kept.');
 const revision=artifact.revisions.at(-1)!;return {reference,artifact:{artifactId:artifact.id,revision:revision.revision,digest:revision.digest},title:revision.title,content:revision.content,taskTitle:task.title};
}
export function pageReferenceHref(input:PageReference):string{const reference=readPageReference(input);return '#glint-page/'+reference.taskId+'/'+reference.artifactId;}
export function parsePageReferenceHref(href:string|undefined):PageReference|undefined{
 const match=href&&/^#glint-page\/([A-Za-z0-9_-]{1,200})\/([A-Za-z0-9_-]{1,200})$/.exec(href);return match?{taskId:match[1],artifactId:match[2]}:undefined;
}
export function prependPageReference(content:string,preview:PageReferencePreview):string{
 const title=preview.title.replace(/[\r\n]+/g,' ').replace(/[\\`*_{}\[\]()<>#+.!|~-]/g,'\\$&');
 return '['+(title||'Saved page')+']('+pageReferenceHref(preview.reference)+')\n\n'+content;
}
