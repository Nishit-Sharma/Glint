import {afterEach,expect,it,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('./controlled-renderer.fixture')).hooks}));
const rich=vi.hoisted(()=>({calls:0}));
vi.mock('@tiptap/react',()=>({useEditor:()=>{rich.calls++;return null;},useEditorState:()=>undefined,EditorContent:()=>null}));
import {createElement} from 'react';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {LearningDraftStore} from '../src/host/learning-drafts';
import {createLearningDrafts} from '../src/renderer/src/learning-drafts';
import {createSavedDocumentDraftController} from '../src/renderer/src/saved-document-draft-controller';
import {PageReferencePicker} from '../src/renderer/src/components/PageReferencePicker';
import RichDocument from '../src/renderer/src/components/RichDocument';
import {markdownComponents} from '../src/renderer/src/components/markdown-policy';
import {requestPageReferenceNavigation,type PageReadCommand} from '../src/renderer/src/page-reference-navigation';
import {DraftNavigationProvider,useDraftNavigation,useNavigationDraft} from '../src/renderer/src/draft-navigation';
import {prependPageReference,resolvePageReference,pageReferenceHref,type PageReference} from '../src/shared/page-reference';
import {createControlledRenderer} from './controlled-renderer.fixture';
import type {Task} from '../src/core/types';

const close:Array<()=>Promise<void>>=[];afterEach(async()=>{for(const dispose of close.splice(0))await dispose();});
const text=(node:{type:string;props:Record<string,any>;children:any[]}):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
const tick=()=>new Promise<void>(resolve=>setTimeout(resolve,2));
async function until(check:()=>boolean){for(let i=0;i<200;i++){if(check())return;await tick();}throw Error('Controlled page-reference operation did not settle');}
async function fixture(){
 const directory=await mkdtemp(join(process.cwd(),'evidence/page-ref-ui-')),core=await createCompanion({dataDir:directory});close.push(()=>core.close());const owner=await core.createTask({title:'Existing source owner'}),source=await core.saveArtifact(owner.id,{title:'Source page',content:'Source canonical text',mimeType:'text/markdown',sourceRefs:[]}),other=await core.createTask({title:'Another owner'}),first=await core.saveArtifact(other.id,{title:'First target',content:'First actual target saved body',mimeType:'text/plain',sourceRefs:[]}),second=await core.saveArtifact(other.id,{title:'Second target',content:'Second distinct saved target',mimeType:'text/markdown',sourceRefs:[]});
 let task=await core.getTask(owner.id),base=source.revision,current=true,saved=0,hold:((taskId:string)=>Promise<Task>)|undefined;const store=new LearningDraftStore({directory,lookupTask:id=>core.getTask(id)}),cache=createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)});await cache.load();const commands:PageReadCommand[]=[],writes:unknown[]=[];
 const controller=createSavedDocumentDraftController({cache,artifactId:source.artifactId,task:()=>task,base:()=>base,isCurrent:()=>current,send:async input=>{writes.push(input);await core.saveArtifact(task.id,input);task=await core.getTask(task.id);return task;},onSaved:revision=>{base=revision;}});
 const invoke=async<T,>(command:PageReadCommand):Promise<T>=>{commands.push(command);return (command.type==='tasks.list'?await core.listTasks():hold?await hold(command.taskId):await core.getTask(command.taskId)) as T;};
 const view=createControlledRenderer(()=>createElement(PageReferencePicker,{task,artifact:task.artifacts[0],controller,disabled:false,isCurrent:()=>current,invoke,onSaved:()=>{saved++;}}));
 const button=(label:string)=>view.find(node=>node.type==='button'&&text(node)===label),select=()=>view.find(node=>node.type==='select'&&node.props.name==='existing-page');
 view.render();return {core,cache,controller,view,button,select,commands,writes,first,second,targetTaskId:other.id,get task(){return task;},get saved(){return saved;},setHold:(value:typeof hold)=>{hold=value;},retire:()=>{current=false;},async open(){button('Link existing page').props.onClick();await until(()=>{view.render();return view.nodes().some(node=>node.type==='option'&&text(node).includes('First target'));});},async choose(artifactId:string){select().props.onChange({target:{value:JSON.stringify({taskId:other.id,artifactId})}});await until(()=>{view.render();return view.nodes().some(node=>node.type==='textarea'&&node.props.value===(artifactId===first.artifactId?'First actual target saved body':'Second distinct saved target'));});}};
}

it('actual chooser inspects cross-owner saved content, Cancel leaves raw/canonical exact, and explicit Save uses the real controller',async()=>{
 const f=await fixture(),before=await f.core.getTask(f.task.id),raw=f.controller.snapshot().raw;await f.open();await f.choose(f.first.artifactId);expect(f.view.nodes().filter(node=>node.type==='label').map(text)).toEqual(['Existing saved page','Saved page content']);f.button('Cancel').props.onClick();f.view.render();expect(f.controller.snapshot().raw).toEqual(raw);expect(await f.core.getTask(f.task.id)).toEqual(before);expect(f.writes).toEqual([]);
 await f.open();await f.choose(f.second.artifactId);f.button('Save page link').props.onClick();await until(()=>{f.view.render();return f.saved===1;});expect(f.writes).toHaveLength(1);expect(f.task.artifacts[0].revisions.at(-1)!.content).toContain(pageReferenceHref({taskId:f.targetTaskId,artifactId:f.second.artifactId}));expect((await f.core.getTask(f.targetTaskId)).artifacts).toHaveLength(2);
});

