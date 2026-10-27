import { createHash } from 'node:crypto';
import { dialog, type BrowserWindow } from 'electron';
import type { Companion } from '../../core/companion';
import type { MetaRunInput } from '../provider';
import type { ConnectionStatus } from '../../shared/bridge';
import { BrowserCoordinator, browserPlannerPrompt, parseBrowserPlan } from './coordinator';
import { BrowserReconciliation } from './reconciliation';
import type {ComposerDraft} from '../../core/task-session';
import type {BrowserWindowOwner} from './local-browser';

type PlannerProvider = { status(): Promise<ConnectionStatus>; run(input: MetaRunInput): Promise<string> };
type Route = { key: string; provider: PlannerProvider };
/** Human-facing host boundary. No renderer boolean can approve transmission or execution. */
export class BrowserService {
  private readonly reconciliation: BrowserReconciliation;
  private readonly lifetime = new AbortController();
  constructor(private readonly core: Companion, private readonly options: {
    panel: () => BrowserWindow; route: () => Route;
    changed: (taskId: string) => void; progress: (taskId: string, requestId: string, text: string) => void;
    headless?: boolean;
    onWindowOwner?:BrowserWindowOwner;
  }) { this.reconciliation = new BrowserReconciliation(core); }
  async run(input: { taskId: string; requestId: string; prompt: string; url: string;submittedDraft?:ComposerDraft }) {
    if(this.lifetime.signal.aborted)throw Error('This browser session has closed. Start a new request.');
    const url = new URL(input.url);
    if (url.username || url.password || !['https:', 'http:'].includes(url.protocol) || (url.protocol === 'http:' && url.hostname !== '127.0.0.1')) throw Error('Use an HTTPS page without sign-in details in the address.');
    const route=this.options.route();
    const coordinator = new BrowserCoordinator(this.core, {
      get endpointKey() { return service.options.route().key; },
      async plan(input) {
        const content = JSON.stringify({ context: input.context, currentObservation: input.observation });
        const response = await route.provider.run({ prompt: browserPlannerPrompt(input.goal), sources: [{ id: 'browser-task-context', version: 1, kind: 'text', role: 'fact', label: 'This task and its isolated browser page', content, digest: createHash('sha256').update(content).digest('hex'), capturedAt: new Date().toISOString() }], signal: input.signal });
        return parseBrowserPlan(response);
      },
    });
    const service = this;
    const result = await coordinator.run({ taskId: input.taskId, requestId: input.requestId, goal: input.prompt,...(input.submittedDraft?{submittedDraft:input.submittedDraft}:{}), url: url.href, origin: url.origin, transmissionApproved: true,
      authorizeStart:async signal=>{
        if(this.lifetime.signal.aborted)throw Error('This browser session has closed. Start a new request.');
        const connection=await route.provider.status();
        if(this.lifetime.signal.aborted)throw Error('This browser session has closed. Start a new request.');
        if(signal.aborted)throw Error('Stopped before browser consent.');
        if(!connection.configured)throw Error('Connect the selected AI service before starting a browser task.');
        const consent = await dialog.showMessageBox(this.options.panel(), {
      type: 'question', signal, message: 'Use an isolated browser for this task?',
      detail: `Website: ${url.origin}\nTask: ${input.prompt}\n\nThis opens a fresh browser without your personal cookies or sign-ins. Visible pages, ordinary field values and this task’s conversation, saved choices and checkpoints will be sent to ${connection.provider === 'Meta' ? 'Meta' : 'OpenAI through your Codex plan'}${connection.tier === 'Standard' ? ' at Standard speed' : ''}. Up to eight planning steps may use your existing model allowance.\n\nEach interaction asks for your approval. Automatic page redirects are currently blocked; use the final page address. Form changes need exact approval; unknown writes, other websites, uploads and downloads are blocked. Websites can still log page visits. Closing this panel keeps the task running; Stop ends this app’s work.`,
      buttons: ['Cancel', 'Open browser'], defaultId: 0, cancelId: 0,
    });
    if (consent.response !== 1) throw Error('The browser task was not authorized. Nothing was sent.');
    if (this.options.route().key !== route.key) throw Error('The connection changed before the browser task started. Review it again.');
        if(signal.aborted)throw Error('Stopped before opening the browser.');
      },
      headless: this.options.headless ?? false,onWindowOwner:this.options.onWindowOwner,
      onProgress: text => { this.options.changed(input.taskId); this.options.progress(input.taskId, input.requestId, text); },
      approveAction: async current => {
        if (this.lifetime.signal.aborted||current.signal.aborted || this.options.route().key !== route.key) return { approved: false };
        const action = current.proposal.intent, target = current.review.target;
        const fields = current.review.write ? [...new URLSearchParams(current.review.write.body)].map(([key, value]) => `${key}: ${/token|csrf|secret|password/i.test(key) ? '(website verification field)' : value}`).join('\n') : '';
        const decision = await dialog.showMessageBox(this.options.panel(), { type: 'question', signal:current.signal, message: current.review.write ? 'Submit this form?' : action.kind === 'fill' ? 'Enter this text?' : 'Allow this browser interaction?', detail: `Page: ${current.observation.url}\nControl: ${target.label || target.role}\n\n${current.reason}\n\n${action.kind === 'fill' ? `Text: ${action.value}` : current.review.write ? `Destination: ${current.review.write.url}\n${fields}\n\nThis approval is for this exact form and these values once.` : target.href ? `Open: ${target.href}` : 'This approval does not permit unknown network writes.'}`, buttons: ['Cancel', current.review.write ? 'Submit once' : 'Allow once'], defaultId: 0, cancelId: 0 });
        if (decision.response !== 1 || current.signal.aborted || this.options.route().key !== route.key) return { approved: false };
        return { approved: true, ...(current.review.write ? { write: current.review.write } : {}) };
      },
    });
    this.options.changed(input.taskId);
    if (result.status !== 'completed') throw Error(result.error ?? 'The browser task stopped before completion. Your progress is kept.');
    return this.core.getTask(input.taskId);
  }
  async inspect(input: { taskId: string; runId: string; operationId: string; url: string }) {
    const permission = await dialog.showMessageBox(this.options.panel(), { type: 'question', message: 'Check the earlier action’s outcome?', detail: `Open a fresh read-only view of ${input.url}. This will not retry the earlier action or use a personal sign-in. No model request is made.`, buttons: ['Cancel', 'Inspect page'], defaultId: 0, cancelId: 0 });
    if (permission.response !== 1) return this.core.getTask(input.taskId);
    const inspection = await this.reconciliation.inspect({ ...input, signal: this.lifetime.signal });
    const text = inspection.observation.text;
    await this.reconciliation.resolve(inspection.id, async current => {
      const outcome = await dialog.showMessageBox(this.options.panel(), { type: 'question', message: 'What does this fresh page show?', detail: `Earlier action: ${current.reason}\nPage: ${current.observation.url}\n\n${text.slice(0, 8_000)}${text.length > 8_000 ? '\n\nOnly an excerpt is shown. Leave the outcome uncertain if this is not enough evidence.' : ''}\n\nThis records your review. It does not retry the action.`, buttons: ['Leave uncertain', 'It completed', 'It did not complete'], defaultId: 0, cancelId: 0 });
      return { outcome: outcome.response === 1 ? 'completed' : outcome.response === 2 ? 'not-completed' : 'uncertain', note: outcome.response === 1 ? 'User reviewed the fresh observed page and reported the action completed.' : outcome.response === 2 ? 'User reviewed the fresh observed page and reported the action did not complete.' : 'The fresh observed page did not settle the outcome.' };
    });
    this.options.changed(input.taskId); return this.core.getTask(input.taskId);
  }
  close(){this.lifetime.abort();}
}
