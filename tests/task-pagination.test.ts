import {expect,test} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {TaskViewPreferences} from '../src/host/task-view-preferences';
import {orderTaskList,restoreTaskView} from '../src/shared/task-view';
import {taskPage} from '../src/renderer/src/task-pagination';
test('older canonical tasks remain reachable in exact existing pin/recency order without duplicates or content mutation and survive restart',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-task-page-'));let tick=0,core=await createCompanion({dataDir:directory,now:()=>new Date(Date.UTC(2026,10,2,0,0,tick++))});
 try{
  const ids:string[]=[];for(let i=0;i<27;i++)ids.push((await core.createTask({title:'Owned task '+String(i).padStart(2,'0')})).id);await core.saveComposerDraft(ids[0],0,{text:'Exact unsent older-task draft',kind:'create'});const tasks=await core.listTasks(),ordered=orderTaskList(tasks,[ids[0]]),before=await readFile(join(directory,'tasks.json'),'utf8');expect(ordered[0].id).toBe(ids[0]);
  const first=taskPage(ordered),second=taskPage(ordered,20),last=taskPage(ordered,30);expect(first).toMatchObject({shown:10,total:27,hasMore:true,hasLess:false});expect(second).toMatchObject({shown:20,total:27,hasMore:true,hasLess:true});expect(last).toMatchObject({shown:27,total:27,hasMore:false});expect(last.items.map(task=>task.id)).toEqual(ordered.map(task=>task.id));expect(new Set(last.items.map(task=>task.id)).size).toBe(27);expect(second.items.slice(0,10)).toEqual(first.items);expect(taskPage(ordered,1000).shown).toBe(27);expect(taskPage([],10)).toMatchObject({shown:0,total:0,hasMore:false});expect(await readFile(join(directory,'tasks.json'),'utf8')).toBe(before);
  const view=new TaskViewPreferences(directory,async id=>(await core.listTasks()).some(task=>task.id===id),id=>core.getTask(id));await view.select(ids[1]);await core.close();core=await createCompanion({dataDir:directory});const fresh=await core.listTasks(),restored=await new TaskViewPreferences(directory,async()=>true,id=>core.getTask(id)).read();expect(restoreTaskView(fresh,restored)?.id).toBe(ids[1]);expect(orderTaskList(fresh,[ids[0]]).map(task=>task.id)).toEqual(ordered.map(task=>task.id));expect((await core.getTask(ids[0])).session?.draft).toBe('Exact unsent older-task draft');expect(fresh.flatMap(task=>task.requests)).toEqual([]);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