it('dirty-source entry preserves exact raw and dispatches neither catalog nor canonical save',async()=>{
 const f=await fixture();f.controller.edit({title:'Raw source title',content:'Exact raw source body\n'});await f.cache.flush();const before=f.controller.snapshot().raw;f.button('Link existing page').props.onClick();f.view.render();expect(f.controller.snapshot().raw).toEqual(before);expect(f.commands).toEqual([]);expect(f.writes).toEqual([]);expect(f.view.nodes().some(node=>node.type==='dialog')).toBe(false);expect(f.view.nodes().filter(node=>node.type==='#text').map(text).join('')).toContain('Your draft is kept');
});

it('same-source Cancel/reopen invalidates old confirm/Cancel handlers and late target previews',async()=>{
 const f=await fixture();await f.open();await f.choose(f.first.artifactId);const oldSave=f.button('Save page link').props.onClick,oldCancel=f.button('Cancel').props.onClick;oldCancel();f.view.render();await f.open();await f.choose(f.second.artifactId);oldSave();oldCancel();f.view.render();await tick();expect(f.writes).toEqual([]);expect(f.view.nodes().some(node=>node.type==='textarea'&&node.props.value==='Second distinct saved target')).toBe(true);
 f.button('Cancel').props.onClick();f.view.render();await f.open();let release!:(task:Task)=>void;const held=new Promise<Task>(resolve=>{release=resolve;});f.setHold(()=>held);f.select().props.onChange({target:{value:JSON.stringify({taskId:f.targetTaskId,artifactId:f.first.artifactId})}});f.view.render();f.button('Cancel').props.onClick();f.view.render();f.setHold(undefined);await f.open();await f.choose(f.second.artifactId);release(await f.core.getTask(f.targetTaskId));await tick();f.view.render();expect(f.view.nodes().some(node=>node.type==='textarea'&&node.props.value==='Second distinct saved target')).toBe(true);expect(f.writes).toEqual([]);
});

it('mounted rich document switches to exact text fallback when a page reference arrives under the same document key',()=>{
 let value='Ordinary **rich** prose',emitted='';rich.calls=0;const view=createControlledRenderer(()=>createElement(RichDocument,{value,title:'Page',documentKey:'same-page',onChange:next=>{emitted=next;}}));view.render();expect(rich.calls).toBe(1);
 value=prependPageReference(value,{reference:{taskId:'another-owner',artifactId:'actual-page'},artifact:{artifactId:'actual-page',revision:1,digest:'a'.repeat(64)},title:'Saved target',content:'not copied',taskTitle:'Other'});view.render();const area=view.find(node=>node.type==='textarea');expect(area.props.value).toBe(value);expect(rich.calls).toBe(1);area.props.onChange({target:{value:value+'\nLater edit'}});expect(emitted).toBe(value+'\nLater edit');
});

it('rendered local reference and main draft guard reject navigation without clearing another draft',async()=>{
 const f=await fixture();let navigation!:ReturnType<typeof useDraftNavigation>,dirty=true,raw='Target current raw bytes',opened=0;
 function Dirty(){useNavigationDraft(dirty,()=>{dirty=false;raw='';});return null;}
 function Root(){navigation=useDraftNavigation();return createElement(DraftNavigationProvider,{value:navigation.api,children:[createElement(Dirty,{key:'draft'}),navigation.review]});}
 const view=createControlledRenderer(()=>createElement(Root));view.render();const target:PageReference={taskId:f.targetTaskId,artifactId:f.first.artifactId},owner=await f.core.getTask(f.targetTaskId),source={taskId:f.task.id,artifact:{artifactId:f.task.artifacts[0].id,revision:1,digest:f.task.artifacts[0].revisions[0].digest}};
 const link=markdownComponents(undefined,true,reference=>requestPageReferenceNavigation(source,reference,{scope:()=>f.task.id,sourceCurrent:()=>true,guard:action=>navigation.api.guard(action),flush:async()=>{},load:async()=>owner,apply:()=>{opened++;},error:()=>{}})).a!;
 const control=createControlledRenderer(()=>createElement(link as any,{href:pageReferenceHref(target),children:'First target'}));control.render();control.find(node=>node.type==='button').props.onClick();view.render();view.find(node=>node.type==='button'&&text(node)==='Keep editing').props.onClick();view.render();await tick();expect(opened).toBe(0);expect(raw).toBe('Target current raw bytes');expect(f.controller.snapshot().raw.present).toBe(false);
});
