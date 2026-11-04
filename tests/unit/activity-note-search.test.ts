import {expect,test,vi} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {Checkpoint,Task} from '../../src/core/types';
import {createCompanion} from '../../src/core/companion';
import {resolveSavedWorkMatch,searchSavedWork,savedWorkSearchLimits} from '../../src/shared/saved-work-search';
import {requestSavedWorkNavigation,type SavedWorkNavigation} from '../../src/renderer/src/saved-work-navigation';

const at='2026-10-30T10:00:00Z';
const note=(id='note'):Checkpoint=>({id,note:'  Decision: MESA crates stay dry.\nNext: inspect the orchard.  ',createdAt:at,sourceRefs:[{sourceId:'s',version:1,digest:'source-1'}],artifacts:[{artifactId:'f',revision:1}]});
const task=(id='a'):Task=>({id,title:'Owner '+id,goal:'',status:'active',createdAt:at,updatedAt:at,sources:[],artifacts:[],requests:[],procedures:[],checkpoints:[note()],actions:[],memory:{enabled:false}});
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};

test('explicit local note search keeps exact owners, text, references and recency while excluding other scopes and ambiguous IDs',()=>{
 const a=task(),b=task('b');b.checkpoints.push({...note('newer'),createdAt:'2026-10-30T11:00:00Z',note:'Mesa inspection complete.'});const before=JSON.stringify([a,b]);
 const result=searchSavedWork([b,a],' mEsA ','notes');expect(result).toMatchObject({query:'mEsA',scope:'notes',matchCount:3,searched:3,partial:0,unsearchedNotes:0});expect(result.matches.map(hit=>[hit.taskId,hit.kind==='note'&&hit.checkpoint.id])).toEqual([['a','note'],['b','newer'],['b','note']]);
 const hit=result.matches[0];expect(hit).toMatchObject({kind:'note',field:'Activity note',excerpt:a.checkpoints[0].note});expect(resolveSavedWorkMatch(a,hit)).toEqual({kind:'note',checkpoint:a.checkpoints[0]});
 expect(searchSavedWork([a],'mesa').matchCount).toBe(1);expect(searchSavedWork([a],'mesa','files').matchCount).toBe(0);expect(searchSavedWork([a],'mesa','tasks').matchCount).toBe(0);expect(searchSavedWork([a],'Owner a','notes').matchCount).toBe(0);expect(searchSavedWork([a],'crates stay dry.\nNext','notes').matchCount).toBe(1);expect(searchSavedWork([a],'.*','notes').matchCount).toBe(0);expect(JSON.stringify([a,b])).toBe(before);
 const duplicate=task();duplicate.checkpoints.push(structuredClone(duplicate.checkpoints[0]));expect(searchSavedWork([duplicate],'mesa','notes').matches).toEqual([]);expect(searchSavedWork([a,a],'mesa','notes').matches).toEqual([]);
});

test('notes require the complete body within local budgets and every excluded whole note is disclosed',()=>{
 const tooLong=task();tooLong.checkpoints[0].note='needle'+'x'.repeat(savedWorkSearchLimits.note);expect(searchSavedWork([tooLong],'needle','notes')).toMatchObject({matches:[],searched:0,partial:0,unsearchedNotes:1});
 const many=task();many.checkpoints=Array.from({length:202},(_,index)=>({...note(String(index)),note:'needle'+'x'.repeat(savedWorkSearchLimits.note-6)}));expect(searchSavedWork([many],'needle','notes')).toMatchObject({matchCount:200,searched:200,partial:0,unsearchedNotes:2});expect(searchSavedWork([many],'needle','notes').matches).toHaveLength(50);
});

