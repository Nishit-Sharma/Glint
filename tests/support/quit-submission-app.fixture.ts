import type {Page} from '@playwright/test';
import type {Command} from '../../src/shared/bridge';
import type {LearningDraftOwner,LearningDraftRecord,LearningDraftValue} from '../../src/shared/learning-drafts';
import {parseModuleAnswer} from '../../src/core/interactive-modules';
import {MODULE_MIME} from '../../src/shared/module-contract';
import {workflowEntry} from './workflow-entry.fixture';

export function gate(){let release!:()=>void,enter!:()=>void;const waiting=new Promise<void>(done=>{release=done;}),entered=new Promise<void>(done=>{enter=done;});return {release,enter,waiting,entered};}
export const workspace=(page:Page)=>page.locator('.workspace:visible');
export const document=(page:Page)=>page.getByRole('dialog',{name:'Document',exact:true});
export const workflowTitle='What happens to review after an edit?';
export async function openFiles(page:Page){await workspace(page).getByRole('button',{name:'Task options',exact:true}).click();await workspace(page).getByRole('button',{name:'Files',exact:true}).click();return page.getByRole('dialog',{name:'Files',exact:true});}
export async function reopenWorkflow(page:Page){const files=await openFiles(page);await files.getByRole('button',{name:/^What happens to review after an edit\? Document/}).click();return document(page);}

/** Existing actual App/real Companion/real sidecar fixture. Only command reply
 * delivery and one disposable sidecar transport call may be held or failed. */
export async function quitSubmissionEntry(page:Page,notes=false){
 const entry=await workflowEntry(page),{fixture}=entry;
 const files=await openFiles(page);await files.getByRole('button',{name:'New file',exact:true}).click();await files.getByRole('button',{name:'Workflow example',exact:true}).click();
 if(notes){await document(page).getByRole('button',{name:'Save as document',exact:true}).click();await document(page).getByRole('heading',{name:workflowTitle+' notes',exact:true}).waitFor();await document(page).getByRole('button',{name:'Back to task',exact:true}).click();await reopenWorkflow(page);}
 const task=await fixture.core.getTask(entry.task.id),artifact=task.artifacts.find(item=>item.revisions.at(-1)?.mimeType===MODULE_MIME)!;
 const revision=artifact.revisions.at(-1)!,module=parseModuleAnswer(JSON.parse(revision.content)).modules[0];
 const owner={taskId:task.id,artifactId:artifact.id,artifactRevision:revision.revision,artifactDigest:revision.digest,moduleId:module.id,moduleVersion:module.version} satisfies LearningDraftOwner;
 const invoke=fixture.invoke.bind(fixture),save=fixture.learningDrafts.save.bind(fixture.learningDrafts),held=new Set<ReturnType<typeof gate>>(),pending=new Set<Promise<unknown>>();
 let moduleGate:{stage:'before'|'after';gate:ReturnType<typeof gate>}|undefined,draftGate:{kind:'raw'|'null';gate:ReturnType<typeof gate>}|undefined,failNull=false;
 const writes:{owner:LearningDraftOwner;slot:string;value:LearningDraftValue|null;expectedRevision:number;outcome?:string;record?:LearningDraftRecord}[]=[];
 let onFlush:((command:Extract<Command,{type:'draft.flushed'}>)=>void)|undefined;
 fixture.learningDrafts.save=async(...args)=>{
  const attempt={owner:args[0],slot:args[1],expectedRevision:args[3],value:args[4]} as typeof writes[number];writes.push(attempt);
  const matching='moduleId' in args[0]&&args[0].taskId===owner.taskId&&args[0].artifactId===owner.artifactId&&args[0].moduleId===owner.moduleId&&args[1].includes(':rule:');
  const barrier=draftGate;if(barrier&&matching&&((barrier.kind==='null')===(args[4]===null))){draftGate=undefined;barrier.gate.enter();await barrier.gate.waiting;held.delete(barrier.gate);}
  if(matching&&args[4]===null&&failNull){failNull=false;attempt.outcome='controlled-failure';throw Error('Owned late tombstone transport failure.');}
  const result=await save(...args);attempt.outcome=result.kind;if(result.kind==='saved')attempt.record=result.record;return result;
 };
 fixture.invoke=command=>{
  const run=async()=>{
   if(command.type==='module.edit'&&command.taskId===owner.taskId&&command.artifactId===owner.artifactId&&command.moduleId===owner.moduleId&&command.action.kind==='set-rule'&&moduleGate){
    const barrier=moduleGate;moduleGate=undefined;
    if(barrier.stage==='before'){barrier.gate.enter();await barrier.gate.waiting;held.delete(barrier.gate);return invoke(command);}
    const result=await invoke(command);barrier.gate.enter();await barrier.gate.waiting;held.delete(barrier.gate);return result;
   }
   const result=await invoke(command);if(command.type==='draft.flushed')onFlush?.(command);return result;
  };
  const work=run();pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});return work;
 };
 return {...entry,owner,writes,
  holdModule(stage:'before'|'after'='after'){if(moduleGate)throw Error('Module reply already armed.');const barrier=gate();held.add(barrier);moduleGate={stage,gate:barrier};return barrier;},
  holdDraft(kind:'raw'|'null'){if(draftGate)throw Error('Draft boundary already armed.');const barrier=gate();held.add(barrier);draftGate={kind,gate:barrier};return barrier;},
  failNextNull(){failNull=true;},onFlush(callback:(command:Extract<Command,{type:'draft.flushed'}>)=>void){onFlush=callback;},
  acknowledgements(id:string){return fixture.commands.filter((command):command is Extract<Command,{type:'draft.flushed'}>=>command.type==='draft.flushed'&&command.quitId===id);},
  async records(){const read=await fixture.learningDrafts.read();if(read.kind!=='available')throw Error('Expected readable owned sidecar.');return read.records.filter(record=>'moduleId' in record.owner&&record.owner.taskId===owner.taskId&&record.owner.artifactId===owner.artifactId&&record.owner.moduleId===owner.moduleId);},
  async state(){return (await fixture.core.getTask(owner.taskId)).session?.moduleStates.find(item=>item.artifactId===owner.artifactId&&item.moduleId===owner.moduleId)?.state;},
  async close(){for(const barrier of held)barrier.release();await Promise.allSettled([...pending]);await page.evaluate(()=>new Promise<void>(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>done())))).catch(()=>{});await Promise.allSettled([...pending]);await fixture.close();},
 };
}
