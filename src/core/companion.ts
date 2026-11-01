import {STUDY_SET_MIME,readStudyCommand,readStudySet,parseStudyNotes,type StudyCommand} from '../shared/study-workbench';
import {studyMaterial,studyDeck,studyProgress,studyProgressEvents,updateStudyState,STUDY_MODULE_ID} from './study-workbench';
import {readRequestInferenceSelection,requestInferenceSaved,sameRequestInference,type RequestInferencePolicy,type RequestInferenceSelection,type RequestInferenceState} from '../shared/request-inference';
import {readPdfPageImages,pdfPageMessages,type PdfPageAddResult} from '../shared/pdf-page-import';
import {readProviderModelReceipt} from '../shared/response-model';
import {INSTRUCTION_SKILL_MIME,InstructionSkillReferenceSchema,readInstructionSkillSave,readInstructionSkillBody,instructionSkillSelection,sameInstructionSkill,type InstructionSkillReference,type InstructionSkillEntry,type InstructionSkillSelection,type InstructionSkillCatalog} from '../shared/instruction-skill';
import {instructionSkillEntry,instructionSkillReference,instructionSkillCatalog} from './instruction-skills';
import {defaultCliPreferences,readCliPreferencesUpdate,type CliPreferences,type CliPreferencesCommit} from '../shared/cli-preferences';
import {emptyLocalContacts,readLocalContactsChange,type LocalContacts,type LocalContactsCommit} from '../shared/local-contacts';
import {changeLocalContacts} from './local-contacts';
import {assertConversationAttempt,readConversationAttemptReceipt} from '../shared/conversation-attempt';
import {QueuedFollowupSchema,pendingFollowups,type QueuedFollowup} from '../shared/queued-followup';
import {readRecurringWorkChange,RECURRING_WORK_LIMIT,RECURRING_HISTORY_LIMIT,type RecurringWork} from '../shared/recurring-work';
import {emptyUserMemory,readMemoryChange,readMemoryUse,MEMORY_CHANGED,MEMORY_FACT_COUNT,type UserMemory,type MemoryCommit} from '../shared/user-memory';
import {selectTaskMemory as selectScopedTaskMemory,taskMemoryConsent,readMemoryPreviewInput} from '../shared/project-memory';
import {readBrowserContinuationReceipt,readBrowserContinuationInput,prepareBrowserContinuation,pendingBrowserContinuation,sameBrowserContinuationInput,type BrowserContinuationInput,type BrowserContinuationReceipt,type BrowserContinuationRelease,reviewBrowserContinuation,BROWSER_CONTINUATION_CHANGED,BROWSER_CONTINUATION_UNCERTAIN} from '../shared/browser-continuation';
import {helperSourceBatchPreview,readHelperSourceBatchSave,readHelperSourceBatchInspection,helperSourceBatchRequestIdentity,HELPER_SOURCE_REPORT_TITLE,type HelperSourceBatchRequest,type HelperSourceBatchInspection,type HelperSourceBatchSaved,type HelperSourceBatchSaveInspection} from '../shared/helper-source-batch';
import {encodeHelperSourceReportReceipt,findHelperSourceReportReceipt} from './helper-source-report-receipt';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { Effect, Either,Schema } from 'effect';
import { isCode, readState, StateValidationError, writeState, type State } from './store';
import { parseModelDraft } from './model-drafts';
import {sourceResumeContext} from './source-resume';
import type {DocumentBinding,DocumentReconciliation} from '../shared/document-source';
import { projectTaskDialogue, projectConversationAttemptDialogue } from './task-dialogue';
import {readResponseBranchInput,responseBranchSnapshot} from './response-branch';
import {readTaskHandoffSave,taskHandoffIdentity,taskHandoffPreview,type TaskHandoffSaved} from '../shared/task-handoff';
import {readTaskArchiveChange} from '../shared/task-archive';
import {defaultReadingPreferences,readReadingCommand,type ReadingPreferences,type ReadingCommit} from '../shared/reading-view';
import {readProjectCommand,projectSourceMatches,projectSourceVersion,projectSourceInTask,projectSourceCopyExists,type ProjectCommand,type ProjectReply,type Project,type ProjectSource,type ProjectPins,type ProjectSidebar,type ProjectInstructions} from '../shared/projects';
import {taskDeletionBlocker,type ProjectDeletePreview,type ProjectDeleteResult} from '../shared/project-deletion';
import {encodeProjectDeletion,findProjectDeletion} from './project-deletion-receipt';
import {encodeProjectCreation,findProjectCreation} from './project-creation-receipt';
import {readPublicGithubCommand,readPublicGithubSnapshot,samePublicGithubConnection,PUBLIC_GITHUB_README_LIMIT,type PublicGithubCapture,type PublicGithubCommand,type PublicGithubResult} from '../shared/public-github';
import {encodeTaskHandoffReceipt,findTaskHandoffReceipt} from './task-handoff-receipt';
import {readSavedDocumentSourceInput,savedDocumentSourcePreview,type SavedDocumentSourceResult} from '../shared/saved-document-source';
import {browserReviewNotesPreview,readBrowserReviewNotesSave,BROWSER_REVIEW_NOTES_TITLE,type BrowserReviewNotesSaved} from '../shared/browser-review-notes';
import {encodeBrowserReviewNotesReceipt,findBrowserReviewNotesReceipt} from './browser-review-notes-receipt';
import {parseModuleAnswer} from './interactive-modules';
import {assertRawModuleOperationAllowed} from '../shared/module-contract';
import {readLocalTaskStart,type LocalTaskStartResult} from '../shared/local-task-start';
import {encodeLocalStartReceipt,findLocalStartReceipt,type LocalStartReceipt} from './local-start-receipt';
import {readSourceTextSave,readSourceTextSaveInspection,sourceTextSaveBindingText,SOURCE_TEXT_SAVE_BINDING_PREFIX,type SourceTextSaveConfirmed,type SourceTextSaveInspection,type SourceTextSaveInspectionInput} from '../shared/source-text-save';
import {encodeSourceTextSaveReceipt,findSourceTextSaveReceipt,sourceTextSaveClaim,type SourceTextSaveReceipt} from './source-text-save-receipt';
import { emptyTaskSession, recoverTaskSession,readComposerDraft,ComposerKindSchema,BrowserStartReceiptSchema,type BrowserStartReceipt,type ComposerDraft,type ComposerKind, type TaskSession } from './task-session';
import type {
  ArtifactInput, ArtifactRevision, CompanionOptions, ExportAction, ExportEvidence,
  ProcedureInput, RequestContext, RequestInput, RequestOutput, RequestRecord, ResumeResult,
  SourceInput, SourceRef, SourceVersion, Source, Task, ArtifactRef, SessionCommitGuard,ModuleStateRef,
} from './types';
export { evaluateExperiment } from './experiments';
export type * from './types';

export class CompanionError extends Error {
  constructor(readonly code: 'not-found' | 'conflict' | 'stale' | 'invalid' | 'closed' | 'busy', message: string) {
    super(message); this.name = 'CompanionError';
  }
}
const reject = (code: CompanionError['code'], message: string): never => { throw new CompanionError(code, message); };
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const clone = <T>(value: T): T => structuredClone(value);
const latest = <T>(values: T[]): T => { const value = values.at(-1); if (!value) return reject('invalid', 'Missing revision.'); return value; };
const text = (value: string, label: string, max = 1_000_000) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || value.includes('\0')) reject('invalid', `${label} must contain 1–${max} characters without null bytes.`);
};
const nowIso = (now: () => Date) => now().toISOString();
const ComposerTextSchema=Schema.String.pipe(Schema.maxLength(100_000),Schema.filter(value=>!value.includes('\0')));
const ComposerValueSchema=Schema.Struct({text:ComposerTextSchema,kind:ComposerKindSchema});
const SubmittedComposerDraftSchema=Schema.Struct({text:ComposerTextSchema,kind:ComposerKindSchema,revision:Schema.Int.pipe(Schema.nonNegative())});
const sameComposerDraft=(a:ComposerDraft,b:ComposerDraft)=>a.revision===b.revision&&a.text===b.text&&a.kind===b.kind;
function requestSession(session:TaskSession):TaskSession{
  const {instructionSkill:_instructionSkill,requestInference:_requestInference,speech:_speech,readingPreferences:_readingPreferences,draft:_draft,draftKind:_kind,draftRevision:_revision,browserContinuationAttempt:_pendingBrowserInput,queuedFollowups:_queuedInput,...rest}=session;
  return {...rest,draft:''};
}
const artifactBytes = (artifact: { content: string; mimeType?: string; encoding?: 'utf8' | 'base64' }): Buffer => {
  if (artifact.encoding !== undefined && artifact.encoding !== 'utf8' && artifact.encoding !== 'base64') reject('invalid', 'Unsupported artifact encoding.');
  if (artifact.encoding === 'base64') {
    if (artifact.mimeType !== 'image/png' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(artifact.content)) reject('invalid', 'Base64 artifacts must contain a PNG image.');
    const bytes = Buffer.from(artifact.content, 'base64');
    if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString('ascii', 12, 16) !== 'IHDR') reject('invalid', 'Invalid PNG signature or header.');
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (width < 1 || height < 1 || width > 16_384 || height > 16_384 || width * height > 40_000_000) reject('invalid', 'PNG dimensions exceed bounds.');
    return bytes;
  }
  if (artifact.mimeType?.startsWith('image/')) reject('invalid', 'Image artifacts require explicit base64 PNG bytes.');
  return Buffer.from(artifact.content);
};

/** One host-owned instance owns one local store. All ledger mutations are serialized. */
export class Companion {
  private state: State;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly controllers = new Map<string, AbortController>();
  private memoryChanges = new AbortController();
  private readonly projectMemoryChanges = new Map<string,AbortController>();
  private closed = false;
  private persistenceFailed = false;
  private constructor(private readonly options: CompanionOptions, state: State, private readonly releaseLock: () => Promise<void>) { this.state = state; }

