import {expect,it} from 'vitest';
import {createCompanion} from '../../src/core/companion';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {emptyTaskSession} from '../../src/core/task-session';
import {taskOutcomeReview,tasksForReviewFilter} from '../../src/renderer/src/task-outcome-review';
import type {Task,ExportAction} from '../../src/core/types';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {TaskSidebar} from '../../src/renderer/src/components/TaskSidebar';

it('finds a task with its own unresolved browser outcome without changing or running work',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'task-outcome-review-')),core=await createCompanion({dataDir:directory});try{
  const task=await core.createTask({title:'A browser outcome'}),other=await core.createTask({title:'Ordinary unfinished work'});await core.runRequest({taskId:task.id,requestId:'request',kind:'browser',prompt:'A saved request',sourceIds:[]},async()=>{throw Error('Outcome unknown.');});
  const session=emptyTaskSession(),observation={id:'page',taskId:task.id,browserId:'browser',documentId:'doc',url:'https://owned.example/',title:'Page',text:'Before action',digest:'page-digest',targets:[]};await core.replaceSession(task.id,0,{...session,runs:[{id:'request',endpointKey:'fixture',origin:'https://owned.example',browserId:'browser',initialObservation:observation,operations:[{id:'action',intent:{kind:'click',snapshotId:'page',targetId:'save'},reason:'A saved action',status:'uncertain'}]}]});
  const current=await core.getTask(task.id),before=structuredClone(current);expect(taskOutcomeReview(current)).toEqual({browserActions:1,fileSaves:0,label:'Needs review: 1 browser outcome'});expect(tasksForReviewFilter([current,other],'needs-review').map(task=>task.id)).toEqual([task.id]);expect(await core.getTask(task.id)).toEqual(before);
  const html=renderToStaticMarkup(createElement(TaskSidebar,{character:null,tasks:[other,current],reviewFilter:'needs-review',onReviewFilter:()=>{},onSelectTask:()=>{},onCreateTask:()=>{},onSettings:()=>{}}));expect(html).toContain('Only unresolved browser outcomes and file saves.');expect(html).toContain('aria-label="A browser outcome"');expect(html).not.toContain('aria-label="Ordinary unfinished work"');
  await core.deleteTask(task.id);expect(tasksForReviewFilter(await core.listTasks(),'needs-review')).toEqual([]);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

function task():Task{return {id:'task',title:'Local work',goal:'',status:'active',createdAt:'2026-10-29',updatedAt:'2026-10-29',sources:[],artifacts:[],requests:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false}};}
function save(taskId='task',status:ExportAction['status']='uncertain'):ExportAction{return {proposal:{id:'save',taskId,artifactId:'document',revision:1,path:'/owned/save.txt',parentRealPath:'/owned',parentDevice:'1',parentInode:'1',artifactDigest:'document-digest',sourceRefs:[],byteLength:5,digest:'proposal-digest',createdAt:'2026-10-29'},status};}

it('includes only same-task uncertain file saves, even in a paused task',()=>{
 const current={...task(),status:'paused' as const,actions:[save(),save('foreign'),save('task','verified'),save('task','failed'),save('task','proposed')]};
 expect(taskOutcomeReview(current)).toEqual({browserActions:0,fileSaves:1,label:'Needs review: 1 file save'});expect(tasksForReviewFilter([current],'needs-review')).toEqual([current]);
});

it('excludes settled history, orphan browser runs and foreign task observations',()=>{
 const current=task(),observation={id:'page',taskId:'task',browserId:'browser',documentId:'doc',url:'https://owned.example/',title:'Page',text:'Page',digest:'page-digest',targets:[]},operation={id:'action',intent:{kind:'click' as const,snapshotId:'page',targetId:'save'},reason:'Earlier action',status:'uncertain' as const};current.requests=[{id:'request',kind:'browser',prompt:'Earlier action',status:'failed',digest:'request-digest',sourceRefs:[],startedAt:'2026-10-29'}];current.session={...emptyTaskSession(),runs:[{id:'request',endpointKey:'fixture',origin:'https://owned.example',browserId:'browser',initialObservation:observation,operations:[{...operation,status:'observed',reconciliation:{id:'review',outcome:'completed',basis:'user-reviewed-observation',note:'Settled.',observation}}]},{id:'orphan',endpointKey:'fixture',origin:'https://owned.example',browserId:'browser',initialObservation:observation,operations:[operation]},{id:'request',endpointKey:'fixture',origin:'https://owned.example',browserId:'browser',initialObservation:{...observation,taskId:'foreign'},operations:[operation]}]};
 expect(taskOutcomeReview(current)).toEqual({browserActions:0,fileSaves:0,label:undefined});expect(tasksForReviewFilter([current],'needs-review')).toEqual([]);expect(tasksForReviewFilter([current],'all')).toEqual([current]);
});

it('does not treat an ordinary running or failed request as an unresolved effect',()=>{
 const current=task();current.requests=[{id:'running',kind:'create',prompt:'In progress',status:'running',digest:'running',sourceRefs:[],startedAt:'2026-10-29'},{id:'failed',kind:'browser',prompt:'Stopped before a browser action',status:'failed',digest:'failed',sourceRefs:[],startedAt:'2026-10-29'}];expect(tasksForReviewFilter([current],'needs-review')).toEqual([]);
});
