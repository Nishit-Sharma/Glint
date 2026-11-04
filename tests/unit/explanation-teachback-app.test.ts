import {expect,it} from 'vitest';
import ts from 'typescript';
import {readFile} from 'node:fs/promises';
import {isConcurrentOrdinary} from '../../src/shared/task-concurrency';
import {isSourceIntakeCommand} from '../../src/shared/source-intake';
import {isExportCommand} from '../../src/shared/export-contract';
import {publicErrorMessage} from '../../src/shared/public-messages';
// Reviewer B's executed candidate1 rejection probe, extended to refresh failures and activation.
it.each(['bridge','refresh'].flatMap(phase=>['navigation','surface','activation','live'].map(mode=>({phase,mode}))))('actual App.run preserves teachback error ownership after $mode during $phase',async({mode,phase})=>{
 const path='src/renderer/src/App.tsx';
 const source=await readFile(path,'utf8'),file=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),app=file.statements.find((n):n is ts.FunctionDeclaration=>ts.isFunctionDeclaration(n)&&n.name?.text==='App')!;
 const handlers=['run','setError'].map(name=>app.body!.statements.find((n):n is ts.FunctionDeclaration=>ts.isFunctionDeclaration(n)&&n.name?.text===name&&!!n.body)!.getText(file));
 let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>enter=r),gate=new Promise<void>(r=>release=r),state={error:''},newQuestionEpoch={current:0},incomingActivationEpoch={current:0},surfaceIntentEpoch={current:0};
 const env={isConcurrentOrdinary,isSourceIntakeCommand,isExportCommand,publicErrorMessage,ordinaryRequests:{get:()=>undefined,size:0},taskRef:{current:{id:'task'}},newQuestionEpoch,incomingActivationEpoch,surfaceIntentEpoch,lock:{current:false},requestErrorOwner:{current:undefined},lastRunError:{current:''},setBusy:()=>{},setErrorValue:(text:string)=>{state.error=text;},bridge:{invoke:async()=>{if(phase==='bridge'){enter();await gate;throw Error('Synthetic delayed rejection');}return {};}},refresh:async()=>{if(phase==='refresh'){enter();await gate;throw Error('Synthetic delayed refresh rejection');}}};
 const js=ts.transpileModule(handlers.join('\n')+'\nreturn run;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,run=new Function(...Object.keys(env),js)(...Object.values(env));
 const pending=run({type:'model.run',kind:'revise',taskId:'task',requestId:'exact-intent',prompt:'Exact learner answer',artifactId:'explanation',teachback:{basis:{artifactId:'explanation',revision:1,digest:'a'.repeat(64)},answer:'Exact learner answer'}});await entered;
 if(mode==='navigation')newQuestionEpoch.current++;if(mode==='surface')surfaceIntentEpoch.current++;if(mode==='activation')incomingActivationEpoch.current++;release();await pending;
 if(mode==='live')expect(state.error).not.toBe('');else expect(state.error).toBe('');
});
it.each(['bridge','refresh'].flatMap(phase=>['navigation','surface','activation','live'].map(mode=>({phase,mode}))))('actual App teachback inspect callback owns delayed errors after $mode during $phase',async({mode,phase})=>{
 const path='src/renderer/src/App.tsx';
 const source=await readFile(path,'utf8'),file=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),app=file.statements.find((n):n is ts.FunctionDeclaration=>ts.isFunctionDeclaration(n)&&n.name?.text==='App')!;
 const handlers=['run','setError'].map(name=>app.body!.statements.find((n):n is ts.FunctionDeclaration=>ts.isFunctionDeclaration(n)&&n.name?.text===name&&!!n.body)!.getText(file)),binding=app.body!.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(file)==='explanationContent'))!;
 let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>enter=r),gate=new Promise<void>(r=>release=r),state={error:''},newQuestionEpoch={current:0},incomingActivationEpoch={current:0},surfaceIntentEpoch={current:0},artifact={id:'explanation',revisions:[{revision:1,digest:'a'.repeat(64),mimeType:'explanation-fixture',sourceRefs:[]}]},task={id:'task',status:'active',artifacts:[artifact]},taskRef={current:task};
 const env={isConcurrentOrdinary,isSourceIntakeCommand,isExportCommand,publicErrorMessage,ordinaryRequests:{get:()=>undefined,size:0},taskRef,newQuestionEpoch,incomingActivationEpoch,surfaceIntentEpoch,lock:{current:false},requestErrorOwner:{current:undefined},lastRunError:{current:''},setBusy:()=>{},setErrorValue:(text:string)=>{state.error=text;},bridge:{invoke:async()=>{if(phase==='bridge'){enter();await gate;throw Error('Synthetic delayed inspection rejection');}return {};}},refresh:async()=>{if(phase==='refresh'){enter();await gate;throw Error('Synthetic delayed inspection refresh rejection');}},React:{createElement:(_type:any,props:any)=>({props})},ExplanationView:()=>{},EXPLANATION_MIME:'explanation-fixture',last:(xs:any[])=>xs.at(-1),task,artifact,busy:false,effectivePending:undefined,draftFrozen:false,workflowReviewNavigation:0,workflowReviewActivation:0,documentSuggestionSurfaceEpoch:0,documentSuggestionSurface:'workspace',surfaceModeRef:{current:'workspace'},taskRunning:()=>undefined};
 const js=ts.transpileModule(handlers.join('\n')+'\n'+binding.getText(file)+'\nreturn explanationContent(artifact).props.teachbackActions;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React}}).outputText,actions=new Function(...Object.keys(env),js)(...Object.values(env));
 const pending=actions.inspect();await entered;if(mode==='navigation')newQuestionEpoch.current++;if(mode==='surface')surfaceIntentEpoch.current++;if(mode==='activation')incomingActivationEpoch.current++;release();await pending;
 if(mode==='live')expect(state.error).not.toBe('');else expect(state.error).toBe('');
});
