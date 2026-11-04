import { randomUUID } from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import { Schema } from 'effect';
import {CompanionError,type Companion} from '../../core/companion';
import { BrowserObservationSchema, type BrowserObservation, type TaskSession } from '../../core/task-session';
import { LocalBrowser, type BrowserWindowOwner } from './local-browser';
import type {Task} from '../../core/types';

const Review = Schema.Struct({ outcome: Schema.Literal('completed', 'not-completed', 'uncertain'), note: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2_000)) });
type OutcomeReview = typeof Review.Type;
type Inspection = { id: string; taskId: string; runId: string; operationId: string; reason: string; observation: BrowserObservation };
type Run = TaskSession['runs'][number];
type Binding = { runId:string; endpointKey:string; origin:string; browserId:string; initialObservation:BrowserObservation; operation:Run['operations'][number] };
type InspectionRecord = { inspection:Inspection; binding:Binding };
function assertBinding(task:Task,binding:Binding):void {
 const run=task.session?.runs.find(run=>run.id===binding.runId),operation=run?.operations.find(operation=>operation.id===binding.operation.id);
 if(!run||!operation||operation.status!=='uncertain'||run.endpointKey!==binding.endpointKey||run.origin!==binding.origin||run.browserId!==binding.browserId||!isDeepStrictEqual(run.initialObservation,binding.initialObservation)||!isDeepStrictEqual(operation,binding.operation))throw Error('This action changed while its outcome was being reviewed. Inspect again.');
}

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
  private inspections = new Map<string, InspectionRecord>();
  constructor(private readonly core: Companion, private readonly onWindowOwner?: BrowserWindowOwner) {}
  async inspect(input: { taskId: string; runId: string; operationId: string; url: string; signal?: AbortSignal }) {
    const task = await this.core.getTask(input.taskId), run = task.session?.runs.find(run => run.id === input.runId), operation = run?.operations.find(operation => operation.id === input.operationId);
    if (!run || !operation || operation.status !== 'uncertain') throw Error('This action does not need an uncertain-outcome inspection.');
    if (new URL(input.url).origin !== run.origin) throw Error('Inspect an explicitly selected page on the original website.');
    const binding:Binding=structuredClone({runId:run.id,endpointKey:run.endpointKey,origin:run.origin,browserId:run.browserId,initialObservation:run.initialObservation,operation});
    const browser = await LocalBrowser.open({ taskId: input.taskId, origin: run.origin, url: input.url, signal: input.signal, onWindowOwner: this.onWindowOwner });
    let inspection:Inspection;
    try {
      const observation = Schema.decodeUnknownSync(BrowserObservationSchema, { onExcessProperty: 'error' })(await browser.observe());
      if(input.signal?.aborted)throw Error('Browser inspection stopped.');
      if(observation.taskId!==input.taskId||observation.browserId!==browser.id||new URL(observation.url).origin!==run.origin)throw Error('The inspected page did not match the selected website. Inspect again.');
      inspection = { id: randomUUID(), taskId: input.taskId, runId: input.runId, operationId: input.operationId, reason: operation.reason, observation };
    } finally { await browser.close(); }
    if(input.signal?.aborted)throw Error('Browser inspection stopped.');
    const reading=this.core.getTask(input.taskId),current=await (input.signal?untilInspectionStopped(reading,input.signal):reading);
    assertBinding(current,binding);
    if(input.signal?.aborted)throw Error('Browser inspection stopped.');
    this.inspections.set(inspection.id, {inspection,binding}); return structuredClone(inspection);
  }
  async resolve(id: string, review: (inspection: Inspection,checkCurrent:()=>Promise<void>) => Promise<OutcomeReview>, control?:{signal:AbortSignal;beginCommit:()=>void}) {
    const record = this.inspections.get(id);
    if (!record) throw Error('Inspect the current website before reviewing this outcome.');
    const {inspection,binding}=record;
    this.inspections.delete(id);
    const beforeReview=this.core.getTask(inspection.taskId),current=await (control?untilInspectionStopped(beforeReview,control.signal):beforeReview);
    assertBinding(current,binding);
    if(control?.signal.aborted)throw Error('Browser inspection stopped.');
    const checkCurrent=async()=>{if(control?.signal.aborted)throw Error('Browser inspection stopped.');const task=await this.core.getTask(inspection.taskId);assertBinding(task,binding);if(control?.signal.aborted)throw Error('Browser inspection stopped.');};
    const decision = Schema.decodeUnknownSync(Review, { onExcessProperty: 'error' })(await review(structuredClone(inspection),checkCurrent));
    if(control?.signal.aborted)throw Error('Browser inspection stopped.');
    const reading=this.core.getTask(inspection.taskId);
    const task = await (control?untilInspectionStopped(reading,control.signal):reading), session = task.session, run = session?.runs.find(run => run.id === inspection.runId), operation = run?.operations.find(operation => operation.id === inspection.operationId);
    assertBinding(task,binding);
    if (!session || !run || !operation || new URL(inspection.observation.url).origin !== run.origin) throw Error('This action changed while its outcome was being reviewed. Inspect again.');
    if(control?.signal.aborted)throw Error('Browser inspection stopped.');
    control?.beginCommit();
    try {
      return await this.core.replaceSession(inspection.taskId, session.revision, { ...session, runs: session.runs.map(run => run.id !== inspection.runId ? run : { ...run, operations: run.operations.map(operation => operation.id !== inspection.operationId ? operation : { ...operation, status: decision.outcome === 'completed' ? 'observed' : decision.outcome === 'not-completed' ? 'failed' : 'uncertain', reconciliation: { id: inspection.id, ...decision, basis: 'user-reviewed-observation', observation: inspection.observation } }) }) });
    } catch(error) {
      if(error instanceof CompanionError&&error.code==='conflict'&&error.message==='Task session changed. Reload before saving your state.')throw Error('The task changed while this outcome was being reviewed. Check the action and inspect again if needed.');
      throw error;
    }
  }
}
