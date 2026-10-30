import type {Artifact,ArtifactRevision,Task} from '../core/types';
import {savedWorkSearchText} from './saved-work-search-text';

export const savedWorkSearchLimits={query:200,file:100_000,task:20_000,total:2_000_000,results:50,excerpt:240} as const;
export type SavedWorkScope='all'|'tasks'|'files';
type Match={taskId:string;taskTitle:string;title:string;excerpt:string;field:'Task name'|'Task goal'|'File name'|'File text'};
export type SavedWorkMatch=
 | Match&{kind:'task';goal:string}
 | Match&{kind:'file';artifactId:string;revision:number;digest:string;mimeType:string;encoding:ArtifactRevision['encoding'];contentLength:number;contentPrefix:string};
export interface SavedWorkResults{query:string;scope:SavedWorkScope;matches:SavedWorkMatch[];matchCount:number;searched:number;partial:number;omitted:number;unavailable:number;unsearchedFiles:number}
export interface SavedWorkSearchState{query:string;scope:SavedWorkScope;results?:SavedWorkResults}
export const searchableSavedFile=(revision:ArtifactRevision)=>['text/plain','text/markdown'].includes(revision.mimeType)&&revision.encoding!=='base64';
const counts=(items:readonly {id:string}[])=>{const result=new Map<string,number>();for(const item of items)result.set(item.id,(result.get(item.id)??0)+1);return result;};
const excerpt=(value:string,index:number,length:number)=>{
 const start=Math.max(0,index-Math.min(80,Math.floor((savedWorkSearchLimits.excerpt-length)/2))),end=Math.min(value.length,start+savedWorkSearchLimits.excerpt);
 return (start?'…':'')+value.slice(start,end)+(end<value.length?'…':'');
};

/** A literal local search, computed only on explicit submission. No source,
 * session, receipt, older revision, image or structured module is indexed. */
export function searchSavedWork(tasks:readonly Task[],input:string,scope:SavedWorkScope='all'):SavedWorkResults{
 const query=input.trim();
 if(!query||query.length>savedWorkSearchLimits.query)throw Error('Enter up to 200 characters to find saved work.');
 const pattern=new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'iu');
 const result:SavedWorkResults={query,scope,matches:[],matchCount:0,searched:0,partial:0,omitted:0,unavailable:0,unsearchedFiles:0};let remaining:number=savedWorkSearchLimits.total;
 const scan=(title:string,body:string,limit:number,fields:readonly [Match['field'],Match['field']],project?:(prefix:string)=>string|null)=>{
  if(!remaining){result.omitted++;return;}
  const head=title.slice(0,Math.min(remaining,limit));remaining-=head.length;
  const text=body.slice(0,Math.min(remaining,Math.max(0,limit-head.length)));remaining-=text.length;
  const searchable=project?project(text):text;if(searchable===null){result.unavailable++;result.unsearchedFiles++;return;}
  result.searched++;if(head.length<title.length||text.length<body.length)result.partial++;
  const titleMatch=pattern.exec(head),bodyMatch=titleMatch?undefined:pattern.exec(searchable),match=titleMatch??bodyMatch;
  return match?{field:fields[titleMatch?0:1],excerpt:excerpt(titleMatch?head:searchable,match.index,match[0].length),contentPrefix:text}:undefined;
 };
 const add=(match:SavedWorkMatch)=>{result.matchCount++;if(result.matches.length<savedWorkSearchLimits.results)result.matches.push(match);};
 // Stable recency ordering makes a bounded search reproducible. A task and all
 // its current files stay together; scope can narrow the same local budget.
 const taskCounts=counts(tasks),ordered=[...tasks].sort((a,b)=>(Date.parse(b.updatedAt)||0)-(Date.parse(a.updatedAt)||0)||a.id.localeCompare(b.id));
 for(const task of ordered){
  if(taskCounts.get(task.id)!==1)continue;
  if(scope!=='files'){
   const found=scan(task.title,task.goal,savedWorkSearchLimits.task,['Task name','Task goal']);
   if(found)add({kind:'task',taskId:task.id,taskTitle:task.title,title:task.title,goal:task.goal,field:found.field,excerpt:found.excerpt});
  }
  if(scope==='tasks')continue;
  const artifactCounts=counts(task.artifacts);
  for(const artifact of task.artifacts){
   const revision=artifact.revisions.at(-1);
   if(artifactCounts.get(artifact.id)!==1||!revision||artifact.revisions.filter(item=>item.revision===revision.revision).length!==1||!searchableSavedFile(revision))continue;
   if(revision.title.length+revision.content.length>Math.min(savedWorkSearchLimits.file,remaining)){result.unsearchedFiles++;continue;}
   const found=scan(revision.title,revision.content,savedWorkSearchLimits.file,['File name','File text'],prefix=>savedWorkSearchText(task,artifact,revision,prefix));
   if(found)add({kind:'file',taskId:task.id,taskTitle:task.title,title:revision.title,artifactId:artifact.id,revision:revision.revision,digest:revision.digest,mimeType:revision.mimeType,encoding:revision.encoding,contentLength:revision.content.length,...found});
  }
 }
 return result;
}

export const savedWorkUnavailable='This match changed or is no longer available. Search again to choose current saved work.';
export function resolveSavedWorkMatch(task:Task,match:SavedWorkMatch):{kind:'task'}|{kind:'file';artifact:Artifact;revision:ArtifactRevision}{
 if(task.id!==match.taskId||task.title!==match.taskTitle)throw Error(savedWorkUnavailable);
 if(match.kind==='task'){
  if(task.goal!==match.goal||task.title!==match.title)throw Error(savedWorkUnavailable);
  return {kind:'task'};
 }
 const artifacts=task.artifacts.filter(item=>item.id===match.artifactId),artifact=artifacts.length===1?artifacts[0]:undefined,revision=artifact?.revisions.at(-1);
 if(!artifact||!revision||artifact.revisions.filter(item=>item.revision===match.revision).length!==1||revision.revision!==match.revision||revision.digest!==match.digest||revision.title!==match.title||revision.mimeType!==match.mimeType||revision.encoding!==match.encoding||revision.content.length!==match.contentLength||revision.content.slice(0,match.contentPrefix.length)!==match.contentPrefix||!searchableSavedFile(revision))throw Error(savedWorkUnavailable);
 return {kind:'file',artifact,revision};
}
