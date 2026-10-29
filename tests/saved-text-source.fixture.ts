import type {Page} from '@playwright/test';
import {createCompanion} from '../src/core/companion';
import {BotPreferences} from '../src/host/bot-preferences';
import {LearningDraftStore} from '../src/host/learning-drafts';
import {offlineTaskEntry} from './offline-task-entry.fixture';

/** Actual App, core and sidecar. Public onboarding and local-text creation set
 * up the saved source; no task/source/draft is injected. The controlled quit
 * boundary emits the real renderer flush event and waits for its actual reply.
 * Reopening creates fresh core AND sidecar objects from the owned directory.
 * This is not a native process quit, OS crash or installed-data test. */
export async function savedTextSourceEntry(page:Page){
 const entry=await offlineTaskEntry(page),events:{kind:string;quitId?:string;error?:string}[]=[];
 const invoke=entry.fixture.invoke.bind(entry.fixture);let failure:'before'|'after'|undefined,gate:{promise:Promise<void>;release:()=>void;reached:boolean}|undefined;
 entry.fixture.invoke=async command=>{
  if(command.type!=='source.text'||!command.edit)return invoke(command);
  if(failure==='before'){failure=undefined;entry.fixture.commands.push(structuredClone(command));throw Error('The owned test transport refused this source save before commit.');}
  const result=await invoke(command),held=gate;gate=undefined;if(held){held.reached=true;await held.promise;}
  if(failure==='after'){failure=undefined;throw Error('The owned test transport lost the source reply after commit.');}return result;
 };
 return {...entry,events,
  rejectNextSourceSave(){failure='before';},
  holdNextSourceReply(lose=false){if(gate)throw Error('Owned source reply already held.');if(lose)failure='after';let release!:()=>void;const promise=new Promise<void>(done=>{release=done;});gate={promise,release,reached:false};return gate;},

  async quitAndRecreate(){
   const quitId=crypto.randomUUID();events.push({kind:'synthetic-host-draft-flush',quitId});
   await entry.fixture.emit({type:'draft.flush',quitId});
   const deadline=Date.now()+7000;
   for(;;){
    const replies=entry.fixture.commands.filter(command=>command.type==='draft.flushed'&&command.quitId===quitId);
    if(replies.length>1)throw Error('Duplicate controlled quit acknowledgement.');
    if(replies.length===1){const reply=replies[0];if(reply.type!=='draft.flushed')throw Error('Wrong quit reply.');events.push({kind:'actual-renderer-flush-reply',quitId,...(reply.error?{error:reply.error}:{})});if(reply.error)throw Error(reply.error);break;}
    if(Date.now()>=deadline)throw Error('Controlled quit was not acknowledged.');
    await page.evaluate(()=>new Promise<void>(done=>requestAnimationFrame(()=>done())));
   }
   await entry.fixture.core.close();
   entry.fixture.core=await createCompanion({dataDir:entry.fixture.directory});
   entry.fixture.bots=await BotPreferences.open(entry.fixture.directory,entry.fixture.core);
   await entry.fixture.bots.finishExample(entry.fixture.core);
   entry.fixture.learningDrafts=new LearningDraftStore({directory:entry.fixture.directory,lookupTask:async id=>(await entry.fixture.core.listTasks()).find(task=>task.id===id)});
   events.push({kind:'fresh-core-and-sidecar-same-owned-directory-renderer-reload'});
   await page.reload();
  },
 };
}
