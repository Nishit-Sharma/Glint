import type {Page} from '@playwright/test';
import {localTaskDurableEntry} from './local-task-durable-app.fixture';
import {SAVED_DOCUMENT_DRAFT_SLOT,savedDocumentDraftOwner} from '../../src/shared/saved-document-draft';
import {learningDraftKey} from '../../src/shared/learning-drafts';
function gate(){let release!:()=>void,reached=false;const waiting=new Promise<void>(done=>{release=done;});return {waiting,release,enter(){reached=true;},reached:()=>reached};}
/** All normal data comes from public controls. Only the exact saved-document
 * response and tombstone transport are controlled after its public creation. */
export async function savedDocumentRecoveryEntry(page:Page){
 const entry=await localTaskDurableEntry(page),{fixture}=entry,invoke=fixture.invoke.bind(fixture),save=fixture.learningDrafts.save.bind(fixture.learningDrafts);
 const held=new Set<ReturnType<typeof gate>>(),pending=new Set<Promise<unknown>>(),boundaryEvents:Array<{kind:string;detail?:unknown}>=[];
 let owner:{taskId:string;artifactId:string}|undefined,reply:ReturnType<typeof gate>|undefined,discardFault:'reject-before'|'lose-after'|undefined;
 function matches(taskId:string,artifactId:string|undefined){return !!owner&&owner.taskId===taskId&&owner.artifactId===artifactId;}
 fixture.invoke=command=>{
  const work=(async()=>{const result=await invoke(command);if(command.type==='artifact.save'&&matches(command.taskId,command.artifact.artifactId)&&reply){const wait=reply;reply=undefined;wait.enter();boundaryEvents.push({kind:'actual-document-core-commit-response-held',detail:{taskId:command.taskId,artifactId:command.artifact.artifactId,expectedRevision:command.artifact.expectedRevision}});await wait.waiting;held.delete(wait);}return result;})();
  pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});return work;
 };
 fixture.learningDrafts.save=async(...args)=>{
  const identity=args[0],document='kind' in identity&&identity.kind==='saved-document-edit'&&matches(identity.taskId,identity.artifactId)&&args[1]===SAVED_DOCUMENT_DRAFT_SLOT;
  if(!document||args[4]!==null)return save(...args);
  const fault=discardFault;discardFault=undefined;
  if(fault==='reject-before'){boundaryEvents.push({kind:'document-tombstone-transport-rejected-before-write'});throw Error('Owned document tombstone transport rejected before storage.');}
  const result=await save(...args);boundaryEvents.push({kind:'actual-document-tombstone-write',detail:result.kind});
  if(fault==='lose-after'){boundaryEvents.push({kind:'document-tombstone-acknowledgement-lost-after-write'});throw Error('Owned document tombstone acknowledgement lost after storage.');}return result;
 };
 async function documentRecord(){if(!owner)throw Error('Bind only the publicly created document first.');const read=await fixture.learningDrafts.read();if(read.kind!=='available')throw Error('Expected actual readable document sidecar.');const key=learningDraftKey(savedDocumentDraftOwner(owner.taskId,owner.artifactId),SAVED_DOCUMENT_DRAFT_SLOT),records=read.records.filter(record=>learningDraftKey(record.owner,record.slot)===key);if(records.length>1)throw Error('Duplicate exact document owner.');return records[0];}
 return {...entry,boundaryEvents,documentRecord,
  bindDocument(value:{taskId:string;artifactId:string}){if(owner)throw Error('The owned document is already bound.');owner={...value};},
  holdNextDocumentReply(){if(!owner||reply)throw Error('One publicly bound document response may be held.');const wait=gate();reply=wait;held.add(wait);return wait;},
  failNextDiscard(fault:'reject-before'|'lose-after'){if(!owner||discardFault)throw Error('One publicly bound document tombstone failure may be armed.');discardFault=fault;},
  async settleBoundary(){await Promise.allSettled([...pending]);await entry.settleWork();},
  async close(){for(const wait of held)wait.release();await Promise.allSettled([...pending]);await entry.close();},
 };
}
