import {documentSuggestions,DOCUMENT_SUGGESTIONS_MIME} from '../shared/document-edit-suggestions';
import {UNCERTAIN_ARTIFACT_CONTEXT} from '../shared/artifact-context-origin';
import {sourceDependencyRefs} from '../shared/source-dependencies';
import {readInstructionSkillBody,INSTRUCTION_SKILL_MIME,type InstructionSkillReference} from '../shared/instruction-skill';
import type {RequestRecord,ArtifactRevision,SourceRef,Task} from './types';
import {requestSourceAvailable} from '../shared/source-intake';
export {requestSourceAvailable} from '../shared/source-intake';
import {emptyTaskSession} from './task-session';

const same=(a:SourceRef,b:SourceRef)=>a.sourceId===b.sourceId&&a.version===b.version&&a.digest===b.digest;
/** Older records did not capture inherited skill provenance; retain every earlier invocation conservatively. */
export function requestSkillRefs(task:Task,request:RequestRecord):InstructionSkillReference[]{
 return request.contextSkillRefs??task.requests.slice(0,task.requests.indexOf(request)+1).flatMap(saved=>saved.instructionSkill?[saved.instructionSkill]:[]);
}
export function artifactSkillRefs(task:Task,artifactId:string,revision:ArtifactRevision):InstructionSkillReference[]{
 const chain=task.artifacts.find(artifact=>artifact.id===artifactId)?.revisions.filter(saved=>saved.revision<=revision.revision)??[];
 if(chain[0]?.contextOrigin)return chain.flatMap(saved=>saved.contextSkillRefs??[]).filter((ref,index,all)=>all.findIndex(other=>JSON.stringify(other)===JSON.stringify(ref))===index);
 return revision.contextSkillRefs??task.requests.filter(request=>request.artifactId===artifactId&&(request.answer?.revision??1)<=revision.revision).flatMap(request=>requestSkillRefs(task,request));
}
/** Unjournaled editable text cannot establish a complete origin from empty metadata.
 * The immutable first revision keeps this decision independent of title, MIME edits,
 * task history deletion or a later model request linked to the same artifact. */
