import type {RequestNoticeObserver,RequestNoticeProducer} from '../../shared/request-notifications';
import {BrowserControl} from './control';
import {BROWSER_MANUAL_CONTROL_LIMITS} from '../../shared/browser-control';
import type {BrowserControlReply} from '../../shared/browser-control';
import {prepareBrowserContinuation,readBrowserContinuationInput,pendingBrowserContinuation,sameBrowserContinuationInput,type BrowserContinuationInput,type BrowserContinuationSelection} from '../../shared/browser-continuation';
import { createHash } from 'node:crypto';
import {LOCAL_HELPER_CONTEXT_NOTICE} from '../../core/interactive-modules';
import { dialog, type BrowserWindow } from 'electron';
import type { Companion } from '../../core/companion';
import type { MetaRunInput } from '../provider';
import type { ConnectionStatus } from '../../shared/bridge';
import { BrowserCoordinator, browserPlannerPrompt, parseBrowserPlan } from './coordinator';
import { BrowserReconciliation,untilInspectionStopped } from './reconciliation';
import type {ComposerDraft} from '../../core/task-session';
import type {BrowserWindowOwner} from './local-browser';
import {currentBrowserWorkflow,workflowInvocation,type BrowserWorkflowRun} from '../../shared/browser-workflow';
import {runAuthoredBrowserWorkflow} from './workflow-service';

