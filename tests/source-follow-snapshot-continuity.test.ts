import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {DocumentSourceFollow} from '../src/host/document-source-follow';
import type {NativeWindow} from '../src/host/native';
import type {DocumentCapture,RuntimeDocumentStamp} from '../src/shared/document-source';
import type {Task} from '../src/core/types';

const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
const target:NativeWindow={id:'window:41',osId:41,title:'Owned document',owner:{name:'Owned editor',processId:88,bundleId:'owned.editor',path:'/owned/editor'},bounds:{x:0,y:0,width:600,height:500},documentToken:'same-native-metadata',displayId:'1',scaleFactor:1,requiresExplicitCapture:true};
const stampA={method:'ax-document',evidence:'foreground-application-correlation',digest:'a'.repeat(64)} as const,stampB={...stampA,digest:'b'.repeat(64)};
function held(){let enter!:()=>void,release!:()=>void;return {started:new Promise<void>(done=>enter=done),waiting:new Promise<void>(done=>release=done),enter:()=>enter(),release:()=>release()};}
const capture=(task:Task,sourceId=task.sources[0].id,edited=true):DocumentCapture=>{const version=task.sources.find(source=>source.id===sourceId)!.versions.at(-1)!;return {ref:{sourceId,version:version.version,digest:version.digest},stamp:{...version.documentStamp!,edited}};};
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'follow-refresh-'));let core=await createCompanion({dataDir:directory});cleanups.push(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});
 let task=await core.createTask({title:'Owned source follow'});
 const put=(owner:Task,native=target,sourceId:string|undefined=owner.sources[0]?.id)=>core.putSource(owner.id,{id:sourceId,kind:'window',label:'Saved owned snapshot',content:'Synthetic snapshot metadata',role:'fact',windowId:native.id,windowProcessId:native.owner.processId,documentToken:native.documentToken,documentStamp:stampA});
 task=await put(task);let observation:RuntimeDocumentStamp={...stampA,edited:false},nextGate:ReturnType<typeof held>|undefined;
 const calls={reviews:0,captures:0};
 const dependencies={core:{getTask:(id:string)=>core.getTask(id),reconcileDocumentSource:(...args:Parameters<typeof core.reconcileDocumentSource>)=>core.reconcileDocumentSource(...args)},observe:async(_target:NativeWindow,options:{assertCurrent:()=>void})=>{const seen=observation,gate=nextGate;nextGate=undefined;gate?.enter();await gate?.waiting;options.assertCurrent();return {kind:'document' as const,stamp:seen};},approve:async()=>{calls.reviews++;return true;},retire:()=>{},changed:()=>{},refresh:async(binding:import('../src/shared/document-source').DocumentBinding,stamp:RuntimeDocumentStamp,guard:()=>void)=>{guard();calls.captures++;const task=await core.putSource(binding.taskId,{id:binding.ref.sourceId,kind:'window',label:'Followed owned snapshot',content:'Synthetic followed metadata',role:'fact',windowId:target.id,windowProcessId:target.owner.processId,documentToken:target.documentToken,documentStamp:{method:stamp.method,evidence:stamp.evidence,digest:stamp.digest}});guard();return {task,sourceId:binding.ref.sourceId,target,capture:{...capture(task,binding.ref.sourceId),stamp}};}};
 const follow=new DocumentSourceFollow(dependencies);follow.bind({task,sourceId:task.sources[0].id,target,capture:capture(task,task.sources[0].id,false)});await follow.enable();
 return {get core(){return core},task,follow,calls,put,dependencies,setObservation:(value:RuntimeDocumentStamp)=>{observation=value;},holdNextObservation:(gate:ReturnType<typeof held>)=>{nextGate=gate;},restart:async()=>{follow.stop();await core.close();core=await createCompanion({dataDir:directory});}};
}

it('continues an existing address-follow choice across a verified immediate explicit refresh and advances exact grant identity',async()=>{
 const f=await fixture(),first=capture(f.task),sourceId=first.ref.sourceId;await f.core.saveComposerDraft(f.task.id,0,{text:'Unsent correction',kind:'explain'});
 const refreshed=await f.put(f.task);f.setObservation({...stampA,edited:true});const proof=capture(refreshed);
 expect(f.follow.bind({task:refreshed,sourceId,target,capture:proof})).toMatchObject({automaticSnapshots:'on',sourceId});
 expect(()=>f.follow.assertGrant({taskId:refreshed.id,ref:first.ref,windowId:target.id,processId:88})).toThrow('expired');
 expect(()=>f.follow.assertGrant({taskId:refreshed.id,ref:proof.ref,windowId:target.id,processId:88})).not.toThrow();
 await f.follow.enable();await f.follow.poll();expect(f.calls).toEqual({reviews:1,captures:0});
 f.setObservation({...stampB,edited:false});await f.follow.poll();expect(f.calls).toEqual({reviews:1,captures:1});
 const saved=await f.core.getTask(refreshed.id);expect(saved.sources[0].currentVersion).toBe(3);expect(saved.session?.draft).toBe('Unsent correction');
});

