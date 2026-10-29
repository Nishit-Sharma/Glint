import type {Page} from '@playwright/test';
import type {Command} from '../src/shared/bridge';
import {createTextHelper} from '../src/core/text-helper-host';
import {offlineTaskEntry} from './offline-task-entry.fixture';

function responseBarrier(){
 let reach!:()=>void,release!:()=>void,deliver!:()=>void;
 const arrived=new Promise<void>(done=>{reach=done;}),waiting=new Promise<void>(done=>{release=done;}),delivered=new Promise<void>(done=>{deliver=done;});
 return {arrived,release,delivered,async hold(){reach();await waiting;deliver();}};
}

/** Every task and helper is created by product controls. Only OS/transport is
 * substituted; barriers delay actual core results, never manufacture content. */
export async function textHelperEntry(page:Page){
 const entry=await offlineTaskEntry(page),fixture=entry.fixture,invoke=fixture.invoke.bind(fixture);
 const helperCreations:Extract<Command,{type:'helper.create'}>[]=[],boundaries:Array<{kind:string;taskId:string;utc:string}>=[];
 const held=new Set<ReturnType<typeof responseBarrier>>();
 let nextRead:{taskId:string;barrier:ReturnType<typeof responseBarrier>}|undefined,nextCreation:ReturnType<typeof responseBarrier>|undefined,nextNotes:ReturnType<typeof responseBarrier>|undefined;
 fixture.invoke=async(command:Command)=>{
  if(command.type==='helper.create'){
   fixture.commands.push(structuredClone(command));helperCreations.push(structuredClone(command));
   const {type,...input}=command,result=await createTextHelper(fixture.core,input);
   await fixture.emit({type:'changed',taskId:command.taskId});
   const barrier=nextCreation;nextCreation=undefined;
   if(barrier){boundaries.push({kind:'committed-helper-response-held',taskId:command.taskId,utc:new Date().toISOString()});await barrier.hold();held.delete(barrier);}
   return result;
  }
  if(command.type==='module.document'){
   const barrier=nextNotes;nextNotes=undefined;const result=await invoke(command);
   if(barrier){boundaries.push({kind:'committed-notes-response-held',taskId:command.taskId,utc:new Date().toISOString()});await barrier.hold();held.delete(barrier);}
   return result;
  }
  if(command.type==='tasks.get'&&nextRead?.taskId===command.taskId){
   const barrier=nextRead.barrier;nextRead=undefined;const result=await invoke(command);
   boundaries.push({kind:'actual-task-read-response-held',taskId:command.taskId,utc:new Date().toISOString()});await barrier.hold();held.delete(barrier);return result;
  }
  return invoke(command);
 };
 return {...entry,helperCreations,boundaries,
  holdNextTaskRead(taskId:string){if(nextRead)throw Error('Task read already held');const barrier=responseBarrier();held.add(barrier);nextRead={taskId,barrier};return barrier;},
  holdNextCreationResponse(){if(nextCreation)throw Error('Helper response already held');const barrier=responseBarrier();held.add(barrier);nextCreation=barrier;return barrier;},
  holdNextNotesResponse(){if(nextNotes)throw Error('Notes response already held');const barrier=responseBarrier();held.add(barrier);nextNotes=barrier;return barrier;},
  async close(){for(const barrier of held)barrier.release();await entry.close();},
 };
}
