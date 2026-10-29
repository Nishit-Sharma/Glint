import type {Artifact, Task} from '../../core/types';
import {parseModuleAnswer} from '../../core/interactive-modules';
import {MODULE_MIME} from '../../shared/module-contract';
import {workflowStatus, type WorkflowBasis} from '../../learning/workflow-grounding';

type SourceBasis=Extract<WorkflowBasis,{kind:'reviewed-source'}>;
const sameRef=(a:SourceBasis['sourceRefs'][number],b:SourceBasis['sourceRefs'][number])=>a.sourceId===b.sourceId&&a.version===b.version&&a.digest===b.digest;
/** Resolve only the exact saved source artifact from the same task. No live freshness is inferred. */
export function workflowSourceDocument(task:Task|undefined,basis:WorkflowBasis):Artifact|undefined {
 if(!task||basis.kind!=='reviewed-source'||task.id!==basis.taskId)return;
 const document=task.artifacts.find(item=>item.id===basis.artifact.artifactId);
 const original=document?.revisions.find(item=>item.revision===basis.artifact.revision&&item.digest===basis.artifact.digest);
 const latest=document?.revisions.at(-1);
 if(!original||!latest||!original.mimeType.startsWith('text/')||original.encoding==='base64'||!latest.mimeType.startsWith('text/')||latest.encoding==='base64')return;
 if(new Set(basis.sourceRefs.map(ref=>ref.sourceId)).size!==basis.sourceRefs.length||new Set(original.sourceRefs.map(ref=>ref.sourceId)).size!==original.sourceRefs.length||original.sourceRefs.length!==basis.sourceRefs.length||!original.sourceRefs.every(ref=>basis.sourceRefs.some(other=>sameRef(ref,other))))return;
 return document;
}
export type WorkflowNavigationScope={taskId:string|undefined;navigation:number;activation:number;workflow:number;surfaceIntent:number;surface:string};
export function workflowNavigationScopeCurrent(captured:WorkflowNavigationScope,current:WorkflowNavigationScope):boolean {
 return captured.taskId!==undefined&&captured.taskId===current.taskId&&captured.navigation===current.navigation&&captured.activation===current.activation&&captured.workflow===current.workflow&&captured.surfaceIntent===current.surfaceIntent&&captured.surface===current.surface;
}
export type WorkflowNavigationOwner={taskId:string;artifactId:string;revision:number;digest:string;moduleId:string};
/** Re-resolve the saved module and its source after the navigation guard has released. */
export function resolveWorkflowNavigation(task:Task|undefined,owner:WorkflowNavigationOwner):Artifact|undefined {
 if(!task||task.id!==owner.taskId)return;
 const revision=task.artifacts.find(item=>item.id===owner.artifactId)?.revisions.at(-1);
 if(!revision||revision.revision!==owner.revision||revision.digest!==owner.digest||revision.mimeType!==MODULE_MIME)return;
 try {
  const module=parseModuleAnswer(JSON.parse(revision.content)).modules.find(item=>item.id===owner.moduleId);
  if(!module||module.data.kind!=='workflow-lab'||workflowStatus(module.data,task).kind!=='stale')return;
  return workflowSourceDocument(task,module.data.basis);
 } catch {return;}
}
export function requestWorkflowNavigation(owner:WorkflowNavigationOwner,options:{current:()=>boolean;task:()=>Task|undefined;load:()=>Promise<Task>;guard:(action:()=>void)=>unknown;open:(task:Task,artifact:Artifact)=>void;unavailable:()=>void}) {
 if(!options.current())return;
 if(!resolveWorkflowNavigation(options.task(),owner)){options.unavailable();return;}
 const read=()=>{void (async()=>{
  if(!options.current())return;
  try {
   const before=options.task();
   const latest=await options.load();
   if(!options.current())return;
   if(options.task()!==before){options.unavailable();return;}
   const document=resolveWorkflowNavigation(latest,owner);
   if(!document){options.unavailable();return;}
   // An edit can appear while the read is in flight. If the guard waits for a
   // decision, reload again after that decision rather than opening stale data.
   let synchronous=true;
   options.guard(()=>{
    if(!options.current())return;
    if(!synchronous){read();return;}
    if(options.task()!==before){options.unavailable();return;}
    options.open(latest,document);
   });
   synchronous=false;
  } catch {if(options.current())options.unavailable();}
 })();};
 options.guard(read);
}
