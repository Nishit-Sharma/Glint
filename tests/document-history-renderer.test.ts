import {afterEach,expect,it,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('./controlled-renderer.fixture')).hooks}));
vi.mock('lucide-react',async original=>({...await original<typeof import('lucide-react')>(),ArrowLeft:()=>null}));
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import ts from 'typescript';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {LearningDraftStore} from '../src/host/learning-drafts';
import {createLearningDrafts} from '../src/renderer/src/learning-drafts';
import {createSavedDocumentDraftController} from '../src/renderer/src/saved-document-draft-controller';
import {createRevisionInstructionsController} from '../src/renderer/src/revision-instructions-controller';
import {prepareSavedRevisionDraft} from '../src/renderer/src/saved-revision-draft';
import {ordinaryTextDocument,savedDocumentDraftBasis} from '../src/shared/saved-document-draft';
import * as editorState from '../src/renderer/src/editor-state';
import {canEditRichText,renameDocumentTitle} from '../src/renderer/src/document-format';
import {useNavigationDraft} from '../src/renderer/src/draft-navigation';
import {Button,Field} from '../src/renderer/src/ui';
import {SavedDocumentDraftStatus} from '../src/renderer/src/components/SavedDocumentDraftStatus';
import {SourceLinks} from '../src/renderer/src/components/SourceLinks';
import {RevisionCompare} from '../src/renderer/src/components/RevisionCompare';
import {PageReferencePicker} from '../src/renderer/src/components/PageReferencePicker';
import {usePageReferenceNavigation} from '../src/renderer/src/page-reference-navigation';
import {createControlledRenderer} from './controlled-renderer.fixture';
import type {ArtifactInput,Task} from '../src/core/types';

const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0))await close();});
const text=(node:{type:string;props:Record<string,any>;children:any[]}):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');

