import {expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('../support/controlled-renderer.fixture')).hooks}));
vi.mock('lucide-react',()=>({ChevronDown:()=>null,ChevronRight:()=>null,Clock:()=>null,Folder:()=>null,Pin:()=>null,Plus:()=>null,Search:()=>null,Settings:()=>null,Star:()=>null}));
import {createElement} from 'react';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../../src/core/companion';
import {TaskSidebar} from '../../src/renderer/src/components/TaskSidebar';
import {TaskChooser} from '../../src/renderer/src/components/TaskChooser';
import type {TaskReviewFilter} from '../../src/renderer/src/task-outcome-review';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';
test('both actual task lists reveal older batches, preserve selection, reset filters/list changes and expose the current hidden task through native controls',async()=>{
 let tick=0;const directory=await mkdtemp(join(tmpdir(),'glint-task-page-ui-')),core=await createCompanion({dataDir:directory,now:()=>new Date(Date.UTC(2026,10,2,0,0,tick++))});
 try{
  const ids:string[]=[];for(let i=0;i<27;i++)ids.push((await core.createTask({title:'Owned task '+String(i).padStart(2,'0')})).id);let tasks=await core.listTasks();const bytes=await readFile(join(directory,'tasks.json'),'utf8');
  for(const surface of ['sidebar','chooser'] as const){let selected='',filter:TaskReviewFilter='all';const select=(task:{id:string})=>{selected=task.id;};
   const renderer=createControlledRenderer(()=>surface==='sidebar'?createElement(TaskSidebar,{character:null,tasks,currentTaskId:ids[0],pinnedTaskIds:[ids[26]],reviewFilter:filter,onReviewFilter:next=>{filter=next;},onSelectTask:select,onCreateTask(){},onSettings(){}}):createElement(TaskChooser,{tasks,currentTaskId:ids[0],pinnedTaskIds:[ids[26]],filter,onFilter:next=>{filter=next;},onSelectTask:select,onCreateTask(){}}));type Node=ReturnType<typeof renderer.nodes>[number];const text=(node:Node):string=>node.type==='#text'?node.props.text:node.children.map(text).join(''),button=(label:string)=>renderer.find(node=>node.type==='button'&&text(node)===label),rows=()=>renderer.nodes().filter(node=>node.type==='button'&&/^Owned task \d\d$/.test(String(node.props['aria-label']??''))),input=()=>renderer.find(node=>node.type==='input'&&node.props.type==='search'),allText=()=>renderer.nodes().filter(node=>node.type==='#text').map(text).join(' ').replace(/\s+/g,' ').trim(),click=(label:string)=>{button(label).props.onClick();renderer.render();};
   renderer.render();expect(rows()).toHaveLength(10);expect(selected).toBe('');expect(button('Show more tasks').props.type).toBe('button');expect(allText()).toContain('of 27 tasks in this view');click('Show more tasks');expect(rows()).toHaveLength(20);click('Show more tasks');expect(rows()).toHaveLength(27);expect(new Set(rows().map(node=>node.props['aria-label'])).size).toBe(27);expect(button('Show more tasks').props.disabled).toBe(true);click('Show fewer tasks');expect(rows()).toHaveLength(20);click('Show current task');expect(rows()).toHaveLength(27);expect(selected).toBe('');renderer.find(node=>node.type==='button'&&node.props['aria-label']==='Owned task 00').props.onClick();expect(selected).toBe(ids[0]);
   input().props.onChange({currentTarget:{value:'Owned task 26'},target:{value:'Owned task 26'}});renderer.render();expect(rows()).toHaveLength(1);input().props.onChange({currentTarget:{value:''},target:{value:''}});renderer.render();expect(rows()).toHaveLength(10);filter='needs-attention';renderer.render();expect(rows()).toHaveLength(0);expect(allText()).toContain('outside this view');filter='all';renderer.render();expect(rows()).toHaveLength(10);click('Show more tasks');tasks=tasks.filter(task=>task.id!==ids[25]);renderer.render();expect(rows()).toHaveLength(10);expect(allText()).toContain('of 26 tasks');expect(selected).toBe(ids[0]);tasks=await core.listTasks();
  }
  expect(await readFile(join(directory,'tasks.json'),'utf8')).toBe(bytes);expect(tasks.flatMap(task=>task.requests)).toEqual([]);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
