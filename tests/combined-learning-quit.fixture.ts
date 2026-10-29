import {expect,type Page} from '@playwright/test';
import type {Command} from '../src/shared/bridge';
import {learningDraftKey,type LearningDraftOwner,type LearningDraftRecord,type LearningDraftValue} from '../src/shared/learning-drafts';
import {createTextHelper} from '../src/core/text-helper-host';
import {parseModuleAnswer} from '../src/core/interactive-modules';
import {MODULE_MIME} from '../src/shared/module-contract';
import type {SemanticHelperState} from '../src/learning/semantic-helper';
import {windowLearningEntry} from './window-learning-entry.fixture';
import {gate} from './quit-submission-app.fixture';

export const workspace=(page:Page)=>page.locator('.workspace:visible');
export const document=(page:Page)=>page.getByRole('dialog',{name:'Document',exact:true});
export const frozenText='Editing is paused while the app finishes saving before closing. Your edits are kept; editing resumes if closing is cancelled.';
export type DraftTarget={owner:LearningDraftOwner;slot:string};
type Write={owner:LearningDraftOwner;slot:string;expectedEpoch:string;expectedRevision:number;value:LearningDraftValue|null;outcome?:string;record?:LearningDraftRecord};
function boundary(){const barrier=gate();let reached=false;return {...barrier,enter(){reached=true;barrier.enter();},reached:()=>reached};}
export async function files(page:Page){await workspace(page).getByRole('button',{name:'Task options',exact:true}).click();await workspace(page).getByRole('button',{name:'Files',exact:true}).click();return page.getByRole('dialog',{name:'Files',exact:true});}
export const settle=(page:Page)=>page.evaluate(()=>new Promise<void>(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>done()))));

/** Actual App/core/store and existing synthetic WINDOW entry. The new seams only
 * hold real postcommit replies or hold/fail an exact disposable sidecar call.
 * Text helpers use the same public Files entry and actual createTextHelper as
 * textHelperEntry, with this fixture's single 4193 transport. No module is seeded. */
export async function combinedLearningQuitEntry(page:Page){
 const entry=await windowLearningEntry(page),fixture=entry.fixture,invoke=fixture.invoke.bind(fixture),save=fixture.learningDrafts.save.bind(fixture.learningDrafts);
 const held=new Set<ReturnType<typeof gate>>(),pending=new Set<Promise<unknown>>(),writes:Write[]=[];
 let reply:{matches:(command:Command)=>boolean;gate:ReturnType<typeof gate>}|undefined;
 let draft:{key:string;kind:'raw'|'null';gate:ReturnType<typeof gate>}|undefined,failNullKey:string|undefined;
 const key=(target:DraftTarget)=>learningDraftKey(target.owner,target.slot);
 fixture.learningDrafts.save=async(...args)=>{
  const write:Write={owner:args[0],slot:args[1],expectedEpoch:args[2],expectedRevision:args[3],value:args[4]};writes.push(write);
  const actual=learningDraftKey(args[0],args[1]),barrier=draft;
  if(barrier&&actual===barrier.key&&((args[4]===null)===(barrier.kind==='null'))){draft=undefined;barrier.gate.enter();await barrier.gate.waiting;held.delete(barrier.gate);}
  if(actual===failNullKey&&args[4]===null){failNullKey=undefined;write.outcome='controlled-transport-failure';throw Error('Owned combined late draft cleanup transport failure.');}
  const result=await save(...args);write.outcome=result.kind;if(result.kind==='saved')write.record=result.record;return result;
 };
 fixture.invoke=command=>{
  const run=async()=>{
   let result:unknown;
   if(command.type==='helper.create'){
    fixture.commands.push(structuredClone(command));const {type,...input}=command;result=await createTextHelper(fixture.core,input);await fixture.emit({type:'changed',taskId:command.taskId});
   }else result=await invoke(command);
   const barrier=reply;if(barrier&&barrier.matches(command)){reply=undefined;barrier.gate.enter();await barrier.gate.waiting;held.delete(barrier.gate);}
   return result;
  };
  const work=run();pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});return work;
 };
 return {...entry,writes,
  holdReply(matches:(command:Command)=>boolean){if(reply)throw Error('A reply is already held.');const barrier=boundary();held.add(barrier);reply={matches,gate:barrier};return barrier;},
  holdDraft(target:DraftTarget,kind:'raw'|'null'){if(draft)throw Error('A draft call is already held.');const barrier=boundary();held.add(barrier);draft={key:key(target),kind,gate:barrier};return barrier;},
  failNextNull(target:DraftTarget){if(failNullKey)throw Error('A null failure is already armed.');failNullKey=key(target);},
  acknowledgements(id:string){return fixture.commands.filter((command):command is Extract<Command,{type:'draft.flushed'}>=>command.type==='draft.flushed'&&command.quitId===id);},
  async records(){const read=await fixture.learningDrafts.read();if(read.kind!=='available')throw Error('Expected readable real draft storage.');return read.records.filter(record=>('taskId' in record.owner)&&record.owner.taskId===entry.task.id);},
  async record(target:DraftTarget){const read=await fixture.learningDrafts.read();if(read.kind!=='available')throw Error('Expected readable real draft storage.');return read.records.find(record=>learningDraftKey(record.owner,record.slot)===key(target));},
  async semanticState(target:DraftTarget){if('kind' in target.owner)throw Error('Expected a real module owner.');const owner=target.owner,state=(await fixture.core.getTask(owner.taskId)).session?.moduleStates.find(item=>item.artifactId===owner.artifactId&&item.artifactRevision===owner.artifactRevision&&item.moduleId===owner.moduleId)?.state;if(state?.format!=='semantic-record-v1')throw Error('Expected the publicly created semantic helper state.');return state as SemanticHelperState;},
  async close(){for(const barrier of held)barrier.release();await Promise.allSettled([...pending]);await settle(page).catch(()=>{});await Promise.allSettled([...pending]);await fixture.close();},
 };
}
export type CombinedEntry=Awaited<ReturnType<typeof combinedLearningQuitEntry>>;

/** Public creation/conversion only; reads below identify the resulting actual
 * historical module owner for draft assertions and transport matching. */
export async function openRecordHelper(page:Page,entry:CombinedEntry){
 const list=await files(page);await list.getByRole('button',{name:'New file',exact:true}).click();await list.getByRole('button',{name:'Text helper',exact:true}).click();
 const scope=document(page).locator('.helper-studio');await scope.getByRole('button',{name:'Create a local record helper',exact:true}).click();await expect(scope.getByRole('heading',{name:'Local record helper',exact:true})).toBeVisible();
 const task=await entry.fixture.core.getTask(entry.task.id),artifact=task.artifacts.find(item=>{const latest=item.revisions.at(-1);return latest?.mimeType===MODULE_MIME&&parseModuleAnswer(JSON.parse(latest.content)).modules.some(module=>module.data.kind==='helper-studio');});
 if(!artifact)throw Error('The public helper entry did not create an artifact.');const revision=artifact.revisions.at(-1)!,module=parseModuleAnswer(JSON.parse(revision.content)).modules.find(item=>item.data.kind==='helper-studio')!;
 const owner:LearningDraftOwner={taskId:task.id,artifactId:artifact.id,artifactRevision:revision.revision,artifactDigest:revision.digest,moduleId:module.id,moduleVersion:module.version};
 return {scope,target:{owner,slot:'helper:semantic:steps'} satisfies DraftTarget};
}
