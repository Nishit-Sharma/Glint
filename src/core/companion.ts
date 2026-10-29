import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { Effect, Either,Schema } from 'effect';
import { isCode, readState, StateValidationError, writeState, type State } from './store';
import { parseModelDraft } from './model-drafts';
import {sourceResumeContext} from './source-resume';
import type {DocumentBinding,DocumentReconciliation} from '../shared/document-source';
import { projectTaskDialogue } from './task-dialogue';
import {readResponseBranchInput,responseBranchSnapshot} from './response-branch';
import {parseModuleAnswer} from './interactive-modules';
import {assertRawModuleOperationAllowed} from '../shared/module-contract';
import {readLocalTaskStart,type LocalTaskStartResult} from '../shared/local-task-start';
import {encodeLocalStartReceipt,findLocalStartReceipt,type LocalStartReceipt} from './local-start-receipt';
import {readSourceTextSave,readSourceTextSaveInspection,sourceTextSaveBindingText,SOURCE_TEXT_SAVE_BINDING_PREFIX,type SourceTextSaveConfirmed,type SourceTextSaveInspection,type SourceTextSaveInspectionInput} from '../shared/source-text-save';
import {encodeSourceTextSaveReceipt,findSourceTextSaveReceipt,sourceTextSaveClaim,type SourceTextSaveReceipt} from './source-text-save-receipt';
import { emptyTaskSession, recoverTaskSession,readComposerDraft,ComposerKindSchema,type ComposerDraft,type ComposerKind, type TaskSession } from './task-session';
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
  const {draft:_draft,draftKind:_kind,draftRevision:_revision,...rest}=session;
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
      const state = await Effect.runPromise(readState(options.dataDir));
      const time = nowIso(options.now ?? (() => new Date()));
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
  beginBrowserRun(taskId:string,run:Omit<TaskSession['runs'][number],'operations'>,expectedContextRevision:number):Promise<TaskSession>{
    return this.exclusive(()=>this.commit(state=>{
      const task=this.task(state,taskId),request=task.requests.find(request=>request.id===run.id),session=task.session??emptyTaskSession();
      if(task.status!=='active'||request?.kind!=='browser'||request.status!=='running')return reject('conflict','The browser request stopped before its first observation was saved.');
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
  putSource(taskId: string, sourceInput: SourceInput, expectedTask?:Task, expectedSource?:SourceRef&{freshness?:Source['freshness']}, assertCurrent:()=>void=()=>{}): Promise<Task> {
    const input=clone(sourceInput),expected=expectedTask?clone(expectedTask):undefined,expectedRef=expectedSource?clone(expectedSource):undefined;
    return this.exclusive(async () => {
      const task = await this.commit(state => {
        assertCurrent();const task = this.task(state, taskId);
        if(expectedRef){const source=task.sources.find(source=>source.id===expectedRef.sourceId),current=source?.versions.at(-1);if(input.id!==expectedRef.sourceId||source?.currentVersion!==expectedRef.version||current?.version!==expectedRef.version||current.digest!==expectedRef.digest||(expectedRef.freshness!==undefined&&source?.freshness!==expectedRef.freshness))return reject('conflict','The selected source or its freshness changed while the snapshot was pending.');}
        if(expected&&(expected.id!==taskId||JSON.stringify(task)!==JSON.stringify(expected)))return reject('conflict','This new task changed while the capture was pending. Capture the window again.');
        this.appendSource(task,input); return task;
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
      const task = this.task(state, taskId); task.status = 'active';
      const affectedArtifacts = task.artifacts.flatMap(artifact => {
        const revisions = artifact.revisions.filter(revision => { try { this.validRefs(task, revision.sourceRefs); return false; } catch { return true; } }).map(revision => revision.revision);
        return revisions.length ? [{ artifactId: artifact.id, revisions }] : [];
      });
      return { task, sourceContext:sourceResumeContext(task), staleSourceIds: task.sources.filter(source => source.freshness !== 'fresh').map(source => source.id), affectedArtifacts, interruptedRequestIds: task.requests.filter(request => request.status === 'interrupted').map(request => request.id) };
    }));
  }

  async runRequest(input: RequestInput, runner: (context: RequestContext) => Promise<RequestOutput>, assertCurrent?:()=>void): Promise<RequestRecord> {
    input = clone(input);
    if(input.submittedDraft!==undefined){try{input.submittedDraft=Schema.decodeUnknownSync(SubmittedComposerDraftSchema,{onExcessProperty:'error'})(input.submittedDraft);if(!Number.isSafeInteger(input.submittedDraft.revision))throw Error('Invalid revision.');}catch{return reject('invalid','Submitted composer draft is invalid.');}}
    let boundSubmittedDraft:ComposerDraft|undefined;
    const controller = new AbortController();
    const begun = await this.exclusive(async () => {
      const task = this.task(this.state, input.taskId), sourceRefs = this.requestRefs(task, input.sourceIds);
      if(input.expectedSourceRefs!==undefined){const refs=input.expectedSourceRefs;if(!Array.isArray(refs)||refs.length!==sourceRefs.length||new Set(refs.map(ref=>ref?.sourceId)).size!==refs.length||refs.some(ref=>!ref||Object.keys(ref).sort().join(',')!=='digest,sourceId,version'||!sourceRefs.some(actual=>actual.sourceId===ref.sourceId&&actual.version===ref.version&&actual.digest===ref.digest)))reject('conflict','Selected source versions changed. Review the current snapshot.');input.expectedSourceRefs=clone(sourceRefs);}
      const digest = hash(JSON.stringify({ ...input, sourceIds: input.sourceIds === undefined ? undefined : sourceRefs.map(ref => ref.sourceId), sourceRefs }));
      const existing = task.requests.find(request => request.id === input.requestId);
      if (existing) {
        // Existing stores may contain the previous payload-only digest for an unscoped request.
        const legacyReplay = input.sourceIds === undefined && existing.digest === hash(JSON.stringify(input));
        if (existing.digest !== digest && !legacyReplay) reject('conflict', 'Request ID has a different payload or source scope.');
        return { existing: clone(existing) };
      }
      const context = await this.commit(state => {
        const task = this.task(state, input.taskId); if (task.status !== 'active') reject('conflict', 'Resume the task before starting a request.');
        text(input.kind, 'Request kind', 100); text(input.prompt, 'Prompt', 50_000); this.claimRequest(state, input.requestId);
        if (input.executionScope !== undefined) text(input.executionScope, 'Execution scope', 2000);
        if (input.artifactId) {
          const artifact = task.artifacts.find(item => item.id === input.artifactId);
          if (!artifact || latest(artifact.revisions).revision !== input.expectedRevision) reject('conflict', 'Artifact changed. Reload before revising.');
        }
        this.validRefs(task, sourceRefs);
        if(input.expectedArtifacts!==undefined)this.validArtifacts(task,input.expectedArtifacts);
        if(input.expectedModuleStates!==undefined)this.validModuleStates(task,input.expectedModuleStates);
        if(input.submittedDraft&&!input.artifactId&&['explain','create','experiment','procedure','browser'].includes(input.kind)&&input.prompt===input.submittedDraft.text.trim()&&sameComposerDraft(readComposerDraft(task.session),input.submittedDraft))boundSubmittedDraft=input.submittedDraft;
        task.requests.push({ id: input.requestId, kind: input.kind, prompt: input.prompt, digest, status: 'running', sourceRefs, startedAt: this.time(), ...(input.artifactId ? { targetArtifactId: input.artifactId, expectedRevision: input.expectedRevision } : {}) });
        const selected = new Set(sourceRefs.map(ref => ref.sourceId));
        return { ...(['explain','create','revise'].includes(input.kind)?{taskHistory:projectTaskDialogue(task,input.requestId,sourceRefs)}:{}), task: { ...task,...(task.session?{session:requestSession(task.session)}:{}), sources: task.sources.filter(source => selected.has(source.id)).map(source => ({ ...source, versions: [latest(source.versions)] })) }, sourceRefs };
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
            const artifact = this.appendArtifact(task, { ...output, artifactId: input.artifactId, expectedRevision: input.expectedRevision, sourceRefs: request.sourceRefs });
            request.status = 'completed'; request.artifactId = artifact.artifactId;
            const saved=artifact.revision;request.answer={artifactId:artifact.artifactId,revision:saved.revision,digest:saved.digest};
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
