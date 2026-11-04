import {afterEach,expect,it} from 'vitest';
import ts from 'typescript';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {LearningDraftStore} from '../src/host/learning-drafts';
import {createLearningDrafts} from '../src/renderer/src/learning-drafts';
import {createNewDocumentDraftController} from '../src/renderer/src/new-document-draft-controller';
import type {Command} from '../src/shared/bridge';
const cleanup:Array<()=>Promise<void>>=[];afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
function gate(){let enter!:()=>void,release!:()=>void;return {started:new Promise<void>(r=>enter=r),wait:new Promise<void>(r=>release=r),enter:()=>enter(),release:()=>release()};}
function evaluate<T>(source:string,bindings:Record<string,unknown>):T{
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 return new Function(...Object.keys(bindings),js)(...Object.values(bindings)) as T;
}
/** Actual App JSX authority and actual editor callbacks; only React scheduling,
 * bridge delivery and raw/reply timing are substituted. Core/cache/store stay real. */
async function fixture(){
 const app=await readFile('src/renderer/src/App.tsx','utf8'),file=ts.createSourceFile('App.tsx',app,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let call:ts.JsxSelfClosingElement|undefined,editor:ts.FunctionDeclaration|undefined;
 function visit(node:ts.Node){if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(file)==='ArtifactEditor')call=node;if(ts.isFunctionDeclaration(node)&&node.name?.text==='ArtifactEditor')editor=node;ts.forEachChild(node,visit);}visit(file);if(!call||!editor)throw Error('Actual document editor/caller is unavailable.');
 const attrs=new Map(call.attributes.properties.flatMap(attr=>ts.isJsxAttribute(attr)&&attr.initializer&&ts.isJsxExpression(attr.initializer)&&attr.initializer.expression?[[attr.name.getText(file),attr.initializer.expression.getText(file)] as const]:[]));
 let creation:ts.CallExpression|undefined,save:ts.FunctionDeclaration|undefined;
 function child(node:ts.Node){if(ts.isCallExpression(node)&&node.expression.getText(file)==='createNewDocumentDraftController')creation=node;if(ts.isFunctionDeclaration(node)&&node.name?.text==='save')save=node;ts.forEachChild(node,child);}child(editor);if(!creation||!save)throw Error('Actual new-document creation/save callback is unavailable.');
 const options=creation.arguments[0].getText(file),saveSource=save.getText(file);
 const directory=await mkdtemp(join(tmpdir(),'new-document-surface-')),core=await createCompanion({dataDir:directory});let task=await core.createTask({title:'Surface-owned new document'}),opened=0,rawGate:ReturnType<typeof gate>|undefined,replyGate:ReturnType<typeof gate>|undefined;
 const commands:Command[]=[],taskRef={current:task},newQuestionEpoch={current:0},incomingActivationEpoch={current:0},surfaceIntentEpoch={current:0},surfaceModeRef={current:'workspace'},workflowContinuation={current:{epoch:0}};
 const storage=new LearningDraftStore({directory,lookupTask:id=>core.getTask(id)}),cache=createLearningDrafts({read:()=>storage.read(),save:async(...args)=>{const held=rawGate,value=args[4];if(held&&value&&JSON.parse(value.value).intentId){rawGate=undefined;held.enter();await held.wait;}return storage.save(...args);}});await cache.load();
 const latestDocument={current:{} as Record<string,any>};
 function render(){
  const env={task,taskRef,newQuestionEpoch,incomingActivationEpoch,surfaceIntentEpoch,surfaceModeRef,workflowContinuation,workflowReviewNavigation:newQuestionEpoch.current,workflowReviewActivation:incomingActivationEpoch.current,workflowReviewEpoch:workflowContinuation.current.epoch,documentSuggestionSurfaceEpoch:surfaceIntentEpoch.current,documentSuggestionSurface:surfaceModeRef.current};
  latestDocument.current={task,...Object.fromEntries(['scope','isCurrent','suggestionScope','suggestionCurrent'].map(name=>{const source=attrs.get(name);if(!source)throw Error('Missing actual scope attribute '+name);return [name,evaluate('return ('+source+');',env)];})),run:async(command:Command)=>{if(command.type!=='document.create')throw Error('Unexpected command');commands.push(command);const {type,...input}=command,result=await core.createAuthoredDocument(input);task=result.task;taskRef.current=task;const held=replyGate;replyGate=undefined;held?.enter();await held?.wait;return result;},back:()=>{opened++;}};
 }
 render();
 function mount(){return evaluate<ReturnType<typeof createNewDocumentDraftController>>('return createNewDocumentDraftController('+options+');',{createNewDocumentDraftController,cache,latestDocument,documentRefresh:()=>{}});}
 let controller=mount();
 function callback(target=controller){return evaluate<(event:{preventDefault():void})=>Promise<void>>(saveSource+'\nreturn save;',{documentController:undefined,newDocumentController:target,scope:latestDocument.current.scope,suggestionScope:latestDocument.current.suggestionScope});}
 cleanup.push(async()=>{rawGate?.release();replyGate?.release();await core.close();await rm(directory,{recursive:true,force:true});});
 return {core,cache,commands,get controller(){return controller},get task(){return task},get opened(){return opened},get scope(){return latestDocument.current.suggestionScope as string},callback,async input(){controller.edit({title:'Current new input',content:'Keep this exact source-free body.'});await cache.flush();},holdRaw(){rawGate=gate();return rawGate;},holdReply(){replyGate=gate();return replyGate;},surface(mode:'workspace'|'companion'){surfaceIntentEpoch.current++;surfaceModeRef.current=mode;workflowContinuation.current.epoch++;render();},remount(){controller=mount();return controller;}};
}
it.each(['compact','compact-and-return'] as const)('the actual App/editor fence retires a raw-flush-held save on %s without IPC or publication',async mode=>{
 const f=await fixture();await f.input();const held=f.holdRaw(),save=f.callback(),sending=save({preventDefault(){}});await held.started;f.surface('companion');if(mode==='compact-and-return')f.surface('workspace');held.release();await sending;expect(f.commands).toEqual([]);expect((await f.core.getTask(f.task.id)).artifacts).toEqual([]);expect(f.controller.snapshot().raw.intentId).not.toBe('');expect(f.controller.snapshot().fields.content).toBe('Keep this exact source-free body.');expect(f.opened).toBe(0);await save({preventDefault(){}});expect(f.commands).toEqual([]);
});
it('the actual current workspace save still publishes one origin and completes navigation',async()=>{
 const f=await fixture();await f.input();await f.callback()({preventDefault(){}});expect(f.commands).toHaveLength(1);expect(f.task.artifacts).toHaveLength(1);expect(f.task.artifacts[0].revisions[0].contextOrigin?.kind).toBe('authored-document-v1');expect(f.opened).toBe(1);expect(f.controller.snapshot().raw.present).toBe(false);
});
it('a durable late reply after compact/return cannot navigate or clear a remounted newer raw generation',async()=>{
 const f=await fixture();await f.input();const held=f.holdReply(),sending=f.callback()({preventDefault(){}});await held.started;expect((await f.core.getTask(f.task.id)).artifacts).toHaveLength(1);f.surface('companion');f.surface('workspace');const newer=f.remount();expect(await newer.discard(f.scope)).toBe(true);expect(newer.edit({title:'New current input',content:'Do not clear this newer body.'},f.scope).kind).toBe('accepted');await f.cache.flush();held.release();await sending;expect(f.commands).toHaveLength(1);expect((await f.core.getTask(f.task.id)).artifacts).toHaveLength(1);expect(newer.snapshot().fields.content).toBe('Do not clear this newer body.');expect(f.opened).toBe(0);
});
