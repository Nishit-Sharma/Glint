import {withOrdinaryAppBindings} from '../support/concurrent-app-bindings.fixture';
import {currentAnswerOrigin} from '../support/current-answer-origin.fixture';
import {requestableSourceIds} from '../../src/shared/source-intake';
import {expect,it} from 'vitest';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
import {createCompanion,type Task} from '../../src/core/companion';
import {readComposerDraft} from '../../src/core/task-session';
import {savedDocumentSourcePreview} from '../../src/shared/saved-document-source';
import {buildMetaMessages} from '../../src/host/provider';
import {buildCodexInput} from '../../src/host/codex-provider';
import type {Command} from '../../src/shared/bridge';
it('the actual App freezes only the owning task’s current source selection before adding a copied source',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'document-selection-')),core=await createCompanion({dataDir:directory});try{
  const created=await core.createTask({title:'Selection owner'});await core.putSource(created.id,{kind:'text',role:'fact',label:'Old A',content:'Old A'});const owner=await core.putSource(created.id,{kind:'text',role:'fact',label:'Old B',content:'Old B'}),ids=owner.sources.map(source=>source.id),app=await routingApp(owner,core,{other:['unrelated']});
  await app.preserveDocumentSourceSelection(owner.id);expect(app.scopeRef.current).toEqual({other:['unrelated'],[owner.id]:ids});
  const newer=await core.putSource(owner.id,{kind:'text',role:'fact',label:'New copy',content:'New copy'});app.setOwner(newer);await app.preserveDocumentSourceSelection(owner.id);expect(app.scopeRef.current[owner.id]).toEqual(ids);
  await app.selectSourceScope([ids[1]]);await app.preserveDocumentSourceSelection(owner.id);expect(app.scopeRef.current[owner.id]).toEqual([ids[1]]);
  const before=structuredClone(app.scopeRef.current),other=await core.createTask({title:'Another owner'});app.setOwner(other);await expect(app.preserveDocumentSourceSelection(owner.id)).rejects.toThrow('Return to the source owner task.');await expect(app.preserveDocumentSourceSelection('deleted-task')).rejects.toThrow('Return to the source owner task.');expect(app.scopeRef.current).toEqual(before);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

/** Extract production App functions, retaining their mutual calls and real core
 * source selection/provider payload builders. Browser/provider transport is inert. */
async function routingApp(owner:Task,core:Awaited<ReturnType<typeof createCompanion>>,initial:Record<string,string[]>){
 const source=await readFile(new URL('../../src/renderer/src/App.tsx',import.meta.url),'utf8'),file=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),names=['saveSourceScope','preserveDocumentSourceSelection','modelRun','runBrowser','detachBrowser','selectSourceScope'],declarations=new Map<string,string>();const visit=(node:ts.Node)=>{if(ts.isFunctionDeclaration(node)&&node.name&&names.includes(node.name.text))declarations.set(node.name.text,node.getText(file));ts.forEachChild(node,visit);};visit(file);expect(declarations.size).toBe(names.length);
 const taskRef={current:owner},taskListSnapshot={current:{generation:0,tasks:[owner]}},scopeRef={current:structuredClone(initial)},commands:Command[]=[],bridgeCommands:Command[]=[],payloads:unknown[]=[];
 const bindings=withOrdinaryAppBindings(file,{requestableSourceIds,draftFrozen:false,sourceReviewIntent:{current:0},setSourceSelectionSaving:()=>{},setTasks:()=>{},refresh:async()=>{},taskRef,taskListSnapshot,scopeRef,requestRef:{current:undefined},lock:{current:false},crypto:{randomUUID},readComposerDraft,draftNavigation:{api:{hasDirty:()=>false}},drafts:{getSnapshot:()=>({})},setBrowserStart:()=>{},setNotice:()=>{},setArrivalIdentities:()=>{},setPendingRequest:()=>{},setStream:()=>{},setError:()=>{},setTask:(task:Task)=>{taskRef.current=task;},bridge:{invoke:async(command:Command)=>{bridgeCommands.push(command);if(command.type==='source-selection.set')return core.setSourceSelection(command);if(command.type==='browser.detach')return core.clearBrowserContext(command.taskId);throw Error('No other host boundary belongs to this check.');}},run:async(command:Command)=>{
  commands.push(command);if(command.type==='browser.run')return core.getTask(command.taskId);
  if(command.type!=='model.run')throw Error('No other execution boundary belongs to this check.');
  await core.runRequest({taskId:command.taskId,requestId:command.requestId,kind:command.kind,prompt:command.prompt,...(command.sourceIds!==undefined?{sourceIds:command.sourceIds}:{})},async ctx=>{const sources=ctx.task.sources.map(source=>source.versions.at(-1)!);payloads.push({sourceIds:sources.map(source=>source.id),meta:buildMetaMessages(command.prompt,sources,ctx.taskHistory),codex:buildCodexInput({prompt:command.prompt,sources,taskContext:ctx.taskHistory})});return {title:'Inert payload capture',content:'No provider call was made.'};});return core.getTask(command.taskId);
 }});
 const code=ts.transpileModule([...declarations.values()].join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,app=Function(...Object.keys(bindings),code+'\nreturn {'+names.join(',')+'};')(...Object.values(bindings)) as {preserveDocumentSourceSelection:(id:string)=>Promise<void>;modelRun:(prompt:string,kind:'explain')=>Promise<unknown>;selectSourceScope:(ids:string[])=>Promise<void>};
 return {...app,commands,bridgeCommands,payloads,scopeRef,setOwner:(task:Task)=>{taskRef.current=task;taskListSnapshot.current.tasks=[task];}};
}
async function browserCopyFixture(check:(input:{core:Awaited<ReturnType<typeof createCompanion>>;target:Task;copy:ReturnType<typeof copyInput>;context:{origin:string;url:string;requestId:string}})=>Promise<void>){
 const directory=await mkdtemp(join(tmpdir(),'document-copy-route-')),core=await createCompanion({dataDir:directory});try{const original=await core.createTask({title:'Document owner'}),saved=await currentAnswerOrigin(core,original.id,randomUUID(),{title:'Saved document',content:'Exact saved document body',mimeType:'text/markdown'},[]),owner=await core.getTask(original.id),created=await core.createTask({title:'Browser task'});await core.putSource(created.id,{kind:'text',role:'fact',label:'Previously unselected source',content:'PRIVATE_OLD_SOURCE_SHOULD_STAY_UNSELECTED'});await core.saveComposerDraft(created.id,0,{kind:'explain',text:'PRIVATE_BROWSER_TASK_DRAFT'});const current=await core.getTask(created.id),context={origin:'https://owned.invalid',url:'https://owned.invalid/current',requestId:'prior-browser'};await core.replaceSession(current.id,current.session!.revision,{...current.session!,browserContext:context});await check({core,target:await core.getTask(current.id),copy:copyInput(owner,current.id,saved.artifactId,saved.revision),context});}finally{await core.close();await rm(directory,{recursive:true,force:true});}
}
function copyInput(owner:Task,taskId:string,artifactId:string,revision:{revision:number;digest:string}){const artifact={artifactId,revision:revision.revision,digest:revision.digest};return {taskId,ownerTaskId:owner.id,artifact,role:'fact' as const,expectedSnapshot:savedDocumentSourcePreview(owner,artifact).snapshot};}
it.each(['unset','empty'] as const)('the actual App keeps an %s browser scope and browser route after adding a snapshot, with no model source payload',async selection=>{
 await browserCopyFixture(async({core,target})=>{const before=await routingApp(target,core,{});await before.modelRun('Read the current page.','explain');expect(before.commands.map(command=>command.type)).toEqual(['browser.run']);});
 await browserCopyFixture(async({core,target,copy,context})=>{
 const app=await routingApp(target,core,selection==='unset'?{}:{[target.id]:[]});await app.preserveDocumentSourceSelection(target.id);const result=await core.copySavedDocumentSource(copy);app.setOwner(result.task);await app.modelRun('Continue with the current page.','explain');
 await mkdir('evidence',{recursive:true});await writeFile(`evidence/browser-route-${selection}-observed.json`,JSON.stringify({scope:app.scopeRef.current,context:result.task.session?.browserContext??null,commands:app.commands,payloads:app.payloads},null,2)+'\n');
 expect(app.commands.map(command=>command.type)).toEqual(['browser.run']);expect(result.task.session?.browserContext).toEqual(context);expect(app.scopeRef.current[target.id]).toEqual([]);expect(app.payloads).toEqual([]);expect(JSON.stringify(app.commands)).not.toContain('PRIVATE_');expect(app.bridgeCommands.map(command=>command.type)).toEqual(['source-selection.set','source-selection.set']);
});});
it('only explicit source selection detaches the browser route; the actual model payload contains only the selected copy',async()=>browserCopyFixture(async({core,target,copy})=>{
 const app=await routingApp(target,core,{});await app.preserveDocumentSourceSelection(target.id);const result=await core.copySavedDocumentSource(copy);app.setOwner(result.task);expect(app.commands).toEqual([]);expect(app.bridgeCommands.map(command=>command.type)).toEqual(['source-selection.set']);
 await app.selectSourceScope([result.reference.sourceId]);expect(app.bridgeCommands.map(command=>command.type)).toEqual(['source-selection.set','browser.detach','source-selection.set']);await app.modelRun('Use my explicitly selected document copy.','explain');expect(app.commands.map(command=>command.type)).toEqual(['model.run']);expect(app.payloads).toHaveLength(1);const payload=app.payloads[0] as {sourceIds:string[]};expect(payload.sourceIds).toEqual([result.reference.sourceId]);expect(JSON.stringify(payload)).toContain('Exact saved document body');expect(JSON.stringify(payload)).not.toContain('PRIVATE_');
}));