async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'document-history-renderer-')),core=await createCompanion({dataDir:directory});
 cleanup.push(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});
 const owner=await core.createTask({title:'Synthetic history owner'}),first=await core.saveArtifact(owner.id,{title:'Earlier saved document',content:'Synthetic V23 task saved work.',mimeType:'text/plain',sourceRefs:[]});
 await core.saveArtifact(owner.id,{artifactId:first.artifactId,expectedRevision:1,title:'Current saved document',content:'Synthetic V24 owner revision two.',mimeType:'text/plain',sourceRefs:[]});
 await core.saveComposerDraft(owner.id,0,{text:'UNSENT keep original\n',kind:'create'});let task=await core.getTask(owner.id);
 const store=new LearningDraftStore({directory,lookupTask:id=>core.getTask(id)}),cache=createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)});await cache.load();
 const initial=task.artifacts[0].revisions[1],setup=createSavedDocumentDraftController({cache,artifactId:first.artifactId,task:()=>task,base:()=>initial,isCurrent:()=>true,send:async()=>undefined,onSaved:()=>{}});
 setup.edit({content:'Temporary setup input, explicitly discarded before reading.'});await cache.flush();expect(await setup.discard()).toBe(true);await cache.flush();
 const before=structuredClone(task),rawBefore=await readFile(join(directory,'learning-drafts.json'),'utf8'),commands:any[]=[];
 const source=await readFile('src/renderer/src/App.tsx','utf8'),file=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let declaration:ts.FunctionDeclaration|undefined;
 const visit=(node:ts.Node)=>{if(ts.isFunctionDeclaration(node)&&node.name?.text==='ArtifactEditor')declaration=node;ts.forEachChild(node,visit);};visit(file);if(!declaration)throw Error('Actual ArtifactEditor declaration is missing.');
 const bindings={useState:React.useState,useRef:React.useRef,useEffect:React.useEffect,useSyncExternalStore:React.useSyncExternalStore,...editorState,ordinaryTextDocument,createSavedDocumentDraftController,createRevisionInstructionsController,prepareSavedRevisionDraft,canEditRichText,renameDocumentTitle,useNavigationDraft,Button,Field,SavedDocumentDraftStatus,SourceLinks,RevisionCompare,
  last:<T,>(items:T[])=>items.at(-1)!,date:(value:string)=>value,signalPracticeDisplay:()=>null,Download:()=>null,
  TaskMenu:({children}:{children:React.ReactNode})=>children,DeveloperDetails:()=>null,ReadableText:({text:body}:{text:string})=>React.createElement('div',{className:'readable-text'},body),RevisionInstructionsInput:()=>null,PageReferencePicker,usePageReferenceNavigation,
 };
 const javascript=ts.transpileModule(declaration.getText(file),{fileName:'ArtifactEditor.tsx',compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const ArtifactEditor=Function('require','exports',...Object.keys(bindings),javascript+'\nreturn ArtifactEditor;')((id:string)=>{if(id==='react/jsx-runtime')return jsx;throw Error('Unexpected extracted editor dependency '+id);},{},...Object.values(bindings));
 const view=createControlledRenderer(()=>React.createElement(ArtifactEditor,{task,artifact:task.artifacts[0],cache,scope:'owned-history',isCurrent:()=>true,busy:false,run:async(command:any)=>{commands.push(command);return undefined;},saveDocument:async(input:ArtifactInput)=>{commands.push({type:'artifact.save',artifact:input});await core.saveArtifact(task.id,input);task=await core.getTask(task.id);return task;},back:()=>{},onModel:async()=>undefined,running:false,onStop:()=>{},onConfigure:()=>{},onWorkflowCreated:()=>{},workflowReviewScope:'owned-history',workflowReviewCurrent:()=>true}));
 const button=(label:string)=>view.find(node=>node.type==='button'&&text(node)===label);
 view.render();button('Sources & versions').props.onClick();view.render();
 return {core,cache,store,view,button,commands,before,rawBefore,directory,setup,get task(){return task;},async select(revision:number){view.find(node=>node.type==='select'&&node.children.some(child=>text(child).startsWith('Revision '))).props.onChange({target:{value:String(revision)}});await Promise.resolve();view.render();},async raw(){await cache.flush();return readFile(join(directory,'learning-drafts.json'),'utf8');},async advance(){await core.saveArtifact(task.id,{artifactId:first.artifactId,expectedRevision:task.artifacts[0].revisions.at(-1)!.revision,title:'New current document',content:'Newly saved third body.',mimeType:'text/plain',sourceRefs:[]});task=await core.getTask(task.id);view.render();}};
}

it('reads an exact older saved version without inventing unsaved edits, recovery or a disabled Export when raw is null',async()=>{
 const f=await fixture();await f.select(1);
 expect(f.view.find(node=>node.props.className==='readable-text').children.map(text).join('')).toBe('Synthetic V23 task saved work.');
 const shown=f.view.nodes().filter(node=>node.type==='#text').map(text).join('');
 expect.soft(shown).not.toContain('has unsaved edits');expect.soft(shown).not.toContain('Earlier document edits');expect.soft(f.button('Export').props.disabled).toBe(false);
 expect(await f.raw()).toBe(f.rawBefore);expect(await f.core.getTask(f.task.id)).toEqual(f.before);expect(f.commands).toEqual([]);
});

it('keeps a genuine unfinished current draft when changing a historical read selection',async()=>{
 const f=await fixture();await f.select(1);f.setup.edit({content:'Genuine later unfinished current document.'});const raw=await f.raw();f.view.render();await f.select(2);await f.cache.flush();f.view.render();
 expect(f.view.nodes().some(node=>node.props.className==='revision-switch-warning')).toBe(true);
 f.button('Keep editing').props.onClick();f.view.render();expect(f.view.find(node=>node.type==='textarea'&&node.props['aria-label']==='Draft content').props.value).toBe('Genuine later unfinished current document.');expect(await f.raw()).toBe(raw);expect(await f.core.getTask(f.task.id)).toEqual(f.before);expect(f.commands).toEqual([]);
});

it('keeps an exact historical read through a newer saved revision, then stages its explicit Edit on the latest basis without saving',async()=>{
 const f=await fixture();await f.select(1);await f.advance();
 expect(f.view.find(node=>node.props.className==='readable-text').children.map(text).join('')).toBe('Synthetic V23 task saved work.');expect(f.button('Export').props.disabled).toBe(false);expect(await f.raw()).toBe(f.rawBefore);
 f.button('Edit document').props.onClick();await vi.waitFor(()=>{f.view.render();expect(f.view.nodes().some(node=>node.type==='textarea'&&node.props['aria-label']==='Draft content')).toBe(true);});
 const body=f.view.find(node=>node.type==='textarea'&&node.props['aria-label']==='Draft content');expect(body.props.value).toBe('Synthetic V23 task saved work.');expect(body.props.readOnly).toBe(false);expect(f.button('Save revision').props.disabled).toBe(false);
 const record=(await f.store.read());if(record.kind!=='available')throw Error('Expected readable fixture draft.');const saved=record.records.find(entry=>'kind' in entry.owner&&entry.owner.kind==='saved-document-edit');expect(saved?.value?.basis).toBe(savedDocumentDraftBasis(f.task,f.task.artifacts[0].id,f.task.artifacts[0].revisions[2]));expect(JSON.parse(saved!.value!.value)).toMatchObject({present:true,content:'Synthetic V23 task saved work.'});expect(f.commands).toEqual([]);expect(f.task.artifacts[0].revisions).toHaveLength(3);expect(f.task.session?.draft).toBe('UNSENT keep original\n');
});
