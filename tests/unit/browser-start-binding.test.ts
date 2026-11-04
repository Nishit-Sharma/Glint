import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../../src/core/companion';
import {emptyTaskSession} from '../../src/core/task-session';

it.each(['stop','invalid-observation','unrelated-edit'] as const)('initial browser publication is atomic with request ownership (%s)',async scenario=>{
 const dataDir=await mkdtemp(join(tmpdir(),'companion-browser-start-')),core=await createCompanion({dataDir});
 let entered!:()=>void,release!:()=>void;const started=new Promise<void>(resolve=>entered=resolve),waiting=new Promise<void>(resolve=>release=resolve);
 try{
  const task=await core.createTask({title:'Atomic context'}),prior={origin:'https://previous.example',url:'https://previous.example/page',requestId:'previous'};
  await core.replaceSession(task.id,0,{...emptyTaskSession(),contextRevision:1,browserContext:prior});
  const running=core.runRequest({taskId:task.id,requestId:'next',kind:'browser',prompt:'Read a new page',sourceIds:[]},async ctx=>{
   entered();await waiting;
   await core.beginBrowserRun(task.id,{id:'next',endpointKey:'fixture',origin:'https://next.example',browserId:'owned-browser',initialObservation:{id:'observation',taskId:task.id,browserId:'owned-browser',documentId:'document',url:'https://next.example/page',title:scenario==='invalid-observation'?'x'.repeat(100001):'New page',text:'Synthetic observation',digest:'digest',targets:[]}},ctx.task.session?.contextRevision??0);
   return {title:'Read page',content:'Grounded answer'};
  });
  await started;
  if(scenario==='stop')await core.cancelRequest(task.id,'next');
  if(scenario==='unrelated-edit'){const session=(await core.getTask(task.id)).session!;await core.replaceSession(task.id,session.revision,{...session,draft:'Keep this independent draft.'});}
  release();const request=await running,current=await core.getTask(task.id);
  if(scenario==='unrelated-edit'){expect(request.status).toBe('completed');expect(current.session?.browserContext?.requestId).toBe('next');expect(current.session?.contextRevision).toBe(2);expect(current.session?.draft).toBe('Keep this independent draft.');}
  else{expect(request.status).toBe(scenario==='stop'?'cancelled':'failed');expect(current.session?.browserContext).toEqual(prior);expect(current.session?.runs).toEqual([]);}
 }finally{release?.();await core.close();await rm(dataDir,{recursive:true,force:true});}
});
