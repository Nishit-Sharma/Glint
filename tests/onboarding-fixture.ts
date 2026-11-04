import {LearningDraftStore} from '../src/host/learning-drafts';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Page} from '@playwright/test';
import {createCompanion,type Companion} from '../src/core/companion';
import {BotPreferences} from '../src/host/bot-preferences';
import {editModule,saveModuleDocument} from '../src/core/module-state';
import type {Command,CompanionEvent,CompanionBridge,ContextActivation} from '../src/shared/bridge';
import {DEFAULT_CHARACTER} from '../src/shared/character-catalog';
import type {ReadyBots} from '../src/shared/bot-catalog';
import {TaskViewPreferences} from '../src/host/task-view-preferences';
/** Real local stores and renderer. OS windows, connection and surface events are explicit host substitutes. */
export class OnboardingFixture{
 learningDrafts!:LearningDraftStore;viewPreferences!:TaskViewPreferences;pendingActivation?:ContextActivation;
 private readonly flushReplies=new Map<string,(error?:string)=>void>();
 readonly commands:Command[]=[];readonly external:string[]=[];readonly rendererErrors:string[]=[];configured=false;denyCapture=false;screenRecordingAllowed=false;viewReadBarrier?:Promise<void>;pendingReadBarrier?:Promise<void>;botGetBarrier?:Promise<void>;taskListBarrier?:Promise<void>;
 private constructor(readonly page:Page,readonly directory:string,public core:Companion,public bots:BotPreferences){}
 static async open(page:Page,input:number|{ready?:boolean;botGetBarrier?:Promise<void>;taskListBarrier?:Promise<void>;pendingActivation?:ContextActivation;viewReadBarrier?:Promise<void>;pendingReadBarrier?:Promise<void>;port?:number}={}){
  const options=typeof input==='number'?{}:input,port=typeof input==='number'?input:options.port??Number(process.env.WINDOW_COMPANION_TEST_PORT??4173);
  const directory=await mkdtemp(join(tmpdir(),'onboarding-renderer-')),core=await createCompanion({dataDir:directory});
  const fixture=new OnboardingFixture(page,directory,core,await BotPreferences.open(directory,core));page.on('pageerror',error=>fixture.rendererErrors.push(error.message));fixture.botGetBarrier=options.botGetBarrier;fixture.taskListBarrier=options.taskListBarrier;fixture.pendingActivation=options.pendingActivation;fixture.viewReadBarrier=options.viewReadBarrier;fixture.pendingReadBarrier=options.pendingReadBarrier;if(options.ready){await fixture.bots.command({type:'complete',expectedRevision:0,profile:DEFAULT_CHARACTER});await fixture.bots.finishExample(core);}
  fixture.learningDrafts=new LearningDraftStore({directory,lookupTask:async id=>(await fixture.core.listTasks()).find(task=>task.id===id)});
  fixture.viewPreferences=new TaskViewPreferences(directory,async id=>(await fixture.core.listTasks()).some(task=>task.id===id));if(options.ready){const task=(await core.listTasks())[0];if(task)await fixture.viewPreferences.select(task.id);}
  await page.exposeFunction('__onboardingInvoke',(command:Command)=>fixture.invoke(command));
  await page.addInitScript(()=>{const listeners=new Set<(event:CompanionEvent)=>void>();Object.assign(window,{__onboardingEvent:(event:CompanionEvent)=>{for(const listener of listeners)listener(event);}});window.companion={invoke:(window as unknown as {__onboardingInvoke:CompanionBridge['invoke']}).__onboardingInvoke,subscribe:listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};}};});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1'&&url.port===String(port))return route.continue();fixture.external.push(url.href);return route.abort();});
  try{await page.goto('http://127.0.0.1:'+port);return fixture;}catch(error){await fixture.close();throw error;}
 }
 emit(event:CompanionEvent){if(event.type==='context.activate')this.pendingActivation=event.activation;return this.page.evaluate(event=>(window as unknown as {__onboardingEvent:(event:CompanionEvent)=>void}).__onboardingEvent(event),event);}
 async ready():Promise<ReadyBots>{const state=await this.bots.read();if(state.kind!=='available'||state.current.kind!=='ready')throw Error('Choose a companion');return state.current;}
 async flushDrafts(){
  const quitId=crypto.randomUUID();let reply:(error?:string)=>void=()=>{};const received=new Promise<void>((resolve,reject)=>{reply=error=>error?reject(Error(error)):resolve();});
  this.flushReplies.set(quitId,reply);const timer=setTimeout(()=>reply('Synthetic quit flush was not acknowledged.'),5000);
  try{await Promise.all([this.emit({type:'draft.flush',quitId}),received]);}finally{clearTimeout(timer);this.flushReplies.delete(quitId);await this.emit({type:'draft.resume',quitId});}
 }
 async restart(){this.pendingActivation=undefined;await this.core.close();this.core=await createCompanion({dataDir:this.directory});this.bots=await BotPreferences.open(this.directory,this.core);await this.bots.finishExample(this.core);await this.page.reload();}
 async close(){await this.core.close();await rm(this.directory,{recursive:true,force:true});if(this.rendererErrors.length)throw Error('Renderer errors: '+this.rendererErrors.join(' | '));}
 async invoke(command:Command):Promise<unknown>{
  this.commands.push(structuredClone(command));
  switch(command.type){
   case 'bots.get':if(this.botGetBarrier)await this.botGetBarrier;return this.bots.read();
   case 'bots.change':{const result=await this.bots.command(command.change);if(result.kind==='saved'&&command.change.type==='complete'){await this.bots.finishExample(this.core);await this.emit({type:'changed'});const state=await this.bots.read();return state.kind==='available'?{kind:'saved',current:state.current}:state;}return result;}
   case 'bots.assign':{const catalog=await this.ready();if(!catalog.bots.some(bot=>bot.id===command.botId))throw Error('Companion unavailable');const task=await this.core.assignBot(command.taskId,command.botId,command.expectedBotId);await this.emit({type:'changed'});return task;}
   case 'tasks.list':if(this.taskListBarrier)await this.taskListBarrier;return this.core.listTasks();
   case 'tasks.get':return this.core.getTask(command.taskId);
   case 'tasks.delete':await this.core.deleteTask(command.taskId);let draftCleanup:'removed'|'unconfirmed'='removed';try{await this.learningDrafts.purgeTask(command.taskId);}catch{draftCleanup='unconfirmed';}await this.emit({type:'changed'});return draftCleanup==='removed'?null:{kind:'deleted',draftCleanup};
   case 'tasks.create':{const catalog=await this.ready();const task=await this.core.createTask({title:command.title,goal:command.goal,assignedBotId:catalog.defaultBotId});await this.emit({type:'changed'});return task;}
   case 'learning-drafts.read':return this.learningDrafts.read();
   case 'learning-drafts.recover':return this.learningDrafts.recover(command.recoveryToken);
   case 'learning-drafts.cleanup':return this.learningDrafts.cleanup();
   case 'learning-drafts.save':return this.learningDrafts.save(command.owner,command.slot,command.expectedEpoch,command.expectedRevision,command.value);
   case 'draft.flushed':this.flushReplies.get(command.quitId)?.(command.error);return null;
   case 'draft.save':return this.core.saveComposerDraft(command.taskId,command.expectedRevision,command.draft);
   case 'module.edit':{await editModule(this.core,command);await this.emit({type:'changed'});return this.core.getTask(command.taskId);}
   case 'module.document':{const result=await saveModuleDocument(this.core,command);await this.emit({type:'changed'});return {...result,task:await this.core.getTask(command.taskId)};}
   case 'artifact.save':{const result=await this.core.saveArtifact(command.taskId,command.artifact);await this.emit({type:'changed'});return result;}
   case 'source.invalidate':{const task=await this.core.invalidateSource(command.taskId,command.sourceId,'Explicitly marked changed. Refresh or replace this source.');await this.emit({type:'changed',taskId:command.taskId});return task;}
   case 'task-view.get':if(this.viewReadBarrier)await this.viewReadBarrier;return this.viewPreferences.read();
   case 'context.view':return this.viewPreferences.select(command.taskId??null);
   case 'context.pending':{const snapshot=this.pendingActivation;if(this.pendingReadBarrier)await this.pendingReadBarrier;return snapshot?{kind:'ready',activation:snapshot}:{kind:'none'};}
   case 'screen-recording.get':return {allowed:this.screenRecordingAllowed,confirmed:true,scope:'this-session'};
   case 'screen-recording.set':{this.screenRecordingAllowed=command.allowed;const state={allowed:command.allowed,confirmed:true,scope:'this-session' as const};await this.emit({type:'screen-recording.changed',state});return state;}
   case 'capture.settings.get':return {kind:'available',current:{revision:0,policy:{policyVersion:1,setupApproval:'not-approved',privateApps:[]}},sessionPaused:false};
   case 'context.cancel':if(this.pendingActivation?.activationId===command.activationId)this.pendingActivation=undefined;return null;
   case 'context.capture':return {activationId:command.activationId,tucked:false,state:'no-room',...(command.taskId?{task:await this.core.getTask(command.taskId)}:{})};
   case 'context.start':if(this.denyCapture)throw Error('Window capture was declined. Your task is kept.');await this.emit({type:'context.activate',activation:{activationId:'synthetic-window-choice',tucked:false,ownerTaskId:command.ownerTaskId,choices:[],requestId:command.requestId,...(command.newTask?{newTask:true}:{})}});return null;
   case 'connection.status':return {connection:{configured:this.configured,provider:'Codex (temporary)',endpoint:'',model:'',state:this.configured?'ready':'unconfigured',detail:'Browser host fixture. No provider transport.',specialized:{sam:'',computer:''}},host:{platform:'darwin',screenPermission:'not-determined',accessibilityPermission:'not-determined',shortcut:'Both Option keys',captureMode:'explicit-frozen',memoryEnabled:false,dataDir:'Disposable browser fixture'}};
   case 'surface.companion':await this.emit({type:'surface',mode:'companion'});return null;
   case 'surface.workspace':case 'surface.expand':case 'surface.standalone':await this.emit({type:'surface',mode:'workspace'});return null;
   case 'surface.collapse':await this.emit({type:'surface',mode:'anchor'});return null;
   case 'surface.fit':case 'presentation.show':return null;
   case 'model.run':throw Error('Connect an AI service in Settings before sending a request.');
   default:throw Error('Unsupported browser fixture operation '+command.type);
  }
 }
}
