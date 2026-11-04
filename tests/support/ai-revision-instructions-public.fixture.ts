import type {Page} from '@playwright/test';
import type {Command} from '../../src/shared/bridge';
import {assertRevisionInstructionRequest,REVISION_INSTRUCTIONS_SLOT} from '../../src/shared/revision-instructions';
import {savedDocumentDraftOwner} from '../../src/shared/saved-document-draft';
import {learningDraftKey} from '../../src/shared/learning-drafts';
import {localTaskDurableEntry} from './local-task-durable-app.fixture';
function gate(){let release!:()=>void,reached=false;const waiting=new Promise<void>(done=>{release=done;});return {waiting,release,enter(){reached=true;},reached:()=>reached};}
export const scriptedRevisionFailure='ECONNRESET from the scripted QA revision runner.';
export const scriptedRevision={title:'Scripted revised document',content:'# Scripted revised document\n\nDeterministic answer from the disclosed QA provider boundary.',mimeType:'text/markdown'};
/** Public normal-data creation, actual core/cache/sidecar. Only configured
 * status, scripted provider output and exact reply/raw-write/tombstone delivery differ. */
export async function aiRevisionInstructionsEntry(page:Page){
 const entry=await localTaskDurableEntry(page),{fixture}=entry,invoke=fixture.invoke.bind(fixture),save=fixture.learningDrafts.save.bind(fixture.learningDrafts);
 const pending=new Set<Promise<unknown>>(),held=new Set<ReturnType<typeof gate>>(),modelCommands:Extract<Command,{type:'model.run'}>[]=[],events:Array<{kind:string;detail?:unknown}>=[];
 let owner:{taskId:string;artifactId:string}|undefined,reply:ReturnType<typeof gate>|undefined,untilStop:ReturnType<typeof gate>|undefined,loseTombstone=false,failNext=false,failRaw=false;
 const owns=(taskId:string,artifactId:string|undefined)=>!!owner&&owner.taskId===taskId&&owner.artifactId===artifactId;
 fixture.invoke=command=>{
  const work=(async()=>{
   if(command.type==='model.cancel'){
    if(!owner||command.taskId!==owner.taskId||!modelCommands.some(prior=>prior.requestId===command.requestId&&prior.artifactId===owner!.artifactId))throw Error('Scripted QA cancellation must target the exact publicly submitted document request.');
    fixture.commands.push(structuredClone(command));const result=await fixture.core.cancelRequest(command.taskId,command.requestId);events.push({kind:'actual-core-cancelled-from-public-stop',detail:structuredClone(command)});await fixture.emit({type:'changed',taskId:command.taskId});return result;
   }
   if(command.type!=='model.run')return invoke(command);
   fixture.commands.push(structuredClone(command));modelCommands.push(structuredClone(command));
   if(!fixture.configured||command.kind!=='revise'||!owns(command.taskId,command.artifactId)||typeof command.revisionBasis!=='string')throw Error('Scripted QA model route requires the exact publicly bound revision request.');
   const before=await fixture.core.getTask(command.taskId),revision=assertRevisionInstructionRequest(before,command.artifactId!,command.revisionBasis,command.sourceIds,command.expectedSourceRefs);
   const fail=failNext,stop=untilStop;failNext=false;untilStop=undefined;
   const result=await fixture.core.runRequest({taskId:command.taskId,requestId:command.requestId,kind:'revise',prompt:command.prompt,sourceIds:command.sourceIds,expectedSourceRefs:command.expectedSourceRefs,artifactId:command.artifactId,expectedRevision:revision.revision},async({signal})=>{
    if(signal.aborted)throw Error('Scripted QA request was stopped.');
    if(stop){stop.enter();events.push({kind:'actual-core-running-awaits-public-stop',detail:command.requestId});try{await new Promise<void>((resolve,reject)=>{const abort=()=>{signal.removeEventListener('abort',abort);reject(Error('Scripted QA request was stopped.'));};signal.addEventListener('abort',abort,{once:true});void stop.waiting.then(()=>{signal.removeEventListener('abort',abort);resolve();});if(signal.aborted)abort();});}finally{held.delete(stop);}}
    if(fail)throw Error(scriptedRevisionFailure);return {...scriptedRevision};
   });
   events.push({kind:'actual-core-scripted-request-finished',detail:structuredClone(result)});
   const wait=reply;reply=undefined;if(wait){wait.enter();events.push({kind:result.status==='completed'?'actual-core-committed-changed-notification-and-reply-held':'actual-core-failed-changed-notification-and-reply-held',detail:command.requestId});await wait.waiting;held.delete(wait);}
   await fixture.emit({type:'changed',taskId:command.taskId});
   if(result.status!=='completed'){events.push({kind:result.status==='cancelled'?'actual-core-cancelled-reply-delivered':'actual-core-failed-reply-delivered',detail:command.requestId});throw Error(result.error||'Scripted QA request '+result.status);}return fixture.core.getTask(command.taskId);
  })();pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});return work;
 };
 fixture.learningDrafts.save=async(...args)=>{
  const identity=args[0],matches='kind' in identity&&identity.kind==='saved-document-edit'&&owns(identity.taskId,identity.artifactId)&&args[1]===REVISION_INSTRUCTIONS_SLOT;
  if(matches&&args[4]!==null&&failRaw){failRaw=false;events.push({kind:'exact-instruction-raw-write-transport-failed-before-storage',detail:structuredClone({owner:identity,slot:args[1],expectedEpoch:args[2],expectedRevision:args[3],value:args[4]})});throw Error('Owned instruction raw-write transport failed before storage.');}
  const result=await save(...args);if(matches&&args[4]===null&&loseTombstone&&result.kind==='saved'){loseTombstone=false;events.push({kind:'actual-instruction-tombstone-acknowledgement-lost',detail:result.kind});throw Error('Owned instruction tombstone acknowledgement lost after actual storage.');}return result;
 };
 async function instructionRecord(observed=owner){if(!observed)throw Error('Bind the publicly observed document before reading its instruction slot.');const state=await fixture.learningDrafts.read();if(state.kind!=='available')throw Error('Instruction sidecar is unavailable.');const key=learningDraftKey(savedDocumentDraftOwner(observed.taskId,observed.artifactId),REVISION_INSTRUCTIONS_SLOT),records=state.records.filter(record=>learningDraftKey(record.owner,record.slot)===key);if(records.length>1)throw Error('Duplicate exact instruction owner.');return records[0];}
 return {...entry,modelCommands,modelEvents:events,instructionRecord,
  bindDocument(value:{taskId:string;artifactId:string}){if(owner)throw Error('The QA document owner is already bound.');owner={...value};},
  async enableScriptedConnection(){if(!owner)throw Error('Public document creation must precede synthetic provider admission.');fixture.configured=true;events.push({kind:'synthetic-configured-provider-status-no-live-connection'});await fixture.emit({type:'connection',connection:{provider:'Meta',configured:true,endpoint:'fixture://scripted-revision',model:'scripted-core-boundary',state:'ready',detail:'Scripted QA transport only. No live provider or host IPC.',specialized:{sam:'disabled',computer:'disabled'}}});},
  holdNextRevisionReply(){if(!owner||reply)throw Error('One publicly bound scripted revision reply may be held.');const wait=gate();held.add(wait);reply=wait;return wait;},
  holdNextRevisionUntilStop(){if(!owner||untilStop)throw Error('One publicly bound scripted revision runner may await Stop.');const wait=gate();held.add(wait);untilStop=wait;return wait;},
  failNextRevision(){if(!owner||failNext)throw Error('One scripted request failure may be armed.');failNext=true;},
  failNextInstructionRawWrite(){if(!owner||failRaw)throw Error('One exact instruction raw write may fail.');failRaw=true;},
  loseNextInstructionTombstone(){if(!owner||loseTombstone)throw Error('One exact instruction tombstone acknowledgement may be lost.');loseTombstone=true;},
  async settleModelBoundary(){await Promise.allSettled([...pending]);await entry.settleWork();},
  async close(){for(const wait of held)wait.release();await Promise.allSettled([...pending]);await entry.close();},
 };
}
