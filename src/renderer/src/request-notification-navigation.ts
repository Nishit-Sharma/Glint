import {requestNoticeTargetMatches,type RequestNoticeResolution} from '../../shared/request-notifications';
/** Resolve again after the live draft guard: an old click never selects a replacement prompt. */
export function createRequestNotificationNavigation(options:{scope:()=>string;load:(id:string)=>Promise<RequestNoticeResolution>;guard:(apply:()=>void)=>unknown;hasDirty?:()=>boolean;apply:(value:Extract<RequestNoticeResolution,{kind:'available'}>)=>void;error:(error:unknown)=>void}){
 let intent=0;
 function accept(value:RequestNoticeResolution){if(value.kind!=='available')throw Error(value.message);if(!requestNoticeTargetMatches(value.task,value.notice.target))throw Error('The original request target changed. No replacement was opened.');if(value.notice.target.kind!=='request'&&!value.active)throw Error('The original input prompt has closed.');return value;}
 return {async open(id:string){const mine=++intent,scope=options.scope(),current=()=>mine===intent&&scope===options.scope();const guarded=()=>options.guard(()=>{void(async()=>{try{const value=accept(await options.load(id));if(!current())return;if(options.hasDirty?.()){guarded();return;}options.apply(value);}catch(error){if(current())options.error(error);}})();});try{accept(await options.load(id));if(current())guarded();}catch(error){if(current())options.error(error);}}};
}