it('retiring old observation work during explicit refresh cannot revoke or stale the new exact binding',async()=>{
 const f=await fixture(),gate=held();f.holdNextObservation(gate);f.setObservation({...stampB,edited:false});const old=f.follow.poll();await gate.started;
 const task=await f.put(f.task);f.setObservation({...stampA,edited:true});f.follow.bind({task,sourceId:task.sources[0].id,target,capture:capture(task)});
 await f.follow.poll();gate.release();await old;expect(f.follow.read()).toMatchObject({automaticSnapshots:'on'});expect(f.calls.captures).toBe(0);expect((await f.core.getTask(task.id)).sources[0]).toMatchObject({freshness:'fresh',currentVersion:2});
});

it.each(['no-proof','same-version','skipped-version','source','task','window','process','metadata','os-id','app-path','app-bundle','stored-token','missing-lineage','protected','stale','paused','stopped'] as const)('does not carry a follow choice through ambiguous or retired refresh scope: %s',async variant=>{
 const f=await fixture();let task=f.task,native=structuredClone(target),sourceId=task.sources[0].id;
 if(variant==='window')native={...native,id:'window:42',osId:42};
 if(variant==='process')native.owner.processId=99;
 if(variant==='metadata')native.documentToken='different-native-identity';
 if(variant==='os-id')native.osId=99;
 if(variant==='app-path')native.owner.path='/owned/other';
 if(variant==='app-bundle')native.owner.bundleId='owned.other';
 if(variant==='protected')native.knownProtected=true;
 if(variant==='task'){task=await f.core.createTask({title:'Other task'});task=await f.put(task);sourceId=task.sources[0].id;}
 else if(variant==='source'){task=await f.core.putSource(task.id,{kind:'window',label:'Another source',content:'Synthetic metadata',role:'fact',windowId:native.id,windowProcessId:native.owner.processId,documentToken:native.documentToken,documentStamp:stampA});sourceId=task.sources.at(-1)!.id;}
 else if(variant!=='same-version')task=await f.put(task,native);
 if(variant==='skipped-version')task=await f.put(task);
 if(variant==='stored-token'){task=structuredClone(task);task.sources[0].versions.at(-1)!.documentToken='mismatched-stored-window';}
 if(variant==='missing-lineage'){task=structuredClone(task);task.sources[0].versions=task.sources[0].versions.slice(-1);}
 if(variant==='stale')task=await f.core.invalidateSource(task.id,sourceId,'Unknown current state');
 if(variant==='paused')task=await f.core.pause(task.id);
 if(variant==='stopped')f.follow.stop('Stopped explicitly');
 f.follow.bind({task,sourceId,target:native,...(variant==='no-proof'?{}:{capture:capture(task,sourceId)})});
 expect(f.follow.read()).toMatchObject({automaticSnapshots:'off'});expect(f.calls).toEqual({reviews:1,captures:0});
});

it('a restarted controller cannot recreate a follow choice from saved sources or a reused capture reference',async()=>{
 const f=await fixture(),task=await f.put(f.task),proof=capture(task);await f.restart();const restarted=new DocumentSourceFollow(f.dependencies);
 restarted.bind({task:await f.core.getTask(task.id),sourceId:task.sources[0].id,target,capture:proof});expect(restarted.read()).toMatchObject({automaticSnapshots:'off'});expect(f.calls.captures).toBe(0);
});

it('an unverifiable refresh proof retires the prior choice before reporting the mismatch',async()=>{
 const f=await fixture(),task=await f.put(f.task),proof=capture(task);proof.ref.digest='f'.repeat(64);
 expect(()=>f.follow.bind({task,sourceId:task.sources[0].id,target,capture:proof})).toThrow('live capture');
 expect(f.follow.read().kind).toBe('off');expect(f.calls).toEqual({reviews:1,captures:0});
});
