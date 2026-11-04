import {Effect} from 'effect';
import {readState} from '../fixtures/a91/src/core/store';

/** Exercise the pinned reader at its actual disk boundary, without assuming current Task is assignable. */
export const oldTaskLookup=(directory:string)=>async(taskId:string)=>(await Effect.runPromise(readState(directory))).tasks.find(task=>task.id===taskId);
