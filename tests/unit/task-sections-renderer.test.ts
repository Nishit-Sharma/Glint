import {afterEach,expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('../support/controlled-renderer.fixture')).hooks}));
import {createElement,Fragment} from 'react';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Task} from '../../src/core/types';
import {TaskViewPreferences} from '../../src/host/task-view-preferences';
import {readTaskSectionsCommand,type TaskSectionsCommand} from '../../src/shared/task-sections';
import {SidebarTaskSections} from '../../src/renderer/src/components/SidebarTaskSections';
import {DraftNavigationProvider,useDraftNavigation} from '../../src/renderer/src/draft-navigation';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';
const directories:string[]=[];
afterEach(async()=>{for(const directory of directories.splice(0))await rm(directory,{recursive:true,force:true});});
const task=(id:string):Task=>({id,title:'Owned '+id,goal:'Keep exact goal',status:'active',createdAt:'2026-11-02T00:00:00Z',updatedAt:'2026-11-02T00:00:00Z',sources:[],artifacts:[],requests:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false}});
type Node=ReturnType<ReturnType<typeof createControlledRenderer>['nodes']>[number];
const text=(node:Node):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
async function fixture(beforeInvoke?:(command:TaskSectionsCommand)=>void|Promise<void>){
 const dir=await mkdtemp(join(tmpdir(),'glint-sidebar-section-ui-'));directories.push(dir);const tasks=Array.from({length:75},(_,index)=>task('task-'+index)),view=new TaskViewPreferences(dir,async id=>tasks.some(task=>task.id===id),undefined,async()=>tasks.map(task=>task.id)),calls:TaskSectionsCommand[]=[],opened:string[]=[];
 let tail:Promise<unknown>=Promise.resolve(),failAfterCommit=false,page:readonly Task[]=tasks,navigation!:ReturnType<typeof useDraftNavigation>;
 const invoke=(raw:TaskSectionsCommand)=>{const command=readTaskSectionsCommand(raw);calls.push(command);tail=(async()=>{await beforeInvoke?.(command);if(command.type==='task-sections.get')return view.readTaskSections();const {type,...change}=command,result=await view.changeTaskSections(change);if(failAfterCommit){failAfterCommit=false;throw Error('Owned synthetic lost acknowledgement');}return result;})();return tail;};
 function Harness(){navigation=useDraftNavigation();return createElement(Fragment,null,createElement(DraftNavigationProvider,{value:navigation.api,children:createElement(SidebarTaskSections,{tasks:page,allTasks:tasks,invoke,renderTask:value=>createElement('button',{onClick:()=>navigation.api.guard(()=>opened.push(value.id))},value.title)})}),navigation.review);}
 const renderer=createControlledRenderer(()=>createElement(Harness)),button=(label:string)=>renderer.find(node=>node.type==='button'&&text(node)===label),namedButton=(label:string)=>renderer.find(node=>node.type==='button'&&node.props['aria-label']===label);
 const settle=async()=>{await tail.catch(()=>{});for(let tick=0;tick<5;tick++){await Promise.resolve();renderer.render();}};
 const input=(value:string)=>{renderer.find(node=>node.type==='input').props.onChange({currentTarget:{value}});renderer.render();};
 const select=(value:string)=>{renderer.find(node=>node.type==='select').props.onChange({currentTarget:{value}});renderer.render();};
 const submit=async()=>{renderer.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await settle();};
 renderer.render();await settle();return {dir,view,tasks,calls,opened,renderer,button,namedButton,settle,input,select,submit,get navigation(){return navigation;},setPage(value:readonly Task[]){page=value;renderer.render();},failNextAcknowledgement(){failAfterCommit=true;}};
}

