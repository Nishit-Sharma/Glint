import { randomUUID } from 'node:crypto';
import { Schema } from 'effect';
import type { Companion } from '../../core/companion';
import { BrowserObservationSchema, type BrowserObservation } from '../../core/task-session';
import { LocalBrowser, type BrowserWindowOwner } from './local-browser';

const Review = Schema.Struct({ outcome: Schema.Literal('completed', 'not-completed', 'uncertain'), note: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2_000)) });
type OutcomeReview = typeof Review.Type;
type Inspection = { id: string; taskId: string; runId: string; operationId: string; reason: string; observation: BrowserObservation };

export function untilInspectionStopped<T>(pending:Promise<T>,signal:AbortSignal):Promise<T>{
  return new Promise((resolve,reject)=>{
    const stopped=()=>{cleanup();reject(Error('Browser inspection stopped.'));},cleanup=()=>signal.removeEventListener('abort',stopped);
    pending.then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
    if(signal.aborted){stopped();return;}
    signal.addEventListener('abort',stopped,{once:true});
  });
}

/** Fresh read-only inspection, followed by trusted human review. Never retries the old effect. */
export class BrowserReconciliation {
  private inspections = new Map<string, Inspection>();
  constructor(private readonly core: Companion, private readonly onWindowOwner?: BrowserWindowOwner) {}
  async inspect(input: { taskId: string; runId: string; operationId: string; url: string; signal?: AbortSignal }) {
    const task = await this.core.getTask(input.taskId), run = task.session?.runs.find(run => run.id === input.runId), operation = run?.operations.find(operation => operation.id === input.operationId);
    if (!run || !operation || operation.status !== 'uncertain') throw Error('This action does not need an uncertain-outcome inspection.');
    if (new URL(input.url).origin !== run.origin) throw Error('Inspect an explicitly selected page on the original website.');
    const browser = await LocalBrowser.open({ taskId: input.taskId, origin: run.origin, url: input.url, signal: input.signal, onWindowOwner: this.onWindowOwner });
    let inspection:Inspection;
    try {
      const observation = Schema.decodeUnknownSync(BrowserObservationSchema, { onExcessProperty: 'error' })(await browser.observe());
      if(input.signal?.aborted)throw Error('Browser inspection stopped.');
      inspection = { id: randomUUID(), taskId: input.taskId, runId: input.runId, operationId: input.operationId, reason: operation.reason, observation };
    } finally { await browser.close(); }
    if(input.signal?.aborted)throw Error('Browser inspection stopped.');
    this.inspections.set(inspection.id, inspection); return structuredClone(inspection);
  }
  async resolve(id: string, review: (inspection: Inspection) => Promise<OutcomeReview>, control?:{signal:AbortSignal;beginCommit:()=>void}) {
    const inspection = this.inspections.get(id);
    if (!inspection) throw Error('Inspect the current website before reviewing this outcome.');
    this.inspections.delete(id);
    const decision = Schema.decodeUnknownSync(Review, { onExcessProperty: 'error' })(await review(structuredClone(inspection)));
    if(control?.signal.aborted)throw Error('Browser inspection stopped.');
    const reading=this.core.getTask(inspection.taskId);
    const task = await (control?untilInspectionStopped(reading,control.signal):reading), session = task.session, run = session?.runs.find(run => run.id === inspection.runId), operation = run?.operations.find(operation => operation.id === inspection.operationId);
    if (!session || !run || !operation || operation.status !== 'uncertain' || new URL(inspection.observation.url).origin !== run.origin) throw Error('This action changed while its outcome was being reviewed. Inspect again.');
    if(control?.signal.aborted)throw Error('Browser inspection stopped.');
    control?.beginCommit();
    return this.core.replaceSession(inspection.taskId, session.revision, { ...session, runs: session.runs.map(run => run.id !== inspection.runId ? run : { ...run, operations: run.operations.map(operation => operation.id !== inspection.operationId ? operation : { ...operation, status: decision.outcome === 'completed' ? 'observed' : decision.outcome === 'not-completed' ? 'failed' : 'uncertain', reconciliation: { id: inspection.id, ...decision, basis: 'user-reviewed-observation', observation: inspection.observation } }) }) });
  }
}