test('an exact saved note refuses deletion, reused identity, changed text/time/references, foreign ownership and duplicate IDs',()=>{
 const original=task(),hit=searchSavedWork([original],'mesa','notes').matches[0];
 const mutations:Array<(value:Task)=>void>=[value=>{value.id='foreign';},value=>{value.title='Renamed';},value=>{value.checkpoints=[];},value=>{value.checkpoints.push(structuredClone(value.checkpoints[0]));},value=>{value.checkpoints[0].id='replaced';},value=>{value.checkpoints[0].note=value.checkpoints[0].note.replace('MESA','MEZA');},value=>{value.checkpoints[0].createdAt='2026-10-30T12:00:00Z';},value=>{value.checkpoints[0].sourceRefs[0].digest='changed';},value=>{value.checkpoints[0].artifacts[0].revision=2;}];
 for(const mutate of mutations){const changed=structuredClone(original);mutate(changed);expect(()=>resolveSavedWorkMatch(changed,hit)).toThrow(/Search again/);}
 const unrelated=structuredClone(original);unrelated.checkpoints.push(note('separate'));unrelated.sources=[];expect(resolveSavedWorkMatch(unrelated,hit)).toEqual({kind:'note',checkpoint:original.checkpoints[0]});
});

test('same/cross-task navigation uses fresh task and list snapshots after discard, and pending updates/deletes never open stale notes',async()=>{
 for(const originId of ['a','b'])for(const change of ['none','deleted','updated','new-list','retired','dirty']){
  const destination=task('b'),hit=searchSavedWork([destination],'mesa','notes').matches[0];let known:Task|undefined=destination,generation=1,current=true,dirty=false,held:(()=>void)|undefined,release!:(value:Task)=>void;
  const open=vi.fn(),failed=vi.fn(),order:string[]=[],owner:SavedWorkNavigation={current:()=>current,listGeneration:()=>generation,knownTask:()=>known,guard:action=>{if(dirty){held=action;return false;}action();return true;},dirty:()=>dirty,started:vi.fn(),finished:vi.fn(),failed,flush:async()=>{order.push('flush:'+originId);},load:async()=>{order.push('read:b');return new Promise(resolve=>{release=resolve;});},open};
  requestSavedWorkNavigation(hit,owner);await tick();
  if(change==='deleted')known=undefined;if(change==='updated'){known=structuredClone(destination);known.checkpoints[0].note='Updated note';}if(change==='new-list')generation++;if(change==='retired')current=false;if(change==='dirty')dirty=true;
  release(destination);await tick();expect(order).toEqual(['flush:'+originId,'read:b']);
  if(change==='none'){expect(open).toHaveBeenCalledWith(destination,{kind:'note',checkpoint:destination.checkpoints[0]});expect(failed).not.toHaveBeenCalled();}
  else{expect(open).not.toHaveBeenCalled();if(change==='retired'||change==='dirty')expect(failed).not.toHaveBeenCalled();else expect(failed).toHaveBeenCalledOnce();}
  if(change==='dirty'){expect(held).toBeDefined();dirty=false;held!();await tick();known=undefined;release(destination);await tick();expect(open).not.toHaveBeenCalled();expect(failed).toHaveBeenCalledOnce();expect(order).toEqual(['flush:'+originId,'read:b','flush:'+originId,'read:b']);}
 }
});

test('saved note search and reopening are byte-read-only and keep the exact source/result basis after controlled core recreation',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'activity-note-search-'));let core=await createCompanion({dataDir:directory});
 try{
  let current=await core.createTask({title:'Orchard decisions'});current=await core.putSource(current.id,{kind:'text',role:'fact',label:'Plan',content:'Keep crates dry.'});await core.saveArtifact(current.id,{title:'Plan',content:'Unchanged authored plan.',mimeType:'text/plain'});current=await core.checkpoint(current.id,'  Mesa decisions\nKeep both spaces.  ');
  const original=structuredClone(current.checkpoints[0]),bytes=await readFile(join(directory,'tasks.json'),'utf8'),hit=searchSavedWork(await core.listTasks(),'mesa','notes').matches[0];expect(resolveSavedWorkMatch(await core.getTask(current.id),hit)).toEqual({kind:'note',checkpoint:original});expect(await readFile(join(directory,'tasks.json'),'utf8')).toBe(bytes);
  await core.close();core=await createCompanion({dataDir:directory});current=await core.getTask(current.id);const reopenedBytes=await readFile(join(directory,'tasks.json'),'utf8');expect(resolveSavedWorkMatch(current,hit)).toEqual({kind:'note',checkpoint:original});expect(searchSavedWork([current],'mesa','notes').matches[0]).toEqual(hit);expect(current.requests).toEqual([]);expect(current.actions).toEqual([]);expect(await readFile(join(directory,'tasks.json'),'utf8')).toBe(reopenedBytes);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
