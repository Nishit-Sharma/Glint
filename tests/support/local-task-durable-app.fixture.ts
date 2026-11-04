import type {Page} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createCompanion} from '../../src/core/companion';
import {BotPreferences} from '../../src/host/bot-preferences';
import {LearningDraftStore} from '../../src/host/learning-drafts';
import type {Command} from '../../src/shared/bridge';
import {learningDraftKey,type LearningDraftRecord,type LearningDraftValue} from '../../src/shared/learning-drafts';
import {localTaskDraftOwner,parseLocalTaskDraft,LOCAL_TASK_DRAFT_SLOT} from '../../src/shared/local-task-draft';
import {serializeLearningDraftJson} from '../../src/shared/learning-drafts';
import {offlineTaskEntry} from './offline-task-entry.fixture';

type Form='text'|'draft';
function gate(){let release!:()=>void;const waiting=new Promise<void>(done=>{release=done;});let reached=false;return {waiting,release,enter(){reached=true;},reached:()=>reached};}
type Write={form:Form;expectedEpoch:string;expectedRevision:number;value:LearningDraftValue|null;outcome?:string;record?:LearningDraftRecord};
/** Public onboarding/New task creates all normal data. The inherited fixture uses
 * actual core and sidecar; only delivery/failure of exact calls is controlled.
 * No module, task, local form or receipt is seeded. The two direct disk mutations
 * below are explicitly adversarial foreign-writer/unsupported-file controls. */