test('actual sidebar controls create/move/rename/remove with real persistent authority and open any current task',async()=>{
 const f=await fixture(),before=JSON.stringify(f.tasks);
 f.namedButton('Move Owned task-74 to section').props.onClick();f.renderer.render();f.select('new');f.button('Move task').props.onClick();f.renderer.render();f.input('Client Ω');await f.submit();
 let saved=await f.view.readTaskSections();expect(saved.kind).toBe('available');if(saved.kind!=='available')throw Error('Fixture sections unavailable');const first=saved.sections[0].id;expect(saved.sections[0]).toMatchObject({name:'Client Ω',taskIds:['task-74']});
 f.button('New section').props.onClick();f.renderer.render();f.input('Research');await f.submit();saved=await f.view.readTaskSections();if(saved.kind!=='available')throw Error('Fixture sections unavailable');const second=saved.sections[1].id;
 f.namedButton('Move Owned task-74 to section').props.onClick();f.renderer.render();f.select('section:'+second);f.button('Move task').props.onClick();await f.settle();
 f.namedButton('Rename section Research').props.onClick();f.renderer.render();f.input('Review');await f.submit();
 f.button('Owned task-74').props.onClick();expect(f.opened).toEqual(['task-74']);
 f.namedButton('Move Owned task-74 to section').props.onClick();f.renderer.render();f.select('');f.button('Move task').props.onClick();await f.settle();
 f.namedButton('Move Owned task-0 to section').props.onClick();f.renderer.render();f.select('section:'+first);f.button('Move task').props.onClick();await f.settle();f.namedButton('Remove section Client Ω and keep its tasks').props.onClick();await f.settle();
 expect(await f.view.readTaskSections()).toMatchObject({sections:[{id:second,name:'Review',taskIds:[]}]});expect(JSON.stringify(f.tasks)).toBe(before);expect(f.tasks).toHaveLength(75);
 const reopened=new TaskViewPreferences(f.dir,async()=>true);expect(await reopened.readTaskSections()).toMatchObject({sections:[{id:second,name:'Review',taskIds:[]}]});
});

test('only the supplied filtered ordered page is grouped; unseen members are retained rather than treated as missing',async()=>{
 const f=await fixture();await f.view.changeTaskSections({expectedRevision:0,change:{kind:'create',sectionId:'client',name:'Client',taskId:'task-74'}});f.button('Reload sections').props.onClick();await f.settle();f.setPage([f.tasks[4],f.tasks[2]]);
 expect(f.renderer.nodes().filter(node=>node.type==='button'&&text(node).startsWith('Owned ')).map(text)).toEqual(['Owned task-4','Owned task-2']);expect(f.renderer.nodes().filter(node=>node.type==='#text').map(text).join(' ')).not.toContain('saved task IDs are unavailable');expect(await f.view.readTaskSections()).toMatchObject({sections:[{taskIds:['task-74']}]});
 f.setPage([f.tasks[74],f.tasks[2]]);expect(f.button('Owned task-74')).toBeDefined();expect(f.button('Owned task-2')).toBeDefined();
});

test('lost acknowledgement holds all mutation until explicit reload reconciles the exact original create without duplication',async()=>{
 const f=await fixture();f.button('New section').props.onClick();f.renderer.render();f.input('Original Ω');f.failNextAcknowledgement();await f.submit();
 expect(f.button('Create section').props.disabled).toBe(true);expect(f.button('New section').props.disabled).toBe(true);expect(f.renderer.find(node=>node.type==='input').props.value).toBe('Original Ω');expect(f.navigation.api.hasDirty()).toBe(true);
 f.button('Reload sections').props.onClick();await f.settle();expect(f.renderer.nodes().filter(node=>node.type==='form')).toHaveLength(0);expect(f.navigation.api.hasDirty()).toBe(false);expect(f.calls.filter(command=>command.type==='task-sections.change')).toHaveLength(1);expect(await f.view.readTaskSections()).toMatchObject({revision:1,sections:[{name:'Original Ω'}]});
});

