import {parseCurrentState,type State} from './store';
import {recoverTaskSession} from './task-session';

export const RESTORED_AUTHORITY_NOTICE='Restored historical content. Review and authorize a new action explicitly.';

/** Preserve user content and immutable versions; historical approvals never become new capabilities. */
export function contentOnlyState(input:State):State{
 const state=structuredClone(parseCurrentState(input));
 for(const schedule of state.recurringWork??[]){schedule.enabled=false;schedule.blockedReason=RESTORED_AUTHORITY_NOTICE;for(const run of schedule.history)if(run.status==='running'){run.status='interrupted';run.error=RESTORED_AUTHORITY_NOTICE;}}
 for(const task of state.tasks){
  if(task.session){
   const recovered=recoverTaskSession(task.session);
   task.session={...recovered,revision:task.session.revision};
  }
  for(const source of task.sources)if(source.versions.at(-1)?.kind==='window'){source.freshness='refresh-required';source.staleReason=RESTORED_AUTHORITY_NOTICE;}
  for(const request of task.requests)if(request.status==='running'){request.status='interrupted';request.error=RESTORED_AUTHORITY_NOTICE;}
  for(const action of task.actions){
   delete action.approvalId;
   if(action.status==='executing'){action.status='uncertain';action.error=RESTORED_AUTHORITY_NOTICE;}
   else if(action.status==='proposed'||action.status==='approved'){action.status='retired';action.error=RESTORED_AUTHORITY_NOTICE;}
  }
 }
 return parseCurrentState(state);
}
