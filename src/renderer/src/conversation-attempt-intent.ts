import type {RequestRecord,SourceRef,Task} from '../../core/types';
import {prepareConversationAttempt,readConversationAttemptOutcome,type ConversationAttemptCommand,type ConversationAttemptSelection} from '../../shared/conversation-attempt';
export type ConversationAttemptState={kind:'idle';error?:string}|{kind:'sending'|'checking'|'unconfirmed';command:ConversationAttemptCommand}|{kind:'recorded';command:ConversationAttemptCommand;request:RequestRecord};
/** App-session editor memory. Saved requests and answers live only in the authoritative task store. */
export type ConversationAttemptDraft={prompt:string;sourceRefs:SourceRef[];state:ConversationAttemptState};
export type ConversationAttemptNotSent={kind:'not-sent';message:string};
const listeners=new WeakMap<ConversationAttemptDraft,Set<(state:ConversationAttemptState)=>void>>();
export function watchConversationAttemptDraft(draft:ConversationAttemptDraft,listener:(state:ConversationAttemptState)=>void){const set=listeners.get(draft)??new Set();set.add(listener);listeners.set(draft,set);return ()=>{set.delete(listener);};}
type Options={task:Task;selection:ConversationAttemptSelection;draft:ConversationAttemptDraft;createId:()=>string;send:(command:ConversationAttemptCommand)=>Promise<Task|undefined|ConversationAttemptNotSent>;read:(taskId:string)=>Promise<Task>;isCurrent:()=>boolean;onState:(state:ConversationAttemptState)=>void;onRecorded:(task:Task)=>void};
export function createConversationAttemptIntent(options:Options){
 const {draft}=options;
 function publish(state:ConversationAttemptState){draft.state=state;for(const listener of listeners.get(draft)??[])listener(state);if(options.isCurrent())options.onState(state);}
 function received(task:Task|undefined,command:ConversationAttemptCommand){const request=task&&readConversationAttemptOutcome(task,command);if(!request){publish({kind:'unconfirmed',command});return;}publish({kind:'recorded',command,request});if(options.isCurrent())options.onRecorded(task!);}
 return {async submit(){if(draft.state.kind!=='idle'||!options.isCurrent())return;const original=options.task.requests.find(request=>request.id===options.selection.requestId)!,command=prepareConversationAttempt(options.task,options.selection,{prompt:draft.prompt,sourceRefs:draft.sourceRefs,mode:draft.prompt.trim()===original.prompt.trim()?'again':'edit'},options.createId());publish({kind:'sending',command});try{const result=await options.send(command);if(result&&'kind' in result&&result.kind==='not-sent'){publish({kind:'idle',error:result.message});return;}received(result as Task|undefined,command);}catch{publish({kind:'unconfirmed',command});}},async check(){if(draft.state.kind==='idle'||draft.state.kind==='sending'||draft.state.kind==='checking'||!options.isCurrent())return;const {command}=draft.state;publish({kind:'checking',command});try{received(await options.read(command.taskId),command);}catch{publish({kind:'unconfirmed',command});}}};
}
