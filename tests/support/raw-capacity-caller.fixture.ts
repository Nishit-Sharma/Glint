import {expect,type Page} from '@playwright/test';
import {BrowserFixture} from './browser-fixture';
import {prepareWorkflowReview,createReviewedWorkflow} from '../../src/core/workflow-review-host';
import {learningDraftKey,type LearningDraftValue} from '../../src/shared/learning-drafts';
import {workflowSourceOwner,workflowSourceReviewSlot,workflowSourcePublicationSlot} from '../../src/renderer/src/workflow-source-review-form';
import type {Command} from '../../src/shared/bridge';

function gate(){let release!:()=>void,enter!:()=>void,reached=false;const waiting=new Promise<void>(done=>{release=done;});return {waiting,release:()=>release(),enter:()=>{reached=true;enter();},entered:new Promise<void>(done=>{enter=done;}),reached:()=>reached};}
type MutableInvoke={invoke:(command:Command)=>Promise<unknown>};
/** Actual React bridge + real disposable core/store. Only an exact raw save and
 * a real postcommit reply are held; the owned text/document are fixture input. */
export async function literalCallerEntry(page:Page){
 const fixture=await BrowserFixture.open(page,undefined,Number(process.env.WINDOW_COMPANION_TEST_PORT??4180));fixture.configured=false;
 const sourceText='Draft + Submit -> In review\nIn review + Approve -> Ready\nReady + Edit -> Draft',sourceLabel='Owned literal caller rules',documentTitle='Owned literal caller notes';
 const sourced=await fixture.core.putSource(fixture.taskA.id,{kind:'text',role:'fact',label:sourceLabel,content:sourceText}),source=sourced.sources.at(-1)!,version=source.versions.at(-1)!,refs=[{sourceId:source.id,version:version.version,digest:version.digest}];
 const saved=await fixture.core.saveArtifact(fixture.taskA.id,{title:documentTitle,content:'This owned document links the literal rule source.',mimeType:'text/markdown',sourceRefs:refs}),basis={artifactId:saved.artifactId,revision:saved.revision.revision,digest:saved.revision.digest};
 const owner=workflowSourceOwner(fixture.taskA.id,basis),rawKey=learningDraftKey(owner,workflowSourceReviewSlot),publicationKey=learningDraftKey(owner,workflowSourcePublicationSlot),rawHold=gate(),replyHold=gate(),pending=new Set<Promise<unknown>>(),writes:{key:string;expectedRevision:number;value:LearningDraftValue|null;outcome?:string}[]=[],requests:Extract<Command,{type:'workflow.review'}>[]=[];
 let rawArmed=false,replyArmed=false;const save=fixture.learningDrafts.save.bind(fixture.learningDrafts),mutable=fixture as unknown as MutableInvoke,invoke=mutable.invoke.bind(fixture);
 fixture.learningDrafts.save=async(...args)=>{const key=learningDraftKey(args[0],args[1]),write={key,expectedRevision:args[3],value:args[4]} as typeof writes[number];writes.push(write);if(key===rawKey&&args[4]!==null&&rawArmed){rawArmed=false;rawHold.enter();await rawHold.waiting;}const result=await save(...args);write.outcome=result.kind;return result;};
 mutable.invoke=command=>{const work=(async()=>{
  if(command.type==='workflow.prepare'){fixture.commands.push(structuredClone(command));const {type,...input}=command;return prepareWorkflowReview(fixture.core,input);}
  if(command.type==='workflow.review'){fixture.commands.push(structuredClone(command));requests.push(structuredClone(command));const {type,...input}=command,result=await createReviewedWorkflow(fixture.core,input);await fixture.changed(command.taskId);if(replyArmed){replyArmed=false;replyHold.enter();await replyHold.waiting;}return result;}
  return invoke(command);
 })();pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});return work;};
 await fixture.changed(fixture.taskA.id);
 const records=async()=>{const data=await fixture.learningDrafts.read();if(data.kind!=='available')throw Error('Expected readable owned sidecar');return data.records;};
 const record=async(key:string)=> (await records()).find(item=>learningDraftKey(item.owner,item.slot)===key);
 const acknowledgements=(id:string)=>fixture.commands.filter((command):command is Extract<Command,{type:'draft.flushed'}>=>command.type==='draft.flushed'&&command.quitId===id);
 async function flush(){const quitId=crypto.randomUUID();await fixture.emit({type:'draft.flush',quitId});await expect.poll(()=>acknowledgements(quitId).length).toBe(1);expect(acknowledgements(quitId)[0].error).toBeUndefined();await fixture.emit({type:'draft.resume',quitId});}
 return {fixture,owner,rawKey,publicationKey,sourceText,sourceLabel,documentTitle,refs,basis,rawHold,replyHold,writes,requests,records,record,acknowledgements,flush,
  holdRaw(){rawArmed=true;},holdReply(){replyArmed=true;},
  async raw(){return record(rawKey);},async publication(){return record(publicationKey);},
  async close(){rawHold.release();replyHold.release();await Promise.allSettled([...pending]);await page.evaluate(()=>new Promise<void>(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>done())))).catch(()=>{});await Promise.allSettled([...pending]);await fixture.close();},
 };
}