  static async open(options: CompanionOptions): Promise<Companion> {
    if (!isAbsolute(options.dataDir)) reject('invalid', 'The task store must have an absolute host-owned path.');
    await mkdir(options.dataDir, { recursive: true, mode: 0o700 });
    const lockPath = join(options.dataDir, 'store.lock');
    const token = randomUUID();
    const claimLock = async () => {
      const file = await open(lockPath, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify({ pid: process.pid, token })); await file.sync(); } finally { await file.close(); }
    };
    try { await claimLock(); } catch (error) {
      if (!isCode(error, 'EEXIST')) throw error;
      const recoveryPath = join(options.dataDir, 'store.lock.recovery');
      let recovery;
      try { recovery = await open(recoveryPath, 'wx', 0o600); } catch (cause) {
        if (isCode(cause, 'EEXIST')) return reject('busy', 'Task store recovery is already guarded; inspect its owner before removing the recovery file.');
        throw cause;
      }
      try {
        await recovery.writeFile(JSON.stringify({ pid: process.pid, token })); await recovery.sync();
        // Serialize the stale-owner read and unlink; abandoned guards require manual inspection.
        let owner: unknown, missing = false;
        try { owner = JSON.parse(await readFile(lockPath, 'utf8')); } catch (cause) {
          if (isCode(cause, 'ENOENT')) missing = true;
          else return reject('busy', 'Task store lock is unreadable; inspect the owner before removing it.');
        }
        if (!missing) {
          if (!owner || typeof owner !== 'object' || !('pid' in owner) || typeof owner.pid !== 'number' || !Number.isInteger(owner.pid) || owner.pid <= 0) return reject('busy', 'Task store lock has an unknown owner.');
          try { process.kill(owner.pid, 0); return reject('busy', 'Another companion owns the task store.'); } catch (cause) { if (!isCode(cause, 'ESRCH')) throw cause; }
          await rm(lockPath);
        }
        try { await claimLock(); } catch (cause) {
          if (isCode(cause, 'EEXIST')) return reject('busy', 'Another companion owns the task store.');
          throw cause;
        }
      } finally { await recovery.close(); await rm(recoveryPath); }
    }
    const release = async () => {
      const owner: unknown = JSON.parse(await readFile(lockPath, 'utf8'));
      if (owner && typeof owner === 'object' && 'token' in owner && owner.token === token) await rm(lockPath);
    };
    try {
      await options.beforeReadState?.();
      const state = await Effect.runPromise(readState(options.dataDir));
      const time = nowIso(options.now ?? (() => new Date()));
      for(const schedule of state.recurringWork??[]){
        if(schedule.mode==='response'&&schedule.enabled){schedule.enabled=false;schedule.revision++;schedule.updatedAt=time;schedule.blockedReason='Restart retired recurring response authorization. Review history and Resume to authorize future occurrences in this app session.';}
        for(const run of schedule.history)if(run.status==='running'){
          const request=state.tasks.find(task=>task.id===run.taskId)?.requests.find(request=>request.id===run.requestId);
          if(request?.status==='completed'&&request.artifactId){run.status='completed';run.artifactId=request.artifactId;}
          else{run.status='interrupted';run.error='The previous response outcome is unverified. It will not be retried. Review the task before authorizing future occurrences.';}
        }
      }
      for (const task of state.tasks) {
        if (task.session) task.session = recoverTaskSession(task.session);
        for (const request of task.requests) if (request.status === 'running') {
          request.status = 'interrupted'; request.finishedAt = time;
          request.error = 'The host stopped before the result was committed. Start a new request explicitly.';
        }
        for (const source of task.sources) if (latest(source.versions).kind === 'window') {
          source.freshness = 'refresh-required'; source.staleReason = 'Window content must be captured again after restart.';
        }
        for (const action of task.actions) {
          if (action.status === 'executing') { action.status = 'uncertain'; action.error = 'The host stopped during export. Inspect the exact destination before another action.'; }
          else if (action.status === 'approved' || action.status === 'proposed') { action.status = 'retired'; action.error = 'Restart retired the unexecuted proposal.'; action.approvalRetiredAt = time; }
        }
      }
      await Effect.runPromise(writeState(options.dataDir, state));
      return new Companion(options, state, release);
    } catch (error) { await release(); throw error; }
  }

  private time() { return nowIso(this.options.now ?? (() => new Date())); }
  private exclusive<T>(operation: () => Promise<T> | T): Promise<T> {
    const result = this.queue.then(() => {
      if (this.closed) reject('closed', 'Companion is closed.');
      if (this.persistenceFailed) reject('closed', 'Task-store persistence failed. Close and reopen to reconcile the durable state.');
      return operation();
    });
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
  private async commit<T>(operation: (draft: State) => T): Promise<T> {
    const draft = clone(this.state), result = operation(draft);
    const persisted = await Effect.runPromise(Effect.either(writeState(this.options.dataDir, draft)));
    if (Either.isLeft(persisted)) {
      if (!(persisted.left instanceof StateValidationError)) {
        this.persistenceFailed = true;
        for (const controller of this.controllers.values()) controller.abort();
      }
      throw persisted.left;
    }
    this.state = draft;
    return clone(result);
  }
  getRecurringWork():Promise<RecurringWork[]>{return this.exclusive(()=>clone(this.state.recurringWork??[]));}
  contentSnapshot():Promise<State>{return this.exclusive(()=>clone(this.state));}
  changeRecurringWork(input:unknown,assertCurrent:()=>void=()=>{}):Promise<RecurringWork[]>{
    const change=clone(readRecurringWorkChange(input));
    return this.exclusive(()=>this.commit(state=>{
      assertCurrent();const items=state.recurringWork??=[],current=items.find(item=>item.id===change.id);
      if((current?.revision??0)!==change.expectedRevision)reject('conflict','This schedule changed. Reload schedules before saving again. Your edits are kept.');
      if(current?.revision===Number.MAX_SAFE_INTEGER)reject('conflict','Schedule revision limit reached. Saved work was preserved.');
      if(change.kind==='save'){
        if(!current&&items.length>=RECURRING_WORK_LIMIT)reject('invalid',`Keep at most ${RECURRING_WORK_LIMIT} schedules. Delete one before adding another.`);
        const time=this.time(),next:RecurringWork={id:change.id,revision:(current?.revision??0)+1,title:change.title.trim(),instruction:change.instruction,intervalHours:change.intervalHours,nextDueAt:change.nextDueAt,...(change.mode?{mode:change.mode}:{}),...(change.timeZone?{timeZone:change.timeZone}:{}),enabled:change.mode==='response'?false:current?.enabled??true,createdAt:current?.createdAt??time,updatedAt:time,history:current?.history??[]};
        if(current)items[items.indexOf(current)]=next;else items.push(next);
      }else{
        if(!current)reject('not-found','This schedule is no longer available.');
        if(change.kind==='delete')items.splice(items.indexOf(current!),1);
        else{if(change.kind==='resume'&&current!.history.some(run=>run.status==='running'))reject('conflict','Wait for the scheduled response to finish before resuming.');current!.enabled=change.kind==='resume';delete current!.blockedReason;current!.revision++;current!.updatedAt=this.time();}
      }
      state.recurringWork=items;return items;
    }));
  }
  /** Atomically prepare one unsent local task per due schedule; no provider or effect authority. */
  prepareRecurringWork(assignedBotId:string,assertCurrent:()=>void=()=>{},authorizedResponseIds:readonly string[]=[]):Promise<string[]>{
    text(assignedBotId,'Companion ID',200);
    return this.exclusive(()=>{
      assertCurrent();const time=this.time(),now=Date.parse(time),due=(this.state.recurringWork??[]).filter(item=>item.enabled&&Date.parse(item.nextDueAt)<=now&&(item.mode!=='response'||authorizedResponseIds.includes(item.id))&&!item.history.some(run=>run.status==='running'));
      if(!due.length)return [];
      return this.commit(state=>{
        assertCurrent();const ids:string[]=[];
        for(const id of due.map(item=>item.id)){
          const item=state.recurringWork!.find(item=>item.id===id)!;
          if(item.revision===Number.MAX_SAFE_INTEGER)reject('conflict','Schedule revision limit reached. Saved work was preserved.');
          const interval=item.intervalHours*3_600_000,start=Date.parse(item.nextDueAt),skipped=Math.floor((now-start)/interval),scheduledFor=new Date(start+skipped*interval).toISOString();
          const nextDueAt=new Date(start+(skipped+1)*interval).toISOString();
          const task:Task={id:randomUUID(),title:item.title,goal:item.instruction,assignedBotId,status:'active',createdAt:time,updatedAt:time,sources:[],artifacts:[],requests:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false},session:{...emptyTaskSession(),draft:item.instruction,draftKind:'explain',draftRevision:1}};
          if(item.mode==='response')task.session=emptyTaskSession();
          state.tasks.push(task);ids.push(task.id);item.history.push({taskId:task.id,scheduledFor,preparedAt:time,skipped,...(item.mode==='response'?{status:'running' as const,requestId:randomUUID()}:{} )});item.history=item.history.slice(-RECURRING_HISTORY_LIMIT);item.nextDueAt=nextDueAt;item.revision++;item.updatedAt=time;
        }
        return ids;
      });
    });
  }
  finishRecurringWork(scheduleId:string,taskId:string,requestId:string):Promise<void>{
    return this.exclusive(()=>this.commit(state=>{
      const schedule=state.recurringWork?.find(item=>item.id===scheduleId),run=schedule?.history.find(item=>item.taskId===taskId&&item.requestId===requestId);
      if(!schedule||!run||run.status!=='running')return;
      const request=state.tasks.find(task=>task.id===taskId)?.requests.find(item=>item.id===requestId);
      if(request?.status==='completed'&&request.artifactId){run.status='completed';run.artifactId=request.artifactId;}
      else{run.status=request?.status==='interrupted'?'interrupted':'failed';run.error='The scheduled response was not confirmed. It may already have reached the service. Review the task; this occurrence will not be retried.';schedule.enabled=false;schedule.revision++;}
      schedule.updatedAt=this.time();
    }));
  }
  haltRecurringWork(id:string,reason:string):Promise<void>{
    text(reason,'Schedule pause reason',500);
    return this.exclusive(()=>this.commit(state=>{const item=state.recurringWork?.find(item=>item.id===id);if(!item||item.mode!=='response')return;item.enabled=false;item.blockedReason=reason;item.revision++;item.updatedAt=this.time();}));
  }

  getCliPreferences():Promise<CliPreferences>{return this.exclusive(()=>clone(this.state.cliPreferences??defaultCliPreferences()));}
  getReadingPreferences(taskId:string):Promise<ReadingPreferences>{return this.exclusive(()=>clone(this.task(this.state,taskId).session?.readingPreferences??defaultReadingPreferences()));}
  changeReadingPreferences(input:unknown,assertCurrent:()=>void=()=>{}):Promise<ReadingCommit>{
    const value=readReadingCommand(input);if(value.type!=='reading.preferences.set')throw Error('Invalid reading preference change.');
    return this.exclusive<ReadingCommit>(()=>{
      assertCurrent();const task=this.task(this.state,value.taskId),current=task.session?.readingPreferences??defaultReadingPreferences();
      if(value.expectedRevision!==current.revision)return {kind:'conflict',current:clone(current)};
      if(current.revision===Number.MAX_SAFE_INTEGER)reject('conflict','Reading preference revision limit reached. Saved work was preserved.');
      return this.commit(state=>{assertCurrent();const owner=this.task(state,value.taskId),session=owner.session??emptyTaskSession(),next={...value.preferences,revision:current.revision+1};owner.session={...session,revision:session.revision+1,readingPreferences:next};return {kind:'saved' as const,current:next};});
    });
  }
  changeCliPreferences(input:unknown,assertCurrent:()=>void=()=>{}):Promise<CliPreferencesCommit>{
    const value=readCliPreferencesUpdate(input);
    return this.exclusive<CliPreferencesCommit>(()=>{
      const current=this.state.cliPreferences??defaultCliPreferences();
      if(value.expectedRevision!==current.revision)return {kind:'conflict',current:clone(current)};
      if(current.revision===Number.MAX_SAFE_INTEGER)reject('conflict','CLI preference revision limit reached. Saved work was preserved.');
      return this.commit(state=>{assertCurrent();const next:CliPreferences={revision:current.revision+1,format:value.format,includeSourceLabels:value.includeSourceLabels,excerptChars:value.excerptChars};state.cliPreferences=next;return {kind:'saved' as const,current:next};});
    });
  }

  getLocalContacts():Promise<LocalContacts>{return this.exclusive(()=>clone(this.state.localContacts??emptyLocalContacts()));}

  changeLocalContacts(input:unknown,assertCurrent:()=>void=()=>{}):Promise<LocalContactsCommit>{
    const value=clone(readLocalContactsChange(input));
    return this.exclusive(async()=>{
      const current=this.state.localContacts??emptyLocalContacts();
      if(value.expectedRevision!==current.revision)return {kind:'conflict',current:clone(current)};
      return this.commit(state=>{
        assertCurrent();const next=changeLocalContacts(current,value.change,{id:randomUUID(),time:this.time()});
        state.localContacts=next;return {kind:'saved' as const,current:next};
      });
    });
  }

  getUserMemory():Promise<UserMemory>{return this.exclusive(()=>clone(this.state.userMemory??emptyUserMemory()));}

  changeUserMemory(input:unknown,assertCurrent:()=>void=()=>{}):Promise<MemoryCommit>{
    const value=clone(readMemoryChange(input));
    return this.exclusive(async()=>{
      const current=this.state.userMemory??emptyUserMemory();
      if(value.expectedRevision!==current.revision)return {kind:'conflict',current:clone(current)};
      if(current.revision===Number.MAX_SAFE_INTEGER)reject('conflict','Memory revision limit reached. Saved memory is preserved.');
      const result=await this.commit(state=>{
        assertCurrent();const next={...clone(current),revision:current.revision+1},change=value.change;
        if(change.kind==='enabled')next.enabled=change.enabled;
        else if(change.kind==='forget'){
          if(!next.facts.some(fact=>fact.id===change.id))reject('not-found','This memory fact was already forgotten.');
          next.facts=next.facts.filter(fact=>fact.id!==change.id);
        }else{
          const previous=change.id?next.facts.find(fact=>fact.id===change.id):undefined;
          if(change.id&&!previous)reject('not-found','This memory fact was already forgotten.');
          if(!previous&&next.facts.length>=MEMORY_FACT_COUNT)reject('invalid',`Keep at most ${MEMORY_FACT_COUNT} memory facts. Forget a fact before adding another.`);
          const fact={id:previous?.id??randomUUID(),revision:next.revision,text:change.text,topics:[...new Set(change.topics.map(topic=>topic.trim()).filter(Boolean))]};
          if(previous)next.facts[next.facts.indexOf(previous)]=fact;else next.facts.push(fact);
        }
        state.userMemory=next;return {kind:'saved' as const,current:next};
      });
      this.memoryChanges.abort(Error(MEMORY_CHANGED));this.memoryChanges=new AbortController();
      return result;
    });
  }

  private selectTaskMemory(task:Task,prompt:string){return selectScopedTaskMemory(this.state.userMemory??emptyUserMemory(),{title:task.title,goal:task.goal,prompt},task.projectId?this.project(this.state,task.projectId):undefined);}
  previewUserMemory(input:unknown){
    const value=readMemoryPreviewInput(input);
    return this.exclusive(()=>clone(value.taskId?this.selectTaskMemory(this.task(this.state,value.taskId),value.prompt):selectScopedTaskMemory(this.state.userMemory??emptyUserMemory(),{title:'',goal:'',prompt:value.prompt})));
  }
  leaseUserMemory(taskId:string,prompt:string){
    return this.exclusive(()=>{
      const task=this.task(this.state,taskId),memory=this.state.userMemory??emptyUserMemory(),project=task.projectId?this.project(this.state,task.projectId):undefined,projectId=task.projectId,projectRevision=project?.revision,projectMemoryRevision=project?.memory?.revision??0;
      if(project&&!this.projectMemoryChanges.has(project.id))this.projectMemoryChanges.set(project.id,new AbortController());
      const selected=clone(this.selectTaskMemory(task,prompt)),projectSignal=project?this.projectMemoryChanges.get(project.id)!.signal:undefined,signal=projectSignal?AbortSignal.any([this.memoryChanges.signal,projectSignal]):this.memoryChanges.signal;
      const assertCurrent=()=>{const current=this.state.tasks.find(item=>item.id===taskId),currentProject=current?.projectId?this.state.projects?.find(item=>item.id===current.projectId):undefined;if(signal.aborted||memory.revision!==(this.state.userMemory??emptyUserMemory()).revision||!current||current.projectId!==projectId||currentProject?.revision!==projectRevision||(currentProject?.memory?.revision??0)!==projectMemoryRevision)throw Error(MEMORY_CHANGED);};
      return {...selected,signal,assertCurrent,consent:taskMemoryConsent(selected),check:async()=>{assertCurrent();}};
    });
  }

  private task(state: State, id: string): Task {
    const task = state.tasks.find(item => item.id === id);
    if (!task) return reject('not-found', 'Task was not found.');
    return task;
  }
  private refs(task: Task): SourceRef[] {
    return task.sources.map(source => { const version = latest(source.versions); return { sourceId: source.id, version: source.currentVersion, digest: version.digest }; });
  }
  private requestRefs(task: Task, sourceIds: string[] | undefined): SourceRef[] {
    if (sourceIds === undefined) return this.refs(task);
    if (!Array.isArray(sourceIds) || sourceIds.length > 64) reject('invalid', 'Select at most 64 source IDs.');
    const selected = new Set<string>();
    for (const id of sourceIds) {
      text(id, 'Source ID', 200);
      if (selected.has(id)) reject('invalid', 'Duplicate selected source ID.');
      if (!task.sources.some(source => source.id === id)) reject('invalid', 'Selected source was not found in this task.');
      selected.add(id);
    }
    return this.refs(task).filter(ref => selected.has(ref.sourceId));
  }
  private validRefs(task: Task, refs: SourceRef[]) {
    if (new Set(refs.map(ref => ref.sourceId)).size !== refs.length) reject('invalid', 'Duplicate source reference.');
    for (const ref of refs) {
      const source = task.sources.find(item => item.id === ref.sourceId);
      if (!source || source.freshness !== 'fresh' || source.currentVersion !== ref.version || latest(source.versions).digest !== ref.digest) reject('stale', 'Source changed or requires an explicit refresh.');
    }
  }
  private validArtifacts(task:Task,refs:ArtifactRef[]) {
    if(!Array.isArray(refs)||refs.length>8||new Set(refs.map(ref=>ref?.artifactId)).size!==refs.length)reject('invalid','Choose at most eight unique basis artifacts.');
    for(const ref of refs){
      if(!ref||Object.keys(ref).sort().join(',')!=='artifactId,digest,revision')reject('invalid','Invalid basis artifact reference.');
      text(ref.artifactId,'Basis artifact ID',200);text(ref.digest,'Basis artifact digest',128);
      if(!Number.isSafeInteger(ref.revision)||ref.revision<1)reject('invalid','Invalid basis artifact revision.');
      const artifact=task.artifacts.find(item=>item.id===ref.artifactId),current=artifact?.revisions.at(-1);
      if(!current||current.revision!==ref.revision||current.digest!==ref.digest)reject('conflict','A cited artifact changed. Review the current source before continuing.');
    }
  }
  private validModuleStates(task:Task,refs:ModuleStateRef[]){
    if(!Array.isArray(refs)||refs.length>8||new Set(refs.map(ref=>`${ref?.artifactId}/${ref?.moduleId}`)).size!==refs.length)reject('invalid','Choose at most eight unique module observations.');
    for(const ref of refs){
      if(!ref||Object.keys(ref).sort().join(',')!=='artifactId,artifactRevision,moduleId,stateRevision')reject('invalid','Invalid module observation reference.');
      text(ref.artifactId,'Module artifact ID',200);text(ref.moduleId,'Module ID',80);
      if(!Number.isSafeInteger(ref.artifactRevision)||ref.artifactRevision<1||!Number.isSafeInteger(ref.stateRevision)||ref.stateRevision<0)reject('invalid','Invalid module observation revision.');
      const artifact=task.artifacts.find(a=>a.id===ref.artifactId),current=artifact?.revisions.at(-1);
      if(!current||current.revision!==ref.artifactRevision||current.mimeType!=='application/vnd.window-companion.modules+json')return reject('conflict','The observed interactive artifact changed.');
      const answer=parseModuleAnswer(JSON.parse(current.content));
      if(!answer.modules.some(m=>m.id===ref.moduleId))reject('conflict','The observed module is unavailable.');
      const saved=task.session?.moduleStates.find(s=>s.artifactId===ref.artifactId&&s.artifactRevision===ref.artifactRevision&&(s.moduleId===ref.moduleId||(s.moduleId===undefined&&answer.modules.length===1)));
      if((saved?.state.revision??0)!==ref.stateRevision)reject('conflict','The observed module state changed. Recompute the explanation.');
    }
  }
  private retire(task: Task, reason: string, sourceId?: string) {
    for (const action of task.actions) if ((action.status === 'proposed' || action.status === 'approved') && (!sourceId || action.proposal.sourceRefs.some(ref => ref.sourceId === sourceId))) {
      action.status = 'retired'; action.error = reason; action.approvalRetiredAt = this.time();
    }
  }
  private cancelRunning(task: Task, reason: string, sourceId?: string) {
    for (const request of task.requests) if (request.status === 'running' && (!sourceId || request.sourceRefs.some(ref => ref.sourceId === sourceId))) {
      request.status = 'cancelled'; request.error = reason; request.finishedAt = this.time();
    }
  }
  private abortCancelled(task: Task) {
    for (const request of task.requests) if (request.status === 'cancelled') this.controllers.get(request.id)?.abort();
  }
  private claimRequest(state: State, id: string) {
    text(id, 'Request ID', 200);
    const digest = hash(id);
    if (state.usedRequestIds.includes(digest)) reject('conflict', 'Request ID was already used.');
    state.usedRequestIds.push(digest);
  }

  listTasks(): Promise<Task[]> { return this.exclusive(() => clone(this.state.tasks)); }
  getTask(taskId: string): Promise<Task> { return this.exclusive(() => clone(this.task(this.state, taskId))); }
  private project(state:State,id:string):Project{
    const project=state.projects?.find(item=>item.id===id);
    return project??reject('not-found','Project was not found.');
  }
  private projectGuidance(state:State,task:Task):ProjectInstructions|undefined{
    if(!task.projectId)return undefined;
    const project=this.project(state,task.projectId);
    return {projectId:project.id,name:project.name,revision:project.revision,text:project.instructions};
  }
  private cancelProjectRequests(task:Task){
    this.cancelRunning(task,'Project context changed during this request.');
  }
  private projectJoinSources(state:State,project:Project,tasks:Task[],expectedRevision?:number,expectedSetting?:boolean){
    const enabled=project.addSharedSourcesOnJoin??false;
    if(expectedRevision!==undefined&&expectedRevision!==project.revision||expectedSetting!==undefined&&expectedSetting!==enabled)reject('conflict','The project or shared-source setting changed. Review the join again.');
    if(!enabled)return [];
    if(expectedRevision===undefined||expectedSetting!==true)reject('conflict','Review the project shared sources before joining. Nothing was moved.');
    return project.sources.filter(shared=>tasks.some(task=>!projectSourceCopyExists(task,project.id,shared))).map(shared=>{
      const version=projectSourceVersion(shared,state.tasks),original=state.tasks.find(task=>task.id===shared.taskId)?.sources.find(source=>source.id===shared.reference.sourceId);
      if(!version||version.kind==='window'||original?.freshness!=='fresh')return reject('conflict','A shared project source is unavailable or needs review. Nothing was moved. Review the shared sources before joining again.');
      return {shared,version};
    });
  }
  private appendProjectSource(task:Task,project:Project,shared:ProjectSource,version:SourceVersion){
    const browserContext=task.session?.browserContext;
    this.cancelProjectRequests(task);
    const ref=this.appendSource(task,{kind:version.kind,label:version.label,content:version.content,role:version.role});
    if(browserContext)task.session={...task.session!,browserContext};
    task.sources.find(source=>source.id===ref.sourceId)!.projectOrigin={projectId:project.id,sourceKey:shared.id,taskId:shared.taskId,reference:clone(shared.reference),copiedVersion:ref.version,copiedDigest:ref.digest};
  }
  projectCommand<C extends ProjectCommand>(input:C,assertCurrent?:()=>void):Promise<ProjectReply<C>>;
  projectCommand(input:unknown,assertCurrent:()=>void=()=>{}):Promise<Project[]|Project|ProjectPins|ProjectSidebar|UserMemory|MemoryCommit|Task|Task[]|ProjectDeletePreview|ProjectDeleteResult>{
    const command=readProjectCommand(input);
    return this.exclusive(async()=>{
      assertCurrent();
      if(command.type==='projects.list')return clone(this.state.projects??[]);
      if(command.type==='projects.delete.preview'){
        const project=this.project(this.state,command.projectId);
        return clone({projectId:project.id,revision:project.revision,snapshot:hash(JSON.stringify(project)),name:project.name,sharedSources:project.sources.length,memoryFacts:project.memory?.facts.length??0,members:this.state.tasks.filter(task=>task.projectId===project.id).sort((a,b)=>a.id.localeCompare(b.id)).map(task=>({taskId:task.id,title:task.title,snapshot:hash(JSON.stringify(task)),blocker:taskDeletionBlocker(task)}))});
      }
      if(command.type==='projects.delete'){
        const intent='project-delete:v1:'+hash(command.intentId),intentHash=hash(intent),members=[...command.members].sort((a,b)=>a.taskId.localeCompare(b.taskId)),payloadDigest=hash(JSON.stringify({...command,members})),previous=findProjectDeletion(this.state.usedRequestIds,intentHash);
        if(previous){if(previous.payloadDigest!==payloadDigest)reject('conflict','This deletion intent has a different project, choice or snapshot.');return clone(previous.result);}
        const selected=this.state.tasks.filter(task=>task.projectId===command.projectId),result=await this.commit(state=>{
          assertCurrent();const project=this.project(state,command.projectId),tasks=state.tasks.filter(task=>task.projectId===project.id).sort((a,b)=>a.id.localeCompare(b.id));
          if(project.revision!==command.expectedRevision||hash(JSON.stringify(project))!==command.expectedSnapshot||tasks.length!==members.length||tasks.some((task,index)=>task.id!==members[index].taskId||hash(JSON.stringify(task))!==members[index].snapshot))reject('conflict','The project or its member tasks changed. Reload the deletion review before deleting.');
          if(command.mode==='delete-tasks')for(const task of tasks){const blocker=taskDeletionBlocker(task);if(blocker)reject('conflict',blocker);}
          const pins=state.projectPins;if(pins?.projectIds.includes(project.id)&&pins.revision===Number.MAX_SAFE_INTEGER)reject('invalid','Project star revision limit reached. Saved work is kept.');
          this.claimRequest(state,intent);
          const result:ProjectDeleteResult={kind:'deleted',projectId:project.id,mode:command.mode,taskIds:tasks.map(task=>task.id)};
          if(command.mode==='delete-tasks'){const ids=new Set(result.taskIds);state.tasks=state.tasks.filter(task=>!ids.has(task.id));}
          else for(const task of tasks){delete task.projectId;this.cancelProjectRequests(task);task.updatedAt=this.time();}
          state.projects=state.projects!.filter(item=>item.id!==project.id);
          if(pins?.projectIds.includes(project.id))state.projectPins={revision:pins.revision+1,projectIds:pins.projectIds.filter(id=>id!==project.id)};
          state.usedRequestIds.push(encodeProjectDeletion({intentHash,payloadDigest,result}));return result;
        });
        this.projectMemoryChanges.get(command.projectId)?.abort(Error(MEMORY_CHANGED));this.projectMemoryChanges.delete(command.projectId);
        for(const task of selected)for(const request of task.requests)this.controllers.get(request.id)?.abort();
        return result;
      }
      if(command.type==='projects.memory.get')return clone(this.project(this.state,command.projectId).memory??emptyUserMemory());
      if(command.type==='projects.memory.change'){
        const current=this.project(this.state,command.projectId).memory??emptyUserMemory();
        if(command.expectedRevision!==current.revision)return {kind:'conflict' as const,current:clone(current)};
        if(current.revision===Number.MAX_SAFE_INTEGER)reject('conflict','Project memory revision limit reached. Saved facts are preserved.');
        const result=await this.commit(state=>{
          assertCurrent();const project=this.project(state,command.projectId),next={...clone(current),revision:current.revision+1},change=command.change;
          if(change.kind==='enabled')next.enabled=change.enabled;
          else if(change.kind==='save'){
            const previous=change.id?next.facts.find(fact=>fact.id===change.id):undefined;
            if(change.id&&!previous)reject('not-found','This project memory fact is no longer available.');
            if(!previous&&next.facts.length>=MEMORY_FACT_COUNT)reject('invalid','The project memory fact limit is reached. Edit an existing fact.');
            const fact={id:previous?.id??randomUUID(),revision:next.revision,text:change.text,topics:[...new Set(change.topics.map(topic=>topic.trim()).filter(Boolean))]};
            if(previous)next.facts[next.facts.indexOf(previous)]=fact;else next.facts.push(fact);
          }else reject('invalid','Project memory supports explicit saved facts and opt-in only.');
          project.memory=next;return {kind:'saved' as const,current:next};
        });
        this.projectMemoryChanges.get(command.projectId)?.abort(Error(MEMORY_CHANGED));this.projectMemoryChanges.set(command.projectId,new AbortController());return result;
      }
      if(command.type==='projects.pins.get')return clone(this.state.projectPins??{revision:0,projectIds:[]});
      if(command.type==='projects.sidebar.get')return clone(this.state.projectSidebar??{revision:0,collapsed:false});
      if(command.type==='projects.sidebar.set')return this.commit(state=>{
        assertCurrent();const sidebar=state.projectSidebar??{revision:0,collapsed:false};
        if(sidebar.collapsed===command.collapsed)return sidebar;
        if(sidebar.revision!==command.expectedRevision)reject('conflict','Projects visibility changed. Reload projects before trying again.');
        if(sidebar.revision===Number.MAX_SAFE_INTEGER)reject('invalid','Projects visibility revision limit reached. Your saved preference is kept.');
        const saved={revision:sidebar.revision+1,collapsed:command.collapsed};state.projectSidebar=saved;return saved;
      });
      if(command.type==='projects.pins.set')return this.commit(state=>{
        assertCurrent();this.project(state,command.projectId);
        const pins=state.projectPins??{revision:0,projectIds:[]};
        if(pins.projectIds.includes(command.projectId)===command.pinned)return pins;
        if(pins.revision!==command.expectedRevision)reject('conflict','Project stars changed. Reload projects before trying again.');
        if(pins.revision===Number.MAX_SAFE_INTEGER)reject('invalid','Project star revision limit reached. Your saved stars are kept.');
        const saved={revision:pins.revision+1,projectIds:command.pinned?[...pins.projectIds,command.projectId]:pins.projectIds.filter(id=>id!==command.projectId)};
        state.projectPins=saved;return saved;
      });
      if(command.type==='projects.assign.bulk'){
        const result=await this.commit(state=>{
          assertCurrent();const destination=command.projectId?this.project(state,command.projectId):undefined;
          const selected=command.tasks.map(entry=>this.task(state,entry.taskId));
          if(selected.every(task=>(task.projectId??null)===command.projectId))return {tasks:selected,movedTaskIds:[] as string[]};
          for(let index=0;index<selected.length;index++)if((selected[index].projectId??null)!==command.tasks[index].expectedProjectId)reject('conflict','A selected task moved to another project. Clear the selection and review it again.');
          const moved=selected.filter(task=>(task.projectId??null)!==command.projectId);
          const copies=destination?this.projectJoinSources(state,destination,moved,command.expectedProjectRevision,command.expectedAddSharedSourcesOnJoin):[];
          for(const task of moved){
            if(command.projectId)task.projectId=command.projectId;else delete task.projectId;
            this.cancelProjectRequests(task);task.updatedAt=this.time();
            if(destination)for(const {shared,version} of copies)if(!projectSourceCopyExists(task,destination.id,shared))this.appendProjectSource(task,destination,shared,version);
          }
          return {tasks:selected,movedTaskIds:moved.map(task=>task.id)};
        });
        const moved=new Set(result.movedTaskIds);for(const task of result.tasks)if(moved.has(task.id))this.abortCancelled(task);
        return result.tasks;
      }
      if(command.type==='projects.create'&&command.intentId){
        const intent='project-create:v1:'+hash(command.intentId),intentHash=hash(intent),name=command.name.trim(),payloadDigest=hash(JSON.stringify({name,includeTask:command.includeTask??null})),previous=findProjectCreation(this.state.usedRequestIds,intentHash);
        if(previous){
          if(previous.payloadDigest!==payloadDigest)reject('conflict','This creation was already submitted with a different name or task. Check the original creation or start a new one.');
          const project=this.state.projects?.find(item=>item.id===previous.projectId);
          if(!project||command.includeTask&&!this.state.tasks.some(task=>task.id===command.includeTask!.taskId&&task.projectId===project.id))return reject('conflict','This project was created, but the project or its task membership is no longer available. No replacement was created.');
          return clone(project);
        }
        const result=await this.commit(state=>{
          assertCurrent();const task=command.includeTask?this.task(state,command.includeTask.taskId):undefined;
          if(task&&(task.projectId??null)!==command.includeTask!.expectedProjectId)reject('conflict','The included task moved to another project. Clear task inclusion and choose it again.');
          if(state.projects?.some(project=>project.name.toLocaleLowerCase()===name.toLocaleLowerCase()))reject('conflict','Another project already uses this name. Choose a different name for the new project.');
          this.claimRequest(state,intent);
          const time=this.time(),project:Project={id:randomUUID(),name,instructions:'',revision:1,createdAt:time,updatedAt:time,sources:[]};
          (state.projects??=[]).push(project);
          if(task){task.projectId=project.id;this.cancelProjectRequests(task);task.updatedAt=time;}
          state.usedRequestIds.push(encodeProjectCreation({intentHash,payloadDigest,projectId:project.id}));return {project,task};
        });
        if(result.task)this.abortCancelled(result.task);
        return result.project;
      }
      const result=await this.commit(state=>{
        assertCurrent();
        if(command.type==='projects.create'){
          const name=command.name.trim(),existing=state.projects?.find(project=>project.name.toLocaleLowerCase()===name.toLocaleLowerCase());
          if(existing)return existing;
          const time=this.time(),project:Project={id:randomUUID(),name,instructions:'',revision:1,createdAt:time,updatedAt:time,sources:[]};
          (state.projects??=[]).push(project);return project;
        }
        if(command.type==='projects.assign'){
          const task=this.task(state,command.taskId);
          const destination=command.projectId?this.project(state,command.projectId):undefined;
          if((task.projectId??null)===command.projectId)return task;
          if((task.projectId??null)!==command.expectedProjectId)reject('conflict','This task moved to another project. Reload before moving it again.');
          const copies=destination?this.projectJoinSources(state,destination,[task],command.expectedProjectRevision,command.expectedAddSharedSourcesOnJoin):[];
          if(command.projectId)task.projectId=command.projectId;else delete task.projectId;
          this.cancelProjectRequests(task);task.updatedAt=this.time();
          if(destination)for(const {shared,version} of copies)if(!projectSourceCopyExists(task,destination.id,shared))this.appendProjectSource(task,destination,shared,version);
          return task;
        }
        const project=this.project(state,command.projectId);
        if(command.type==='projects.update'&&project.name===command.name.trim()&&project.instructions===command.instructions&&(project.useAccountMemory??true)===(command.useAccountMemory??project.useAccountMemory??true)&&(project.addSharedSourcesOnJoin??false)===(command.addSharedSourcesOnJoin??project.addSharedSourcesOnJoin??false))return project;
        if(command.type!=='projects.sources.update'&&project.revision!==command.expectedRevision)reject('conflict','This project changed. Reload its saved details before trying again.');
        if(command.type==='projects.update'){
          const guidanceUnchanged=project.name===command.name.trim()&&project.instructions===command.instructions&&(project.useAccountMemory??true)===(command.useAccountMemory??project.useAccountMemory??true);
          if(command.addSharedSourcesOnJoin!==undefined&&(command.expectedAddSharedSourcesOnJoin===undefined||command.expectedAddSharedSourcesOnJoin!==(project.addSharedSourcesOnJoin??false)))reject('conflict','The shared-source setting changed. Reload saved project details before saving.');
          const name=command.name.trim();
          if(state.projects?.some(other=>other.id!==project.id&&other.name.toLocaleLowerCase()===name.toLocaleLowerCase()))reject('conflict','Another project already uses this name.');
          project.name=name;project.instructions=command.instructions;
          if(command.useAccountMemory!==undefined)project.useAccountMemory=command.useAccountMemory;
          if(command.addSharedSourcesOnJoin!==undefined)project.addSharedSourcesOnJoin=command.addSharedSourcesOnJoin;
          if(guidanceUnchanged){project.updatedAt=this.time();return project;}
          for(const task of state.tasks)if(task.projectId===project.id)this.cancelProjectRequests(task);
        }else if(command.type==='projects.sources.add'){
          const task=this.task(state,command.taskId);
          if(task.projectId!==project.id)reject('conflict','Move this task into the project before sharing its source.');
          this.validRefs(task,[command.reference]);
          const version=task.sources.find(source=>source.id===command.reference.sourceId)!.versions.at(-1)!;
          if(version.kind==='window')reject('invalid','Share saved text or images. Window captures stay with their original task.');
          if(project.sources.some(source=>projectSourceMatches(source,task.id,command.reference)))return project;
          if(project.sources.length>=64)reject('invalid','A project can share at most 64 saved sources.');
          project.sources.push({id:randomUUID(),taskId:task.id,reference:clone(command.reference)});
        }else if(command.type==='projects.sources.update'){
          const shared=project.sources.find(source=>source.id===command.sourceKey);
          if(!shared)return reject('not-found','This shared source was removed.');
          const task=this.task(state,command.taskId);
          if(task.projectId!==project.id)reject('conflict','Move the original task into this project before updating its shared source.');
          if(shared.taskId!==task.id||shared.reference.sourceId!==command.reference.sourceId||command.expectedReference.sourceId!==command.reference.sourceId)reject('conflict','This shared source changed. Review its saved versions again.');
          if(command.reference.version<=command.expectedReference.version)reject('invalid','Choose a newer saved version of the same source.');
          this.validRefs(task,[command.reference]);
          const version=task.sources.find(source=>source.id===command.reference.sourceId)!.versions.at(-1)!;
          if(version.kind==='window')reject('invalid','Share saved text or images. Window captures stay with their original task.');
          if(projectSourceMatches(shared,task.id,command.reference))return project;
          if(project.revision!==command.expectedRevision)reject('conflict','This project changed. Review its saved versions again.');
          if(!projectSourceMatches(shared,task.id,command.expectedReference))reject('conflict','This shared source changed. Review its saved versions again.');
          project.sources=project.sources.map(source=>source.id===shared.id?{...source,reference:clone(command.reference)}:source);
        }else if(command.type==='projects.sources.remove'){
          if(!project.sources.some(source=>source.id===command.sourceKey))return project;
          project.sources=project.sources.filter(source=>source.id!==command.sourceKey);
        }else{
          const task=this.task(state,command.taskId),shared=project.sources.find(source=>source.id===command.sourceKey);
          if(task.projectId!==project.id)reject('conflict','Move this task into the project before adding its sources.');
          if(!shared)return reject('not-found','This shared source was removed.');
          const version=projectSourceVersion(shared,state.tasks);
          if(!version||version.kind==='window')return reject('not-found','The original saved source is unavailable. Existing task copies are kept.');
          if(projectSourceInTask(task,project.id,shared))return task;
          this.appendProjectSource(task,project,shared,version);
          return task;
        }
        if(project.revision===Number.MAX_SAFE_INTEGER)reject('invalid','Project revision limit reached. Your saved project is kept.');
        project.revision++;project.updatedAt=this.time();return project;
      });
      for(const task of this.state.tasks)this.abortCancelled(task);
      return result;
    });
  }
  previewStudyNotes(taskId:string,reference:SourceRef){
    return this.exclusive(()=>{const task=this.task(this.state,taskId),material=studyMaterial(task,reference);return clone({material,...parseStudyNotes(material.text)});});
  }
  getStudyView(taskId:string,reference:ArtifactRef){
    return this.exclusive(()=>{const task=this.task(this.state,taskId),view=studyDeck(task,reference,false);let current=true;try{this.validArtifacts(task,[reference]);if(view.deck.material)this.validRefs(task,[view.deck.material.reference]);}catch{current=false;}return clone({task,reference,...view,current,progress:studyProgress(view.deck,view.state),events:studyProgressEvents(task)});});
  }
  saveStudySet(input:Extract<StudyCommand,{type:'study.create'|'study.save'}>,assertCurrent:()=>void=()=>{}){
    const command=readStudyCommand(input);if(command.type!=='study.create'&&command.type!=='study.save')throw Error('Choose a study-set save action.');
    return this.exclusive(()=>this.commit(state=>{assertCurrent();const task=this.task(state,command.taskId);if(task.status!=='active'||task.archive)throw Error('Resume the owning task before saving study work.');
      if(command.type==='study.create'){
        const duplicate=task.artifacts.find(artifact=>{try{return artifact.revisions[0]?.mimeType===STUDY_SET_MIME&&readStudySet(JSON.parse(artifact.revisions[0].content)).creationId===command.intentId;}catch{return false;}});if(duplicate)return clone({task,artifactId:duplicate.id,revision:latest(duplicate.revisions)});
        const body=readStudySet({kind:'study-set',schemaVersion:1,creationId:command.intentId,name:'New study set',cards:[]}),saved=this.appendArtifact(task,{title:body.name,content:JSON.stringify(body),mimeType:STUDY_SET_MIME,sourceRefs:[]});return clone({task,...saved});
      }
      const artifact=task.artifacts.find(artifact=>artifact.id===command.artifactId),previous=artifact&&latest(artifact.revisions);if(!previous||previous.mimeType!==STUDY_SET_MIME)throw Error('The saved study set is unavailable.');const before=readStudySet(JSON.parse(previous.content)),material=studyMaterial(task,command.reference),body=readStudySet({kind:'study-set',schemaVersion:1,creationId:before.creationId,name:command.name,material,cards:command.cards}),content=JSON.stringify(body);
      if(previous.content===content&&(command.expectedRevision===previous.revision||command.expectedRevision===previous.revision-1))return clone({task,artifactId:artifact.id,revision:previous});
      const saved=this.appendArtifact(task,{artifactId:artifact.id,expectedRevision:command.expectedRevision,title:body.name,content,mimeType:STUDY_SET_MIME,sourceRefs:[{...material.reference}]});return clone({task,...saved});
    }));
  }
  actOnStudy(input:Extract<StudyCommand,{type:'study.action'}>,assertCurrent:()=>void=()=>{}){
    const command=readStudyCommand(input);if(command.type!=='study.action')throw Error('Choose a study action.');
    return this.exclusive(()=>this.commit(state=>{assertCurrent();const task=this.task(state,command.taskId);if(task.status!=='active'||task.archive)throw Error('Resume the owning task before continuing study.');this.validArtifacts(task,[command.deckRef]);const view=studyDeck(task,command.deckRef);if(view.deck.material)this.validRefs(task,[view.deck.material.reference]);const updated=updateStudyState(view.deck,command.deckRef,view.state,command.action,this.time());
      if(JSON.stringify(updated)!==JSON.stringify(view.state)){const session=task.session??emptyTaskSession();task.session={...session,revision:session.revision+1,moduleStates:[...session.moduleStates.filter(item=>!(item.artifactId===command.deckRef.artifactId&&item.artifactRevision===command.deckRef.revision&&item.moduleId===STUDY_MODULE_ID)),{artifactId:command.deckRef.artifactId,artifactRevision:command.deckRef.revision,moduleId:STUDY_MODULE_ID,state:updated}]};task.updatedAt=this.time();}
      return clone({task,reference:command.deckRef,deck:view.deck,state:updated,current:true,progress:studyProgress(view.deck,updated),events:studyProgressEvents(task)});
    }));
  }
  listInstructionSkills():Promise<InstructionSkillEntry[]>{
    return this.exclusive(()=>clone(instructionSkillCatalog(this.state.tasks).entries));
  }
  getInstructionSkillCatalog(taskId:string):Promise<InstructionSkillCatalog>{
    return this.exclusive(()=>{const task=this.task(this.state,taskId),catalog=instructionSkillCatalog(this.state.tasks),invocation=instructionSkillSelection(task.session);if(invocation.selection&&!catalog.entries.some(entry=>sameInstructionSkill(entry.reference,invocation.selection))){try{catalog.entries.push(instructionSkillEntry(this.state.tasks,invocation.selection));}catch{if(!catalog.unavailable.some(item=>sameInstructionSkill(item.reference,invocation.selection)))catalog.unavailable.push({reference:invocation.selection,name:'Pinned saved version',reason:'This exact pinned skill or resource is unavailable. Clear the choice or inspect its owner file.'});}}return clone({...catalog,invocation});});
  }
  saveInstructionSkill(input:unknown,assertCurrent:()=>void=()=>{}):Promise<InstructionSkillEntry>{
    const value=readInstructionSkillSave(input);
    return this.exclusive(()=>this.commit(state=>{
      assertCurrent();const task=this.task(state,value.taskId);if(task.status!=='active'||task.archive)throw Error('Open and resume the skill owner task before saving.');
      const artifact=value.artifactId?task.artifacts.find(item=>item.id===value.artifactId):undefined;
      if(value.artifactId&&!artifact)throw Error('The saved skill was not found in its owner task.');
      const previous=artifact?readInstructionSkillBody(JSON.parse(latest(artifact.revisions).content)):undefined;
      if(artifact&&latest(artifact.revisions).mimeType!==INSTRUCTION_SKILL_MIME)throw Error('This saved file is not an instruction skill.');
      const body={kind:'instruction-skill' as const,schemaVersion:1 as const,creationId:previous?.creationId??value.intentId,name:value.name,description:value.description,instructions:value.instructions,resources:value.resources},content=JSON.stringify(body);
      if(!artifact){
        const duplicate=task.artifacts.find(item=>{try{return item.revisions[0]?.mimeType===INSTRUCTION_SKILL_MIME&&readInstructionSkillBody(JSON.parse(item.revisions[0].content)).creationId===value.intentId;}catch{return false;}});
        if(duplicate){if(duplicate.revisions[0].content!==content)throw Error('This skill creation attempt already has different instructions or resources.');return instructionSkillEntry(state.tasks,instructionSkillReference(task.id,duplicate.id,duplicate.revisions[0]));}
      }else if(latest(artifact.revisions).content===content&&(value.expectedRevision===latest(artifact.revisions).revision||value.expectedRevision===latest(artifact.revisions).revision-1))return instructionSkillEntry(state.tasks,instructionSkillReference(task.id,artifact.id,latest(artifact.revisions)));
      this.validRefs(task,[...value.resources]);
      const saved=this.appendArtifact(task,{...(artifact?{artifactId:artifact.id,expectedRevision:value.expectedRevision}:{}),title:value.name,content,mimeType:INSTRUCTION_SKILL_MIME,sourceRefs:[...value.resources]});
      return instructionSkillEntry(state.tasks,instructionSkillReference(task.id,saved.artifactId,saved.revision));
    }));
  }
  setInstructionSkill(taskId:string,expectedRevision:number,selection:InstructionSkillReference|null,assertCurrent:()=>void=()=>{}):Promise<InstructionSkillSelection>{
    return this.exclusive(()=>this.commit(state=>{
      assertCurrent();const task=this.task(state,taskId),session=task.session??emptyTaskSession(),current=instructionSkillSelection(session);
      if(task.status!=='active'||task.archive||session.browserContext)throw Error('Use skills in an active ordinary text task.');
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||current.revision!==expectedRevision)throw Error('This task skill choice changed. Reload before choosing again.');
      if(selection)instructionSkillEntry(state.tasks,selection);
      if(sameInstructionSkill(current.selection,selection))return clone(current);
      if(current.revision===Number.MAX_SAFE_INTEGER)throw Error('The skill choice revision limit was reached.');
      const saved={revision:current.revision+1,selection:selection?{...selection}:null};task.session={...session,instructionSkill:saved,revision:session.revision+1};task.updatedAt=this.time();return clone(saved);
    }));
  }
  instructionSkillContext(taskId:string,selection?:InstructionSkillReference|null):Promise<InstructionSkillEntry|undefined>{
    return this.exclusive(()=>{const task=this.task(this.state,taskId),chosen=selection===undefined?instructionSkillSelection(task.session).selection:selection;return chosen?clone(instructionSkillEntry(this.state.tasks,chosen)):undefined;});
  }
  previewInstructionRequest(taskId:string,expectedRevision:number,sourceIds:string[]):Promise<Omit<RequestContext,'signal'>>{
    return this.exclusive(()=>{const task=this.task(this.state,taskId);if(task.status!=='active'||task.archive||task.session?.browserContext)throw Error('Inspect skills in an active ordinary text task.');const current=instructionSkillSelection(task.session);if(current.revision!==expectedRevision)throw Error('The task skill choice changed. Reload before inspecting.');const sourceRefs=this.requestRefs(task,sourceIds),chosen=current.selection,selected=new Set(sourceIds);return clone({task:{...task,sources:task.sources.filter(source=>selected.has(source.id)).map(source=>({...source,versions:[latest(source.versions)]}))},sourceRefs,taskHistory:projectTaskDialogue(task,'skill-composition-preview',sourceRefs),projectInstructions:this.projectGuidance(this.state,task),...(chosen?{instructionSkill:instructionSkillEntry(this.state.tasks,chosen)}:{})});});
  }
  setRequestInference(taskId:string,expectedRevision:number,selection:RequestInferenceSelection|null,assertCurrent:()=>void=()=>{},policy:RequestInferencePolicy='fixed'):Promise<RequestInferenceState>{
    const chosen=selection===null?null:readRequestInferenceSelection(selection);
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)return Promise.reject(Error('The model choice revision is invalid.'));
    if(policy!=='fixed'&&policy!=='automatic')return Promise.reject(Error('Choose Fixed or Automatic routing.'));
    return this.exclusive(()=>this.commit(state=>{
      assertCurrent();const task=this.task(state,taskId),session=task.session??emptyTaskSession(),current=requestInferenceSaved(session);
      if(task.status!=='active'||task.archive)throw Error('Open and resume the task before changing its model choice.');
      if(current.revision!==expectedRevision)throw Error('The task model choice changed. Reopen its settings before changing it.');
      if(policy==='automatic'&&!sameRequestInference(current.selection,chosen))throw Error('Automatic routing keeps the existing fixed choice. Choose Fixed before changing that choice.');
      if(sameRequestInference(current.selection,chosen)&&(current.policy??'fixed')===policy)return {taskId,...current};
      if(current.revision===Number.MAX_SAFE_INTEGER)throw Error('The model choice revision limit was reached.');
      const saved={revision:current.revision+1,selection:chosen,...(policy==='automatic'?{policy}:{})};task.session={...session,requestInference:saved,revision:session.revision+1};task.updatedAt=this.time();return {taskId,...saved};
    }));
  }
  markResponseContextChanged(taskId:string,assertCurrent:()=>void=()=>{}):Promise<Task>{
    return this.exclusive(()=>this.commit(state=>{assertCurrent();const task=this.task(state,taskId),session=task.session??emptyTaskSession();if(task.status!=='active'||task.archive||(session.contextRevision??0)===Number.MAX_SAFE_INTEGER)throw Error('The response context cannot be changed for this task.');task.session={...session,revision:session.revision+1,contextRevision:(session.contextRevision??0)+1};task.updatedAt=this.time();return task;}));
  }
  saveComposerDraft(taskId:string,expectedDraftRevision:number,value:{text:string;kind:ComposerKind}):Promise<ComposerDraft>{
    let next:typeof ComposerValueSchema.Type;
    try{next=Schema.decodeUnknownSync(ComposerValueSchema,{onExcessProperty:'error'})(value);}catch{return Promise.reject(new CompanionError('invalid','Composer draft needs bounded text and a supported request type.'));}
    return this.exclusive(()=>this.commit(state=>{
      const task=this.task(state,taskId),session=task.session??emptyTaskSession(),current=readComposerDraft(session);
      if(!Number.isSafeInteger(expectedDraftRevision)||expectedDraftRevision<0||expectedDraftRevision!==current.revision)return reject('conflict','Composer draft changed. Reload it before saving.');
      if(current.revision>=Number.MAX_SAFE_INTEGER)return reject('invalid','Composer draft revision limit reached. Keep the current draft for recovery.');
      task.session={...session,draft:next.text,draftKind:next.kind,draftRevision:current.revision+1,revision:session.revision+1};task.updatedAt=this.time();
      return readComposerDraft(task.session);
    }));
  }
  private queuedBasis(task:Task,sourceRefs:readonly SourceRef[],precedingRequestIds:readonly string[]):string{
    const allowed=new Set(precedingRequestIds);
    const artifacts=task.artifacts.filter(artifact=>!task.requests.some(request=>allowed.has(request.id)&&request.answer?.artifactId===artifact.id&&request.answer.revision===artifact.revisions.at(-1)?.revision&&request.answer.digest===artifact.revisions.at(-1)?.digest));
    return hash(JSON.stringify({taskId:task.id,title:task.title,goal:task.goal,status:task.status,assignedBotId:task.assignedBotId,project:this.projectGuidance(this.state,task),contextRevision:task.session?.contextRevision??0,browser:task.session?.browserContext??null,sourceRefs,checkpoints:task.checkpoints,artifacts:artifacts.map(artifact=>({id:artifact.id,revisions:artifact.revisions.map(revision=>({revision:revision.revision,digest:revision.digest}))})),requests:task.requests.filter(request=>!allowed.has(request.id))}));
  }
  queuedFollowupBasis(taskId:string,sourceRefs:readonly SourceRef[],precedingRequestIds:readonly string[]):Promise<string>{
    return this.exclusive(()=>{const task=this.task(this.state,taskId);this.validRefs(task,[...sourceRefs]);return this.queuedBasis(task,sourceRefs,precedingRequestIds);});
  }
  saveQueuedFollowup(taskId:string,value:QueuedFollowup,expectedRevision:number,submittedDraft?:ComposerDraft):Promise<Task>{
    const item=Schema.decodeUnknownSync(QueuedFollowupSchema,{onExcessProperty:'error'})(value);
    return this.exclusive(()=>this.commit(state=>{
      const task=this.task(state,taskId),session=task.session??emptyTaskSession(),items=[...(session.queuedFollowups??[])],index=items.findIndex(entry=>entry.id===item.id),existing=items[index];
      if(task.status!=='active'||task.session?.browserContext)reject('conflict','Queued follow-ups support active text tasks only. Browser actions require their own review.');
      if(existing?.revision===item.revision&&JSON.stringify(existing)===JSON.stringify(item))return task;
      if((existing?.revision??0)!==expectedRevision||existing&&(existing.status==='dispatched'||existing.status==='cancelled')||item.revision!==expectedRevision+1)reject('conflict','This queued follow-up changed. Reload before editing.');
      if(this.queuedBasis(task,item.sourceRefs,item.precedingRequestIds)!==item.basis)reject('conflict','The queued context changed before saving. Your text is kept.');
      this.validRefs(task,[...item.sourceRefs]);
      if(!sameInstructionSkill(existing?existing.instructionSkill:instructionSkillSelection(session).selection,item.instructionSkill))reject('conflict','The queued skill choice changed. Keep its original pinned selection.');
      if(item.instructionSkill)instructionSkillEntry(state.tasks,item.instructionSkill);
      if(index<0){if(items.length>=100)reject('invalid','This task has reached its saved follow-up limit.');if(state.usedRequestIds.includes(item.id)||state.tasks.some(owner=>owner.id!==taskId&&owner.session?.queuedFollowups?.some(entry=>entry.id===item.id)))reject('conflict','This follow-up identity is already used.');items.push(item);}else{items[index]=item;for(let position=index+1;position<items.length;position++)if(items[position].status==='queued')items[position]={...items[position],status:'held',reason:'An earlier queued message changed. Review this follow-up before queueing it again.'};}
      const current=readComposerDraft(session),consume=submittedDraft&&sameComposerDraft(current,submittedDraft)&&submittedDraft.text.trim()===item.prompt.trim()&&submittedDraft.kind===item.kind;
      task.session={...session,queuedFollowups:items,revision:session.revision+1,...(consume?{draft:'',draftKind:current.kind,draftRevision:current.revision}:{})};task.updatedAt=this.time();return task;
    }));
  }
  cancelQueuedFollowup(taskId:string,id:string,expectedRevision:number):Promise<Task>{
    return this.exclusive(()=>this.commit(state=>{const task=this.task(state,taskId),session=task.session??emptyTaskSession(),items=[...(session.queuedFollowups??[])],index=items.findIndex(item=>item.id===id),item=items[index];if(!item||item.revision!==expectedRevision||!['queued','held'].includes(item.status))reject('conflict','This follow-up changed. Reload before cancelling.');items[index]={...item,revision:item.revision+1,status:'cancelled',reason:'Cancelled before dispatch.'};for(let position=index+1;position<items.length;position++)if(items[position].status==='queued')items[position]={...items[position],status:'held',reason:'An earlier queued message was cancelled. Review this follow-up before queueing it again.'};task.session={...session,revision:session.revision+1,queuedFollowups:items};task.updatedAt=this.time();return task;}));
  }
  holdQueuedFollowups(taskId:string,reason:string,id?:string):Promise<Task>{
    return this.exclusive(()=>this.commit(state=>{const task=this.task(state,taskId),session=task.session??emptyTaskSession(),items=session.queuedFollowups?.map(item=>item.status==='queued'&&(!id||item.id===id)?{...item,status:'held' as const,reason}:item);if(items)task.session={...session,revision:session.revision+1,queuedFollowups:items};return task;}));
  }
  /** Host-only CAS, not a renderer/model command. Uses the same atomic ledger as requests/exports. */
  replaceSession(taskId: string, expectedRevision: number, next: TaskSession, guard?:SessionCommitGuard): Promise<TaskSession> {
    next = clone(next);
    guard=guard===undefined?undefined:clone(guard);
    return this.exclusive(() => this.commit(state => {
      const task = this.task(state, taskId), current = task.session ?? emptyTaskSession();
      if (!Number.isInteger(expectedRevision) || expectedRevision !== current.revision) reject('conflict', 'Task session changed. Reload before saving your state.');
      if(guard){if(guard.requireActive===true&&task.status!=='active')reject('conflict','Resume the owning task before committing its local manifest.');this.validRefs(task,guard.sourceRefs);this.validArtifacts(task,guard.artifactRefs);}
      task.session = { ...next, revision: current.revision + 1 };
      task.updatedAt = this.time(); return task.session;
    }));
  }
  clearBrowserContext(taskId: string): Promise<Task> {
    return this.exclusive(() => this.commit(state => { const task=this.task(state,taskId),{browserContext:_browser,...session}=task.session??emptyTaskSession();task.session={...session,revision:session.revision+1,contextRevision:(session.contextRevision??0)+1};task.updatedAt=this.time();return task; }));
  }
  recordBrowserStartingSite(taskId:string,requestId:string,origin:string):Promise<BrowserStartReceipt>{
    const receipt=Schema.decodeUnknownSync(BrowserStartReceiptSchema,{onExcessProperty:'error'})({origin,recordedAt:this.time()});
    return this.exclusive(()=>{
      const task=this.task(this.state,taskId),request=task.requests.find(request=>request.id===requestId);
      if(task.status!=='active'||request?.kind!=='browser'||request.status!=='running')return reject('conflict','The browser request stopped before its starting website was recorded.');
      if(task.session?.runs.some(run=>run.origin===origin&&run.operations.some(operation=>operation.status==='uncertain')))return reject('conflict','An earlier action on this site has an uncertain outcome. Inspect and reconcile it before opening another browser.');
      if(request.browserStart){if(request.browserStart.origin!==origin)return reject('conflict','The browser starting website changed. Start a new request.');return clone(request.browserStart);}
      if(task.session?.runs.some(run=>run.id===requestId))return reject('conflict','The browser already has an observation. Its starting website cannot be recorded retrospectively.');
      return this.commit(state=>{const task=this.task(state,taskId),request=task.requests.find(request=>request.id===requestId)!;request.browserStart=receipt;task.updatedAt=this.time();return receipt;});
    });
  }
  beginBrowserRun(taskId:string,run:Omit<TaskSession['runs'][number],'operations'>,expectedContextRevision:number):Promise<TaskSession>{
    return this.exclusive(()=>this.commit(state=>{
      const task=this.task(state,taskId),request=task.requests.find(request=>request.id===run.id),session=task.session??emptyTaskSession();
      if(task.status!=='active'||request?.kind!=='browser'||request.status!=='running')return reject('conflict','The browser request stopped before its first observation was saved.');
      if(request.browserStart&&request.browserStart.origin!==run.origin)return reject('conflict','The observed website does not match this browser request’s starting website.');
      if(session.runs.some(previous=>previous.id===run.id))return reject('conflict','This browser run already has an initial observation.');
      if(!Number.isSafeInteger(expectedContextRevision)||expectedContextRevision<0||run.initialObservation.taskId!==taskId||run.initialObservation.browserId!==run.browserId||new URL(run.initialObservation.url).origin!==run.origin)return reject('invalid','The initial browser observation does not match its request.');
      const contextRevision=session.contextRevision??0;
      task.session={...session,revision:session.revision+1,runs:[...session.runs,{...run,operations:[]}],...(contextRevision===expectedContextRevision?{contextRevision:contextRevision+1,browserContext:{origin:run.origin,url:run.initialObservation.url,requestId:run.id}}:{})};
      task.updatedAt=this.time();return task.session;
    }));
  }
  migrateBotAssignments(legacyBotId:string):Promise<void>{
    text(legacyBotId,'Companion ID',200);
    return this.exclusive(async()=>{if(this.state.tasks.some(task=>!task.assignedBotId))await this.commit(state=>{for(const task of state.tasks)task.assignedBotId??=legacyBotId;});});
  }
  assignBot(taskId:string,botId:string,expectedBotId:string):Promise<Task>{
    text(botId,'Companion ID',200);text(expectedBotId,'Previous companion ID',200);
    return this.exclusive(()=>this.commit(state=>{
      const task=this.task(state,taskId);
      if(task.assignedBotId!==expectedBotId)return reject('conflict','This task companion changed. Reload before choosing again.');
      if(task.requests.some(request=>request.status==='running')||task.actions.some(action=>['proposed','approved','executing','uncertain'].includes(action.status))||task.session?.runs.some(run=>run.operations.some(operation=>['proposed','executing','uncertain'].includes(operation.status))))return reject('busy','Change after this response or execution decision finishes.');
      task.assignedBotId=botId;return task;
    }));
  }
  ensureLocalExample(botId:string):Promise<Task>{
    text(botId,'Companion ID',200);
    return this.exclusive(()=>{
      const existing=this.state.tasks.find(task=>task.provenance==='local-example');if(existing)return clone(existing);
      return this.commit(state=>{
        const time=this.time(),task:Task={id:randomUUID(),title:'Observatory visit',goal:'Explore a bundled local example.',status:'active',assignedBotId:botId,provenance:'local-example',createdAt:time,updatedAt:time,sources:[],artifacts:[],requests:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false}};
        const sourceId=randomUUID(),summary='Doors open at 18:00. Arrive by 17:50 for orientation. The guide does not confirm your group size.',content='Bundled local example. These are sample observatory facts, not facts about the current window.\n\n'+summary,digest=hash(content);
        task.sources.push({id:sourceId,currentVersion:1,freshness:'fresh',versions:[{id:sourceId,version:1,digest,capturedAt:time,kind:'text',label:'Visit guide',role:'fact',content}]});
        this.appendArtifact(task,{title:'Before your visit',mimeType:'application/vnd.window-companion.modules+json',sourceRefs:[{sourceId,version:1,digest}],content:JSON.stringify({schemaVersion:1,markdown:summary,modules:[{id:'visit-plan',version:1,provenance:[],data:{kind:'plan',schemaVersion:1,title:'Before your visit',purpose:'A local checklist you can change and save.',items:[{id:'arrival',title:'Arrive by 17:50',detail:'Orientation begins before doors open.'},{id:'group',title:'Confirm your group size',detail:'The guide does not confirm it.'}]}}]})});
        state.tasks.push(task);return task;
      });
    });
  }
  createTask(input: { title: string; goal?: string; assignedBotId?:string }): Promise<Task> {
    return this.exclusive(() => this.commit(state => {
      text(input.title, 'Title', 200); if (input.goal) text(input.goal, 'Goal', 10_000);
      const time = this.time();
      const task: Task = { id: randomUUID(), title: input.title, goal: input.goal ?? '', status: 'active', createdAt: time, updatedAt: time, sources: [], artifacts: [], requests: [], procedures: [], checkpoints: [], actions: [], memory: { enabled: false } };
      if(input.assignedBotId){text(input.assignedBotId,'Companion ID',200);task.assignedBotId=input.assignedBotId;}
      state.tasks.push(task); return task;
    }));
  }
  /** Atomically creates ordinary local data once. Replays cannot gain provider or action authority. */
  async startLocalTask(input:unknown,assignedBotId:string,assertCurrent:()=>void=()=>{},assertNewTask:()=>void=()=>{}):Promise<LocalTaskStartResult>{
    const value=readLocalTaskStart(input),{intentId,...payload}=value,payloadDigest=hash(JSON.stringify({operation:'local-task-start',...payload})),intentHash=hash(intentId);
    text(assignedBotId,'Companion ID',200);
    const result=(task:Task,receipt:LocalStartReceipt):LocalTaskStartResult=>receipt.kind==='text'?{task,kind:'text',sourceId:receipt.targetId}:{task,kind:'draft',artifactId:receipt.targetId};
    return this.exclusive(()=>{
      assertCurrent();
      const receipt=findLocalStartReceipt(this.state.usedRequestIds,intentHash);
      if(receipt){
        if(receipt.payloadDigest!==payloadDigest)return reject('conflict','This local save was already submitted with different text. Open the saved task or start a new local save.');
        const task=this.state.tasks.find(item=>item.id===receipt.taskId);
        const source=task?.sources.find(item=>item.id===receipt.targetId);
        const artifact=task?.artifacts.find(item=>item.id===receipt.targetId);
        const targetExists=receipt.kind==='text'?source?.versions.some(version=>version.version===source.currentVersion&&version.kind==='text'):artifact?.revisions.length;
        if(!task||!targetExists)return reject('conflict','This local save was already used, but its saved task or text is no longer available. Start a new local save.');
        return clone(result(task,receipt));
      }
      return this.commit(state=>{
        assertCurrent();assertNewTask();this.claimRequest(state,intentId);
        const time=this.time(),task:Task={id:randomUUID(),title:value.title,goal:'',assignedBotId,status:'active',createdAt:time,updatedAt:time,sources:[],artifacts:[],requests:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false}};
        let targetId:string;
        if(value.kind==='text'){
          targetId=randomUUID();const source:SourceInput={kind:'text',label:value.title,content:value.content,role:'fact'};
          task.sources.push({id:targetId,currentVersion:1,freshness:'fresh',versions:[{...source,id:targetId,version:1,digest:hash(JSON.stringify(source)),capturedAt:time}]});
          task.session={...emptyTaskSession(),revision:1,contextRevision:1};
        }else{
          targetId=this.appendArtifact(task,{title:value.title,content:value.content,mimeType:'text/markdown',sourceRefs:[]}).artifactId;
        }
        const nextReceipt:LocalStartReceipt={intentHash,payloadDigest,taskId:task.id,kind:value.kind,targetId};
        // One commit owns both the ordinary claim and its opaque replay receipt.
        // Preserve every ledger string through all ordinary writes, including old readers.
        state.usedRequestIds.push(encodeLocalStartReceipt(nextReceipt));
        state.tasks.push(task);return result(task,nextReceipt);
      });
    });
  }
  /** Existing branches remain independent when their original task is later deleted. */
  async branchFromResponse(input:unknown,assignedBotId:string,assertCurrent:()=>void=()=>{}):Promise<LocalTaskStartResult>{
    const value=clone(readResponseBranchInput(input)),title=value.title.trim();if(!title)reject('invalid','Name the new task.');
    const intentId='response-branch-v1:'+hash(JSON.stringify({taskId:value.taskId,requestId:value.requestId,answer:{artifactId:value.answer.artifactId,revision:value.answer.revision,digest:value.answer.digest},title,expectedSnapshot:value.expectedSnapshot}));
    return this.startLocalTask({intentId,kind:'text',title,content:value.expectedSnapshot},assignedBotId,assertCurrent,()=>{
      const snapshot=responseBranchSnapshot(this.task(this.state,value.taskId),value);
      if(snapshot.content!==value.expectedSnapshot)reject('conflict','The copied conversation changed. Close this review and open it again before creating a task.');
    });
  }
  async deleteTask(taskId: string): Promise<void> {
    await this.exclusive(async () => {
      const task = this.task(this.state, taskId);
      await this.commit(state => { state.tasks = state.tasks.filter(item => item.id !== taskId); });
      for (const request of task.requests) this.controllers.get(request.id)?.abort();
    });
  }
  /** Host rollback only. Compare and delete in the same ledger turn, so work
   * adopted by another action can never be removed by a cancelled intake. */
  discardTaskIfUnchanged(expected: Task): Promise<boolean> {
    const snapshot = clone(expected);
    if (snapshot.artifacts.length || snapshot.requests.length || snapshot.procedures.length || snapshot.checkpoints.length || snapshot.actions.length || snapshot.memory.enabled) return Promise.resolve(false);
    return this.exclusive(async () => {
      const current = this.state.tasks.find(task => task.id === snapshot.id);
      if (!current || JSON.stringify(current) !== JSON.stringify(snapshot)) return false;
      await this.commit(state => { state.tasks = state.tasks.filter(task => task.id !== snapshot.id); });
      return true;
    });
  }
  updateTask(taskId: string, input: { title: string; goal?: string }): Promise<Task> {
    return this.exclusive(() => this.commit(state => {
      text(taskId, 'Task ID', 200);
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'title' && key !== 'goal')) reject('invalid', 'Only the task name and goal can be edited.');
      text(input.title, 'Title', 200);
      const title = input.title.trim();
      text(title, 'Title', 200);
      if (input.goal !== undefined && (typeof input.goal !== 'string' || input.goal.length > 10_000 || input.goal.includes('\0'))) reject('invalid', 'Goal must contain at most 10000 characters without null bytes.');
      const task = this.task(state, taskId);
      task.title = title;
      if (input.goal !== undefined) task.goal = input.goal;
      task.updatedAt = this.time();
      return task;
    }));
  }
  async savePublicGithubSnapshot(command:PublicGithubCapture,snapshotInput:unknown,content:string,assertCurrent:()=>void=()=>{}):Promise<PublicGithubResult>{
    const value=readPublicGithubCommand(command),snapshot=readPublicGithubSnapshot(snapshotInput);
    if(value.type!=='github.capture'||snapshot.repository!==value.repository)return reject('invalid','GitHub snapshot scope does not match the chosen repository.');
    text(content,'README text',PUBLIC_GITHUB_README_LIMIT);
    if(Buffer.byteLength(content,'utf8')>PUBLIC_GITHUB_README_LIMIT)return reject('invalid','The README exceeds 256 KiB.');
    return this.exclusive(async()=>{
      const result=await this.commit(state=>{
        assertCurrent();const task=this.task(state,value.taskId);
        if(task.status!=='active'||task.archive)return reject('conflict','Resume this task before reading GitHub.');
        if(!samePublicGithubConnection(task.publicGithub,value.expectedConnection))return reject('conflict','The GitHub connection changed. Review the current task before refreshing.');
        const connected=task.publicGithub,source=connected?task.sources.find(source=>source.id===connected.sourceId):undefined,current=source?.versions.at(-1);
        if(connected&&(!source||!current||!value.expectedSource||source.id!==value.expectedSource.sourceId||source.currentVersion!==value.expectedSource.version||current.digest!==value.expectedSource.digest||current.kind!=='text'||current.publicGithub?.repository!==connected.repository||connected.repository!==snapshot.repository))return reject('conflict','The saved GitHub source changed. Open it before refreshing, or disconnect to capture a new source.');
        if(!connected&&value.expectedSource)return reject('conflict','This source refresh no longer has a GitHub connection.');
        const unchanged=!!current&&current.content===content;
        if(source&&source.currentVersion>=Number.MAX_SAFE_INTEGER&&!unchanged)return reject('invalid','The source version limit was reached. The saved snapshot is unchanged.');
        const reference=unchanged?{sourceId:source!.id,version:current!.version,digest:current!.digest}:this.appendSource(task,{...(source?{id:source.id}:{}),kind:'text',label:snapshot.repository+' · README',content,role:'fact',publicGithub:snapshot});
        if(unchanged){source!.freshness='fresh';delete source!.staleReason;delete source!.documentChange;}
        task.publicGithub={repository:snapshot.repository,sourceId:reference.sourceId,checkedAt:snapshot.snapshotAt,readmeSha:snapshot.blobSha};task.updatedAt=this.time();
        return {task,reference,unchanged};
      });this.abortCancelled(result.task);return result;
    });
  }
  async disconnectPublicGithub(command:Extract<PublicGithubCommand,{type:'github.disconnect'}>,assertCurrent:()=>void=()=>{}):Promise<Task>{
    const value=readPublicGithubCommand(command);if(value.type!=='github.disconnect')return reject('invalid','Invalid GitHub disconnect operation.');
    return this.exclusive(()=>this.commit(state=>{assertCurrent();const task=this.task(state,value.taskId);if(!samePublicGithubConnection(task.publicGithub,value.expectedConnection))return reject('conflict','The GitHub connection changed. Review it before disconnecting.');delete task.publicGithub;task.updatedAt=this.time();return task;}));
  }
  private appendSource(task:Task,input:SourceInput):SourceRef {
    text(input.label, 'Source label', 500); text(input.content, 'Source content', 12_000_000);
    if (!['text', 'image', 'window'].includes(input.kind) || !['fact', 'style', 'inspiration'].includes(input.role)) reject('invalid', 'Invalid source kind or role.');
    if (input.kind === 'window' && (!input.windowId || !input.documentToken)) reject('invalid', 'A window source requires a host window ID and explicit capture/document token.');
    const id = input.id ?? randomUUID(), source = task.sources.find(item => item.id === id);
    const version: SourceVersion = { ...clone(input), id, version: (source?.currentVersion ?? 0) + 1, digest: hash(JSON.stringify(input)), capturedAt: this.time() };
    if (source) { source.versions.push(version); source.currentVersion = version.version; source.freshness = 'fresh'; delete source.staleReason; delete source.documentChange; }
    else task.sources.push({ id, currentVersion: 1, versions: [version], freshness: 'fresh' });
    const {browserContext:_browser,...session}=task.session??emptyTaskSession();task.session={...session,revision:session.revision+1,contextRevision:(session.contextRevision??0)+1};
    this.retire(task, 'Source refreshed.', id); this.cancelRunning(task, 'Source refreshed during request.', id);
    task.updatedAt = this.time(); return {sourceId:id,version:version.version,digest:version.digest};
  }
  private savedTextSource(input:SourceTextSaveInspectionInput,receipt:SourceTextSaveReceipt):SourceTextSaveConfirmed {
    if(receipt.taskId!==input.taskId||receipt.sourceId!==input.sourceId||receipt.version!==input.expectedSource.version+1||receipt.payloadDigest!==input.binding.slice(SOURCE_TEXT_SAVE_BINDING_PREFIX.length))return reject('conflict','This source save identity belongs to different text or a different source.');
    const task=this.task(this.state,input.taskId),source=task.sources.find(source=>source.id===input.sourceId);
    const basis=source?.versions.filter(version=>version.version===input.expectedSource.version);
    const versions=source?.versions.filter(version=>version.version===receipt.version);
    if(!source||basis?.length!==1||basis[0].kind!=='text'||basis[0].id!==source.id||basis[0].digest!==input.expectedSource.digest||versions?.length!==1||versions[0].id!==source.id||versions[0].kind!=='text'||versions[0].digest!==receipt.digest)return reject('conflict','This source save was committed, but its saved source version is no longer available.');
    return clone({kind:'confirmed',task,reference:{sourceId:receipt.sourceId,version:receipt.version,digest:receipt.digest},intentId:input.intentId,binding:input.binding});
  }
  async saveTextSource(input:unknown,assertCurrent:()=>void=()=>{}):Promise<SourceTextSaveConfirmed> {
    const value=readSourceTextSave(input),payloadDigest=hash(sourceTextSaveBindingText(value));
    if(value.binding!==SOURCE_TEXT_SAVE_BINDING_PREFIX+payloadDigest)return reject('invalid','The source save binding does not match its exact text and source version.');
    const intentHash=hash(JSON.stringify({operation:'source-text-edit:v1',intentId:value.intentId}));
    const inspection={taskId:value.taskId,sourceId:value.source.id,expectedSource:value.expectedSource,intentId:value.intentId,binding:value.binding};
    return this.exclusive(async()=>{
      assertCurrent();const receipt=findSourceTextSaveReceipt(this.state.usedRequestIds,intentHash);
      if(receipt)return this.savedTextSource(inspection,receipt);
      const result=await this.commit(state=>{
        assertCurrent();const task=this.task(state,value.taskId),source=task.sources.find(source=>source.id===value.source.id),current=source?.versions.at(-1),expected=value.expectedSource;
        if(!source||!current)return reject('not-found','The selected text source was not found.');
        if(current.kind!=='text'||source.currentVersion!==expected.version||current.version!==expected.version||current.digest!==expected.digest||source.freshness!==expected.freshness)return reject('conflict','The selected source or its freshness changed while this edit was pending.');
        if(source.currentVersion>=Number.MAX_SAFE_INTEGER)return reject('invalid','The source version limit was reached. Keep the edit for recovery.');
        const reference=this.appendSource(task,value.source);
        state.usedRequestIds.push(sourceTextSaveClaim(intentHash),encodeSourceTextSaveReceipt({intentHash,payloadDigest,taskId:task.id,...reference}));
        return {kind:'confirmed' as const,task,reference,intentId:value.intentId,binding:value.binding};
      });
      this.abortCancelled(result.task);return result;
    });
  }
  async inspectTextSourceSave(input:unknown):Promise<SourceTextSaveInspection> {
    const value=readSourceTextSaveInspection(input),intentHash=hash(JSON.stringify({operation:'source-text-edit:v1',intentId:value.intentId}));
    return this.exclusive(()=>{
      const receipt=findSourceTextSaveReceipt(this.state.usedRequestIds,intentHash);
      if(receipt)return this.savedTextSource(value,receipt);
      const task=this.task(this.state,value.taskId),source=task.sources.find(source=>source.id===value.sourceId),current=source?.versions.at(-1),expected=value.expectedSource;
      if(!source||!current)return reject('not-found','The selected text source was not found.');
      return clone({kind:'uncommitted',task,expectedUnchanged:current.kind==='text'&&source.currentVersion===expected.version&&current.version===expected.version&&current.digest===expected.digest&&source.freshness===expected.freshness,intentId:value.intentId,binding:value.binding});
    });
  }
  async copySavedDocumentSource(input:unknown,assertCurrent:()=>void=()=>{}):Promise<SavedDocumentSourceResult>{
    const value=readSavedDocumentSourceInput(input);
    return this.exclusive(async()=>{
      const result=await this.commit(state=>{
        assertCurrent();const task=this.task(state,value.taskId),owner=this.task(state,value.ownerTaskId);
        if(task.status!=='active')return reject('conflict','Resume the destination task before adding a source.');
        const preview=savedDocumentSourcePreview(owner,value.artifact,value.role);
        if(preview.snapshot!==value.expectedSnapshot)return reject('conflict','The selected document or its source freshness changed. Review the copy again.');
        const sourceId='saved-document-'+hash(JSON.stringify({taskId:value.taskId,ownerTaskId:value.ownerTaskId,artifact:{artifactId:value.artifact.artifactId,revision:value.artifact.revision,digest:value.artifact.digest},role:value.role,expectedSnapshot:value.expectedSnapshot})),existing=task.sources.find(source=>source.id===sourceId);
        if(existing){
          const version=existing.versions[0];
          if(existing.currentVersion!==1||existing.versions.length!==1||existing.freshness!=='fresh'||version.content!==preview.content||version.label!==preview.label||version.role!==value.role)return reject('conflict','This copied source already exists and has changed. Open it in Context; no edits were replaced.');
          return {task,reference:{sourceId,version:1,digest:version.digest},alreadyAdded:true};
        }
        const browserContext=task.session?.browserContext;
        const reference=this.appendSource(task,{id:sourceId,kind:'text',label:preview.label,content:preview.content,role:value.role});
        // Adding an unselected saved snapshot does not detach the current browser route.
        if(browserContext)task.session={...task.session!,browserContext};
        return {task,reference,alreadyAdded:false};
      });
      this.abortCancelled(result.task);return result;
    });
  }
  async addPdfPageSources(taskId:string,input:unknown,assertCurrent:()=>void=()=>{}):Promise<PdfPageAddResult>{
    const images=clone(readPdfPageImages(input));
    for(const image of images){const match=/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.content);if(!match)throw Error(pdfPageMessages.render);const png=Buffer.from(match[1],'base64');if(png.length<24||png.length>8*1024*1024||!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||png.readUInt32BE(16)!==image.pdfPage.width||png.readUInt32BE(20)!==image.pdfPage.height||hash(png)!==image.pdfPage.pngDigest)throw Error(pdfPageMessages.changed);}
    return this.exclusive(async()=>{const result=await this.commit(state=>{
      assertCurrent();const task=this.task(state,taskId);if(task.status!=='active'||task.archive||task.session?.browserContext)throw Error(pdfPageMessages.inactive);
      const existing=images.map(image=>task.sources.find(source=>source.id===image.id));
      if(existing.some(Boolean)){
        if(!existing.every((source,index)=>{const version=source?.versions.at(-1),image=images[index];return source?.currentVersion===1&&version?.kind==='image'&&version.label===image.label&&version.content===image.content&&version.role===image.role&&JSON.stringify(version.pdfPage)===JSON.stringify(image.pdfPage);}))throw Error(pdfPageMessages.changed);
        return {task,references:existing.map(source=>({sourceId:source!.id,version:source!.currentVersion,digest:source!.versions.at(-1)!.digest})),alreadyAdded:true};
      }
      for(const image of images)this.appendSource(task,{...image});
      return {task,references:images.map(image=>{const source=task.sources.find(source=>source.id===image.id)!,version=source.versions.at(-1)!;return {sourceId:source.id,version:version.version,digest:version.digest};}),alreadyAdded:false};
    });this.abortCancelled(result.task);return result;});
  }
  putSource(taskId: string, sourceInput: SourceInput, expectedTask?:Task, expectedSource?:SourceRef&{freshness?:Source['freshness']}, assertCurrent:()=>void=()=>{}, options?:{preserveBrowserContextForNewText:true}): Promise<Task> {
    const input=clone(sourceInput),expected=expectedTask?clone(expectedTask):undefined,expectedRef=expectedSource?clone(expectedSource):undefined;
    return this.exclusive(async () => {
      const task = await this.commit(state => {
        assertCurrent();const task = this.task(state, taskId);
        if(expectedRef){const source=task.sources.find(source=>source.id===expectedRef.sourceId),current=source?.versions.at(-1);if(input.id!==expectedRef.sourceId||source?.currentVersion!==expectedRef.version||current?.version!==expectedRef.version||current.digest!==expectedRef.digest||(expectedRef.freshness!==undefined&&source?.freshness!==expectedRef.freshness))return reject('conflict','The selected source or its freshness changed while the snapshot was pending.');}
        if(expected&&(expected.id!==taskId||JSON.stringify(task)!==JSON.stringify(expected)))return reject('conflict','This new task changed while the capture was pending. Capture the window again.');
        if(options?.preserveBrowserContextForNewText&&(input.kind!=='text'||task.sources.some(source=>source.id===input.id)))return reject('conflict','Only a new unselected text source can keep the current browser route.');
        const browserContext=options?.preserveBrowserContextForNewText?task.session?.browserContext:undefined;
        this.appendSource(task,input);if(browserContext)task.session={...task.session!,browserContext};return task;
      });
      this.abortCancelled(task); return task;
    });
  }
  invalidateSource(taskId: string, sourceId: string, reason: string, expectedSource?:SourceRef): Promise<Task> {
    return this.exclusive(async () => {
      if(expectedSource){const current=this.task(this.state,taskId).sources.find(source=>source.id===sourceId)?.versions.at(-1);if(expectedSource.sourceId!==sourceId||current?.version!==expectedSource.version||current.digest!==expectedSource.digest)return clone(this.task(this.state,taskId));}
      const task = await this.commit(state => {
        const task = this.task(state, taskId), source = task.sources.find(item => item.id === sourceId);
        if (!source) return reject('not-found', 'Source was not found.');
        text(reason, 'Reason', 1000); source.freshness = 'refresh-required'; source.staleReason = reason;
        this.retire(task, reason, sourceId); this.cancelRunning(task, reason, sourceId); task.updatedAt = this.time(); return task;
      }); this.abortCancelled(task); return task;
    });
  }
  observeWindow(taskId: string, observation: { windowId: string; documentToken: string; title?: string; boundsToken?: string }): Promise<Task> {
    return this.exclusive(async () => {
      const unchangedTask = this.task(this.state, taskId);
      const changed = unchangedTask.sources.some(source => {
        const version = latest(source.versions);
        return source.freshness === 'fresh' && version.windowId === observation.windowId && (version.documentToken !== observation.documentToken || version.title !== observation.title || version.boundsToken !== observation.boundsToken);
      });
      if (!changed) return clone(unchangedTask);
      const task = await this.commit(state => {
        const task = this.task(state, taskId);
        for (const source of task.sources) {
          const version = latest(source.versions);
          if (version.windowId === observation.windowId && (version.documentToken !== observation.documentToken || version.title !== observation.title || version.boundsToken !== observation.boundsToken)) {
            source.freshness = 'refresh-required'; source.staleReason = 'The selected window changed. Capture it again explicitly.';
            this.retire(task, source.staleReason, source.id); this.cancelRunning(task, source.staleReason, source.id);
          }
        }
        return task;
      }); this.abortCancelled(task); return task;
    });
  }
  reconcileDocumentSource(binding:DocumentBinding,observation:DocumentReconciliation,assertCurrent?:()=>void):Promise<{kind:'unchanged'|'invalidated'|'superseded';task:Task}>{
    const guard=()=>{if(observation.kind==='edited-transition'&&!assertCurrent)reject('invalid','An edited transition requires its current host-session guard.');assertCurrent?.();};
    return this.exclusive(async()=>{
      guard();const before=this.task(this.state,binding.taskId),source=before.sources.find(source=>source.id===binding.ref.sourceId),version=source?.versions.at(-1);
      if(!source||!version||version.kind!=='window'||version.version!==binding.ref.version||version.digest!==binding.ref.digest||version.windowId!==binding.windowId||version.windowProcessId!==binding.processId)return {kind:'superseded',task:clone(before)};
      const editedTransition=observation.kind==='edited-transition';
      if(editedTransition){
        if(typeof observation.before.edited!=='boolean'||typeof observation.after.edited!=='boolean'||observation.before.edited===observation.after.edited||!version.documentStamp||version.documentStamp.digest!==observation.before.digest||version.documentStamp.digest!==observation.after.digest||observation.before.method!=='ax-document'||observation.after.method!=='ax-document'||observation.before.evidence!=='foreground-application-correlation'||observation.after.evidence!=='foreground-application-correlation')reject('invalid','The edited transition does not match the exact captured document.');
      }
      if(observation.kind==='inactive'||observation.kind==='document'&&version.documentStamp?.digest===observation.stamp.digest)return {kind:'unchanged',task:clone(before)};
      const reason=editedTransition
        ?'The focused application reports an edited-state transition at the same document address. The prior snapshot and its derived results are historical; capture the selected window again explicitly.'
        :observation.kind==='document'
          ?version.documentStamp?'The focused application reports a different document. The prior snapshot and its derived results are historical; review the new selected-window snapshot.':'This snapshot has no document observation to compare. Capture it again before using it as current evidence.'
          :`Document following is frozen (${observation.reason}). The previous snapshot is historical; select this window again explicitly.`;
      const observedDigest=editedTransition?observation.after.digest:observation.kind==='document'?observation.stamp.digest:undefined;
      if(source.freshness==='refresh-required'&&source.documentChange?.reason===reason&&source.documentChange.observedDigest===observedDigest)return {kind:'unchanged',task:clone(before)};
      const task=await this.commit(state=>{
        guard();const task=this.task(state,binding.taskId),source=task.sources.find(source=>source.id===binding.ref.sourceId);
        if(!source)return reject('conflict','The observed source was removed.');
        source.freshness='refresh-required';source.staleReason=reason;
        source.documentChange={kind:observation.kind==='document'||editedTransition?'changed':'unavailable',reason,observedAt:this.time(),...(observedDigest?{observedDigest}:{})};
        this.retire(task,reason,source.id);this.cancelRunning(task,reason,source.id);
        const {browserContext:_browser,...session}=task.session??emptyTaskSession();task.session={...session,revision:session.revision+1,contextRevision:(session.contextRevision??0)+1};
        task.updatedAt=this.time();return task;
      });
      this.abortCancelled(task);return {kind:'invalidated',task};
    });
  }
  private appendArtifact(task: Task, input: ArtifactInput): { artifactId: string; revision: ArtifactRevision } {
    text(input.title, 'Artifact title', 500); text(input.content, 'Artifact content', 12_000_000);
    if(input.expectedArtifacts!==undefined)this.validArtifacts(task,input.expectedArtifacts);
    if(input.expectedModuleStates!==undefined)this.validModuleStates(task,input.expectedModuleStates);
    const sourceRefs = clone(input.sourceRefs ?? this.refs(task)); this.validRefs(task, sourceRefs);
    const artifact = input.artifactId ? task.artifacts.find(item => item.id === input.artifactId) : undefined;
    if (input.artifactId && !artifact) return reject('not-found', 'Artifact was not found.');
    if (artifact && input.expectedRevision !== latest(artifact.revisions).revision) reject('conflict', 'Artifact changed. Reload before saving.');
    const bytes = artifactBytes(input);
    const revision: ArtifactRevision = { revision: (artifact ? latest(artifact.revisions).revision : 0) + 1, title: input.title, content: input.content, mimeType: input.mimeType ?? 'text/plain', ...(input.encoding ? { encoding: input.encoding } : {}), sourceRefs, digest: hash(bytes), createdAt: this.time() };
    const id = artifact?.id ?? randomUUID();
    if (artifact) { artifact.revisions.push(revision); this.retire(task, 'Artifact revised.'); }
    else task.artifacts.push({ id, revisions: [revision] });
    task.updatedAt = this.time(); return { artifactId: id, revision };
  }
  saveArtifact(taskId: string, input: ArtifactInput): Promise<{ artifactId: string; revision: ArtifactRevision }> {
    return this.exclusive(() => this.commit(state => this.appendArtifact(this.task(state, taskId), input)));
  }
  private helperSourceReportSaved(task:Task,input:HelperSourceBatchInspection):HelperSourceBatchSaved|undefined{
    const {binding,...request}=input,claimHash=hash('helper-source-report:'+binding),receipt=findHelperSourceReportReceipt(this.state.usedRequestIds,claimHash);
    if(!receipt){if(this.state.usedRequestIds.includes(claimHash))return reject('conflict','The original table-report save is unavailable. Inspect Files before another action.');return undefined;}
    const original=task.artifacts.find(item=>item.id===receipt.artifactId)?.revisions.find(item=>item.revision===receipt.revision);
    if(receipt.taskId!==task.id||receipt.binding!==binding||receipt.requestDigest!==helperSourceBatchRequestIdentity(request)||!original||original.title!==HELPER_SOURCE_REPORT_TITLE||original.mimeType!=='text/markdown'||original.encoding==='base64'||original.digest!==receipt.digest||hash(original.content)!==receipt.payloadDigest||receipt.payloadDigest!==receipt.digest||original.sourceRefs.length!==1||original.sourceRefs[0].sourceId!==request.sourceRef.sourceId||original.sourceRefs[0].version!==request.sourceRef.version||original.sourceRefs[0].digest!==request.sourceRef.digest)return reject('conflict','The original reviewed report is unavailable or changed. No replacement was created.');
    return {kind:'saved',taskId:task.id,binding,artifactId:receipt.artifactId,revision:receipt.revision,digest:receipt.digest,alreadySaved:true};
  }
  /** Read-only reconciliation uses the original exact intent, even after a later source/helper edit. */
  inspectHelperSourceBatchSave(input:unknown):Promise<HelperSourceBatchSaveInspection>{
    const value=clone(readHelperSourceBatchInspection(input));
    return this.exclusive(()=>{const task=this.task(this.state,value.taskId);return clone(this.helperSourceReportSaved(task,value)??{kind:'not-saved' as const,taskId:task.id,binding:value.binding});});
  }
  /** One explicit local document save. No input/preview values enter request history before this action. */
  saveHelperSourceBatchReport(input:unknown,assertCurrent:()=>void=()=>{}):Promise<HelperSourceBatchSaved>{
    const {confirmed:_confirmed,...value}=clone(readHelperSourceBatchSave(input));
    return this.exclusive(()=>{
      assertCurrent();const task=this.task(this.state,value.taskId),existing=this.helperSourceReportSaved(task,value);if(existing)return clone(existing);
      const {binding,...request}=value,preview=helperSourceBatchPreview(task,request);if(preview.binding!==binding)return reject('conflict','The reviewed table report changed. Preview it again before saving.');
      return this.commit(state=>{
        assertCurrent();const current=this.task(state,value.taskId),reviewed=helperSourceBatchPreview(current,request);if(reviewed.binding!==binding)return reject('conflict','The table or active helper changed before saving. Review a new report.');
        const intent='helper-source-report:'+binding,claimHash=hash(intent);this.claimRequest(state,intent);
        const saved=this.appendArtifact(current,{title:reviewed.title,content:reviewed.content,mimeType:'text/markdown',sourceRefs:[{...request.sourceRef}],expectedArtifacts:[{artifactId:request.artifactId,revision:request.artifactRevision,digest:request.artifactDigest}],expectedModuleStates:[{artifactId:request.artifactId,artifactRevision:request.artifactRevision,moduleId:request.moduleId,stateRevision:request.stateRevision}]}),payloadDigest=hash(reviewed.content);
        state.usedRequestIds.push(encodeHelperSourceReportReceipt({claimHash,binding,requestDigest:helperSourceBatchRequestIdentity(request),payloadDigest,taskId:current.id,artifactId:saved.artifactId,revision:saved.revision.revision,digest:saved.revision.digest}));
        return {kind:'saved' as const,taskId:current.id,binding,artifactId:saved.artifactId,revision:saved.revision.revision,digest:saved.revision.digest,alreadySaved:false};
      });
    });
  }
  /** Saving shown recovery evidence is local data, never authority to retry a website action. */
  async saveBrowserReviewNotes(input:unknown,assertCurrent:()=>void=()=>{}):Promise<BrowserReviewNotesSaved>{
    const value=clone(readBrowserReviewNotesSave(input)),intentId='browser-review-notes:'+hash(JSON.stringify([value.taskId,value.runId,value.operationId,value.binding])),claimHash=hash(intentId);
    return this.exclusive<BrowserReviewNotesSaved>(()=>{
      assertCurrent();const task=this.task(this.state,value.taskId),preview=browserReviewNotesPreview(task,value.runId,value.operationId);
      if(preview.binding!==value.binding)return reject('conflict','The reviewed page or outcome changed. Review the current shown notes before saving.');
      const payloadDigest=hash(preview.content),receipt=findBrowserReviewNotesReceipt(this.state.usedRequestIds,claimHash);
      if(receipt){
        const original=task.artifacts.find(artifact=>artifact.id===receipt.artifactId)?.revisions.find(revision=>revision.revision===receipt.revision);
        if(receipt.taskId!==task.id||receipt.payloadDigest!==payloadDigest||!original||original.digest!==receipt.digest||hash(original.content)!==receipt.digest||original.content!==preview.content||original.mimeType!=='text/markdown'||original.sourceRefs.length)return reject('conflict','The original saved notes are unavailable or changed. No replacement was created.');
        return clone({taskId:value.taskId,runId:value.runId,operationId:value.operationId,binding:value.binding,artifactId:receipt.artifactId,revision:receipt.revision,digest:receipt.digest,alreadySaved:true});
      }
      return this.commit(state=>{
        assertCurrent();const current=this.task(state,value.taskId);if(browserReviewNotesPreview(current,value.runId,value.operationId).binding!==value.binding)return reject('conflict','The reviewed page or outcome changed. Review it again.');
        this.claimRequest(state,intentId);const saved=this.appendArtifact(current,{title:BROWSER_REVIEW_NOTES_TITLE,content:preview.content,mimeType:'text/markdown',sourceRefs:[]});
        state.usedRequestIds.push(encodeBrowserReviewNotesReceipt({claimHash,payloadDigest,taskId:current.id,artifactId:saved.artifactId,revision:saved.revision.revision,digest:saved.revision.digest}));
        return {taskId:value.taskId,runId:value.runId,operationId:value.operationId,binding:value.binding,artifactId:saved.artifactId,revision:saved.revision.revision,digest:saved.revision.digest,alreadySaved:false};
      });
    });
  }
  saveTaskHandoff(input:unknown,assertCurrent:()=>void=()=>{}):Promise<TaskHandoffSaved>{
    const value=clone(readTaskHandoffSave(input)),intent='task-handoff:'+value.intentId,claimHash=hash(intent),requestDigest=hash(taskHandoffIdentity(value));
    return this.exclusive<TaskHandoffSaved>(()=>{
      assertCurrent();const task=this.task(this.state,value.taskId),receipt=findTaskHandoffReceipt(this.state.usedRequestIds,claimHash);
      if(receipt){
        const original=task.artifacts.find(artifact=>artifact.id===receipt.artifactId)?.revisions.find(revision=>revision.revision===receipt.revision);
        if(receipt.taskId!==task.id||receipt.requestDigest!==requestDigest||receipt.payloadDigest!==hash(value.binding)||!original||original.digest!==receipt.digest||hash(original.content)!==receipt.digest||original.content!==value.binding||original.mimeType!=='text/markdown'||original.sourceRefs.length)return reject('conflict','The original saved handoff is unavailable. No replacement was created.');
        return clone({task,artifactId:receipt.artifactId,revision:receipt.revision,digest:receipt.digest,alreadySaved:true});
      }
      return this.commit(state=>{
        assertCurrent();const current=this.task(state,value.taskId);if(current.status!=='active')return reject('conflict','Resume the task before saving a handoff.');
        const preview=taskHandoffPreview(current,{taskId:value.taskId,artifacts:value.artifacts,noteIds:value.noteIds,includeGoal:value.includeGoal});
        if(preview.binding!==value.binding)return reject('conflict','The selected saved work or its source status changed. Review the current handoff before saving.');
        this.claimRequest(state,intent);const saved=this.appendArtifact(current,{title:preview.title,content:preview.content,mimeType:'text/markdown',sourceRefs:[]});
        state.usedRequestIds.push(encodeTaskHandoffReceipt({claimHash,requestDigest,payloadDigest:hash(preview.content),taskId:current.id,artifactId:saved.artifactId,revision:saved.revision.revision,digest:saved.revision.digest}));
        return {task:current,artifactId:saved.artifactId,revision:saved.revision.revision,digest:saved.revision.digest,alreadySaved:false};
      });
    });
  }
  checkpoint(taskId: string, note: string): Promise<Task> {
    return this.exclusive(() => this.commit(state => {
      const task = this.task(state, taskId); text(note, 'Checkpoint note', 10_000);
      task.checkpoints.push({ id: randomUUID(), note, createdAt: this.time(), sourceRefs: this.refs(task), artifacts: task.artifacts.map(artifact => ({ artifactId: artifact.id, revision: latest(artifact.revisions).revision })) });
      return task;
    }));
  }
  pause(taskId: string): Promise<Task> {
    return this.exclusive(async () => {
      const task = await this.commit(state => { const task = this.task(state, taskId); task.status = 'paused'; this.cancelRunning(task, 'Task paused.'); this.retire(task, 'Task paused.'); return task; });
      this.abortCancelled(task); return task;
    });
  }
  resume(taskId: string): Promise<ResumeResult> {
    return this.exclusive(() => this.commit(state => {
      const task = this.task(state, taskId);if(task.archive)return reject('conflict','Restore this archived task before resuming it.'); task.status = 'active';
      const affectedArtifacts = task.artifacts.flatMap(artifact => {
        const revisions = artifact.revisions.filter(revision => { try { this.validRefs(task, revision.sourceRefs); return false; } catch { return true; } }).map(revision => revision.revision);
        return revisions.length ? [{ artifactId: artifact.id, revisions }] : [];
      });
      return { task, sourceContext:sourceResumeContext(task), staleSourceIds: task.sources.filter(source => source.freshness !== 'fresh').map(source => source.id), affectedArtifacts, interruptedRequestIds: task.requests.filter(request => request.status === 'interrupted').map(request => request.id) };
    }));
  }

  /** Persist the exact local intent before dispatch. A different pending intent is returned, never replaced. */
  prepareBrowserContinuationAttempt(input:BrowserContinuationInput):Promise<Task>{
    const value=clone(readBrowserContinuationInput(input));
    return this.exclusive(()=>{
      const task=this.task(this.state,value.taskId);if(pendingBrowserContinuation(task))return clone(task);
      if(this.state.usedRequestIds.includes(hash(value.requestId)))return reject('conflict','This remaining-work identity is already retired or recorded. Check its original outcome.');
      const command=prepareBrowserContinuation(task,{taskId:task.id,requestId:value.previous.requestId,digest:value.previous.digest},value,value.requestId,value.previous.binding),{type:_type,...canonical}=command;
      return this.commit(state=>{const current=this.task(state,value.taskId),session=current.session??emptyTaskSession();current.session={...session,revision:session.revision+1,browserContinuationAttempt:{input:canonical,phase:'prepared'}};current.updatedAt=this.time();return current;});
    });
  }
  /** Explicit local closure: retire an absent ID atomically, or clear only a matching terminal receipt. */
  releaseBrowserContinuationAttempt(input:BrowserContinuationInput):Promise<BrowserContinuationRelease>{
    const value=clone(readBrowserContinuationInput(input));
    const receipt:BrowserContinuationReceipt={previousRequestId:value.previous.requestId,previousDigest:value.previous.digest,bindingDigest:hash(value.previous.binding),startPageDigest:hash(value.url),promptDigest:hash(value.prompt)};
    const retired='browser-continuation-retired-v1:'+hash(JSON.stringify({taskId:value.taskId,requestId:value.requestId,receipt}));
    return this.exclusive(()=>{
      const task=this.task(this.state,value.taskId),pending=pendingBrowserContinuation(task),request=task.requests.find(request=>request.id===value.requestId);
      if(pending&&!sameBrowserContinuationInput(pending.input,value))return reject('conflict','A different browser attempt is pending. Its input is kept.');
      if(request){
        if(pending&&pending.phase!=='submitted')return reject('conflict','The saved attempt and its request disagree. Its pending input is kept.');
        let saved:BrowserContinuationReceipt;try{saved=readBrowserContinuationReceipt(request.browserContinuation);}catch{return reject('conflict','The exact continuation receipt is unavailable. Its pending input is kept.');}
        const origin=new URL(value.url).origin,runs=task.session?.runs.filter(run=>run.id===value.requestId)??[];
        if(JSON.stringify(saved)!==JSON.stringify(receipt)||request.kind!=='browser'||request.prompt!==value.prompt||request.sourceRefs.length||request.targetArtifactId||request.browserStart&&request.browserStart.origin!==origin||runs.length>1||runs.some(run=>run.origin!==origin||run.initialObservation.taskId!==task.id||run.initialObservation.browserId!==run.browserId))return reject('conflict','The exact continuation receipt changed. Its pending input is kept.');
        if(request.status==='running')return reject('conflict','This browser request is still running. Use the task Stop control or check again.');
      }else if(!this.state.usedRequestIds.includes(retired)){
        if(pending?.phase==='submitted')return reject('conflict','The submitted browser request is unavailable. Its pending input is kept.');
        if(!pending)reviewBrowserContinuation(task,{taskId:task.id,requestId:value.previous.requestId,digest:value.previous.digest});
        if(this.state.usedRequestIds.includes(hash(value.requestId)))return reject('conflict','This identity cannot be safely retired. Its pending input is kept.');
      }
      return this.commit(state=>{
        const current=this.task(state,value.taskId);
        if(!request&&!state.usedRequestIds.includes(retired)){this.claimRequest(state,value.requestId);state.usedRequestIds.push(retired);}
        const {browserContinuationAttempt:_pending,...session}=current.session??emptyTaskSession();current.session={...session,revision:session.revision+1};current.updatedAt=this.time();
        return {kind:request?'cleared-terminal' as const:'retired-unstarted' as const,task:current,taskId:current.id,requestId:value.requestId,receipt};
      });
    });
  }

  setTaskArchived(input:unknown,assertCurrent:()=>void=()=>{}):Promise<Task>{
    const value=clone(readTaskArchiveChange(input));
    return this.exclusive(()=>this.commit(state=>{
      assertCurrent();const task=this.task(state,value.taskId);
      if((task.archive?.id??null)!==value.expectedArchiveId)return reject('conflict','The archive state changed. Review the current task before trying again.');
      if(!!task.archive===value.archived)return task;
      if(value.archived){
        if(task.status!=='paused')return reject('conflict','Pause this task before archiving it.');
        if(task.requests.some(request=>request.status==='running')||task.actions.some(action=>action.status==='executing')||task.session?.runs.some(run=>run.operations.some(operation=>operation.status==='executing')))return reject('busy','Wait for the current work to finish before archiving this task.');
        task.archive={id:randomUUID(),archivedAt:this.time()};
      }else delete task.archive;
      task.updatedAt=this.time();return task;
    }));
  }

  async runRequest(input: RequestInput, runner: (context: RequestContext) => Promise<RequestOutput>, assertCurrent?:()=>void): Promise<RequestRecord> {
    input = clone(input);
    if(input.inference!==undefined)input.inference=readRequestInferenceSelection(input.inference);
    if(input.instructionSkill!==undefined&&input.instructionSkill!==null)input.instructionSkill=Schema.decodeUnknownSync(InstructionSkillReferenceSchema,{onExcessProperty:'error'})(input.instructionSkill);
    if(input.instructionSkillRevision!==undefined&&(!Number.isSafeInteger(input.instructionSkillRevision)||input.instructionSkillRevision<0))throw Error('The task skill choice revision is invalid.');
    if(input.inferenceRevision!==undefined&&(!Number.isSafeInteger(input.inferenceRevision)||input.inferenceRevision<0))throw Error('The request model choice revision is invalid.');
    if(input.submittedDraft!==undefined){try{input.submittedDraft=Schema.decodeUnknownSync(SubmittedComposerDraftSchema,{onExcessProperty:'error'})(input.submittedDraft);if(!Number.isSafeInteger(input.submittedDraft.revision))throw Error('Invalid revision.');}catch{return reject('invalid','Submitted composer draft is invalid.');}}
    if(input.browserContinuation!==undefined){try{input.browserContinuation=readBrowserContinuationReceipt(input.browserContinuation);if(input.kind!=='browser'||input.submittedDraft||input.artifactId)throw Error();}catch{return reject('invalid','The browser continuation receipt is invalid. Existing work is kept.');}}
    if(input.conversationAttempt!==undefined)input.conversationAttempt=readConversationAttemptReceipt(input.conversationAttempt);
    if(input.memory!==undefined){try{input.memory=readMemoryUse(input.memory);}catch{return reject('invalid','Invalid memory receipt.');}}
    let boundSubmittedDraft:ComposerDraft|undefined;
    const controller = new AbortController();
    const begun = await this.exclusive(async () => {
      const task = this.task(this.state, input.taskId), sourceRefs = this.requestRefs(task, input.sourceIds);
      const ordinarySkill=['explain','create'].includes(input.kind)&&!input.artifactId&&(!input.executionScope||input.executionScope.startsWith('response-preferences:v1:'));
      if(!ordinarySkill&&(input.instructionSkill||input.instructionSkillRevision!==undefined))throw Error('Skills apply only to ordinary questions and drafts.');
      const currentSkill=instructionSkillSelection(task.session);
      if(ordinarySkill&&!input.queuedFollowup&&(!sameInstructionSkill(currentSkill.selection,input.instructionSkill)||input.instructionSkillRevision!==undefined&&input.instructionSkillRevision!==currentSkill.revision))throw Error('The selected skill changed. Review the current task choice before asking.');
      const skill=input.instructionSkill?instructionSkillEntry(this.state.tasks,input.instructionSkill):undefined;
      if(input.expectedSourceRefs!==undefined){const refs=input.expectedSourceRefs;if(!Array.isArray(refs)||refs.length!==sourceRefs.length||new Set(refs.map(ref=>ref?.sourceId)).size!==refs.length||refs.some(ref=>!ref||Object.keys(ref).sort().join(',')!=='digest,sourceId,version'||!sourceRefs.some(actual=>actual.sourceId===ref.sourceId&&actual.version===ref.version&&actual.digest===ref.digest)))reject('conflict','Selected source versions changed. Review the current snapshot.');input.expectedSourceRefs=clone(sourceRefs);}
      if(input.memory){
        if(!['explain','create'].includes(input.kind)||input.artifactId)reject('invalid','Memory applies only to ordinary questions and drafts.');
        const expected=this.selectTaskMemory(task,input.prompt).receipt;
        if(JSON.stringify(expected)!==JSON.stringify(input.memory))reject('conflict',MEMORY_CHANGED);
      }
      const projectInstructions=input.kind==='browser'||input.executionScope?.startsWith('recurring-response:v1:')?undefined:this.projectGuidance(this.state,task);
      const digest = hash(JSON.stringify({ ...input, sourceIds: input.sourceIds === undefined ? undefined : sourceRefs.map(ref => ref.sourceId), sourceRefs,...(projectInstructions?{projectInstructions}:{}) }));
      const existing = task.requests.find(request => request.id === input.requestId);
      if (existing) {
        // Existing stores may contain the previous payload-only digest for an unscoped request.
        const legacyReplay = input.sourceIds === undefined && existing.digest === hash(JSON.stringify(input));
        if (existing.digest !== digest && !legacyReplay) reject('conflict', 'Request ID has a different payload or source scope.');
        return { existing: clone(existing) };
      }
      const context = await this.commit(state => {
        const task = this.task(state, input.taskId); if (task.status !== 'active') reject('conflict', 'Resume the task before starting a request.');
        if(ordinarySkill&&!input.queuedFollowup&&!sameInstructionSkill(instructionSkillSelection(task.session).selection,input.instructionSkill))throw Error('The selected skill changed before this request.');
        if(input.instructionSkill)instructionSkillEntry(state.tasks,input.instructionSkill);
        if(input.inference&&!input.queuedFollowup){const current=requestInferenceSaved(task.session);if(input.inferenceRevision!==current.revision||current.policy!=='automatic'&&current.selection&&!sameRequestInference(current.selection,input.inference))throw Error('The task model choice changed before this request. Ask again with its current choice.');}
        text(input.kind, 'Request kind', 100); text(input.prompt, 'Prompt', 50_000); this.claimRequest(state, input.requestId);
        if (input.executionScope !== undefined) text(input.executionScope, 'Execution scope', 2000);
        if (input.artifactId) {
          const artifact = task.artifacts.find(item => item.id === input.artifactId);
          if (!artifact || latest(artifact.revisions).revision !== input.expectedRevision) reject('conflict', 'Artifact changed. Reload before revising.');
        }
        this.validRefs(task, sourceRefs);
        if(input.conversationAttempt){assertConversationAttempt(task,input);if(task.requests.some(request=>request.status==='running'))reject('conflict','Wait for the current response before asking again.');}
        if(input.browserContinuation){
          const receipt=input.browserContinuation,review=reviewBrowserContinuation(task,{taskId:task.id,requestId:receipt.previousRequestId,digest:receipt.previousDigest});
          const pending=pendingBrowserContinuation(task);if(!pending||pending.phase!=='prepared'||pending.input.requestId!==input.requestId||pending.input.prompt!==input.prompt||hash(pending.input.previous.binding)!==receipt.bindingDigest||hash(pending.input.url)!==receipt.startPageDigest||pending.input.previous.requestId!==receipt.previousRequestId||pending.input.previous.digest!==receipt.previousDigest)reject('conflict','The exact pending browser intent is unavailable. No browser was started.');
          if(input.requestId===receipt.previousRequestId||sourceRefs.length||hash(review.binding)!==receipt.bindingDigest||hash(input.prompt)!==receipt.promptDigest)reject('conflict',BROWSER_CONTINUATION_CHANGED);
          if(review.uncertain)reject('conflict',BROWSER_CONTINUATION_UNCERTAIN);
          if(task.requests.some(request=>request.status==='running'))reject('conflict','Wait for the current request to finish before planning remaining browser work.');
          let scope:{url:string;origin:string;continuation:unknown};try{scope=JSON.parse(input.executionScope??'');if(typeof scope.url!=='string'||new URL(scope.url).href!==scope.url||new URL(scope.url).origin!==review.origin||scope.origin!==review.origin||hash(scope.url)!==receipt.startPageDigest||JSON.stringify(scope.continuation)!==JSON.stringify(receipt))throw Error();}catch{reject('conflict','The exact browser continuation scope is unavailable. Existing work is kept.');}
        }
        if(input.expectedArtifacts!==undefined)this.validArtifacts(task,input.expectedArtifacts);
        if(input.expectedModuleStates!==undefined)this.validModuleStates(task,input.expectedModuleStates);
        if(input.submittedDraft&&!input.artifactId&&['explain','create','experiment','procedure','browser'].includes(input.kind)&&input.prompt===input.submittedDraft.text.trim()&&sameComposerDraft(readComposerDraft(task.session),input.submittedDraft))boundSubmittedDraft=input.submittedDraft;
        if(input.queuedFollowup){const binding=input.queuedFollowup,session=task.session??emptyTaskSession(),item=pendingFollowups(session.queuedFollowups)[0];if(!item||item.status!=='queued'||item.id!==binding.id||item.id!==input.requestId||item.revision!==binding.revision||item.scope!==binding.scope||item.basis!==binding.basis||item.prompt!==input.prompt||item.kind!==input.kind||!sameRequestInference(item.inference,input.inference)||!sameInstructionSkill(item.instructionSkill,input.instructionSkill)||JSON.stringify(item.sourceRefs)!==JSON.stringify(sourceRefs)||this.queuedBasis(task,item.sourceRefs,item.precedingRequestIds)!==item.basis||task.requests.some(request=>request.status==='running'))reject('conflict','The exact first queued follow-up is no longer ready. Review it again.');task.session={...session,revision:session.revision+1,queuedFollowups:session.queuedFollowups!.map(entry=>entry.id===item.id?{...entry,status:'dispatched' as const,dispatchedRequestId:input.requestId}:entry)};}
        task.requests.push({ ...(input.instructionSkill?{instructionSkill:clone(input.instructionSkill)}:{}),...(input.inference?{inference:clone(input.inference)}:{}),id: input.requestId, kind: input.kind, prompt: input.prompt, digest, status: 'running', sourceRefs, startedAt: this.time(),...(input.memory?{memory:clone(input.memory)}:{}),...(input.conversationAttempt?{conversationAttempt:clone(input.conversationAttempt)}:{}),...(input.browserContinuation?{browserContinuation:clone(input.browserContinuation)}:{}), ...(input.artifactId ? { targetArtifactId: input.artifactId, expectedRevision: input.expectedRevision } : {}) });
        if(input.browserContinuation){const session=task.session!;task.session={...session,revision:session.revision+1,browserContinuationAttempt:{...session.browserContinuationAttempt!,phase:'submitted'}};}
        const selected = new Set(sourceRefs.map(ref => ref.sourceId));
        const {publicGithub:_publicGithub,...requestTask}=task;
        return { ...(skill?{instructionSkill:clone(skill)}:{}),...(projectInstructions?{projectInstructions}:{}),...(['explain','create','revise'].includes(input.kind)?{taskHistory:input.conversationAttempt?projectConversationAttemptDialogue(task,input.conversationAttempt,sourceRefs):projectTaskDialogue(task,input.requestId,sourceRefs)}:{}), task: { ...requestTask,...(task.session?{session:requestSession(task.session)}:{}), sources: task.sources.filter(source => selected.has(source.id)).map(source => ({ ...source, versions: [latest(source.versions)] })) }, sourceRefs };
      });
      this.controllers.set(input.requestId, controller);
      return { context };
    });
    if (begun.existing) return begun.existing;
    const context = begun.context;
    if (!context) return reject('invalid', 'Missing request context.');
    let output: RequestOutput | undefined, failure: unknown;
    try {
      if (controller.signal.aborted) throw new Error('Request cancelled.');
      output = await Effect.runPromise(Effect.tryPromise({ try: () => runner({ ...context, signal: controller.signal }), catch: error => error }));
    } catch (error) { failure = error; }
    try {
      return await this.exclusive(() => this.commit(state => {
        const task = this.task(state, input.taskId), request = task.requests.find(item => item.id === input.requestId);
        if (!request) return reject('not-found', 'Request was removed.');
        if (request.status !== 'running') return request;
        if(!failure&&output&&!controller.signal.aborted){
          try{assertCurrent?.();}catch(error){failure=error;controller.abort(error);}
        }
        request.finishedAt = this.time();
        if (failure || !output || controller.signal.aborted) {
          request.status = controller.signal.aborted ? 'cancelled' : 'failed';
          request.error = failure instanceof Error ? failure.message : String(failure ?? 'Request returned no output.');
        } else {
          try {
            if(input.expectedArtifacts!==undefined)this.validArtifacts(task,input.expectedArtifacts);
            if(input.expectedModuleStates!==undefined)this.validModuleStates(task,input.expectedModuleStates);
            const {modelReceipt,...answer}=output,receipt=modelReceipt===undefined?undefined:readProviderModelReceipt(modelReceipt);
            if(receipt){const {provider,model,effort,tier}=receipt;if(receipt.requestId!==request.id||input.inference&&!sameRequestInference(input.inference,{provider,model,effort,tier}))throw Error('Provider model receipt does not match this request. No answer was accepted.');}
            const artifact = this.appendArtifact(task, { ...answer, artifactId: input.artifactId, expectedRevision: input.expectedRevision, sourceRefs: request.sourceRefs });
            request.status = 'completed'; request.artifactId = artifact.artifactId;
            const saved=artifact.revision;request.answer={artifactId:artifact.artifactId,revision:saved.revision,digest:saved.digest};
            if(receipt)request.responseModel={...receipt,answer:{...request.answer}};
            if(boundSubmittedDraft&&sameComposerDraft(readComposerDraft(task.session),boundSubmittedDraft)){
              // Consumption leaves the user-edit epoch available to a newer save already queued against it.
              const session=task.session??emptyTaskSession();task.session={...session,draft:'',draftKind:boundSubmittedDraft.kind,draftRevision:boundSubmittedDraft.revision,revision:session.revision+1};
            }
          } catch (error) { request.status = 'failed'; request.error = error instanceof Error ? error.message : String(error); }
        }
        return request;
      }));
    } finally {
      this.controllers.delete(input.requestId);
    }
  }
  cancelRequest(taskId: string, requestId: string): Promise<RequestRecord> {
    return this.exclusive(async () => {
      const result = await this.commit(state => {
        const task = this.task(state, taskId), request = task.requests.find(item => item.id === requestId);
        if (!request) return reject('not-found', 'Request was not found.');
        if (request.status === 'running') { request.status = 'cancelled'; request.finishedAt = this.time(); request.error = 'Stopped by user.'; }
        this.retire(task, 'Stop retired unexecuted approvals.'); return request;
      }); this.controllers.get(requestId)?.abort(); return result;
    });
  }
  saveProcedure(taskId: string, input: ProcedureInput): Promise<Task> {
    return this.exclusive(() => this.commit(state => {
      const allowed = new Set(['id', 'expectedRevision', 'title', 'project', 'steps', 'sourceRefs', 'originArtifact']);
      for (const key of Object.keys(input)) if (!allowed.has(key)) reject('invalid', `Unknown procedure input field ${key}. Observation metadata is resolved from a saved artifact.`);
      const task = this.task(state, taskId); text(input.title, 'Procedure title', 500);
      if (!Array.isArray(input.steps) || input.steps.length < 1 || input.steps.length > 32) reject('invalid', 'A procedure needs 1–32 inspectable steps.');
      for (const step of input.steps) {
        text(step.intent, 'Step intent', 2000); text(step.target, 'Step target', 2000); text(step.expectedResult, 'Expected result', 2000);
        if (!Array.isArray(step.preconditions) || step.preconditions.length > 16) reject('invalid', 'Too many preconditions.');
        for (const condition of step.preconditions) { text(condition.key, 'Precondition key', 100); text(condition.equals, 'Precondition value', 1000); }
      }
      const sourceRefs = clone(input.sourceRefs ?? this.refs(task)); this.validRefs(task, sourceRefs);
      const procedure = input.id ? task.procedures.find(item => item.id === input.id) : undefined;
      if (input.id && !procedure) return reject('not-found', 'Procedure was not found.');
      if (procedure && input.expectedRevision !== latest(procedure.revisions).revision) reject('conflict', 'Procedure changed. Reload before editing.');
      let observation = procedure ? clone(latest(procedure.revisions).observation) : undefined;
      if (input.originArtifact !== undefined) {
        const origin = input.originArtifact;
        if (origin === null || typeof origin !== 'object' || Array.isArray(origin) || Object.keys(origin).length !== 2 || !Object.hasOwn(origin, 'artifactId') || !Object.hasOwn(origin, 'revision')) reject('invalid', 'Procedure origin must contain only artifactId and revision.');
        text(origin.artifactId, 'Origin artifact ID', 200);
        if (!Number.isInteger(origin.revision) || origin.revision < 1) reject('invalid', 'Origin artifact revision must be a positive integer.');
        const artifact = this.artifactRevision(task, origin.artifactId, origin.revision);
        const draft = parseModelDraft(artifact.content, 'procedure');
        if (draft.kind !== 'procedure') return reject('invalid', 'Origin artifact must contain a procedure draft.');
        const digest = hash(artifactBytes(artifact));
        if (digest !== artifact.digest) reject('conflict', 'Origin artifact bytes differ from its saved digest.');
        observation = { artifactId: origin.artifactId, revision: origin.revision, digest, summary: draft.summary, limitations: clone(draft.limitations) };
      }
      const revision = { revision: (procedure ? latest(procedure.revisions).revision : 0) + 1, title: input.title, scope: { taskId, ...(input.project ? { project: input.project } : {}) }, steps: clone(input.steps), sourceRefs, createdAt: this.time(), ...(observation ? { observation } : {}) };
      if (procedure) procedure.revisions.push(revision); else task.procedures.push({ id: randomUUID(), revisions: [revision] });
      return task;
    }));
  }
  checkProcedure(taskId: string, procedureId: string, context: { project?: string; values: Record<string, string> }): Promise<{ ready: boolean; failures: string[]; executionAuthorized: false }> {
    return this.exclusive(() => {
      const task = this.task(this.state, taskId), procedure = task.procedures.find(item => item.id === procedureId);
      if (!procedure) return reject('not-found', 'Procedure was not found in this task.');
      const revision = latest(procedure.revisions), failures: string[] = [];
      if (revision.scope.project && revision.scope.project !== context.project) failures.push('Project scope differs.');
      try { this.validRefs(task, revision.sourceRefs); } catch { failures.push('Procedure sources require refresh or correction.'); }
      revision.steps.forEach((step, index) => step.preconditions.forEach(condition => { if (!Object.hasOwn(context.values, condition.key) || context.values[condition.key] !== condition.equals) failures.push(`Step ${index + 1}: ${condition.key} must equal ${condition.equals}.`); }));
      return { ready: failures.length === 0, failures, executionAuthorized: false };
    });
  }

  private action(task: Task, actionId: string): ExportAction {
    const action = task.actions.find(item => item.proposal.id === actionId); if (!action) return reject('not-found', 'Export proposal was not found.'); return action;
  }
  private artifactRevision(task: Task, artifactId: string, revision: number): ArtifactRevision {
    const artifact = task.artifacts.find(item => item.id === artifactId), result = artifact?.revisions.find(item => item.revision === revision);
    if (!result) return reject('not-found', 'Artifact revision was not found.'); return result;
  }
  private async destination(path: string) {
    if (!isAbsolute(path) || path !== resolve(path) || !basename(path) || path.includes('\0')) reject('invalid', 'Choose an exact absolute destination without traversal.');
    const parent = await realpath(dirname(path));
    const stat = await lstat(parent);
    if (!stat.isDirectory()) reject('invalid', 'Export parent must be a directory.');
    return { path: join(parent, basename(path)), parentRealPath: parent, parentDevice: String(stat.dev), parentInode: String(stat.ino) };
  }
  proposeExport(taskId: string, input: { artifactId: string; revision: number; path: string }): Promise<ExportAction> {
    return this.exclusive(async () => {
      const task = this.task(this.state, taskId), revision = this.artifactRevision(task, input.artifactId, input.revision);
      assertRawModuleOperationAllowed(revision.mimeType,'export');
      if (task.status !== 'active') reject('conflict', 'Resume the task before proposing an export.');
      this.validRefs(task, revision.sourceRefs);
      const destination = await this.destination(input.path);
      if (task.actions.some(action => action.proposal.path === destination.path && (action.status === 'uncertain' || action.status === 'executing'))) reject('conflict', 'Inspect the uncertain export at this destination before proposing another.');
      try { await lstat(input.path); return reject('conflict', 'Destination already exists. Choose a new filename.'); } catch (error) { if (!isCode(error, 'ENOENT')) throw error; }
      return this.commit(state => {
        const task = this.task(state, taskId);
        const fields = { id: randomUUID(), taskId, artifactId: input.artifactId, revision: input.revision, ...destination, artifactDigest: revision.digest, sourceRefs: clone(revision.sourceRefs), byteLength: artifactBytes(revision).length, createdAt: this.time() };
        const action: ExportAction = { proposal: { ...fields, digest: hash(JSON.stringify(fields)) }, status: 'proposed' };
        task.actions.push(action); return action;
      });
    });
  }
  approveExport(taskId: string, actionId: string, proposalDigest: string): Promise<ExportAction> {
    return this.exclusive(() => this.commit(state => {
      const task = this.task(state, taskId), action = this.action(task, actionId);
      assertRawModuleOperationAllowed(this.artifactRevision(task,action.proposal.artifactId,action.proposal.revision).mimeType,'export');
      if (task.status !== 'active' || action.status !== 'proposed' || action.proposal.digest !== proposalDigest) reject('conflict', 'Proposal changed, retired, or was already approved.');
      this.validRefs(task, action.proposal.sourceRefs);
      action.approvalId = randomUUID(); action.status = 'approved'; return action;
    }));
  }
  executeExport(taskId: string, input: { actionId: string; approvalId: string; requestId: string }): Promise<ExportAction> {
    return this.exclusive(async () => {
      const task = this.task(this.state, taskId), action = this.action(task, input.actionId);
      const revision = this.artifactRevision(task, action.proposal.artifactId, action.proposal.revision);
      assertRawModuleOperationAllowed(revision.mimeType,'export');
      if (action.requestId === input.requestId && action.approvalId === input.approvalId) return clone(action);
      if (task.status !== 'active' || action.status !== 'approved' || action.approvalId !== input.approvalId || action.approvalRetiredAt) reject('conflict', 'A current one-use approval is required.');
      this.validRefs(task, action.proposal.sourceRefs);
      const bytes = artifactBytes(revision);
      if (hash(bytes) !== action.proposal.artifactDigest || bytes.length !== action.proposal.byteLength) reject('conflict', 'Artifact bytes differ from the approved proposal.');
      const destination = await this.destination(action.proposal.path);
      if (destination.parentDevice !== action.proposal.parentDevice || destination.parentInode !== action.proposal.parentInode) reject('conflict', 'Destination directory changed after approval.');
      await this.commit(state => {
        this.claimRequest(state, input.requestId);
        const current = this.action(this.task(state, taskId), input.actionId);
        current.status = 'executing'; current.requestId = input.requestId; current.approvalRetiredAt = this.time();
      });
      let evidence: ExportEvidence | undefined, failure: unknown, opened = false;
      try {
        const currentDestination = await this.destination(action.proposal.path);
        if (currentDestination.parentDevice !== action.proposal.parentDevice || currentDestination.parentInode !== action.proposal.parentInode) reject('conflict', 'Destination directory changed before the write.');
        const file = await open(action.proposal.path, 'wx', 0o600); opened = true;
        try {
          const parentAfterOpen = await this.destination(action.proposal.path);
          if (parentAfterOpen.parentDevice !== action.proposal.parentDevice || parentAfterOpen.parentInode !== action.proposal.parentInode) reject('conflict', 'Destination directory changed while opening the export.');
          await file.writeFile(bytes); await file.sync();
        } finally { await file.close(); }
        evidence = await this.inspectBytes(action);
      } catch (error) { failure = error; }
      // If the ledger cannot commit, executing stays durable and restart requires inspection.
      return this.commit(state => {
        const current = this.action(this.task(state, taskId), input.actionId);
        if (evidence) { current.status = 'verified'; current.evidence = evidence; }
        else { current.status = opened ? 'uncertain' : 'failed'; current.error = failure instanceof Error ? failure.message : String(failure); }
        return current;
      });
    });
  }
  private async inspectBytes(action: ExportAction): Promise<ExportEvidence> {
    const stat = await lstat(action.proposal.path);
    if (!stat.isFile() || stat.isSymbolicLink()) reject('conflict', 'Destination is not a regular file.');
    const file = await open(action.proposal.path, 'r');
    let bytes: Buffer;
    try {
      const actual = await file.stat();
      if (!actual.isFile() || actual.ino !== stat.ino || actual.dev !== stat.dev) reject('conflict', 'Destination changed during inspection.');
      bytes = await file.readFile();
    } finally { await file.close(); }
    const digest = hash(bytes);
    if (bytes.length !== action.proposal.byteLength || digest !== action.proposal.artifactDigest) reject('conflict', 'Destination bytes do not match the approved artifact.');
    return { path: action.proposal.path, byteLength: bytes.length, digest, verifiedAt: this.time() };
  }
  inspectExport(taskId: string, actionId: string): Promise<ExportAction> {
    return this.exclusive(async () => {
      const action = this.action(this.task(this.state, taskId), actionId);
      if (!['executing', 'uncertain', 'verified'].includes(action.status)) reject('conflict', 'This export has no uncertain or completed write to inspect.');
      let evidence: ExportEvidence | undefined, failure: unknown;
      try { evidence = await this.inspectBytes(action); } catch (error) { failure = error; }
      return this.commit(state => {
        const current = this.action(this.task(state, taskId), actionId);
        if (evidence) { current.status = 'verified'; current.evidence = evidence; delete current.error; }
        else { current.status = isCode(failure, 'ENOENT') ? 'failed' : 'uncertain'; delete current.evidence; current.error = failure instanceof Error ? failure.message : String(failure); }
        return current;
      });
    });
  }
  /** Restoration closes the live store but retains its existing ownership through replacement and rollback. */
  closeForContentRestore<T>(transaction:()=>Promise<T>):Promise<T>{
    const result=this.queue.then(async()=>{
      if(this.closed)return reject('closed','Companion is closed.');
      this.closed=true;for(const controller of this.controllers.values())controller.abort();this.controllers.clear();
      try{return await transaction();}finally{await this.releaseLock();}
    });
    this.queue=result.then(()=>undefined,()=>undefined);return result;
  }
  /** Close leaves running records for explicit interrupted-request reconciliation on next open. */
  close(): Promise<void> {
    const result = this.queue.then(async () => {
      if (this.closed) return;
      this.closed = true; for (const controller of this.controllers.values()) controller.abort(); this.controllers.clear(); await this.releaseLock();
    });
    this.queue = result.then(() => undefined, () => undefined); return result;
  }
}

export const createCompanion = (options: CompanionOptions): Promise<Companion> => Companion.open(options);
