import type {Page} from '@playwright/test';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {BotPreferences} from '../src/host/bot-preferences';
import {readLocalTaskStart} from '../src/shared/local-task-start';
import type {Command} from '../src/shared/bridge';
import {OnboardingFixture} from './onboarding-fixture';

/** By default no task, source or module is seeded. The optional ready fixture
 * initializes identity and its bundled example only; journey-owned work is still
 * created through New task and source controls. Only initialized identity/example
 * setup and OS/provider/transport boundaries are substituted.
 * The pinned-old phase runs actual old Companion+Store, not an old packaged UI. */
export async function offlineTaskEntry(page:Page,port=4180,options:{ready?:boolean}={}){
 const fixture=await OnboardingFixture.open(page,{port,...options});
 const invoke=fixture.invoke.bind(fixture);
 const creations:Extract<Command,{type:'tasks.start-local'}>[]=[];
 const phases:Array<{phase:string;utc:string;companionSha256?:string;storeSha256?:string}>=[{phase:'current-renderer/current-core',utc:new Date().toISOString()}];
 let barrier:Promise<void>|undefined,release:(()=>void)|undefined,loseResponse=false,oldDirectory:string|undefined;
 fixture.invoke=async(command:Command)=>{
  if(command.type==='tasks.start-local'){
   fixture.commands.push(structuredClone(command));creations.push(structuredClone(command));
   const waiting=barrier;barrier=undefined;if(waiting)await waiting;
   const {type,...input}=command,parsed=readLocalTaskStart(input),catalog=await fixture.ready();
   const result=await fixture.core.startLocalTask(parsed,catalog.defaultBotId);
   await fixture.emit({type:'changed',taskId:result.task.id});
   if(loseResponse){loseResponse=false;throw Error('Owned fixture dropped the save response after the atomic commit.');}
   return result;
  }
  if(command.type==='source.text.inspect'){
   fixture.commands.push(structuredClone(command));const {type,...input}=command;return fixture.core.inspectTextSourceSave(input);
  }
  if(command.type==='source.text'){
   fixture.commands.push(structuredClone(command));if(command.edit){const result=await fixture.core.saveTextSource({taskId:command.taskId,source:command.source,expectedSource:command.expectedSource,...command.edit});await fixture.emit({type:'changed',taskId:command.taskId});return {...result,task:await fixture.core.getTask(command.taskId)};}const task=await fixture.core.putSource(command.taskId,command.source,undefined,command.expectedSource);await fixture.emit({type:'changed',taskId:command.taskId});return task;
  }
  if(command.type==='source.document'){
   fixture.commands.push(structuredClone(command));const {type,...input}=command;
   const result=await fixture.core.copySavedDocumentSource(input);await fixture.emit({type:'changed',taskId:command.taskId});return result;
  }
  if(command.type==='artifact.save'){
   fixture.commands.push(structuredClone(command));await fixture.core.saveArtifact(command.taskId,command.artifact);await fixture.emit({type:'changed',taskId:command.taskId});return fixture.core.getTask(command.taskId);
  }
  if(command.type==='artifact.handoff'){
   fixture.commands.push(structuredClone(command));const {type,...input}=command;
   const result=await fixture.core.saveTaskHandoff(input);await fixture.emit({type:'changed',taskId:command.taskId});return result;
  }
  return invoke(command);
 };
 return {fixture,creations,phases,
  holdNextSave(){if(barrier)throw Error('Save already held');barrier=new Promise<void>(done=>{release=done;});},
  releaseSave(){release?.();release=undefined;},
  loseNextResponse(){loseResponse=true;},
  async usePinnedOldCore(){
   const companion=await readFile(resolve('tests/fixtures/legacy-local-start-companion.ts.txt'),'utf8'),store=await readFile(resolve('tests/fixtures/legacy-local-start-store.ts.txt'),'utf8');
   const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
   if(sha(companion)!=='7735e42bfc8ae7966202aad4044b0d3db8f348b5a42b53f4506385bffc4b70e7'||sha(store)!=='f92762234f2937d69d113b06109d5867f42a02afd58d738f96017db2dfbce831')throw Error('Pinned old source changed');
   await mkdir(resolve('evidence/offline-task-entry'),{recursive:true});oldDirectory=await mkdtemp(resolve('evidence/offline-task-entry/old-core-'));const outfile=join(oldDirectory,'companion.mjs');
   await build({stdin:{contents:companion,loader:'ts',sourcefile:'pinned-046-companion.ts',resolveDir:resolve('src/core')},outfile,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent',plugins:[{name:'pinned-store',setup(build){build.onResolve({filter:/^\.\/store$/},()=>({path:'old-store',namespace:'pinned'}));build.onLoad({filter:/.*/,namespace:'pinned'},()=>({contents:store,loader:'ts',resolveDir:resolve('src/core')}));}}]});
   const older:typeof import('../src/core/companion')=await import(pathToFileURL(outfile).href);
   await fixture.core.close();fixture.core=await older.createCompanion({dataDir:fixture.directory});fixture.bots=await BotPreferences.open(fixture.directory,fixture.core);phases.push({phase:'same-renderer/pinned-046-core',utc:new Date().toISOString(),companionSha256:sha(companion),storeSha256:sha(store)});await page.reload();
  },
  async restartNewCore(){await fixture.restart();phases.push({phase:'same-renderer/reopened-current-core',utc:new Date().toISOString()});},
  async close(){release?.();try{await fixture.close();}finally{if(oldDirectory)await rm(oldDirectory,{recursive:true,force:true});}},
 };
}
