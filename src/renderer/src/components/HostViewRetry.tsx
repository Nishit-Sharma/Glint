import './host-view-retry.css';
/** Host view confirmation for per-task reads guarded by the host's selected view. Undefined means the caller is already inside a confirmed view. */
export type HostViewGate={state:'pending'|'ready'|'failed'|'retrying';retry:()=>void};
export const HOST_VIEW_RETRY_MESSAGE='Couldn’t open this task’s saved state.';
export const hostViewWaiting=(gate?:HostViewGate)=>!!gate&&gate.state!=='ready';
export const hostViewFailed=(gate?:HostViewGate)=>gate?.state==='failed'||gate?.state==='retrying';
/** Stays mounted while a retry is pending so keyboard focus remains on its button. `place` keeps names distinct when several gated places fail. */
export function HostViewRetry({gate,place}:{gate?:HostViewGate;place?:string}){
 if(!gate||!hostViewFailed(gate))return null;const retrying=gate.state==='retrying',suffix=place?' for '+place:'';
 return <p role="alert" className="host-view-retry"><span>{HOST_VIEW_RETRY_MESSAGE}</span><button type="button" aria-label={(retrying?'Retrying opening this task':'Retry opening this task')+suffix} aria-disabled={retrying||undefined} onClick={retrying?undefined:gate.retry}>{retrying?'Retrying…':'Retry'}</button></p>;
}
