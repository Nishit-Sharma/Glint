/** Local admission limit, independent of any provider/account/vendor entitlement. */
export const INDEPENDENT_TASK_LIMIT=2;
export function isConcurrentOrdinary(input:{kind?:string;artifactId?:unknown;briefAction?:unknown;conversationAttempt?:unknown;browserContinuation?:unknown;canvasContext?:unknown;revisionBasis?:unknown;queuedFollowup?:unknown;expectedArtifacts?:unknown;expectedModuleStates?:unknown;executionScope?:string}){
 const scopes=input.executionScope?.split('|')??[];
 return scopes.every(scope=>scope.startsWith('response-preferences:v1:')||scope.startsWith('folder-instructions:v1:'))&&['explain','create'].includes(input.kind??'')&&!input.artifactId&&!input.briefAction&&!input.conversationAttempt&&!input.browserContinuation&&!input.canvasContext&&!input.revisionBasis&&!input.queuedFollowup&&!input.expectedArtifacts&&!input.expectedModuleStates;
}
/** A synchronous reservation covers preflight as well as generation. */
export function createTaskConcurrency(){
 const owners=new Map<string,{parallel:boolean}>();
 return {acquire(taskId:string,parallel:boolean){
  if(owners.has(taskId))throw Error('Wait for the current task response to finish or stop.');
  if(owners.size&&(!parallel||[...owners.values()].some(owner=>!owner.parallel)))throw Error('Finish active work before starting this operation. Only independent ordinary questions can run together.');
  if(owners.size>=INDEPENDENT_TASK_LIMIT)throw Error('Two independent tasks are already running. Wait for one to finish or stop it.');
  const owner={parallel};owners.set(taskId,owner);return()=>{if(owners.get(taskId)===owner)owners.delete(taskId);};
 },get size(){return owners.size;}};
}
