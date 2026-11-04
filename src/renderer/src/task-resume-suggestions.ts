import {Schema} from 'effect';
import type {Task} from '../../core/types';
import {projectRequestTask} from '../../core/request-context';
import {requestableSourceRefs} from '../../shared/source-intake';
import {pickingTextDigest} from '../../shared/picking-digest';

export type TaskResumeSuggestion={taskId:string;title:string;goal:string;requestId:string;status:string;reason:string;prompt:string;binding:string};
/** Local status prompts only. Raw questions, answers, source text and memory never become suggestions. */
export function taskResumeSuggestions(tasks:readonly Task[],currentTaskId?:string,activeTaskIds:readonly string[]=[]):TaskResumeSuggestion[]{
 const candidates=tasks.flatMap(task=>{
  if(task.id===currentTaskId||activeTaskIds.includes(task.id)||task.archive||task.provenance==='local-example')return [];
  const eligible=projectRequestTask(task,requestableSourceRefs(task),tasks),request=eligible.requests.at(-1);
  if(!request||request.id!==task.requests.at(-1)?.id||!['explain','create'].includes(request.kind))return [];
  if(task.requests.some(item=>item.status==='running'))return [];
  const state=request.status==='interrupted'?{rank:1,reason:'The latest response was interrupted. Its outcome may need review.',prompt:'Review the interrupted response before deciding what to do.'}:request.status==='failed'?{rank:2,reason:'The latest response is recorded as failed.',prompt:'Review the failed response before deciding what to do.'}:request.status==='cancelled'?{rank:3,reason:'The latest response is recorded as stopped.',prompt:'Review the stopped response before deciding what to do.'}:request.status==='completed'&&request.answer?{rank:4,reason:'A completed response is saved in this task.',prompt:'Review the saved response and choose a follow-up.'}:undefined;
  if(!state)return [];
  const binding=pickingTextDigest(JSON.stringify({taskId:task.id,title:task.title,goal:task.goal,status:task.status,updatedAt:task.updatedAt,projectId:task.projectId,request:{id:request.id,digest:request.digest,status:request.status,answer:request.answer,questions:request.questions?.map(item=>[item.id,item.revision,item.status])},sources:task.sources.map(source=>[source.id,source.currentVersion,source.versions.at(-1)?.digest,source.freshness,source.revoked,source.projectOrigin]),selection:task.session?.sourceSelection,skill:task.session?.instructionSkill}));
  return [{taskId:task.id,title:task.title,goal:task.goal,requestId:request.id,status:request.status,reason:state.reason,prompt:state.prompt,binding,rank:state.rank,updatedAt:task.updatedAt}];
 });
 return candidates.sort((a,b)=>a.rank-b.rank||b.updatedAt.localeCompare(a.updatedAt)||a.taskId.localeCompare(b.taskId)).map(({rank:_rank,updatedAt:_updated,...item})=>item);
}

const key='glint-local-task-resume-suggestions-v1';
const savedSchema=Schema.Struct({schemaVersion:Schema.Literal(1),enabled:Schema.Boolean,dismissed:Schema.Array(Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/))).pipe(Schema.maxItems(100))});
const readSaved=Schema.decodeUnknownSync(savedSchema,{onExcessProperty:'error'});
type Saved=typeof savedSchema.Type;
type Snapshot=Saved&{available:boolean;version:number};
export function createTaskResumePreference(storage:()=>Pick<Storage,'getItem'|'setItem'>){
 let snapshot:Snapshot|undefined;const listeners=new Set<()=>void>();
 function read():Omit<Snapshot,'version'>{try{const raw=storage().getItem(key);return {...(raw===null?{schemaVersion:1 as const,enabled:false,dismissed:[]}:readSaved(JSON.parse(raw))),available:true};}catch{return {schemaVersion:1,enabled:false,dismissed:[],available:false};}}
 function getSnapshot(){return snapshot??(snapshot={...read(),version:0});}
 function publish(value:Omit<Snapshot,'version'>){snapshot={...value,version:(snapshot?.version??0)+1};for(const listener of listeners)listener();}
 function change(edit:(current:Saved)=>Saved){
  try{const current=read();if(!current.available)throw Error();const next=readSaved(edit(current));storage().setItem(key,JSON.stringify(next));const persisted=read();if(!persisted.available||JSON.stringify(readSaved({schemaVersion:persisted.schemaVersion,enabled:persisted.enabled,dismissed:persisted.dismissed}))!==JSON.stringify(next))throw Error();publish(persisted);}
  catch{publish({schemaVersion:1,enabled:false,dismissed:[],available:false});throw Error('The resume-suggestion choice could not be saved. Suggestions are hidden. Reload the saved choice before trying again.');}
 }
 return {key,getSnapshot,subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},refresh(){publish(read());},set(enabled:boolean){change(current=>({schemaVersion:1,enabled,dismissed:current.dismissed}));},dismiss(binding:string){change(current=>({schemaVersion:1,enabled:current.enabled,dismissed:[...current.dismissed.filter(item=>item!==binding),binding].slice(-100)}));},recompute(){change(current=>({schemaVersion:1,enabled:current.enabled,dismissed:[]}));}};
}
export const taskResumePreference=createTaskResumePreference(()=>window.localStorage);
if(typeof window!=='undefined')window.addEventListener('storage',event=>{if(event.key===key||event.key===null)taskResumePreference.refresh();});
