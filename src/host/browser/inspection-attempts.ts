import type {BrowserInspectionStopResult} from '../../shared/bridge';
type Scope={taskId:string;runId:string;operationId:string;attemptId:string};
type Entry={scope:Scope;controller:AbortController;committing:boolean};

/** Host-owned, session-only cancellation. Attempt IDs cannot be reused. */
export class BrowserInspectionAttempts {
 private readonly active=new Map<string,Entry>();
 private readonly used=new Set<string>();
 private closed=false;
 begin(scope:Scope){
  if(this.closed)throw Error('Browser inspections are closed.');
  if(this.used.has(scope.attemptId)||this.used.size>=10_000)throw Error('Use a new inspection attempt.');
  const entry:Entry={scope:{...scope},controller:new AbortController(),committing:false};
  this.used.add(scope.attemptId);this.active.set(scope.attemptId,entry);
  return {signal:entry.controller.signal,beginCommit:()=>{if(entry.controller.signal.aborted||this.active.get(scope.attemptId)!==entry)throw Error('Browser inspection stopped.');entry.committing=true;},finish:()=>{if(this.active.get(scope.attemptId)===entry)this.active.delete(scope.attemptId);}};
 }
 stop(scope:Scope):BrowserInspectionStopResult{
  const entry=this.active.get(scope.attemptId);
  if(!entry||entry.scope.taskId!==scope.taskId||entry.scope.runId!==scope.runId||entry.scope.operationId!==scope.operationId)return {kind:'not-active'};
  if(entry.committing)return {kind:'finishing'};
  entry.controller.abort();return {kind:'stopped'};
 }
 close(){this.closed=true;for(const entry of this.active.values())if(!entry.committing)entry.controller.abort();}
 resume(){this.closed=false;}
}
