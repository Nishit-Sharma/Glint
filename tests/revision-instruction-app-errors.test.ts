import {afterEach,expect,it} from 'vitest';
import ts from 'typescript';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import type {Artifact,Task} from '../src/core/types';
import type {Command,CompanionEvent} from '../src/shared/bridge';
import {createCompanion} from '../src/core/companion';
import {LearningDraftStore} from '../src/host/learning-drafts';
import {createLearningDrafts} from '../src/renderer/src/learning-drafts';
import {createRevisionInstructionsController} from '../src/renderer/src/revision-instructions-controller';
import {assertRevisionInstructionRequest} from '../src/shared/revision-instructions';
import {isExportCommand} from '../src/shared/export-contract';
import {publicErrorMessage} from '../src/shared/public-messages';
import {RevisionInstructionsInput} from '../src/renderer/src/components/RevisionInstructionsInput';
import {Composer} from '../src/renderer/src/components/Composer';
const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
function gate(){let enter!:()=>void,release!:()=>void;return {entered:new Promise<void>(done=>{enter=done;}),waiting:new Promise<void>(done=>{release=done;}),enter:()=>enter(),release:()=>release()};}

/** Execute the unchanged App handlers, not a restatement of their catch logic.
 * React state/DOM and bridge delivery are substituted; core/cache/store are real. */