export function artifactContextUncertain(task:Task,artifactId:string,revision:ArtifactRevision):boolean{
 return uncertainArtifactContext(task,artifactId,revision,new Set());
}
function uncertainArtifactContext(task:Task,artifactId:string,revision:ArtifactRevision,seen:Set<string>):boolean{
 const key=artifactId+':'+revision.revision;if(seen.has(key)||seen.size>=16)return true;seen.add(key);
 const artifacts=task.artifacts.filter(artifact=>artifact.id===artifactId),chain=artifacts[0]?.revisions.filter(saved=>saved.revision<=revision.revision)??[],first=chain[0];
 if(artifacts.length!==1||!first)return true;
 if(chain.some(saved=>saved.contextUncertain))return true;
 if(first.mimeType===DOCUMENT_SUGGESTIONS_MIME){
  const original=documentSuggestions(first),bodies=chain.map(documentSuggestions);
  if(!original||original.phase!=='pending'||original.taskId!==task.id||bodies.some(body=>!body||body.taskId!==task.id||body.requestId!==original.requestId||body.target.artifactId!==original.target.artifactId||body.target.revision!==original.target.revision||body.target.digest!==original.target.digest))return true;
  const owners=task.artifacts.filter(artifact=>artifact.id===original.target.artifactId),targets=owners[0]?.revisions.filter(saved=>saved.revision===original.target.revision&&saved.digest===original.target.digest)??[];
  return owners.length!==1||targets.length!==1||uncertainArtifactContext(task,original.target.artifactId,targets[0],seen);
 }
 if(!chain.some(saved=>saved.encoding!=='base64'&&(saved.mimeType.startsWith('text/')||['application/json','application/vnd.window-companion.modules+json'].includes(saved.mimeType))))return false;
 if(first.contextOrigin){
  const origin=first.contextOrigin;if(first.mimeType!=='text/markdown'||origin.contentDigest!==first.digest)return true;
  if(origin.kind==='authored-document-v1')return first.revision!==1||origin.taskId!==task.id||origin.artifactId!==artifactId||first.encoding==='base64'||first.contextSourceRefs===undefined||first.contextSkillRefs===undefined||first.contextSkillRefs.length!==0||first.contextSourceRefs.length!==first.sourceRefs.length||first.sourceRefs.some(ref=>!first.contextSourceRefs!.some(saved=>same(ref,saved)));
  if(origin.kind==='source-comparison-v1')return false; // Issued only in the closed atomic comparison publisher.
  const owners=task.artifacts.filter(artifact=>artifact.id===origin.basis.artifactId),bases=owners[0]?.revisions.filter(saved=>saved.revision===origin.basis.revision&&saved.digest===origin.basis.digest)??[];
  if(owners.length!==1||bases.length!==1||bases[0].mimeType!=='application/vnd.window-companion.modules+json'||bases[0].contextSourceRefs===undefined||uncertainArtifactContext(task,origin.basis.artifactId,bases[0],seen))return true;
  const sources=sourceDependencyRefs(bases[0]),skills=artifactSkillRefs(task,origin.basis.artifactId,bases[0]);
  return !first.contextSourceRefs||sources.some(ref=>!first.contextSourceRefs!.some(saved=>same(ref,saved)))||!first.contextSkillRefs||skills.some(ref=>!first.contextSkillRefs!.some(saved=>saved.ownerTaskId===ref.ownerTaskId&&saved.artifactId===ref.artifactId&&saved.revision===ref.revision&&saved.digest===ref.digest));
 }
 return task.requests.filter(request=>request.status==='completed'&&request.answer?.artifactId===artifactId&&request.answer.revision===first.revision&&request.answer.digest===first.digest).length!==1;
}
export function assertArtifactContextCertain(task:Task,artifactId:string,revision:ArtifactRevision){if(artifactContextUncertain(task,artifactId,revision))throw Error(UNCERTAIN_ARTIFACT_CONTEXT);}
/** Canonical local-note edits retain every recorded original restriction. */
export function artifactContextSources(task:Task,artifactId:string,revision:ArtifactRevision):SourceRef[]{
 const chain=task.artifacts.find(artifact=>artifact.id===artifactId)?.revisions.filter(saved=>saved.revision<=revision.revision)??[];
 return chain[0]?.contextOrigin?sourceDependencyRefs({sourceRefs:chain.flatMap(saved=>sourceDependencyRefs(saved))}):sourceDependencyRefs(revision);
}
/** One outgoing view. The durable task and all historical revisions remain untouched. */
export function projectRequestTask(task:Task,selected:readonly SourceRef[],owners:readonly Task[]=[task],chosenSkill:InstructionSkillReference|null|undefined=task.session?.instructionSkill?.selection):Task{
 const sources=task.sources.flatMap(source=>{const version=source.versions.at(-1);return requestSourceAvailable(source,owners)&&version&&selected.some(ref=>same(ref,{sourceId:source.id,version:version.version,digest:version.digest}))?[{...source,versions:[version]}]:[];});
 const refs=sources.map(source=>({sourceId:source.id,version:source.currentVersion,digest:source.versions[0].digest}));
 // Legacy ungrounded history may have inherited older source text without recording its provenance.
 const restricted=task.sources.some(source=>source.versions.length>1||!refs.some(ref=>ref.sourceId===source.id));
 const allowed=(used:readonly SourceRef[],inherited?:readonly SourceRef[])=>used.every(ref=>refs.some(current=>same(ref,current)))&&(inherited!==undefined?inherited.every(ref=>refs.some(current=>same(ref,current))):!restricted);
 const skillAllowed=(reference:InstructionSkillReference|undefined)=>{if(!reference)return true;if(JSON.stringify(reference)!==JSON.stringify(chosenSkill))return false;try{const owner=owners.find(task=>task.id===reference.ownerTaskId),saved=owner?.artifacts.find(artifact=>artifact.id===reference.artifactId)?.revisions.find(revision=>revision.revision===reference.revision&&revision.digest===reference.digest);if(!owner||saved?.mimeType!==INSTRUCTION_SKILL_MIME)return false;return readInstructionSkillBody(JSON.parse(saved.content)).resources.every(ref=>{const source=owner.sources.find(source=>source.id===ref.sourceId),current=source?.versions.at(-1);return !!source&&requestSourceAvailable(source,owners)&&current?.version===ref.version&&current.digest===ref.digest;});}catch{return false;}};
 const artifacts=task.artifacts.flatMap(artifact=>{const revisions=artifact.revisions.filter(revision=>!artifactContextUncertain(task,artifact.id,revision)&&allowed(revision.sourceRefs,artifact.revisions[0]?.contextOrigin?artifactContextSources(task,artifact.id,revision):revision.contextSourceRefs)&&artifactSkillRefs(task,artifact.id,revision).every(skillAllowed));return revisions.length&&revisions.at(-1)===artifact.revisions.at(-1)?[{...artifact,revisions}]:[];});
 const artifactAllowed=(artifactId:string,revision:number)=>artifacts.some(artifact=>artifact.id===artifactId&&artifact.revisions.some(saved=>saved.revision===revision));
 const requests=task.requests.filter(request=>requestSkillRefs(task,request).every(skillAllowed)&&allowed(request.sourceRefs,request.contextSourceRefs)&&(!request.answer||artifactAllowed(request.answer.artifactId,request.answer.revision)));
 const skillRestricted=task.requests.some(request=>!requestSkillRefs(task,request).every(skillAllowed))||task.artifacts.some(artifact=>artifactContextUncertain(task,artifact.id,artifact.revisions.at(-1)!));
 const session=task.session;
 const {publicGithub:_github,...owner}=task;
 return {...owner,sources,artifacts,requests,procedures:task.procedures.flatMap(procedure=>{const revisions=procedure.revisions.filter(revision=>allowed(revision.sourceRefs)&&(!revision.observation||artifactAllowed(revision.observation.artifactId,revision.observation.revision)));return revisions.length&&revisions.at(-1)===procedure.revisions.at(-1)?[{...procedure,revisions}]:[];}),checkpoints:task.checkpoints.filter(checkpoint=>allowed(checkpoint.sourceRefs)&&checkpoint.artifacts.every(ref=>artifactAllowed(ref.artifactId,ref.revision))),actions:task.actions.filter(action=>allowed(action.proposal.sourceRefs)&&artifactAllowed(action.proposal.artifactId,action.proposal.revision)),...(session?{session:{...emptyTaskSession(),revision:session.revision,...(session.contextRevision!==undefined?{contextRevision:session.contextRevision}:{}),moduleStates:session.moduleStates.filter(saved=>artifactAllowed(saved.artifactId,saved.artifactRevision)),runs:restricted||skillRestricted?[]:session.runs,...(session.browserContext?{browserContext:session.browserContext}:{})}}:{})};
}
