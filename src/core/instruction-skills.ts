import {createHash} from 'node:crypto';
import type {Task,ArtifactRevision} from './types';
import {INSTRUCTION_SKILL_MIME,INSTRUCTION_SKILL_ACTIVITY_LIMIT,readInstructionSkillBody,type InstructionSkillReference,type InstructionSkillEntry,type InstructionSkillUnavailable,type InstructionSkillRequestActivity} from '../shared/instruction-skill';

export function instructionSkillEntry(tasks:readonly Task[],reference:InstructionSkillReference):InstructionSkillEntry{
 const owner=tasks.find(task=>task.id===reference.ownerTaskId),artifact=owner?.artifacts.find(item=>item.id===reference.artifactId),saved=artifact?.revisions.find(item=>item.revision===reference.revision&&item.digest===reference.digest);
 if(!owner||!saved||saved.mimeType!==INSTRUCTION_SKILL_MIME||saved.encoding==='base64'||createHash('sha256').update(saved.content).digest('hex')!==saved.digest)throw Error('This exact saved skill is unavailable. Choose a saved skill again.');
 const body=readInstructionSkillBody(JSON.parse(saved.content));
 const resources=body.resources.map(ref=>{const source=owner.sources.find(source=>source.id===ref.sourceId),version=source?.versions.find(version=>version.version===ref.version&&version.digest===ref.digest);if(!version||version.kind!=='text')throw Error('A pinned skill resource is unavailable. Reattach a chosen saved text resource.');return {reference:{...ref},label:version.label,content:version.content};});
 if(body.instructions.length+resources.reduce((length,item)=>length+item.content.length,0)>32000)throw Error('Skill instructions and resources exceed the 32,000-character request limit. Choose smaller resources.');
 return {reference:{...reference},name:body.name,description:body.description,instructions:body.instructions,resources,current:artifact!.revisions.at(-1)===saved};
}
export function instructionSkillReference(ownerTaskId:string,artifactId:string,revision:ArtifactRevision):InstructionSkillReference{return {ownerTaskId,artifactId,revision:revision.revision,digest:revision.digest};}
function activityName(tasks:readonly Task[],reference:InstructionSkillReference):string|null{
 const owner=tasks.find(task=>task.id===reference.ownerTaskId),artifact=owner?.artifacts.find(item=>item.id===reference.artifactId),saved=artifact?.revisions.find(item=>item.revision===reference.revision&&item.digest===reference.digest);
 if(!saved||saved.mimeType!==INSTRUCTION_SKILL_MIME||saved.encoding==='base64'||createHash('sha256').update(saved.content).digest('hex')!==saved.digest)return null;
 try{return readInstructionSkillBody(JSON.parse(saved.content)).name;}catch{return null;}
}
const recordedTime=(value:string|undefined):string|null=>value&&Number.isFinite(Date.parse(value))?value:null;
function requestActivity(tasks:readonly Task[]){
 const records:InstructionSkillRequestActivity[]=[];
 for(const task of tasks)for(const request of task.requests){
  if(!request.instructionSkill)continue;
  records.push({reference:{...request.instructionSkill},name:activityName(tasks,request.instructionSkill),taskId:task.id,taskTitle:task.title,requestId:request.id,status:request.status,startedAt:recordedTime(request.startedAt),finishedAt:recordedTime(request.finishedAt)});
 }
 records.sort((a,b)=>(b.startedAt?Date.parse(b.startedAt):-Infinity)-(a.startedAt?Date.parse(a.startedAt):-Infinity)||a.taskId.localeCompare(b.taskId)||a.requestId.localeCompare(b.requestId));
 return {records:records.slice(0,INSTRUCTION_SKILL_ACTIVITY_LIMIT),total:records.length};
}
export function instructionSkillCatalog(tasks:readonly Task[]){
 const entries:InstructionSkillEntry[]=[],unavailable:InstructionSkillUnavailable[]=[];
 for(const owner of tasks)for(const artifact of owner.artifacts){const saved=artifact.revisions.at(-1);if(saved?.mimeType!==INSTRUCTION_SKILL_MIME)continue;const reference=instructionSkillReference(owner.id,artifact.id,saved);try{entries.push(instructionSkillEntry(tasks,reference));}catch{unavailable.push({reference,name:saved.title,reason:'This skill or a pinned resource is unavailable. Inspect its saved file in the owner task.'});}}
 return {entries,unavailable,activity:requestActivity(tasks)};
}