async function actualAppHandlers(environment:Record<string,unknown>){
 const source=await readFile(resolve('src/renderer/src/App.tsx'),'utf8'),file=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const app=file.statements.find((node):node is ts.FunctionDeclaration=>ts.isFunctionDeclaration(node)&&node.name?.text==='App');if(!app?.body)throw Error('Actual App body is unavailable.');
 const functions=['run','modelRun','stop','setError','openArtifact','retireContext'].map(name=>{const node=app.body!.statements.find((node):node is ts.FunctionDeclaration=>ts.isFunctionDeclaration(node)&&node.name?.text===name&&!!node.body);if(!node)throw Error('Actual App handler missing: '+name);return node.getText(file);});
 const subscriptions:ts.ArrowFunction[]=[],stopCallbacks:ts.ArrowFunction[]=[];function visit(node:ts.Node){if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.expression.getText(file)==='bridge'&&node.expression.name.text==='subscribe'&&node.arguments.length===1&&ts.isArrowFunction(node.arguments[0]))subscriptions.push(node.arguments[0]);if((ts.isJsxSelfClosingElement(node)||ts.isJsxOpeningElement(node))&&node.tagName.getText(file)==='ArtifactEditor')for(const attribute of node.attributes.properties)if(ts.isJsxAttribute(attribute)&&attribute.name.getText(file)==='onStop'&&attribute.initializer&&ts.isJsxExpression(attribute.initializer)&&attribute.initializer.expression&&ts.isArrowFunction(attribute.initializer.expression))stopCallbacks.push(attribute.initializer.expression);ts.forEachChild(node,visit);}visit(app);
 if(subscriptions.length!==1)throw Error('Expected the single actual App event subscriber.');
 if(stopCallbacks.length!==1)throw Error('Expected the actual ArtifactEditor Stop callback.');
 const javascript=ts.transpileModule(functions.join('\n')+'\nconst event='+subscriptions[0].getText(file)+';\nreturn {run,modelRun,stop,openArtifact,event};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 const handlers=new Function(...Object.keys(environment),javascript)(...Object.values(environment)) as {modelRun:(prompt:string,kind:'revise',artifactId:string,refs:[],owner:undefined,submittedDraft:undefined,briefAction:undefined,requestId:string,basis?:string)=>Promise<Task|undefined>;stop:(scope?:unknown)=>Promise<void>;openArtifact:(artifact:Artifact)=>void;event:(event:CompanionEvent)=>void};
 const stopJavascript=ts.transpileModule('return '+stopCallbacks[0].getText(file)+';',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 return {...handlers,renderStop:(render:Record<string,unknown>)=>{const values={...environment,...render};return new Function(...Object.keys(values),stopJavascript)(...Object.values(values)) as ()=>void;}};
}
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'revision-app-errors-')),core=await createCompanion({dataDir:directory}),hold=gate(),cancelHold=gate(),stopWork:Promise<unknown>[]=[];let pending:Promise<unknown>|undefined,pendingSnapshot:{taskId:string;requestId:string;kind:string;prompt:string}|undefined;
 cleanup.push(async()=>{hold.release();cancelHold.release();await Promise.allSettled([...(pending?[pending]:[]),...stopWork]);await core.close();await rm(directory,{recursive:true,force:true});});
 const created=await core.createTask({title:'One task with two real saved documents'}),first=await core.saveArtifact(created.id,{title:'Document A',content:'Committed A.',mimeType:'text/plain',sourceRefs:[]}),second=await core.saveArtifact(created.id,{title:'Document B',content:'Committed B.',mimeType:'text/plain',sourceRefs:[]}),task=await core.getTask(created.id),artifactA=task.artifacts.find(item=>item.id===first.artifactId)!,artifactB=task.artifacts.find(item=>item.id===second.artifactId)!;
 const state={error:'',notice:'',page:'artifact',artifactId:first.artifactId,busy:false,retireCalls:0},taskRef={current:task},newQuestionEpoch={current:0},incomingActivationEpoch={current:0},requestRef:{current:unknown}={current:undefined},requestErrorOwner:{current:unknown}={current:undefined},lastRunError={current:''},lock={current:false},contextRef:{current:string|undefined}={current:undefined};
 const faults={raw:false,cancel:false},cancellations:Array<Extract<Command,{type:'model.cancel'}>>=[],contextCancellations:string[]=[];
 const store=new LearningDraftStore({directory,lookupTask:async id=>(await core.listTasks()).find(item=>item.id===id)}),cache=createLearningDrafts({read:()=>store.read(),save:(...args)=>{if(faults.raw&&args[4]!==null){faults.raw=false;return Promise.reject(Error('Controlled raw storage failure.'));}return store.save(...args);}});await cache.load();
 const refresh=async()=>{taskRef.current=await core.getTask(task.id);},setErrorValue=(value:string)=>{state.error=value;};
 const bridge={invoke:async(command:Command)=>{
  if(command.type==='context.cancel'){contextCancellations.push(command.activationId);return null;}
  if(command.type==='model.cancel'){cancellations.push(command);cancelHold.enter();await cancelHold.waiting;if(faults.cancel)throw Error('ECONNRESET');return core.cancelRequest(command.taskId,command.requestId);}
  if(command.type!=='model.run')throw Error('Unexpected App command in this unit seam.');
  const current=await core.getTask(task.id),revision=command.revisionBasis?assertRevisionInstructionRequest(current,command.artifactId!,command.revisionBasis,command.sourceIds,command.expectedSourceRefs):current.artifacts.find(item=>item.id===command.artifactId)!.revisions.at(-1)!;
  const result=await core.runRequest({taskId:task.id,requestId:command.requestId,kind:command.kind,prompt:command.prompt,artifactId:command.artifactId,expectedRevision:revision.revision,sourceIds:command.sourceIds,expectedSourceRefs:command.expectedSourceRefs},async()=>{hold.enter();await hold.waiting;throw Error('Scripted bound revision failed.');});
  await refresh();if(result.status!=='completed')throw Error(result.error);return core.getTask(task.id);
 }};
 const noop=()=>{},handlers=await actualAppHandlers({page:'artifact',task,artifact:artifactA,taskRef,newQuestionEpoch,incomingActivationEpoch,requestRef,requestErrorOwner,lastRunError,lock,bridge,isExportCommand,publicErrorMessage,refresh,setErrorValue,setBusy:(value:boolean)=>{state.busy=value;},setNotice:(value:string)=>{state.notice=value;},setArrivalIdentities:noop,setPendingRequest:(value:typeof pendingSnapshot)=>{pendingSnapshot=value;},setStream:noop,setArtifact:(value:Artifact)=>{state.artifactId=value.id;},setPage:(value:string)=>{state.page=value;},scopeRef:{current:{}},draftNavigation:{api:{hasDirty:()=>false,guard:(action:()=>void)=>{action();return true;}}},contextStart:{current:undefined},contextRef,setContext:()=>{state.retireCalls++;},beginContext:(activation:{activationId:string})=>{contextRef.current=activation.activationId;state.page='work';setErrorValue('');}});
 const controller=createRevisionInstructionsController({cache,artifactId:first.artifactId,task:()=>taskRef.current,base:()=>first.revision,scope:()=>newQuestionEpoch.current+':'+incomingActivationEpoch.current,isCurrent:()=>state.page==='artifact'&&state.artifactId===first.artifactId,send:(prompt,binding)=>handlers.modelRun(prompt,'revise',first.artifactId,[],undefined,undefined,undefined,binding.requestId,binding.basis)});
 const raw='  Keep A instructions α 👋  ';controller.edit(raw);
 return {core,task,artifactA,artifactB,controller,cache,handlers,hold,cancelHold,state,faults,cancellations,contextCancellations,contextRef,lastRunError,requestErrorOwner,newQuestionEpoch,incomingActivationEpoch,raw,stopCallback(){const appStop=handlers.renderStop({pendingRequest:pendingSnapshot,workflowReviewNavigation:newQuestionEpoch.current,workflowReviewActivation:incomingActivationEpoch.current,stop:(scope?:unknown)=>{const work=handlers.stop(scope);stopWork.push(work);return work;}});const rendered=RevisionInstructionsInput({controller,cache,busy:true,dirty:false,conflict:false,stale:false,runningRequestId:pendingSnapshot?.requestId,onStop:appStop,onConfigure:noop,connection:{provider:'Codex (temporary)',configured:true,endpoint:'fixture://no-network',model:'scripted',state:'ready',detail:'Unit transport',specialized:{sam:'',computer:''}}});return Composer(rendered.props.children[1].props).props.children[0].props.onStop as ()=>void;},settleStops:()=>Promise.allSettled(stopWork),send(){const result=controller.submit();pending=result;return result;},sendLegacy(){const result=handlers.modelRun('Legacy revision','revise',first.artifactId,[],undefined,undefined,undefined,crypto.randomUUID());pending=result;return result;}};
}
it('the actual App path still shows a matching live bound revision failure and retains its durable raw',async()=>{
 const f=await fixture(),sending=f.send();await f.hold.entered;f.hold.release();expect(await sending).toBe(false);expect(f.state.error).toBe('This action could not be completed. Review the task before continuing.');expect(f.lastRunError.current).toBe(f.state.error);expect(f.requestErrorOwner.current).toMatchObject({taskId:f.task.id});expect(f.controller.snapshot().raw.text).toBe(f.raw);expect((await f.core.getTask(f.task.id)).requests[0].status).toBe('failed');
});
it('the actual App path does not publish document A failure over document B after same-task navigation',async()=>{
 const f=await fixture(),sending=f.send();await f.hold.entered;f.handlers.openArtifact(f.artifactB);expect(f.state.artifactId).toBe(f.artifactB.id);expect(f.newQuestionEpoch.current).toBe(1);f.hold.release();expect(await sending).toBe(false);expect(f.state.error).toBe('');expect(f.lastRunError.current).toBe('');expect(f.requestErrorOwner.current).toBeUndefined();expect(f.controller.snapshot().raw.text).toBe(f.raw);expect((await f.core.getTask(f.task.id)).requests[0].status).toBe('failed');
});
it('the actual subscribed incoming-activation path retires a bound revision error without consuming its raw',async()=>{
 const f=await fixture(),sending=f.send();await f.hold.entered;f.handlers.event({type:'context.activate',activation:{activationId:'synthetic-incoming',tucked:false,ownerTaskId:f.task.id,choices:[]}});expect(f.incomingActivationEpoch.current).toBe(1);f.hold.release();expect(await sending).toBe(false);expect(f.state.error).toBe('');expect(f.lastRunError.current).toBe('');expect(f.requestErrorOwner.current).toBeUndefined();expect(f.controller.snapshot().raw.text).toBe(f.raw);
});
it('unbound legacy model error presentation keeps its existing task-level behavior',async()=>{
 const f=await fixture(),sending=f.sendLegacy();await f.hold.entered;f.handlers.openArtifact(f.artifactB);f.hold.release();expect(await sending).toBeUndefined();expect(f.state.error).toBe('This action could not be completed. Review the task before continuing.');
});
it('a stale actual Stop callback after document retarget cannot cancel the still-pending A request or retire the new view',async()=>{
 const f=await fixture(),sending=f.send();await f.hold.entered;const oldStop=f.stopCallback(),originalRequest=f.controller.snapshot().activeRequestId;f.handlers.openArtifact(f.artifactB);expect(f.controller.snapshot().activeRequestId).toBe(originalRequest);const retired=f.state.retireCalls;expect(f.controller.snapshot().held).toBe(true);oldStop();await Promise.resolve();expect(f.cancellations).toEqual([]);expect(f.state.retireCalls).toBe(retired);f.hold.release();expect(await sending).toBe(false);
});
it('a stale actual Stop callback after incoming activation leaves the new context and the same pending request alone',async()=>{
 const f=await fixture(),sending=f.send();await f.hold.entered;const oldStop=f.stopCallback(),originalRequest=f.controller.snapshot().activeRequestId;f.handlers.event({type:'context.activate',activation:{activationId:'new-incoming-context',tucked:false,ownerTaskId:f.task.id,choices:[]}});expect(f.controller.snapshot().held).toBe(true);expect(f.controller.snapshot().activeRequestId).toBe(originalRequest);oldStop();await Promise.resolve();expect.soft(f.cancellations).toEqual([]);expect.soft(f.contextCancellations).toEqual([]);expect(f.contextRef.current).toBe('new-incoming-context');f.hold.release();expect(await sending).toBe(false);
});
it('a matching live Stop still cancels its exact request while raw storage is unhealthy',async()=>{
 const f=await fixture(),sending=f.send();await f.hold.entered;f.faults.raw=true;expect(f.controller.edit('Newer raw with a failed sidecar write').kind).toBe('accepted');await expect(f.cache.flush()).rejects.toThrow();expect(f.controller.snapshot().held).toBe(true);f.stopCallback()();await f.cancelHold.entered;expect(f.cancellations).toHaveLength(1);const request=(await f.core.getTask(f.task.id)).requests[0];expect(f.cancellations[0]).toMatchObject({taskId:f.task.id,requestId:request.id});f.cancelHold.release();await f.settleStops();expect(f.state.notice).toBe('Stopped. Saved work is kept.');f.hold.release();expect(await sending).toBe(false);expect(f.controller.snapshot().raw.text).toBe('Newer raw with a failed sidecar write');
});
it.each(['notice','error'] as const)('accepted A cancellation keeps its exact effect but cannot publish a late %s over B',async outcome=>{
 const f=await fixture(),sending=f.send();await f.hold.entered;f.stopCallback()();await f.cancelHold.entered;const original=(await f.core.getTask(f.task.id)).requests[0].id;f.handlers.openArtifact(f.artifactB);if(outcome==='error')f.faults.cancel=true;f.cancelHold.release();await f.settleStops();expect(f.cancellations).toEqual([{type:'model.cancel',taskId:f.task.id,requestId:original}]);expect(f.state.error).toBe('');expect(f.state.notice).toBe('');f.hold.release();expect(await sending).toBe(false);
});
it('an accepted matching live Stop still presents a cancellation transport error',async()=>{
 const f=await fixture(),sending=f.send();await f.hold.entered;f.faults.cancel=true;f.stopCallback()();await f.cancelHold.entered;f.cancelHold.release();await f.settleStops();expect(f.state.error).not.toBe('');expect(f.cancellations).toHaveLength(1);f.hold.release();expect(await sending).toBe(false);
});
it('legacy event-style Stop callers retain their existing cancellation behavior',async()=>{
 const f=await fixture(),sending=f.send();await f.hold.entered;const stopping=f.handlers.stop({type:'click'});await f.cancelHold.entered;f.cancelHold.release();await stopping;expect(f.cancellations).toHaveLength(1);expect(f.state.notice).toBe('Stopped. Saved work is kept.');f.hold.release();expect(await sending).toBe(false);
});