test('dirty section editing uses the existing navigation guard and stale captured forms cannot save or clear a newer choice',async()=>{
 const f=await fixture();f.button('New section').props.onClick();f.renderer.render();f.input('Keep this section choice');const retired=f.renderer.find(node=>node.type==='form').props.onSubmit;
 f.button('Owned task-0').props.onClick();f.renderer.render();expect(f.opened).toEqual([]);f.button('Keep editing').props.onClick();f.renderer.render();expect(f.renderer.find(node=>node.type==='input').props.value).toBe('Keep this section choice');
 f.button('Cancel section').props.onClick();f.renderer.render();f.button('New section').props.onClick();f.renderer.render();f.input('Newer choice');retired({preventDefault(){}});await f.settle();expect(f.calls.filter(command=>command.type==='task-sections.change')).toHaveLength(0);expect(f.renderer.find(node=>node.type==='input').props.value).toBe('Newer choice');
 f.button('Owned task-1').props.onClick();f.renderer.render();f.button('Leave and discard edits').props.onClick();f.renderer.render();expect(f.opened).toEqual(['task-1']);expect(f.renderer.nodes().filter(node=>node.type==='form')).toHaveLength(0);await expect(readFile(join(f.dir,'task-view.json'))).rejects.toMatchObject({code:'ENOENT'});
});


test('a held clean saved-section read leaves task navigation available',async()=>{
 let read:Promise<void>|undefined,release!:()=>void;const f=await fixture(command=>command.type==='task-sections.get'?read:undefined);
 read=new Promise<void>(resolve=>{release=resolve;});f.button('Reload sections').props.onClick();f.renderer.render();
 expect(f.button('Reload sections').props.disabled).toBe(true);expect(f.navigation.api.hasDirty()).toBe(false);f.button('Owned task-0').props.onClick();f.renderer.render();expect(f.opened).toEqual(['task-0']);expect(f.renderer.nodes().some(node=>node.type==='dialog')).toBe(false);
 release();await f.settle();expect(await f.view.readTaskSections()).toMatchObject({kind:'available',revision:0,sections:[]});expect(f.navigation.api.hasDirty()).toBe(false);
});

test('a held section read preserves an actual dirty section editor and its navigation review',async()=>{
 let read:Promise<void>|undefined,release!:()=>void;const f=await fixture(command=>command.type==='task-sections.get'?read:undefined);f.button('New section').props.onClick();f.renderer.render();f.input('Keep this unsaved section');
 read=new Promise<void>(resolve=>{release=resolve;});f.button('Reload sections').props.onClick();f.renderer.render();expect(f.navigation.api.hasDirty()).toBe(true);f.button('Owned task-0').props.onClick();f.renderer.render();expect(f.opened).toEqual([]);f.button('Keep editing').props.onClick();f.renderer.render();expect(f.renderer.find(node=>node.type==='input').props.value).toBe('Keep this unsaved section');
 release();await f.settle();expect(f.navigation.api.hasDirty()).toBe(true);expect(f.renderer.find(node=>node.type==='input').props.value).toBe('Keep this unsaved section');f.button('Cancel section').props.onClick();f.renderer.render();expect(f.navigation.api.hasDirty()).toBe(false);expect(await f.view.readTaskSections()).toMatchObject({revision:0,sections:[]});
});

test('a held remove mutation without an editor keeps navigation protected until its real acknowledgement',async()=>{
 let write:Promise<void>|undefined,release!:()=>void;const f=await fixture(command=>command.type==='task-sections.change'?write:undefined);f.button('New section').props.onClick();f.renderer.render();f.input('Remove pending');await f.submit();
 write=new Promise<void>(resolve=>{release=resolve;});f.namedButton('Remove section Remove pending and keep its tasks').props.onClick();f.renderer.render();expect(f.renderer.nodes().some(node=>node.type==='form')).toBe(false);expect(f.navigation.api.hasDirty()).toBe(true);f.button('Owned task-0').props.onClick();f.renderer.render();expect(f.opened).toEqual([]);f.button('Keep editing').props.onClick();f.renderer.render();
 release();await f.settle();expect(f.navigation.api.hasDirty()).toBe(false);expect(await f.view.readTaskSections()).toMatchObject({revision:2,sections:[]});expect(f.tasks).toHaveLength(75);
});
