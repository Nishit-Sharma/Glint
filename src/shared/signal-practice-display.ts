import type {Artifact,ArtifactRevision,Task} from '../core/types';
import {parseSignalAssignment} from '../learning/signal-concept';
import {signalPracticeDocument} from '../learning/signal-sequential-practice';
import {prepareWorkflowPassages} from '../learning/workflow-review';

/** A display-only projection. Unrecognized or changed text is always left intact. */
export function signalPracticeDisplay(task:Task,artifact:Artifact,revision:ArtifactRevision,content:string):string|null{
 try{
  if(revision.mimeType!=='text/markdown'||revision.encoding==='base64'||content!==revision.content)return null;
  if(!task.artifacts.some(item=>item.id===artifact.id&&item.revisions.some(saved=>saved.revision===revision.revision&&saved.digest===revision.digest&&saved.content===content)))return null;
  const request=task.requests.find(item=>/^signal-practice-v1-[a-f0-9]{64}(?:_[1-9][0-9]*)?$/.test(item.id)&&item.kind==='experiment'&&item.prompt==='Record the first answer to a separate hypothetical signal practice.'&&item.status==='completed'&&item.artifactId===artifact.id&&item.answer?.artifactId===artifact.id&&item.answer.revision===revision.revision&&item.answer.digest===revision.digest&&JSON.stringify(item.sourceRefs)===JSON.stringify(revision.sourceRefs));
  if(!request||revision.sourceRefs.length<1||revision.sourceRefs.length>2)return null;
  const sources=revision.sourceRefs.map(ref=>{const source=task.sources.find(item=>item.id===ref.sourceId),version=source?.versions.find(item=>item.id===ref.sourceId&&item.version===ref.version&&item.digest===ref.digest);if(!version||version.kind!=='text'||version.role!=='fact')throw Error('Missing source');return {sourceId:ref.sourceId,text:version.content};});
  const marker='\n<!--signal-sequential-practice-v1:',index=content.lastIndexOf(marker);if(index<0||!content.endsWith('-->'))return null;const encoded=content.slice(index+marker.length,-3);if(!/^[A-Za-z0-9_-]+$/.test(encoded))return null;
  const binary=atob(encoded.replaceAll('-','+').replaceAll('_','/'));if(btoa(binary).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')!==encoded)return null;
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(binary,c=>c.charCodeAt(0)))) as unknown;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='answer,reasoning')return null;const {answer,reasoning}=value as {answer:unknown;reasoning:unknown};if((answer!==0&&answer!==1)||typeof reasoning!=='string'||reasoning.length>500)return null;
  const match=/^# Sequential signal assignment practice\n\n## Reviewed source line\n\n`([^`\r\n]+)`\n\n/.exec(content),quote=match?.[1];if(!quote||!parseSignalAssignment(quote))return null;const passages=prepareWorkflowPassages(sources);if(passages.issues.length||!passages.passages.some(p=>p.quote===quote))return null;
  const body=signalPracticeDocument(quote,answer,reasoning);return content===body+marker+encoded+'-->'?body:null;
 }catch{return null;}
}
