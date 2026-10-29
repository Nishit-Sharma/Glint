import type {RequestRecord,Task} from '../../core/types';
import {prepareRequestFollowup,readRequestFollowupOutcome,type RequestFollowupCommand,type RequestFollowupSelection,type RequestFollowupValue} from '../../shared/request-followup';
export type RequestFollowupState={kind:'idle'}|{kind:'sending'|'checking'|'unconfirmed';command:RequestFollowupCommand}|{kind:'recorded';command:RequestFollowupCommand;request:RequestRecord};
type Options={task:Task;selection:RequestFollowupSelection;createId:()=>string;send:(command:RequestFollowupCommand)=>Promise<Task|undefined>;read:(taskId:string)=>Promise<Task>;isCurrent:()=>boolean;onState:(state:RequestFollowupState)=>void;onRecorded:(task:Task)=>void};
/** One explicit send. Recovery only reads the saved request; there is no resend operation. */
export function createRequestFollowupIntent(options:Options){
 let state:RequestFollowupState={kind:'idle'};
 function publish(next:RequestFollowupState){state=next;if(options.isCurrent())options.onState(next);}
 function received(task:Task|undefined,command:RequestFollowupCommand){const request=task&&readRequestFollowupOutcome(task,command);if(!request){publish({kind:'unconfirmed',command});return;}publish({kind:'recorded',command,request});if(options.isCurrent())options.onRecorded(task!);}
 return {snapshot:()=>state,async submit(value:RequestFollowupValue){if(state.kind!=='idle'||!options.isCurrent())return;const command=prepareRequestFollowup(options.task,options.selection,value,options.createId());publish({kind:'sending',command});try{received(await options.send(command),command);}catch{publish({kind:'unconfirmed',command});}},async check(){if(state.kind==='idle'||state.kind==='sending'||state.kind==='checking'||!options.isCurrent())return;const {command}=state;publish({kind:'checking',command});try{received(await options.read(command.taskId),command);}catch{publish({kind:'unconfirmed',command});}}};
}
