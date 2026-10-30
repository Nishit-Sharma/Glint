import type {Task} from '../../core/types';
import {resolveSavedWorkMatch,savedWorkUnavailable,type SavedWorkMatch} from '../../shared/saved-work-search';
type Resolved=ReturnType<typeof resolveSavedWorkMatch>;
export interface SavedWorkNavigation{
 current():boolean;guard(action:()=>void):boolean;dirty():boolean;
 listGeneration():number;knownTask(taskId:string):Task|undefined;
 flush():Promise<void>;load(taskId:string):Promise<Task>;
 started():void;finished():void;failed(error:unknown):void;open(task:Task,result:Resolved):void;
}
/** A held discard review never retains an authority to an old task snapshot.
 * Read again after leaving it; late lookups never replace the current view. */
export function requestSavedWorkNavigation(match:SavedWorkMatch,owner:SavedWorkNavigation):void{
 const begin=()=>{
  if(!owner.current())return;const generation=owner.listGeneration();owner.started();
  void(async()=>{
   try{
    await owner.flush();if(!owner.current())return;
    const task=await owner.load(match.taskId);if(!owner.current())return;
    const result=resolveSavedWorkMatch(task,match);
    const known=owner.knownTask(match.taskId);
    if(owner.listGeneration()!==generation)throw Error('Saved work changed while opening. Search again to choose from the current task list.');
    if(!known)throw Error(savedWorkUnavailable);
    resolveSavedWorkMatch(known,match);
    if(owner.dirty()){owner.finished();owner.guard(begin);return;}
    owner.open(task,result);
   }catch(error){if(owner.current())owner.failed(error);}
   finally{owner.finished();}
  })();
 };
 owner.guard(begin);
}
