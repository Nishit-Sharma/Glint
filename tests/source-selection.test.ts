import {afterEach,expect,it,vi} from 'vitest';
import * as fs from 'node:fs/promises';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createCompanion,type Companion} from '../src/core/companion';
import {readSourceSelectionCommand} from '../src/shared/source-selection';
import {requestableSourceIds,changeInclusion,inclusionRows} from '../src/shared/source-intake';
vi.mock('node:fs/promises',{spy:true});

const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
async function fixture(){const root=resolve('work/continuation/runtime');await mkdir(root,{recursive:true});const directory=await mkdtemp(join(root,'selection-'));let core:Companion=await createCompanion({dataDir:directory});cleanups.push(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});return {get core(){return core},directory,restart:async()=>{await core.close();core=await createCompanion({dataDir:directory});}};}
const choose=(taskId:string,expectedRevision:number,sourceIds:string[])=>({type:'source-selection.set',taskId,expectedRevision,sourceIds});

it('preserves explicit empty selection and source-derived history privacy through restart while keeping draft, results, other task and legacy defaults',async()=>{
 const f=await fixture(),task=await f.core.createTask({title:'Owned continuity'}),other=await f.core.createTask({title:'Independent task'});
 await f.core.putSource(task.id,{id:'private',kind:'text',role:'fact',label:'Private synthetic',content:'SOURCE_PRIVATE'});
 await f.core.putSource(other.id,{id:'other',kind:'text',role:'fact',label:'Other source',content:'OTHER_PRIVATE'});
 await f.core.runRequest({taskId:task.id,requestId:'original',kind:'explain',prompt:'DERIVED_PRIVATE',sourceIds:['private']},async()=>({title:'Saved answer',content:'DERIVED_PRIVATE'}));
 await f.core.saveComposerDraft(task.id,0,{text:'Keep this unsent message',kind:'explain'});const before=await f.core.getTask(task.id),independent=await f.core.getTask(other.id);
 await f.core.setSourceSelection(choose(task.id,0,[]));await f.restart();const current=await f.core.getTask(task.id);
 expect(current.session?.sourceSelection).toEqual({revision:1,sourceIds:[]});expect(requestableSourceIds(current)).toEqual([]);expect(current.session?.draft).toBe(before.session?.draft);expect(current.requests).toEqual(before.requests);expect(current.artifacts).toEqual(before.artifacts);
 expect((await f.core.getTask(other.id)).sources).toEqual(independent.sources);expect(requestableSourceIds(await f.core.getTask(other.id))).toEqual(['other']);
 await f.core.runRequest({taskId:task.id,requestId:'after-restart',kind:'explain',prompt:'Use current context'},async context=>{expect(context.sourceRefs).toEqual([]);expect(context.task.sources).toEqual([]);expect(context.taskHistory).not.toContain('DERIVED_PRIVATE');expect(JSON.stringify(context)).not.toContain('SOURCE_PRIVATE');return {title:'Safe answer',content:'No source context'};});
 let calls=0;const called=async()=>{calls++;return {title:'Unexpected',content:'Must not call a provider'};};for(const kind of ['explain','create','revise','experiment','procedure','brief','concept-map','design-canvas','browser'])await expect(f.core.runRequest({taskId:task.id,requestId:'stale-scope-'+kind,kind,prompt:'Stale selection',sourceIds:['private']},called)).rejects.toThrow('Source selection changed');expect(calls).toBe(0);
 expect(await readFile(join(f.directory,'tasks.json'),'utf8')).toContain('DERIVED_PRIVATE');
});

it('rejects command-shaped authority and malformed selection input',()=>{
 for(const input of [{...choose('task',0,[]),send:true},choose('task',-1,[]),choose('task',0,['a','a']),choose('task',0,Array.from({length:65},(_,i)=>String(i)))])expect(()=>readSourceSelectionCommand(input)).toThrow();
});

