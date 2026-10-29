import type {Page} from '@playwright/test';
import type {Command} from '../src/shared/bridge';
import {OnboardingFixture} from './onboarding-fixture';

/** Real renderer/onboarding and Companion store. Browser action, failed launch,
 * inspection and provider status are transport substitutes; no website opens. */
export async function browserLaunchRendererEntry(page:Page){
 const fixture=await OnboardingFixture.open(page,{port:4180});fixture.configured=true;
 let mode:'uncertain'|'failure'|'hold'='uncertain',held=false,releaseHold=()=>{};
 const original=fixture.invoke.bind(fixture),pending=new Set<Promise<unknown>>();
 const handle=async(command:Command):Promise<unknown>=>{
  if(command.type==='browser.inspect'){
   fixture.commands.push(structuredClone(command));
   throw Error('Companion could not open its browser. Your task is kept.');
  }
  if(command.type==='model.cancel'){
   fixture.commands.push(structuredClone(command));const task=await fixture.core.cancelRequest(command.taskId,command.requestId);await fixture.emit({type:'changed',taskId:command.taskId});return task;
  }
  if(command.type!=='browser.run')return original(command);
  fixture.commands.push(structuredClone(command));const selected=mode;
  const request=await fixture.core.runRequest({taskId:command.taskId,requestId:command.requestId,kind:'browser',prompt:command.prompt,sourceIds:[],...(command.submittedDraft?{submittedDraft:command.submittedDraft}:{})},async ctx=>{
   if(selected==='hold'){
    held=true;await new Promise<void>(resolve=>{releaseHold=resolve;if(ctx.signal.aborted)resolve();else ctx.signal.addEventListener('abort',()=>resolve(),{once:true});});throw Error('Stopped by the controlled browser transport.');
   }
   if(selected==='failure')throw Error('Companion could not open its browser. Your task is kept.');
   const observation={id:'synthetic-observation',taskId:command.taskId,browserId:'synthetic-browser',documentId:'synthetic-document',url:command.url,title:'Synthetic form',text:'Synthetic unverified action context',digest:'synthetic-observation-digest',targets:[]};
   await fixture.core.beginBrowserRun(command.taskId,{id:command.requestId,endpointKey:'synthetic-transport',origin:new URL(command.url).origin,browserId:observation.browserId,initialObservation:observation},ctx.task.session?.contextRevision??0);
   const session=(await fixture.core.getTask(command.taskId)).session!;
   await fixture.core.replaceSession(command.taskId,session.revision,{...session,runs:session.runs.map(run=>run.id!==command.requestId?run:{...run,operations:[{id:'synthetic-unknown-action',intent:{kind:'click',snapshotId:observation.id,targetId:'synthetic-submit'},reason:'Synthetic prior action may have completed',status:'uncertain'}]})});
   throw Error('This website action has an uncertain outcome. Inspect it before any new attempt.');
  });
  await fixture.emit({type:'changed',taskId:command.taskId});if(request.status!=='completed')throw Error(request.error??'Browser request stopped.');return fixture.core.getTask(command.taskId);
 };
 fixture.invoke=command=>{const work=handle(command);pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});return work;};
 try{await page.reload();}catch(error){await fixture.close();throw error;}
 return {fixture,setMode(value:'uncertain'|'failure'|'hold'){mode=value;},get held(){return held;},async close(){releaseHold();await Promise.allSettled([...pending]);await fixture.close();}};
}
