import {expect,type Page} from '@playwright/test';
import type {Command} from '../../src/shared/bridge';
import {learningDraftKey,type LearningDraftRecord,type LearningDraftValue} from '../../src/shared/learning-drafts';
import {reviewedWorkflowEntry} from './workflow-reviewed-entry.fixture';
import {gate} from './quit-submission-app.fixture';
import {workflowSourceOwner} from '../../src/renderer/src/workflow-source-review-form';
export const workspace=(page:Page)=>page.locator('.workspace:visible');
export const document=(page:Page)=>page.getByRole('dialog',{name:'Document',exact:true});
export const review=(page:Page)=>document(page).getByRole('region',{name:'Review workflow rules',exact:true});
export const assumptionName='Your additional assumptions (optional, one per line)';
export const frozenText='Editing is paused while the app finishes saving before closing. Your edits are kept; editing resumes if closing is cancelled.';
export const unicodeStates=['甲','乙','丙','丁'].map(value=>value.repeat(160)),unicodeEvents=['一','二','三','四','五','六','七','八'].map(value=>value.repeat(160));
function boundary(){const value=gate();let reached=false;return {...value,enter(){reached=true;value.enter();},reached:()=>reached};}
export async function files(page:Page){await workspace(page).getByRole('button',{name:'Task options',exact:true}).click();await workspace(page).getByRole('button',{name:'Files',exact:true}).click();return page.getByRole('dialog',{name:'Files',exact:true});}
export async function openSavedDocument(page:Page,title:string){const list=await files(page),row=list.locator('.artifact-row').filter({has:page.getByText(title,{exact:true})});await expect(row).toHaveCount(1);await expect(row.getByText(title,{exact:true})).toHaveCount(1);await row.click();await expect(document(page).getByRole('heading',{name:title,exact:true})).toBeVisible();}
export async function begin(page:Page,title:string){await openSavedDocument(page,title);await reopen(page);return review(page);}
export async function reopen(page:Page){await document(page).getByRole('button',{name:'Document options',exact:true}).click();await document(page).getByRole('button',{name:'Review workflow rules',exact:true}).click();await expect(review(page).getByRole('checkbox',{name:'Use passage 1',exact:true})).toBeVisible();}
export async function choose(scope:ReturnType<typeof review>){await scope.getByRole('combobox',{name:'Experiment starting state',exact:true}).selectOption('Draft');await scope.getByRole('combobox',{name:'Experiment event 1',exact:true}).selectOption('Submit');}
export const confirm=(page:Page)=>review(page).getByRole('checkbox',{name:'I reviewed these rules and experiment choices.',exact:true});
/** Actual existing source-review App/core/sidecar. Only delivery of real commit
 * results and an exact disposable raw transport call are controlled. */
export async function sourceReviewDraftEntry(page:Page,kind:'literal'|'ambiguous'='literal',capacity=false){
 const entry=await reviewedWorkflowEntry(page,kind),{fixture}=entry,invoke=fixture.invoke.bind(fixture),save=fixture.learningDrafts.save.bind(fixture.learningDrafts),held=new Set<ReturnType<typeof gate>>(),pending=new Set<Promise<unknown>>(),writes:{slot:string;value:LearningDraftValue|null;key:string;outcome?:string}[]=[];
 if(capacity){const lines=Array.from({length:80},(_,index)=>`${unicodeStates[Math.floor(index%24/8)]} + ${unicodeEvents[index%8]} -> ${unicodeStates[3]}`);await fixture.core.putSource(entry.task.id,{id:entry.sourceIds[0],kind:'text',role:'fact',label:'Owned Unicode rules one',content:lines.slice(0,40).join('\n')});const task=await fixture.core.putSource(entry.task.id,{kind:'text',role:'fact',label:'Owned Unicode rules two',content:lines.slice(40).join('\n')}),artifact=task.artifacts.find(item=>item.id===entry.basisArtifactId)!,revision=artifact.revisions.at(-1)!,refs=task.sources.map(source=>{const version=source.versions.at(-1)!;return {sourceId:source.id,version:version.version,digest:version.digest};});await fixture.core.saveArtifact(task.id,{artifactId:artifact.id,expectedRevision:revision.revision,title:entry.documentTitle,content:revision.content,mimeType:'text/markdown',sourceRefs:refs});await page.reload();await workspace(page).getByRole('complementary',{name:'Task navigation',exact:true}).getByRole('button',{name:entry.task.title,exact:true}).click();await expect(workspace(page).getByRole('heading',{level:1,name:entry.task.title,exact:true})).toBeVisible();}
 let reply:ReturnType<typeof boundary>|undefined,nullWrite:{key:string;gate:ReturnType<typeof boundary>}|undefined,failRaw=false,loseReply=false;
 fixture.invoke=command=>{const run=async()=>{const result=await invoke(command);if(command.type==='workflow.review'){const wait=reply;reply=undefined;if(wait){wait.enter();await wait.waiting;held.delete(wait);}if(loseReply){loseReply=false;throw Error('Owned lost literal publication reply after durable commit.');}}return result;};const work=run();pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});return work;};
 fixture.learningDrafts.save=async(...args)=>{const key=learningDraftKey(args[0],args[1]),write={key,slot:args[1],value:args[4]} as typeof writes[number];writes.push(write);if(('taskId' in args[0])&&args[0].taskId===entry.task.id&&args[1]==='workflow-source:review'){
  if(args[4]!==null&&failRaw){failRaw=false;write.outcome='controlled-failure';throw Error('Owned literal raw write transport failure.');}
  const wait=nullWrite;if(args[4]===null&&wait?.key===key){nullWrite=undefined;wait.gate.enter();await wait.gate.waiting;held.delete(wait.gate);}
 }const result=await save(...args);write.outcome=result.kind;return result;};
 return {...entry,writes,
  holdReply(){if(reply)throw Error('Reply already held');reply=boundary();held.add(reply);return reply;},
  loseNextReply(){loseReply=true;},failNextRaw(){failRaw=true;},
  holdNull(record:LearningDraftRecord){const wait=boundary();nullWrite={key:learningDraftKey(record.owner,record.slot),gate:wait};held.add(wait);return wait;},
  acknowledgements(id:string){return fixture.commands.filter((command):command is Extract<Command,{type:'draft.flushed'}>=>command.type==='draft.flushed'&&command.quitId===id);},
  async records(){const result=await fixture.learningDrafts.read();if(result.kind!=='available')throw Error('Expected actual readable sidecar.');return result.records.filter(record=>('taskId' in record.owner)&&record.owner.taskId===entry.task.id&&'kind' in record.owner&&record.owner.kind==='workflow-source-review');},
  async raw(){const prepared=entry.counters.preparations.at(-1);if(!prepared)throw Error('Open the public review first.');const key=learningDraftKey(workflowSourceOwner(entry.task.id,prepared.basis),'workflow-source:review'),result=await fixture.learningDrafts.read();if(result.kind!=='available')throw Error('Expected readable raw store.');return result.records.find(record=>learningDraftKey(record.owner,record.slot)===key);},
  async close(){for(const wait of held)wait.release();await Promise.allSettled([...pending]);await page.evaluate(()=>new Promise<void>(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>done())))).catch(()=>{});await Promise.allSettled([...pending]);await fixture.close();},
 };
}
