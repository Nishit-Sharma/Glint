import {pendingFollowups} from '../src/shared/queued-followup';
import {createRecurringWorkRunner} from '../src/host/recurring-work-runner';
import {ConversationExports} from '../src/host/conversation-export';
import {readConversationExportCommand} from '../src/shared/conversation-export';
import {prepareConceptMapGeneration} from '../src/host/concept-map-generation';
import {ResponsePreferences} from '../src/host/response-preferences';
import {LearningDraftStore} from '../src/host/learning-drafts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { createCompanion, evaluateExperiment, type Companion } from '../src/core/companion';
import type { BrowserInspectionStopResult, CompactFit, Command, CompanionBridge, CompanionEvent, ConnectionStatus, HostStatus, Task } from '../src/shared/bridge';
import {isExportCommand,readExportReply,type ExportHandlers} from '../src/shared/export-contract';
import {CharacterPreferences} from '../src/host/character-preferences';
import {screenBriefInsight} from '../src/core/screen-brief';
import {TaskViewPreferences} from '../src/host/task-view-preferences';
import type {BrowserReviewNotesSaved} from '../src/shared/browser-review-notes';

declare global {
  interface Window {
    __browserFixtureInvoke: CompanionBridge['invoke'];
    __browserFixtureEvent: (event: CompanionEvent) => void;
  }
}
type ModelCommand = Extract<Command, { type: 'model.run' }>;
type ModelControl = { command: ModelCommand; resolve: (value: { title: string; content: string; mimeType: string }) => void; reject: (reason: Error) => void };

/** Browser-only host fixture. Durable task behavior uses the real core and a disposable directory.
 * Native capabilities and provider transport are explicit substitutes; this proves neither route. */
export class BrowserFixture {
  conversationExports!:ConversationExports;
  recurringWorkRunner?:ReturnType<typeof createRecurringWorkRunner>;
  readonly recurringAuthorizations=new Set<string>();
  startRecurringWork(){this.recurringWorkRunner=createRecurringWorkRunner({prepare:async guard=>{
    const ids=await this.core.prepareRecurringWork('fixture-bot',guard,[...this.recurringAuthorizations]);
    for(const item of await this.core.getRecurringWork())for(const run of item.history)if(item.mode==='response'&&run.status==='running'&&run.requestId&&ids.includes(run.taskId)){
      guard();await this.core.runRequest({taskId:run.taskId,requestId:run.requestId,kind:'explain',prompt:item.instruction,sourceIds:[],expectedSourceRefs:[],executionScope:'synthetic-browser-recurring'},async()=>({title:'Synthetic scheduled response',content:'SYNTHETIC RECURRING PASS',mimeType:'text/markdown'}),guard);await this.core.finishRecurringWork(item.id,run.taskId,run.requestId);
    }return ids;
  },changed:ids=>{void this.emit({type:'schedules.changed'});if(ids.length)void this.changed();}});this.recurringWorkRunner.start();}
  viewPreferences!:TaskViewPreferences;
  learningDrafts!:LearningDraftStore;
  preferences!:CharacterPreferences;
  responsePreferences!:ResponsePreferences;
  preferenceSaveError?:string;
  losePreferenceAcknowledgement=false;
  loseBranchAcknowledgement=false;
  loseModelAcknowledgement=false;
  readonly commands: Command[] = [];
  readonly pending = new Map<string, ModelControl>();
  readonly modelInvocations: ModelCommand[] = [];
  readonly externalRequests: string[] = [];
  configured=true;
  checkBarrier?:Promise<void>;
  browserError?:string;
  taskPinError?:string;
  taskAttentionError?:string;
  taskAttentionBarrier?:Promise<void>;
  browserCompletion?:Promise<void>;
  browserInspection?:(command:Extract<Command,{type:'browser.inspect'}>)=>Promise<Task>;
  browserInspectionCancel?:(command:Extract<Command,{type:'browser.inspect.cancel'}>)=>Promise<BrowserInspectionStopResult>;
  browserReviewNotes?:(command:Extract<Command,{type:'browser.review.notes'}>)=>Promise<BrowserReviewNotesSaved>;
  draftSaveBarrier?:Promise<void>;
  draftSaveError?:string;
  calculationBarrier?:Promise<void>;
  exitBarrier?:Promise<void>;
  captureExitSnapshot?:()=>Promise<string>;
  taskListBarrier?:Promise<void>;
  taskRead?:(taskId:string)=>Promise<Task>;
  exportProposalBarrier?:Promise<void>;
  cancelExport=false;
  denyExportApproval=false;
  exportPath?:string;
  uncertainExport=false;
  private readonly uncertainExports=new Set<string>();
  private collapseExit?:string;
  private exitCapture?:{id:string;purpose:'quit'|'collapse';started:boolean;dataUrl?:string};
  private entranceId?:string;
  private activation?:{activationId:string;tucked:boolean};
  private surface:'workspace'|'companion'|'anchor'='workspace';
  private lastSurface:'workspace'|'companion'='workspace';
  private constructor(readonly page: Page, readonly directory: string, public core: Companion, readonly taskA: Task, readonly taskB: Task) {}