export async function localTaskDurableEntry(page:Page,port=Number(process.env.WINDOW_COMPANION_TEST_PORT??4180)){
 const entry=await offlineTaskEntry(page,port),{fixture}=entry,invoke=fixture.invoke.bind(fixture);
 const held=new Set<ReturnType<typeof gate>>(),pending=new Set<Promise<unknown>>(),writes:Write[]=[],dispatchRaw:{command:Extract<Command,{type:'tasks.start-local'}>;record?:LearningDraftRecord}[]=[],events:{kind:string;detail?:unknown}[]=[];
 let reply:{form:Form;gate:ReturnType<typeof gate>}|undefined,draft:{form:Form;kind:'raw'|'null';gate:ReturnType<typeof gate>}|undefined,fail:{form:Form;kind:'raw'|'null'}|undefined;
 const matches=(owner:unknown,slot:string):owner is ReturnType<typeof localTaskDraftOwner>=>!!owner&&typeof owner==='object'&&'kind'in owner&&owner.kind==='local-task-form'&&'form'in owner&&(owner.form==='text'||owner.form==='draft')&&slot===LOCAL_TASK_DRAFT_SLOT;
 async function record(form:Form){const read=await fixture.learningDrafts.read();if(read.kind!=='available')throw Error('Expected actual readable local draft storage');const key=learningDraftKey(localTaskDraftOwner(form),LOCAL_TASK_DRAFT_SLOT),found=read.records.filter(record=>learningDraftKey(record.owner,record.slot)===key);if(found.length>1)throw Error('Duplicate exact local owner');return found[0];}
 async function settleWork(){await Promise.allSettled([...pending]);await page.evaluate(()=>new Promise<void>(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>done()))));await Promise.allSettled([...pending]);}
 function installSaveBoundary(){
  const save=fixture.learningDrafts.save.bind(fixture.learningDrafts);
  fixture.learningDrafts.save=async(...args)=>{
   if(!matches(args[0],args[1]))return save(...args);
   const form=args[0].form,kind=args[4]===null?'null':'raw',write:Write={form,expectedEpoch:args[2],expectedRevision:args[3],value:args[4]};writes.push(write);
   const wait=draft;if(wait&&wait.form===form&&wait.kind===kind){draft=undefined;wait.gate.enter();await wait.gate.waiting;held.delete(wait.gate);}
   if(fail?.form===form&&fail.kind===kind){fail=undefined;write.outcome='controlled-transport-failure';throw Error('Owned local '+kind+' draft transport failure');}
   const result=await save(...args);write.outcome=result.kind;if(result.kind==='saved')write.record=result.record;return result;
  };
 }
 installSaveBoundary();
 fixture.invoke=command=>{
  const run=async()=>{
   if(command.type==='tasks.start-local')dispatchRaw.push({command:structuredClone(command),record:await record(command.kind)});
   const result=await invoke(command);
   if(command.type==='tasks.start-local'){const wait=reply;if(wait&&wait.form===command.kind){reply=undefined;wait.gate.enter();events.push({kind:'actual-core-committed-reply-held',detail:command.intentId});await wait.gate.waiting;held.delete(wait.gate);}}
   return result;
  };
  const work=run();pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});return work;
 };
 function hold(kind:'raw'|'null',form:Form){if(draft)throw Error('A draft hold is already armed');const value=gate();held.add(value);draft={form,kind,gate:value};return value;}
 return {...entry,writes,dispatchRaw,events,record,settleWork,
  holdRaw:(form:Form)=>hold('raw',form),holdNull:(form:Form)=>hold('null',form),
  holdReply(form:Form){if(reply)throw Error('A reply hold is already armed');const value=gate();held.add(value);reply={form,gate:value};return value;},
  failNext(form:Form,kind:'raw'|'null'){if(fail)throw Error('A failure is already armed');fail={form,kind};},
  acknowledgements(quitId:string){return fixture.commands.filter((command):command is Extract<Command,{type:'draft.flushed'}>=>command.type==='draft.flushed'&&command.quitId===quitId);},
  async flushEvent(quitId:string){events.push({kind:'synthetic-draft-flush',detail:quitId});await fixture.emit({type:'draft.flush',quitId});},
  async resumeEvent(quitId:string){events.push({kind:'synthetic-draft-resume',detail:quitId});await fixture.emit({type:'draft.resume',quitId});},
  async foreignReplace(form:Form,content:string){
   const prior=await record(form);if(!prior?.value)throw Error('Public entry must first save the actual owner');const raw=parseLocalTaskDraft(JSON.parse(prior.value.value));if(raw.intentId)throw Error('Do not rewrite an uncertain attempt');
   const value={...prior.value,value:serializeLearningDraftJson({...raw,content},'local-task-form')},other=new LearningDraftStore({directory:fixture.directory,lookupTask:async id=>(await fixture.core.listTasks()).find(task=>task.id===id)}),read=await other.read();if(read.kind!=='available')throw Error('Expected current foreign-writer basis');
   const result=await other.save(prior.owner,prior.slot,read.epoch,prior.revision,value);events.push({kind:'controlled-foreign-CAS',detail:{prior,result}});return result;
  },
  async unsupportedFile(){const path=join(fixture.directory,'learning-drafts.json'),prior=await readFile(path),parsed=JSON.parse(prior.toString()),bytes=Buffer.from(JSON.stringify({...parsed,schemaVersion:999}));await writeFile(path,bytes);events.push({kind:'controlled-unsupported-file',detail:{priorSchema:parsed.schemaVersion,bytes:bytes.length}});return bytes;},
  async recreateCoreAndStore(){
   if(held.size)throw Error('Cannot recreate with a controlled call held');await settleWork();
   await fixture.core.close();fixture.core=await createCompanion({dataDir:fixture.directory});fixture.bots=await BotPreferences.open(fixture.directory,fixture.core);await fixture.bots.finishExample(fixture.core);
   fixture.learningDrafts=new LearningDraftStore({directory:fixture.directory,lookupTask:async id=>(await fixture.core.listTasks()).find(task=>task.id===id)});installSaveBoundary();events.push({kind:'new-core-and-draft-store-objects-same-disposable-directory-renderer-reload'});await page.reload();
  },
  async close(){for(const wait of held)wait.release();await Promise.allSettled([...pending]);await page.evaluate(()=>new Promise<void>(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>done())))).catch(()=>{});await Promise.allSettled([...pending]);await entry.close();},
 };
}