type PlannerProvider = { accountScope():Promise<string>; status(): Promise<ConnectionStatus>; run(input: MetaRunInput): Promise<string> };
type Route = { key: string; provider: PlannerProvider };
type ActiveControl={control:BrowserControl;origin:string;binding:{kind:'provider';routeKey:string;assertAccountCurrent:()=>Promise<void>}|{kind:'workflow';workflow:BrowserWorkflowRun['workflow'];pathPrefix:string}};
/** Human-facing host boundary. No renderer boolean can approve transmission or execution. */
export class BrowserService {
  private readonly reconciliation: BrowserReconciliation;
  private readonly controls=new Map<string,ActiveControl>();
  private readonly returning=new Set<BrowserControl>();
  private readonly lifetime = new AbortController();
  constructor(private readonly core: Companion, private readonly options: {
    panel: () => BrowserWindow; route: () => Route;
    changed: (taskId: string) => void; progress: (taskId: string, requestId: string, text: string) => void;
    headless?: boolean;observeNotice?:RequestNoticeObserver;
    onWindowOwner?:BrowserWindowOwner;
  }) { this.reconciliation = new BrowserReconciliation(core, options.onWindowOwner); }
  private notice<T>(category:'question'|'permission',owner:RequestNoticeProducer,purpose:string,work:()=>Promise<T>,signal?:AbortSignal,validate?:()=>void|Promise<void>):Promise<T>{
    let original:Promise<T>|undefined;const once=()=>original??=(async()=>work())();
    try{void this.options.observeNotice?.(category,owner,purpose,once,signal,validate).catch(()=>{});}catch{}
    return once();
  }
  async continue(input:BrowserContinuationInput){
    const value=readBrowserContinuationInput(input),selection={taskId:value.taskId,requestId:value.previous.requestId,digest:value.previous.digest};
    const current=await this.core.getTask(value.taskId),pending=pendingBrowserContinuation(current);if(!pending||!sameBrowserContinuationInput(pending.input,value))throw Error('Save and check this exact remaining-work attempt before starting its browser.');
    const command=prepareBrowserContinuation(current,selection,value,value.requestId,value.previous.binding);
    return this.run({taskId:command.taskId,requestId:command.requestId,prompt:command.prompt,url:command.url,continuation:{selection,binding:command.previous.binding}});
  }
  async run(input: { taskId: string; requestId: string; prompt: string; url: string;submittedDraft?:ComposerDraft;continuation?:{selection:BrowserContinuationSelection;binding:string} }) {
    if(this.lifetime.signal.aborted)throw Error('This browser session has closed. Start a new request.');
    const taskId=input.taskId,requestId=input.requestId;
    const url = new URL(input.url);
    if (url.username || url.password || !['https:', 'http:'].includes(url.protocol) || (url.protocol === 'http:' && url.hostname !== '127.0.0.1')) throw Error('Use an HTTPS page without sign-in details in the address.');
    const validateContinuation=async()=>{if(input.continuation)prepareBrowserContinuation(await this.core.getTask(input.taskId),input.continuation.selection,input,input.requestId,input.continuation.binding);};
    await validateContinuation();
    const route=this.options.route();let accountScope:string|undefined;
    const coordinator = new BrowserCoordinator(this.core, {
      get endpointKey() { return service.options.route().key; },
      async plan(input) {
        const content = JSON.stringify({ context: input.context, currentObservation: input.observation });
        if(content.length>200_000)throw Error('This task and page exceed the browser planning limit. Save a checkpoint or choose a narrower page.');
        if(!accountScope||input.signal.aborted||this.endpointKey!==route.key)throw Error('The browser provider context changed. Review it again.');
        const response = await route.provider.run({expectedAccountScope:accountScope,captureFence:{assertCurrent:()=>{if(input.signal.aborted||service.options.route().key!==route.key)throw Error('The browser request changed before transmission.');},check:()=>service.core.assertRequestCurrent(taskId,requestId)}, prompt: browserPlannerPrompt(input.goal), sources: [{ id: 'browser-task-context', version: 1, kind: 'text', role: 'fact', label: 'This task and its isolated browser page', content, digest: createHash('sha256').update(content).digest('hex'), capturedAt: new Date().toISOString() }], signal: input.signal });
        await service.assertControlBinding(taskId,activeControl);
        if(input.signal.aborted)throw Error('The browser request changed before accepting its plan.');
        return parseBrowserPlan(response);
      },
    });
    const service = this;
    const control=new BrowserControl(),controlKey=JSON.stringify([input.taskId,input.requestId]);
    if(this.controls.has(controlKey))throw Error('This browser request is already running.');
    // shortcut: account fingerprints are sampled; use a provider session lease for atomic account ownership.
    const activeControl:ActiveControl={control,origin:url.origin,binding:{kind:'provider',routeKey:route.key,assertAccountCurrent:async()=>{if(!accountScope||await route.provider.accountScope()!==accountScope)throw Error('The browser provider account changed. Review it again.');}}};
    this.controls.set(controlKey,activeControl);
    try {
    const result = await coordinator.run({ taskId: input.taskId, requestId: input.requestId, goal: input.prompt,...(input.submittedDraft?{submittedDraft:input.submittedDraft}:{}), url: url.href, origin: url.origin, transmissionApproved: true,control,
      ...(input.continuation?{continuation:{previousRequestId:input.continuation.selection.requestId,previousDigest:input.continuation.selection.digest,bindingDigest:createHash('sha256').update(input.continuation.binding).digest('hex'),startPageDigest:createHash('sha256').update(url.href).digest('hex'),promptDigest:createHash('sha256').update(input.prompt).digest('hex')}}:{}),
      authorizeStart:async signal=>{
        await validateContinuation();
        if(this.lifetime.signal.aborted)throw Error('This browser session has closed. Start a new request.');
        const connection=await route.provider.status();accountScope=await route.provider.accountScope();
        if(this.lifetime.signal.aborted)throw Error('This browser session has closed. Start a new request.');
        if(signal.aborted)throw Error('Stopped before browser consent.');
        if(!connection.configured)throw Error('Connect the selected AI service before starting a browser task.');
        const consent = await this.notice('permission',{taskId:input.taskId,requestId:input.requestId},'browser-start',()=>dialog.showMessageBox(this.options.panel(), {
      type: 'question', signal, message: 'Use an isolated browser for this task?',
      detail: `Website: ${url.origin}\nTask: ${input.prompt}\n\nThis opens a fresh browser without your personal cookies or sign-ins. Visible pages, ordinary field values and this task’s conversation, saved choices and checkpoints will be sent to ${connection.provider === 'Meta' ? 'Meta' : 'OpenAI through your Codex plan'}${connection.tier === 'Standard' ? ' at Standard speed' : ''}. Up to eight planning steps may use your existing model allowance.\n\n${LOCAL_HELPER_CONTEXT_NOTICE}\n\nEach agent interaction asks for your approval. Some website editors are read-only here. Enter any drafted changes on the website yourself. Automatic page redirects are currently blocked; use the final page address. Agent interactions need exact approval; unapproved POST/PUT/PATCH/DELETE, other websites, uploads and downloads are blocked. Websites can still log page visits. Closing this panel keeps the task running; Stop ends this app’s work. Pause and take control waits for a started agent interaction to settle. ${BROWSER_MANUAL_CONTROL_LIMITS.join('\n\n')}`,
      buttons: ['Cancel', 'Open browser'], defaultId: 0, cancelId: 0,
    }),signal,()=>{if(this.lifetime.signal.aborted||signal.aborted||this.options.route().key!==route.key)throw Error('The original browser consent is no longer active.');});
    if (consent.response !== 1) throw Error('The browser task was not authorized. Nothing was sent.');
    if(await route.provider.accountScope()!==accountScope)throw Error('The browser provider account changed. Review it again.');
    if (this.options.route().key !== route.key) throw Error('The connection changed before the browser task started. Review it again.');
        await validateContinuation();
        if(signal.aborted)throw Error('Stopped before opening the browser.');
      },
      assertExecutionCurrent:()=>this.assertControlBinding(taskId,activeControl),
      headless: this.options.headless ?? false,onWindowOwner:this.options.onWindowOwner,
      onProgress: text => { this.options.changed(input.taskId); this.options.progress(input.taskId, input.requestId, text); },
      approveAction: async current => {
        if (this.lifetime.signal.aborted||current.signal.aborted || this.options.route().key !== route.key) return { approved: false };
        await this.assertControlBinding(taskId,activeControl);
        if(current.signal.aborted)return {approved:false};
        const action = current.proposal.intent, target = current.review.target;
        const choice=action.kind==='select'?target.options?.find(option=>option.value===action.value):undefined;
        if(action.kind==='select'&&!choice)throw Error('The reviewed choice is no longer available. Observe it again.');
        const fields = current.review.write ? [...new URLSearchParams(current.review.write.body)].map(([key, value]) => `${key}: ${/token|csrf|secret|password/i.test(key) ? '(website verification field)' : value}`).join('\n') : '';
        const decision = await this.notice('permission',{taskId:input.taskId,requestId:input.requestId},'browser-action',()=>dialog.showMessageBox(this.options.panel(), { type: 'question', signal:current.signal, message: current.review.write ? 'Submit this form?' : action.kind === 'fill' ? 'Enter this text?' : action.kind==='select'?'Select this option?':'Allow this browser interaction?', detail: `Page: ${current.observation.url}\nControl: ${target.label || target.role}\n\n${current.reason}\n\n${action.kind === 'select' ? `Option: ${choice!.label}\nValue: ${action.value}\n\nSelecting this option can change the website through same-site GET or HEAD requests. Select once approves this exact choice once and the same-site GET or HEAD requests it causes; their effects may be unknown. POST, PUT, PATCH and DELETE requests are blocked. A form submission using those methods needs separate review. An observed selection does not verify a website effect.` : action.kind === 'fill' ? `Text: ${action.value}` : current.review.write ? `Destination: ${current.review.write.url}\n${fields}\n\nThis approval is for this exact form and these values once.` : target.href ? `Open: ${target.href}` : 'This approval does not permit unknown network writes.'}${action.kind==='select'?'':`\n\nThis interaction can trigger same-site GET or HEAD requests that change the website; their effects may be unknown. Other website writes are blocked unless included in the reviewed submission. An observed page does not verify the website effect.`}`, buttons: ['Cancel', current.review.write ? 'Submit once' : action.kind==='select'?'Select once':'Allow once','Pause and take control'], defaultId: 0, cancelId: 0 }),current.signal,()=>{if(this.lifetime.signal.aborted||current.signal.aborted||this.options.route().key!==route.key)throw Error('The original browser action is no longer active.');});
        await this.assertControlBinding(taskId,activeControl);
        if(decision.response===2&&!current.signal.aborted&&this.options.route().key===route.key)control.take();
        if (decision.response !== 1 || current.signal.aborted || this.options.route().key !== route.key) return { approved: false };
        return { approved: true, ...(current.review.write ? { write: current.review.write } : {}) };
      },
    });
    this.options.changed(input.taskId);
    if (result.status !== 'completed') throw Error(result.error ?? 'The browser task stopped before completion. Your progress is kept.');
    return this.core.getTask(input.taskId);
    } finally {control.close();this.controls.delete(controlKey);}
  }
  async runWorkflow(input:BrowserWorkflowRun,assertHostCurrent:()=>void=()=>{}){
    const assertCurrent=()=>{assertHostCurrent();if(this.lifetime.signal.aborted)throw Error('This browser session has closed. Start a new request.');};
    assertCurrent();
    const workflow=currentBrowserWorkflow(await this.core.getTask(input.taskId),input.workflow);workflowInvocation(workflow,input.url,input.inputs);assertCurrent();
    const control=new BrowserControl(),key=JSON.stringify([input.taskId,input.requestId]);
    if(this.controls.has(key))throw Error('This browser request is already running.');
    this.controls.set(key,{control,origin:workflow.origin,binding:{kind:'workflow',workflow:input.workflow,pathPrefix:workflow.pathPrefix}});
    try{return await runAuthoredBrowserWorkflow(this.core,input,{control,panel:this.options.panel,observeNotice:this.options.observeNotice,assertCurrent,changed:this.options.changed,headless:this.options.headless,onWindowOwner:this.options.onWindowOwner});}
    finally{control.close();this.controls.delete(key);}
  }
  controlStatus(input:{taskId:string;requestId:string}):BrowserControlReply{return this.controls.get(JSON.stringify([input.taskId,input.requestId]))?.control.status()??{mode:'unavailable'};}
  private async assertControlBinding(taskId:string,current:ActiveControl){
    if(this.lifetime.signal.aborted)throw Error('This browser control is no longer active.');
    if(current.binding.kind==='provider'){
      if(this.options.route().key!==current.binding.routeKey)throw Error('This browser request changed. Stop it and review a new request.');
      await current.binding.assertAccountCurrent();
      if(this.lifetime.signal.aborted||this.options.route().key!==current.binding.routeKey)throw Error('This browser request changed. Stop it and review a new request.');
    }else currentBrowserWorkflow(await this.core.getTask(taskId),current.binding.workflow);
  }
  async changeControl(input:{taskId:string;requestId:string;id:string;action:'take'|'return'}):Promise<BrowserControlReply>{
    const key=JSON.stringify([input.taskId,input.requestId]),current=this.controls.get(key);
    if(!current||current.control.status().id!==input.id||this.lifetime.signal.aborted)throw Error('This browser control is no longer active.');
    if(input.action==='take')return current.control.take();
    if(current.control.status().mode!=='user')throw Error('Wait until browser work is paused before returning control.');
    const requestSignal=current.control.requestSignal;
    if(!requestSignal||requestSignal.aborted)throw Error('This browser request changed. Stop it and review a new request.');
    await this.assertControlBinding(input.taskId,current);
    if(this.controls.get(key)!==current||requestSignal.aborted||this.lifetime.signal.aborted)throw Error('This browser control is no longer active.');
    const signal=AbortSignal.any([requestSignal,this.lifetime.signal]);
    if(this.returning.has(current.control))throw Error('Browser control return is already being reviewed.');
    this.returning.add(current.control);
    try {
    const continuation=current.binding.kind==='workflow'?`Glint will read the current page again and continue the exact reviewed saved workflow. No model request is made. Every request must remain within the saved path ${current.binding.pathPrefix}.`:'Glint will read the current page again and send its visible content and ordinary field values to the previously approved AI service.';
    const decision=await this.notice('permission',{taskId:input.taskId,requestId:input.requestId},'browser-return',()=>dialog.showMessageBox(this.options.panel(),{type:'question',signal,message:'Return browser control to Glint?',detail:`Website: ${current.origin}\n\n${continuation} Do not enter passwords or other private data. ${BROWSER_MANUAL_CONTROL_LIMITS.join('\n\n')}`,buttons:['Keep control','Return control'],defaultId:0,cancelId:0}),signal,async()=>{await this.assertControlBinding(input.taskId,current);if(signal.aborted||this.controls.get(key)!==current)throw Error('The original control review is no longer active.');});
    await this.assertControlBinding(input.taskId,current);
    if(this.controls.get(key)!==current||signal.aborted)throw Error('This browser control is no longer active.');
    return decision.response===1?current.control.returnToAgent():current.control.status();
    } finally {this.returning.delete(current.control);}
  }
  async inspect(input: { taskId: string; runId: string; operationId: string; url: string },control?:{signal:AbortSignal;beginCommit:()=>void}) {
    const signal=control?AbortSignal.any([this.lifetime.signal,control.signal]):this.lifetime.signal;
    if(signal.aborted)throw Error('Browser inspection stopped.');
    const permission = await this.notice('permission',{taskId:input.taskId,requestId:input.runId},'browser-inspection',()=>untilInspectionStopped(dialog.showMessageBox(this.options.panel(), { type: 'question', signal, message: 'Check the earlier action’s outcome?', detail: `Open a fresh read-only view of ${input.url}. This will not retry the earlier action or use a personal sign-in. No model request is made.`, buttons: ['Cancel', 'Inspect page'], defaultId: 0, cancelId: 0 }),signal),signal);
    if (permission.response !== 1) {const task=await untilInspectionStopped(this.core.getTask(input.taskId),signal);if(signal.aborted)throw Error('Browser inspection stopped.');return task;}
    const inspection = await untilInspectionStopped(this.reconciliation.inspect({ ...input, signal }),signal);
    const text = inspection.observation.text;
    await this.reconciliation.resolve(inspection.id, async (current,checkNoticeCurrent) => {
      if(signal.aborted)throw Error('Browser inspection stopped.');
      const outcome = await this.notice('question',{taskId:input.taskId,requestId:input.runId},'browser-outcome',()=>untilInspectionStopped(dialog.showMessageBox(this.options.panel(), { type: 'question', signal, message: 'What does this fresh page show?', detail: `Earlier action: ${current.reason}\nPage: ${current.observation.url}\n\n${text.slice(0, 8_000)}${text.length > 8_000 ? '\n\nOnly an excerpt is shown. Leave the outcome uncertain if this is not enough evidence.' : ''}\n\nThis records your review. It does not retry the action.`, buttons: ['Leave uncertain', 'It completed', 'It did not complete'], defaultId: 0, cancelId: 0 }),signal),signal,checkNoticeCurrent);
      return { outcome: outcome.response === 1 ? 'completed' : outcome.response === 2 ? 'not-completed' : 'uncertain', note: outcome.response === 1 ? 'User reviewed the fresh observed page and reported the action completed.' : outcome.response === 2 ? 'User reviewed the fresh observed page and reported the action did not complete.' : 'The fresh observed page did not settle the outcome.' };
    },{signal,beginCommit:control?.beginCommit??(()=>{})});
    this.options.changed(input.taskId); return this.core.getTask(input.taskId);
  }
  close(){this.lifetime.abort();for(const {control} of this.controls.values())control.close();this.controls.clear();}
}
