import type {Companion} from '../core/companion';
import type {Task} from '../core/types';
import type {SourceIntakeCommand} from '../shared/source-intake';

export type SourceIntakeHostOptions={
 core():Pick<Companion,'revokeSource'|'restoreSource'|'redactSource'>;
 /** Drops any frozen pixels held for the source; they are never reused after revocation. */
 dropCapture(taskId:string,sourceId:string):void;
 followedSource():{taskId:string;sourceId:string}|undefined;
 stopFollow(reason:string):void;
 changed(taskId:string):void;
};

export function createSourceIntakeHost(options:SourceIntakeHostOptions){
 const release=(taskId:string,sourceId:string,reason:string)=>{
  options.dropCapture(taskId,sourceId);
  const followed=options.followedSource();if(followed?.taskId===taskId&&followed.sourceId===sourceId)options.stopFollow(reason);
 };
 async function command(c:SourceIntakeCommand,guard:()=>void):Promise<Task>{
  let task:Task;
  switch(c.type){
   case 'source-intake.revoke':task=await options.core().revokeSource(c.taskId,c.expected.sourceId,guard,c.expected);release(c.taskId,c.expected.sourceId,'Source removed from requests. Choose a window again explicitly.');break;
   case 'source-intake.restore':task=await options.core().restoreSource(c.taskId,c.expected.sourceId,guard,c.expected,c.revokedAt,c.revocationId);break;
   case 'source-intake.redact':task=await options.core().redactSource(c.taskId,c.expected,c.spans,guard);break;
   default:{const unreachable:never=c;throw Error(`Unknown source intake command: ${String(unreachable)}`);}
  }
  options.changed(c.taskId);return task;
 }
 return {command};
}
