import type {Task} from '../../core/types';
import type {StudyProgressEvent} from '../../shared/study-workbench';
/** The latest notice intent owns deferred loading and the live application draft guard. */
export function createNotificationNavigation(options:{scope:()=>string;load:(event:StudyProgressEvent)=>Promise<Task>;guard:(apply:()=>void)=>unknown;apply:(event:StudyProgressEvent,task:Task)=>void;error:(error:unknown)=>void}){
 let intent=0,ready:{intent:number;scope:string;event:StudyProgressEvent;task:Task}|undefined;
 const applyLatest=()=>{const next=ready;if(!next||next.intent!==intent||next.scope!==options.scope())return;ready=undefined;try{options.apply(next.event,next.task);}catch(error){options.error(error);}};
 return {async open(event:StudyProgressEvent){const mine=++intent,scope=options.scope();ready=undefined;try{const task=await options.load(event);if(mine!==intent||scope!==options.scope())return;ready={intent:mine,scope,event,task};options.guard(applyLatest);}catch(error){if(mine===intent&&scope===options.scope())options.error(error);}}};
}
