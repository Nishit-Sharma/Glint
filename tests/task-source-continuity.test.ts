import {afterEach,expect,it,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {sourceResumeContext} from '../src/core/source-resume';
import {TaskSourceContinuity} from '../src/renderer/src/components/TaskSourceContinuity';
import {continuityTask} from './task-source-continuity.fixture';
import type {Task} from '../src/core/types';
const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();vi.unstubAllGlobals();});
async function fixture(){const directory=await mkdtemp(join(tmpdir(),'continuity-view-'));let core=await createCompanion({dataDir:directory});cleanups.push(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});return {get core(){return core},restart:async()=>{await core.close();core=await createCompanion({dataDir:directory});}};}
const view=(task:Task)=>renderToStaticMarkup(createElement(TaskSourceContinuity,{task}));

it('shows exact affected procedure metadata locally without source/step bodies, actions or a task mutation',async()=>{
 const f=await fixture(),{task,ref,procedureId}=await continuityTask(f.core,'Orchard'),before=structuredClone(task),invoke=vi.fn();vi.stubGlobal('window',{companion:{invoke}});
 const html=view(task);
 for(const text of ['Saved procedure source context','Orchard procedure','earlier saved source version','Current live content is unknown','Procedure ID',procedureId,ref.sourceId,ref.digest]){
  expect(html).toContain(text);
 }
 expect(html).toContain('The source is marked fresh; live content remains unknown.');expect(html).not.toContain('Saved snapshot status is current');expect(html).toContain('Revision 1');expect(html).toContain('Current saved revision 1');expect(html).not.toContain('PRIVATE_');expect(html).not.toContain('<button');expect(html).not.toContain('<form');expect(invoke).not.toHaveBeenCalled();expect(await f.core.getTask(task.id)).toEqual(before);
});

it('keeps a corrected current revision distinct from affected history and preserves freshness uncertainty',async()=>{
 const f=await fixture(),created=await continuityTask(f.core,'Mesa'),latest=created.task.sources[0].versions.at(-1)!;
 const task=await f.core.saveProcedure(created.task.id,{id:created.procedureId,expectedRevision:1,title:'Corrected Mesa procedure',steps:created.task.procedures[0].revisions[0].steps,sourceRefs:[{sourceId:latest.id,version:latest.version,digest:latest.digest}]});
 const html=view(task);expect(html).toContain('0 current revisions need source review');expect(html).toContain('Revision 1 · Historical saved revision');expect(html).toContain('Current saved revision 2');
 const stale=await f.core.invalidateSource(task.id,latest.id,'Latest state is unknown');const unknown=view(stale);
 expect(unknown).toContain('1 current revision needs source review');expect(unknown).toContain('Refresh or review is required');expect(unknown).toContain('An earlier saved source version');expect(unknown).toContain('Matches the latest saved version');
});

it('does not call an unavailable reference current when the source record is marked fresh',async()=>{
 const f=await fixture(),created=await continuityTask(f.core,'Unavailable reference',false),task=structuredClone(created.task);
 task.procedures[0].revisions[0].sourceRefs[0].digest='f'.repeat(64);
 const html=view(task);expect(html).toContain('The exact saved snapshot is unavailable');expect(html).toContain('The source is marked fresh; live content remains unknown.');expect(html).not.toContain('Saved snapshot status is current');expect(html).not.toContain('Matches the latest saved version');
});

it('uses only the current task, is quiet when dependencies are current, and retains unknown state through reopen',async()=>{
 const f=await fixture(),a=await continuityTask(f.core,'Task A'),b=await continuityTask(f.core,'Task B',false);
 expect(view(a.task)).toContain('Task A procedure');expect(view(b.task)).toBe('');expect(view({...a.task,id:b.task.id,procedures:b.task.procedures,sources:b.task.sources})).toBe('');
 await f.core.invalidateSource(a.task.id,a.ref.sourceId,'Review is required');await f.core.pause(a.task.id);await f.restart();const resumed=await f.core.resume(a.task.id),html=view(resumed.task);
 expect(html).toContain('Task A procedure');expect(html).toContain('Refresh or review is required');expect(html).not.toContain('Task B');expect(html).not.toContain('PRIVATE_');
});

it('shows neutral unavailable evidence and exactly counts omitted affected records',async()=>{
 const f=await fixture(),created=await continuityTask(f.core,'Long history'),task=structuredClone(created.task),original=task.procedures[0];task.sources=[];
 task.procedures=Array.from({length:32},(_,index)=>({...structuredClone(original),id:'procedure-'+index,revisions:Array.from({length:12},(_,revision)=>({...structuredClone(original.revisions[0]),revision:revision+1,sourceRefs:Array.from({length:24},(_,source)=>({sourceId:'absent-'+source,version:1,digest:'f'.repeat(64)}))}))}));
 const context=sourceResumeContext(task),html=view(task),omitted=context.omissions;
 expect(html).toContain('The exact saved snapshot is unavailable');expect(html).toContain('Source freshness is unknown');expect(html).not.toContain('withdrawn');expect(html).toContain(`${omitted.affectedProcedures} entire procedures, ${omitted.procedureRevisions} revisions and ${omitted.procedureSourceRefs} source references`);expect(html).toContain('Omitted dependencies remain unknown');expect(html).not.toContain('PRIVATE_');expect(html).toContain('32 procedures');
});
