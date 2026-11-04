import type {WindowWorkflowSourceContext} from '../learning/window-workflow-proposal';
import type {WindowWorkflowCaptureFence} from '../core/window-workflow-host';
type Capture={sourceVersion:string;imageSha256:string;capturedAt:string};
/** The host supplies the exact source-bound in-memory object and current privacy/native checks. Never exposed through IPC. */
export function createWindowWorkflowCaptureFence<C extends Capture>(context:WindowWorkflowSourceContext,options:{now:()=>number;readCapture:()=>C|undefined;assertScope:()=>void;beforeCheck?:()=>Promise<void>;checkTarget:(capture:C)=>Promise<void>}):WindowWorkflowCaptureFence{
 let bound:C|undefined;
 const current=()=>{
  options.assertScope();const capture=options.readCapture(),expected=context.source.capture,now=options.now();
  if(!Number.isFinite(now)||now<Date.parse(expected.capturedAt)||now>=Date.parse(expected.previewExpiresAt)||!capture||capture.sourceVersion!==expected.captureId||capture.imageSha256!==expected.imageSha256||capture.capturedAt!==expected.capturedAt||bound!==undefined&&bound!==capture)throw Error('The exact window capture changed or expired. Capture and review it again.');
  bound=capture;return capture;
 };
 const checkCommit=async()=>{const capture=current();await options.checkTarget(capture);current();};
 return {assertCurrent:()=>{current();},checkCommit,check:async()=>{await options.beforeCheck?.();await checkCommit();}};
}