  static async open(page: Page, mode?:'companion'|'anchor',port=Number(process.env.WINDOW_COMPANION_TEST_PORT??4173)) {
    const directory = await mkdtemp(join(tmpdir(), 'window-companion-browser-'));
    const core = await createCompanion({ dataDir: join(directory, 'store') });
    let taskA = await core.createTask({ title: 'Task Alpha', goal: 'Keep Alpha sources and results separate.' });
    taskA = await core.putSource(taskA.id, { kind: 'text', label: 'Alpha brief', role: 'fact', content: 'Alpha event is on October 23.' });
    await core.saveArtifact(taskA.id, { title: 'Alpha draft', content: 'Alpha revision one.' });
    let taskB = await core.createTask({ title: 'Task Beta', goal: 'Keep Beta sources and results separate.' });
    taskB = await core.putSource(taskB.id, { kind: 'text', label: 'Beta brief', role: 'fact', content: 'Beta event is on November 5.' });
    await core.saveArtifact(taskB.id, { title: 'Beta draft', content: 'Beta revision one.' });
    const fixture = new BrowserFixture(page, directory, core, await core.getTask(taskA.id), await core.getTask(taskB.id));
    fixture.conversationExports=new ConversationExports(id=>fixture.core.getTask(id));
    fixture.learningDrafts=new LearningDraftStore({directory:join(directory,'store'),lookupTask:async id=>(await fixture.core.listTasks()).find(task=>task.id===id)});
    fixture.preferences=await CharacterPreferences.open(join(directory,'store'));
    fixture.responsePreferences=new ResponsePreferences(join(directory,'store'));
    fixture.viewPreferences=new TaskViewPreferences(join(directory,'store'),async id=>(await fixture.core.listTasks()).some(task=>task.id===id),id=>fixture.core.getTask(id));
    await fixture.viewPreferences.select(taskA.id);
    if(mode==='companion')fixture.lastSurface='companion';if(mode)fixture.surface=mode;
    await page.exposeFunction('__browserFixtureInvoke',async(command:Command)=>{const result=await fixture.invoke(command);return isExportCommand(command)?readExportReply(command,result):result;});
    await page.addInitScript(() => {
      const listeners = new Set<(event: CompanionEvent) => void>();
      window.__browserFixtureEvent = event => { for (const listener of listeners) listener(event); };
      window.companion = { invoke: window.__browserFixtureInvoke, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
    });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname === '127.0.0.1' && url.port === String(port)) return route.continue();
      fixture.externalRequests.push(url.href);
      return route.abort('blockedbyclient');
    });
    try { await page.goto('http://127.0.0.1:'+port+(mode?'?mode='+mode:'')); }
    catch (error) { await fixture.close(); throw error; }
    return fixture;
  }

  emit(event: CompanionEvent) { if(event.type==='surface'){if(event.mode!=='panel')this.surface=event.mode;if(event.mode==='workspace'||event.mode==='companion')this.lastSurface=event.mode;}return this.page.evaluate(event => window.__browserFixtureEvent(event), event); }
  async changed(taskId?: string) { await this.emit({ type: 'changed', taskId }); }
  async restartCore(){await this.recurringWorkRunner?.stop();this.recurringAuthorizations.clear();await this.core.close();this.core=await createCompanion({dataDir:join(this.directory,'store')});this.recurringWorkRunner?.start();await this.changed();}
  async enter(mode:'workspace'|'companion',compactFit?:CompactFit){this.entranceId=crypto.randomUUID();await this.emit({type:'presentation.enter',entranceId:this.entranceId,mode});await this.emit({type:'surface',mode,...(compactFit?{compactFit}:{})});return this.entranceId;}
  async prepareExit(exitId:string,dataUrl?:string,purpose:'quit'|'collapse'='quit'){if(!this.exitCapture)this.exitCapture={id:exitId,purpose,started:false,dataUrl};await this.emit({type:'presentation.prepare',exitId,purpose});}
  async stream(text: string, requestId = [...this.pending.keys()].at(-1)) {
    const control = requestId ? this.pending.get(requestId) : undefined;
    if (!control) throw new Error('No pending browser fixture request.');
    await this.emit({ type: 'stream', taskId: control.command.taskId, requestId: control.command.requestId, text:control.command.kind==='brief'?screenBriefInsight(text):text });
  }
  complete(text: string, requestId = [...this.pending.keys()].at(-1), mimeType='text/markdown') {
    const control = requestId ? this.pending.get(requestId) : undefined;
    if (!control) throw new Error('No pending browser fixture request.');
    control.resolve({ title: 'Fixture provider result', content: text, mimeType });
  }
  fail(reason: string, requestId = [...this.pending.keys()].at(-1)) {
    const control = requestId ? this.pending.get(requestId) : undefined;
    if (!control) throw new Error('No pending browser fixture request.');
    control.reject(new Error(reason));
  }
  async close() {
    for (const control of this.pending.values()) control.reject(new Error('Browser fixture closed.'));
    await this.recurringWorkRunner?.stop();await this.core.close(); await rm(this.directory, { recursive: true, force: true });
  }
  private async mutation(taskId: string, action: () => Promise<unknown>) {
    await action(); await this.changed(taskId); return this.core.getTask(taskId);
  }
  private exportOutcome(action:import('../src/core/types').ExportAction):import('../src/core/types').ExportAction{return this.uncertainExports.has(action.proposal.id)?{...action,status:'uncertain',evidence:undefined,error:'Simulated host acknowledgement loss after the actual write.'}:action;}
  private exportOutcomes(task:Task):Task{return {...task,actions:task.actions.map(action=>this.exportOutcome(action))};}
  private readonly exportHandlers:ExportHandlers={
    'export.propose':async command=>{
      if(this.cancelExport)return null;
      const action=await this.core.proposeExport(command.taskId,{artifactId:command.artifactId,revision:command.revision,path:this.exportPath??join(this.directory,`export-${command.artifactId}-${command.revision}.txt`)});
      await this.changed(command.taskId);
      if(this.exportProposalBarrier)await this.exportProposalBarrier;
      return action;
    },
    'export.approve':async command=>{
      if(this.denyExportApproval)throw new Error('File export was not approved.');
      const action=await this.core.approveExport(command.taskId,command.actionId,command.digest);
      if(!action.approvalId)throw new Error('Browser fixture approval unavailable');
      const result=await this.core.executeExport(command.taskId,{actionId:command.actionId,approvalId:action.approvalId,requestId:command.requestId});
      if(this.uncertainExport)this.uncertainExports.add(command.actionId);
      await this.changed(command.taskId);
      return this.exportOutcome(result);
    },
    'export.inspect':async command=>{const result=await this.core.inspectExport(command.taskId,command.actionId);this.uncertainExports.delete(command.actionId);return result;},
  };
  private async invoke(command: Command): Promise<unknown> {
    this.commands.push(structuredClone(command));
    switch (command.type) {
      case 'conversation.export.preview':{const parsed=readConversationExportCommand(command);if(parsed.type!=='conversation.export.preview')throw Error('Invalid conversation preview.');return this.conversationExports.preview(parsed);}
      case 'conversation.export.save':{const parsed=readConversationExportCommand(command);if(parsed.type!=='conversation.export.save')throw Error('Invalid conversation save.');return this.conversationExports.save(parsed,async preview=>this.cancelExport?null:this.exportPath??join(this.directory,'conversation.'+(preview.format==='markdown'?'md':'json')),()=>{});}
      case 'schedules.get':return {items:await this.core.getRecurringWork(),runtime:this.recurringWorkRunner?.read()??{state:'stopped',message:'Automatic draft preparation is stopped.'}};
      case 'schedules.change':{this.recurringAuthorizations.delete(command.change.id);const items=await this.core.changeRecurringWork(command.change);if(command.change.kind==='resume')this.recurringAuthorizations.add(command.change.id);await this.emit({type:'schedules.changed'});return {items,runtime:this.recurringWorkRunner?.read()??{state:'stopped',message:'Automatic draft preparation is stopped.'}};}
      case 'bots.get':return undefined;
      case 'response-preferences.get':return this.responsePreferences.read();
      case 'response-preferences.update':return this.responsePreferences.update({expectedRevision:command.expectedRevision,enabled:command.enabled,text:command.text});
      case 'preferences.get':return this.preferences.read();
      case 'preferences.update':{if(this.preferenceSaveError)throw Error(this.preferenceSaveError);const result=await this.preferences.update({expectedRevision:command.expectedRevision,profile:command.profile});if(this.losePreferenceAcknowledgement){this.losePreferenceAcknowledgement=false;throw Error('Fixture lost acknowledgement after commit.');}return result;}

      case 'presentation.capture':{
        const pending=this.exitCapture;if(!pending||pending.id!==command.exitId)throw Error('No matching fixture capture.');if(pending.started)return null;pending.started=true;
        const dataUrl=pending.dataUrl??(this.captureExitSnapshot?await this.captureExitSnapshot():await this.page.evaluate(()=>{const c=document.createElement('canvas');c.width=360;c.height=440;const context=c.getContext('2d')!;context.fillStyle='#202428';context.fillRect(0,0,360,440);context.fillStyle='#eee';context.font='24px system-ui';context.fillText('Synthetic collapse snapshot',20,70);return c.toDataURL('image/png');}));
        if(this.exitCapture===pending)await this.emit({type:'presentation.exit',exitId:pending.id,purpose:pending.purpose,dataUrl});return null;
      }
      case 'presentation.finish': if(this.exitBarrier)await this.exitBarrier;if(command.exitId===this.collapseExit){await this.emit({type:'surface',mode:'anchor'});return {purpose:'collapse',mode:'anchor'};}if(command.exitId===this.exitCapture?.id)this.exitCapture=undefined;return null;
      case 'presentation.reveal':if(command.exitId!==this.collapseExit)throw Error('No matching fixture presentation.');this.collapseExit=undefined;this.exitCapture=undefined;return null;
      case 'presentation.show':if(command.entranceId!==this.entranceId)throw Error('No matching fixture entrance.');this.entranceId=undefined;return null;
      case 'tasks.list': if(this.taskListBarrier)await this.taskListBarrier;return (await this.core.listTasks()).map(task=>this.exportOutcomes(task));
      case 'tasks.get': return this.exportOutcomes(await (this.taskRead?this.taskRead(command.taskId):this.core.getTask(command.taskId)));
      case 'tasks.branch':{const {type,...input}=command,saved=await this.core.branchFromResponse(input,'fixture-bot');await this.changed(saved.task.id);if(this.loseBranchAcknowledgement){this.loseBranchAcknowledgement=false;throw Error('Branch acknowledgement was lost.');}return saved;}
      case 'tasks.create': { const task = await this.core.createTask(command); await this.changed(task.id); return task; }
      case 'tasks.update': { const task = await this.core.updateTask(command.taskId, {title:command.title,goal:command.goal}); await this.changed(task.id); return task; }
      case 'tasks.pause': return this.mutation(command.taskId, () => this.core.pause(command.taskId));
      case 'tasks.resume': return this.mutation(command.taskId, () => this.core.resume(command.taskId));
      case 'tasks.checkpoint': return this.mutation(command.taskId, () => this.core.checkpoint(command.taskId, command.note));
      case 'queue.hold':return this.mutation(command.taskId,()=>this.core.holdQueuedFollowups(command.taskId,'Context review holds queued text.'));
      case 'queue.cancel':return this.mutation(command.taskId,()=>this.core.cancelQueuedFollowup(command.taskId,command.id,command.expectedRevision));
      case 'queue.submit':case 'queue.edit':{
        const task=await this.core.getTask(command.taskId),items=task.session?.queuedFollowups??[],existing=items.find(item=>item.id===command.id),precedingRequestIds=existing?[...existing.precedingRequestIds]:[...task.requests.filter(request=>request.status==='running').map(request=>request.id),...pendingFollowups(items).map(item=>item.id)],basis=await this.core.queuedFollowupBasis(task.id,command.expectedSourceRefs,precedingRequestIds);
        return this.mutation(task.id,()=>this.core.saveQueuedFollowup(task.id,{id:command.id,revision:(existing?.revision??0)+1,prompt:command.prompt,kind:command.kind,createdAt:existing?.createdAt??new Date().toISOString(),sourceRefs:command.expectedSourceRefs,precedingRequestIds,basis,scope:'a'.repeat(64),status:'queued'},existing?.revision??0,command.type==='queue.submit'?command.submittedDraft:undefined));
      }
      case 'draft.save':if(this.draftSaveBarrier)await this.draftSaveBarrier;if(this.draftSaveError)throw Error(this.draftSaveError);return this.core.saveComposerDraft(command.taskId,command.expectedRevision,command.draft);
      case 'draft.flushed':return null;
      case 'learning-drafts.read':return this.learningDrafts.read();
      case 'learning-drafts.save':return this.learningDrafts.save(command.owner,command.slot,command.expectedEpoch,command.expectedRevision,command.value);
      case 'learning-drafts.recover':return this.learningDrafts.recover(command.recoveryToken);
      case 'learning-drafts.cleanup':return this.learningDrafts.cleanup();
      case 'tasks.delete': await this.core.deleteTask(command.taskId);let draftCleanup:'removed'|'unconfirmed'='removed';try{await this.learningDrafts.purgeTask(command.taskId);}catch{draftCleanup='unconfirmed';}await this.changed();return draftCleanup==='removed'?null:{kind:'deleted',draftCleanup};
      case 'source.text.inspect':{const {type,...input}=command;return this.core.inspectTextSourceSave(input);}
      case 'source.text': {if(command.edit){const result=await this.core.saveTextSource({taskId:command.taskId,source:command.source,expectedSource:command.expectedSource,...command.edit});await this.emit({type:'changed',taskId:command.taskId});return {...result,task:await this.core.getTask(command.taskId)};}return this.mutation(command.taskId, () => this.core.putSource(command.taskId, command.source,undefined,command.expectedSource));}
      case 'source.invalidate': return this.mutation(command.taskId, () => this.core.invalidateSource(command.taskId, command.sourceId, 'Changed in browser fixture'));
      case 'source.preview': return null;
      case 'browser.detach': return this.mutation(command.taskId,()=>this.core.clearBrowserContext(command.taskId));
      case 'browser.inspect':{if(!this.browserInspection)throw Error('Browser inspection is not enabled in this renderer fixture.');const result=await this.browserInspection(command);await this.changed(command.taskId);return result;}
      case 'browser.inspect.cancel':{if(!this.browserInspectionCancel)throw Error('Browser inspection cancellation is not enabled in this renderer fixture.');return this.browserInspectionCancel(command);}
      case 'browser.review.notes':{const {type,...input}=command,result=this.browserReviewNotes?await this.browserReviewNotes(command):await this.core.saveBrowserReviewNotes(input);await this.changed(command.taskId);return result;}
      case 'browser.run':{
        if(!this.browserError&&!this.browserCompletion)throw Error('Browser execution is not enabled in this renderer fixture.');
        const request=await this.core.runRequest({taskId:command.taskId,requestId:command.requestId,kind:'browser',prompt:command.prompt,sourceIds:[],...(command.submittedDraft?{submittedDraft:command.submittedDraft}:{})},async()=>{await this.emit({type:'stream',taskId:command.taskId,requestId:command.requestId,text:'Reading the selected page…'});if(this.browserCompletion)await this.browserCompletion;if(this.browserError)throw Error(this.browserError);return {title:'Browser findings',content:'The observed page supports this answer.',mimeType:'text/markdown'};});
        await this.changed(command.taskId);if(request.status!=='completed')throw Error(request.error);return this.core.getTask(command.taskId);
      }
      case 'context.start':{const activation={activationId:crypto.randomUUID(),tucked:this.surface==='anchor',...(command.newTask?{newTask:true}:{}),...(command.source?{analyze:true,source:command.source,ownerTaskId:command.source.taskId}:command.ownerTaskId?{ownerTaskId:command.ownerTaskId}:{}),...(command.requestId?{requestId:command.requestId}:{}),target:{id:'window:99',title:'Visitor guide',owner:{name:'Document viewer'},bounds:{x:20,y:20,width:600,height:500}},choices:[]};this.activation=activation;await this.emit({type:'context.activate',activation});return null;}
      case 'task-attention.get':return this.viewPreferences.readAttention();
      case 'task-attention.change':if(this.taskAttentionBarrier)await this.taskAttentionBarrier;if(this.taskAttentionError)throw Error(this.taskAttentionError);return this.viewPreferences.changeAttention(command.change);
      case 'task-view.get':return this.viewPreferences.read();
      case 'task-pins.get':return this.viewPreferences.readPins();
      case 'task-pins.set':if(this.taskPinError)throw Error(this.taskPinError);return this.viewPreferences.setPinned(command.taskId,command.pinned);
      case 'context.pending':return this.activation?{kind:'ready',activation:this.activation}:{kind:'none'};
      case 'context.view':return this.viewPreferences.select(command.taskId??null);
      case 'context.cancel':if(this.activation?.activationId===command.activationId)this.activation=undefined;return null;
      case 'context.capture':{
        const activation=this.activation;if(!activation||activation.activationId!==command.activationId)throw Error('Screen selection expired.');this.activation=undefined;
        let task=command.taskId?await this.core.getTask(command.taskId):await this.core.createTask({title:'Visitor guide'});task=await this.core.putSource(task.id,{kind:'window',label:'Visitor guide',role:'fact',content:JSON.stringify({imageSha256:'browser-fixture-no-pixels'}),windowId:command.windowId,documentToken:'test-document'});await this.changed(task.id);if(activation.tucked)await this.enter('companion');return {state:'captured',activationId:activation.activationId,tucked:activation.tucked,task,sourceId:task.sources.at(-1)!.id};
      }
      case 'artifact.save': return this.mutation(command.taskId, () => this.core.saveArtifact(command.taskId, command.artifact));
      case 'procedure.save': return this.mutation(command.taskId, () => this.core.saveProcedure(command.taskId, command.procedure));
      case 'procedure.check': {const result=await this.core.checkProcedure(command.taskId, command.procedureId, { values: command.context });if(this.checkBarrier)await this.checkBarrier;return result;}
      case 'experiment.evaluate': {const result=evaluateExperiment(command.spec, command.inputs);if(this.calculationBarrier)await this.calculationBarrier;return result;}
      case 'model.run': {
        const concept=prepareConceptMapGeneration(await this.core.getTask(command.taskId),command);
        const target = command.artifactId ? (await this.core.getTask(command.taskId)).artifacts.find(artifact => artifact.id === command.artifactId) : undefined;
        const result = await this.core.runRequest(concept?.request??{ taskId: command.taskId, requestId: command.requestId, kind: command.kind, prompt: command.prompt, ...(command.submittedDraft?{submittedDraft:command.submittedDraft}:{}),...(command.conversationAttempt?{conversationAttempt:command.conversationAttempt}:{}),...(command.sourceIds!==undefined?{sourceIds:command.sourceIds}:{}),...(command.expectedSourceRefs?{expectedSourceRefs:command.expectedSourceRefs}:{}), ...(target ? { artifactId: target.id, expectedRevision: target.revisions.at(-1)?.revision } : {}) }, context => new Promise((resolve, reject) => {
          this.modelInvocations.push(command);
          const bound=concept?.bind(context);
          this.pending.set(command.requestId, { command, resolve:value=>{this.pending.delete(command.requestId);try{resolve(bound?bound.finish(value.content):value);}catch(error){reject(error);}}, reject:error=>{this.pending.delete(command.requestId);reject(error);} });
          context.signal.addEventListener('abort', () => this.pending.get(command.requestId)?.reject(new Error('Stopped by browser fixture transport')), { once: true });
        }));
        await this.changed(command.taskId);
        if (result.status !== 'completed') throw new Error(result.error || `Request ${result.status}`);
        if(this.loseModelAcknowledgement){this.loseModelAcknowledgement=false;throw Error('Fixture lost the model acknowledgement after the saved response.');}
        return this.core.getTask(command.taskId);
      }
      case 'model.cancel': return this.mutation(command.taskId, () => this.core.cancelRequest(command.taskId, command.requestId));
      case 'export.propose':return this.exportHandlers['export.propose'](command);
      case 'export.approve':return this.exportHandlers['export.approve'](command);
      case 'export.inspect':return this.exportHandlers['export.inspect'](command);
      case 'connection.status': {
        const connection: ConnectionStatus = { provider: 'Meta', configured: this.configured, endpoint: 'fixture://local', model: 'browser-transport-fixture', state: this.configured?'ready':'unconfigured', detail: 'Browser fixture only; no provider connection.', specialized: { sam: 'Unavailable in browser fixture', computer: 'Unavailable in browser fixture' } };
        const host: HostStatus = { platform: 'browser-fixture', screenPermission: 'not exercised', accessibilityPermission: 'not exercised', shortcut: 'Both Option keys', captureMode: 'explicit-frozen', memoryEnabled: false, dataDir: this.directory };
        return { connection, host };
      }
      case 'surface.collapse': {
        if(this.entranceId){const exitId=this.entranceId;this.entranceId=undefined;await this.emit({type:'presentation.cancel',exitId});await this.emit({type:'surface',mode:'anchor'});return null;}
        if(this.collapseExit)return null;this.collapseExit=crypto.randomUUID();await this.prepareExit(this.collapseExit,undefined,'collapse');return null;
      }
      case 'surface.expand': case 'surface.workspace': case 'surface.standalone': case 'surface.companion': {
        if(this.collapseExit){const exitId=this.collapseExit;this.collapseExit=undefined;this.exitCapture=undefined;await this.emit({type:'presentation.cancel',exitId});}
        const mode=command.type==='surface.expand'?this.lastSurface:command.type==='surface.companion'?'companion':'workspace';if(this.surface==='anchor'){this.entranceId=crypto.randomUUID();await this.emit({type:'presentation.enter',entranceId:this.entranceId,mode});}
        await this.emit({type:'surface',mode});return null;
      }
      default: throw new Error(`Capability ${command.type} is not implemented by the browser host fixture.`);
    }
  }
}
