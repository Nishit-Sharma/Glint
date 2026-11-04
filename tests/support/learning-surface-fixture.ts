import type {Page} from '@playwright/test';
import {OnboardingFixture} from './onboarding-fixture';
import type {Command} from '../../src/shared/bridge';
import type {ModuleDraft} from '../../src/core/interactive-modules';
import {MODULE_MIME} from '../../src/shared/module-contract';

/** Actual App and disposable core store; only host/provider transport is substituted. */
export async function learningSurface(page:Page){
 const fixture=await OnboardingFixture.open(page,{ready:true});
 fixture.configured=true;
 const catalog=await fixture.ready();
 const task=await fixture.core.createTask({title:'Practice and teach',assignedBotId:catalog.defaultBotId});
 await fixture.viewPreferences.select(task.id);
 const invoke=fixture.invoke.bind(fixture);
 let complete:((value:{title:string;content:string;mimeType:string})=>void)|undefined;
 let pendingReject:((reason:Error)=>void)|undefined;
 const close=fixture.close.bind(fixture);
 fixture.close=async()=>{pendingReject?.(Error('Local renderer fixture closed.'));await close();};
 fixture.invoke=async(command:Command)=>{
  if(command.type!=='model.run')return invoke(command);
  fixture.commands.push(structuredClone(command));
  const result=await fixture.core.runRequest({taskId:command.taskId,requestId:command.requestId,kind:command.kind,prompt:command.prompt,sourceIds:[],...(command.submittedDraft?{submittedDraft:command.submittedDraft}:{})},({signal})=>new Promise((resolve,reject)=>{complete=resolve;pendingReject=reject;signal.addEventListener('abort',()=>reject(Error('Local request cancelled.')),{once:true});}));
  pendingReject=undefined;
  await fixture.emit({type:'changed',taskId:task.id});
  if(result.status!=='completed')throw Error(result.error??'Local fixture request failed.');
  return fixture.core.getTask(command.taskId);
 };
 await fixture.restart();
 await page.getByRole('button',{name:task.title,exact:true}).click();
 await page.getByRole('heading',{name:task.title,exact:true}).waitFor();
 async function begin(prompt:string){
  await page.getByRole('textbox',{name:'Ask about this task',exact:true}).fill(prompt);
  await page.getByRole('button',{name:'Ask',exact:true}).click();
  const until=Date.now()+5000;while(!complete&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,10));
  if(!complete)throw Error('The substituted transport did not receive the local request.');
  const resolve=complete;complete=undefined;return resolve;
 }
 return {
  fixture,task,
  async arrive(data:ModuleDraft){
   const resolve=await begin('Open the local '+data.title+' example.');
   resolve({title:data.title,mimeType:MODULE_MIME,content:JSON.stringify({schemaVersion:1,markdown:'Local practice. Changes stay with this task.',modules:[{id:data.kind,version:1,data,provenance:[]}]})});
   await page.getByRole('heading',{name:data.title,exact:true}).waitFor();
  },
  async streamProse(){
   const resolve=await begin('Keep the checked lesson while this local text streams.');
   const command=[...fixture.commands].reverse().find(command=>command.type==='model.run');
   if(command?.type!=='model.run')throw Error('Local stream has no request owner.');
   return {stream:(text:string)=>fixture.emit({type:'stream',taskId:task.id,requestId:command.requestId,text}),finish:()=>resolve({title:'Local text',mimeType:'text/markdown',content:'The checked lesson stays with this task.'})};
  },
 };
}
