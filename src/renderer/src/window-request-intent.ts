import type {Task} from '../../core/types';
import {isTaskLearningDraftOwner,learningDraftTaskId,serializeLearningDraftJson,type LearningDraftOwner} from '../../shared/learning-drafts';
import type {createLearningDrafts} from './learning-drafts';
export const emptyWindowRequestIntent={requestId:'',binding:''};
type Input={cache:ReturnType<typeof createLearningDrafts>;owner:LearningDraftOwner;slot:string;basis:string;binding:string;newId:()=>string;isCurrent:()=>boolean};
function read(input:Input){return input.cache.readForm(input.owner,input.slot,emptyWindowRequestIntent,input.basis);}
function ready(input:Input){const state=input.cache.getSnapshot(),form=read(input);if(!isTaskLearningDraftOwner(input.owner)||!input.isCurrent()||state.frozen||state.maintenance||form.status!=='ready'||form.error)throw Error('Wait until this exact raw review draft is saved.');return form;}
/** Persist before dispatch; an uncertain write must reconcile through the existing draft cache. */
export async function prepareWindowRequestIntent(input:Input):Promise<string>{
 let value=ready(input).value;
 if(value.requestId&&value.binding!==input.binding)throw Error('This saved attempt belongs to earlier input. Check its saved outcome, then deliberately start a separate attempt.');
 if(!value.requestId){value={requestId:input.newId(),binding:input.binding};input.cache.edit(input.owner,input.slot,emptyWindowRequestIntent,input.basis,()=>value);}
 await input.cache.flushForm(input.owner,input.slot);
 const current=ready(input);
 if(serializeLearningDraftJson(current.value)!==serializeLearningDraftJson(value))throw Error('The saved attempt changed before dispatch. Inspect its draft before continuing.');
 return value.requestId;
}
export async function startSeparateWindowAttempt(input:Input&{readTask:()=>Promise<Task>}):Promise<void>{
 const value=ready(input).value;
 if(value.requestId){const task=await input.readTask(),previous=task.id===learningDraftTaskId(input.owner)?task.requests.find(request=>request.id===value.requestId):undefined;if(!previous||previous.status==='running')throw Error('The earlier outcome is still unknown or running. Check it before starting another attempt.');}
 const current=ready(input);if(serializeLearningDraftJson(current.value)!==serializeLearningDraftJson(value))throw Error('The attempt changed while checking its outcome.');
 input.cache.edit(input.owner,input.slot,emptyWindowRequestIntent,input.basis,()=>emptyWindowRequestIntent);
}
