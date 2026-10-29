import type {ConnectionStatus} from '../../../shared/bridge';
import type {createRevisionInstructionsController} from '../revision-instructions-controller';
import type {createLearningDrafts} from '../learning-drafts';
import {Composer} from './Composer';
import {RevisionInstructionsStatus} from './RevisionInstructionsStatus';
export function RevisionInstructionsInput({controller,cache,busy,dirty,conflict,stale,connection,runningRequestId,onStop,onConfigure}:{controller:ReturnType<typeof createRevisionInstructionsController>;cache:ReturnType<typeof createLearningDrafts>;busy:boolean;dirty:boolean;conflict:boolean;stale:boolean;connection?:ConnectionStatus;runningRequestId?:string;onStop:()=>void;onConfigure:()=>void}){
 const view=controller.snapshot(),ownRunning=!!view.activeRequestId&&view.activeRequestId===runningRequestId;
 return <><RevisionInstructionsStatus controller={controller} cache={cache}/><Composer active idPrefix="revision" value={view.raw.text} placeholder="Ask for a change…" kind="create" onChange={change=>controller.edit(change.text??view.raw.text)} disabled={busy||view.operation||dirty||conflict||stale||view.held} frozen={view.held||dirty||conflict||stale} connection={connection} running={ownRunning} stopWhileDisabled={ownRunning} onRun={text=>void controller.submit(text)} onStop={()=>{if(ownRunning&&controller.snapshot().activeRequestId===runningRequestId)onStop();}} onConfigure={onConfigure} allowModes={false}/></>;
}