it('validates exact CAS without silent truncation, isolates tasks and explicitly includes new sources only when chosen',async()=>{
 const f=await fixture(),a=await f.core.createTask({title:'Selection A'}),b=await f.core.createTask({title:'Selection B'});await f.core.putSource(a.id,{id:'a',kind:'text',role:'fact',label:'A',content:'A'});await f.core.putSource(b.id,{id:'foreign',kind:'text',role:'fact',label:'B',content:'B'});
 const first=await f.core.setSourceSelection(choose(a.id,0,['a']));expect((await f.core.setSourceSelection(choose(a.id,1,['a']))).session?.sourceSelection).toEqual(first.session?.sourceSelection);
 const results=await Promise.allSettled([f.core.setSourceSelection(choose(a.id,1,[])),f.core.setSourceSelection(choose(a.id,1,['a']))]);expect(results.map(result=>result.status)).toEqual(['fulfilled','rejected']);
 for(const input of [choose(a.id,2,['foreign']),choose(a.id,2,['a','a']),choose(a.id,2,Array.from({length:65},(_,i)=>String(i))),{...choose(a.id,2,[]),send:true}]){await expect(async()=>f.core.setSourceSelection(input)).rejects.toThrow();}
 let current=await f.core.putSource(a.id,{id:'new',kind:'text',role:'fact',label:'Newly added',content:'NEW_PRIVATE'});expect(requestableSourceIds(current)).toEqual([]);expect(inclusionRows(current).every(row=>row.state==='excluded')).toBe(true);expect(changeInclusion(current,undefined,'new',true)).toEqual(['new']);
 current=await f.core.setSourceSelection(choose(a.id,2,['new']));current=await f.core.putSource(a.id,{id:'new',kind:'text',role:'fact',label:'Refreshed',content:'New revision'});expect(requestableSourceIds(current)).toEqual(['new']);
 current=await f.core.revokeSource(a.id,'new');expect(requestableSourceIds(current)).toEqual([]);await f.core.runRequest({taskId:a.id,requestId:'while-removed',kind:'create',prompt:'No sources'},async context=>{expect(context.sourceRefs).toEqual([]);return {title:'No source context',content:'Safe'};});const removal=current.sources.find(source=>source.id==='new')!.revoked!;current=await f.core.restoreSource(a.id,'new',()=>{},undefined,removal.at,removal.id);expect(requestableSourceIds(current)).toEqual(['new']);
 expect((await f.core.getTask(b.id)).session?.sourceSelection).toBeUndefined();
});

it('holds queued followups and cancels an active source-free inference before it can publish after source selection changes',async()=>{
 const f=await fixture(),task=await f.core.createTask({title:'Queued selection'});const item={id:randomUUID(),revision:1,prompt:'Reviewed queued message',kind:'explain' as const,createdAt:new Date().toISOString(),sourceRefs:[],status:'queued' as const,basis:await f.core.queuedFollowupBasis(task.id,[],[]),scope:'c'.repeat(64),precedingRequestIds:[]};await f.core.saveQueuedFollowup(task.id,item,0);
 let enter!:()=>void,release!:()=>void,signal:AbortSignal|undefined;const entered=new Promise<void>(resolve=>enter=resolve),gate=new Promise<void>(resolve=>release=resolve);
 const pending=f.core.runRequest({taskId:task.id,requestId:'pending',kind:'explain',prompt:'Pending source-free request',sourceIds:[]},async context=>{signal=context.signal;enter();await gate;return {title:'Late answer',content:'Must not publish'};});await entered;
 const selected=await f.core.setSourceSelection(choose(task.id,0,[]));expect(signal?.aborted).toBe(true);expect(selected.session?.queuedFollowups?.[0]).toMatchObject({status:'held'});expect(selected.session?.queuedFollowups?.[0].reason).toContain('Source selection');expect(await f.core.queuedFollowupBasis(task.id,[],[])).not.toBe(item.basis);release();expect((await pending).status).toBe('cancelled');expect((await f.core.getTask(task.id)).artifacts).toEqual([]);
});

it('does not acknowledge or publish a failed atomic selection save and reopens the last confirmed selection',async()=>{
 const f=await fixture(),task=await f.core.createTask({title:'Selection disk failure'});await f.core.putSource(task.id,{id:'a',kind:'text',role:'fact',label:'A',content:'A'});await f.core.setSourceSelection(choose(task.id,0,['a']));const before=await readFile(join(f.directory,'tasks.json'),'utf8');
 const rename=vi.spyOn(fs,'rename').mockRejectedValueOnce(Error('Owned synthetic selection write failure'));try{await expect(f.core.setSourceSelection(choose(task.id,1,[]))).rejects.toThrow();}finally{rename.mockRestore();}
 expect(await readFile(join(f.directory,'tasks.json'),'utf8')).toBe(before);await f.restart();expect((await f.core.getTask(task.id)).session?.sourceSelection).toEqual({revision:1,sourceIds:['a']});
});
