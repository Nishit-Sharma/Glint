import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion,type Companion} from '../src/core/companion';
import {sourceResumeContext} from '../src/core/source-resume';
const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
async function fixture(){const directory=await mkdtemp(join(tmpdir(),'document-continuity-'));let core=await createCompanion({dataDir:directory});cleanups.push(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});return {get core(){return core},restart:async()=>{await core.close();core=await createCompanion({dataDir:directory});return core}};}
it('explains restart source uncertainty without losing drafts, decisions or exact artifact revisions',async()=>{
 const f=await fixture();let task=await f.core.createTask({title:'Synthetic document task',goal:'Preserve the earlier comparison constraint'});
 task=await f.core.putSource(task.id,{kind:'window',label:'Synthetic A',content:'frozen snapshot metadata',role:'fact',windowId:'window:41',documentToken:'metadata-A'});
 const source=task.sources[0],ref={sourceId:source.id,version:1,digest:source.versions[0].digest};
 await f.core.checkpoint(task.id,'Keep dates in UTC for the comparison.');
 const answer=await f.core.saveArtifact(task.id,{title:'Existing answer',content:'Prior partial result',sourceRefs:[ref]});
 await f.core.saveComposerDraft(task.id,0,{text:'Unsent correction',kind:'explain'});await f.restart();
 const resumed=await f.core.resume(task.id),context=sourceResumeContext(resumed.task);
 expect(context.sources[0]).toMatchObject({ref,status:'refresh-required',authority:'new-user-gesture-required'});
 expect(context.affectedArtifacts).toEqual([{artifactId:answer.artifactId,revisions:[1]}]);
 expect(context.relatedCheckpoints[0].note).toBe('Keep dates in UTC for the comparison.');
 expect(resumed.task.session?.draft).toBe('Unsent correction');
 expect(resumed.task.artifacts[0].revisions[0].content).toBe('Prior partial result');
});

const stampA={method:'ax-document',evidence:'foreground-application-correlation',digest:'a'.repeat(64)} as const;
const stampB={...stampA,digest:'b'.repeat(64)};
it('invalidates same-title A to B while preserving exact A history and cancels its running result',async()=>{
 const f=await fixture();let task=await f.core.createTask({title:'Same title A and B'});
 task=await f.core.putSource(task.id,{kind:'window',label:'Same title',content:'A snapshot',role:'fact',windowId:'window:41',windowProcessId:88,documentToken:'unchanged-title-and-bounds',documentStamp:stampA});
 const source=task.sources[0],ref={sourceId:source.id,version:1,digest:source.versions[0].digest};
 const saved=await f.core.saveArtifact(task.id,{title:'Prior A result',content:'Keep A as history',sourceRefs:[ref]});
 const gate=hold();const running=f.core.runRequest({taskId:task.id,requestId:'reading-A',kind:'explain',prompt:'Read A'},async ctx=>{gate.enter();await gate.wait;return {title:'Late A',content:ctx.signal.aborted?'Aborted result':'Must not publish'};});
 await gate.started;
 const observed=await f.core.reconcileDocumentSource({taskId:task.id,ref,windowId:'window:41',processId:88},{kind:'document',stamp:stampB});gate.release();
 expect(observed.kind).toBe('invalidated');expect((await running).status).toBe('cancelled');
 expect(observed.task.sources[0]).toMatchObject({freshness:'refresh-required',currentVersion:1,documentChange:{kind:'changed',observedDigest:stampB.digest}});
 expect(observed.task.sources[0].versions[0].content).toBe('A snapshot');expect(observed.task.artifacts[0].revisions[0].digest).toBe(saved.revision.digest);
});
function hold(){let release!:()=>void,enter!:()=>void;return {wait:new Promise<void>(resolve=>release=resolve),started:new Promise<void>(resolve=>enter=resolve),release:()=>release(),enter:()=>enter()};}

import {DocumentSourceAdapter,type DocumentSourceDependencies} from '../src/host/document-source-native';
import {DocumentSourceFollow} from '../src/host/document-source-follow';
import type {NativeWindow} from '../src/host/native';
const nativeA:NativeWindow={id:'window:41',osId:41,title:'Same title',owner:{name:'Synthetic app',processId:88},bounds:{x:0,y:0,width:100,height:100},displayId:'1',scaleFactor:1,documentToken:'unchanged-metadata',requiresExplicitCapture:true};
function adapterFixture(){
 let foreground:NativeWindow|undefined=nativeA,permitted=true,eligible=true,reply:unknown={kind:'document',processId:88,digest:stampA.digest};
 const calls={metadata:0},deps:DocumentSourceDependencies={platform:'darwin',trusted:async()=>permitted,foreground:async()=>foreground,eligible:async()=>eligible,readFocusedDocument:async()=>{calls.metadata++;return reply}};
 return {adapter:new DocumentSourceAdapter(deps),deps,calls,setForeground:(value:NativeWindow|undefined)=>{foreground=value},setPermission:(value:boolean)=>{permitted=value},setEligible:(value:boolean)=>{eligible=value},setReply:(value:unknown)=>{reply=value},observe:()=>new DocumentSourceAdapter(deps).observe(nativeA,{assertCurrent:()=>{},signal:new AbortController().signal})};
}
it('does not read excluded C or background same-title windows',async()=>{
 const a=adapterFixture();a.setForeground({...nativeA,id:'window:99',osId:99});expect(await a.observe()).toEqual({kind:'inactive',reason:'background'});expect(a.calls.metadata).toBe(0);
 a.setForeground(nativeA);a.setEligible(false);expect(await a.observe()).toEqual({kind:'frozen',reason:'excluded'});expect(a.calls.metadata).toBe(0);
});
it.each(['mismatched-pid','foreground-change','malformed-reply','permission-revoked'])('freezes ambiguous metadata without exposing document values: %s',async change=>{
 const a=adapterFixture();
 if(change==='mismatched-pid')a.setReply({kind:'document',processId:99,digest:stampA.digest});
 if(change==='malformed-reply')a.setReply({kind:'document',processId:88,digest:stampA.digest,url:'file:///private/synthetic-only'});
 if(change==='foreground-change')a.deps.readFocusedDocument=async()=>{a.setForeground({...nativeA,id:'window:99',osId:99});return {kind:'document',processId:88,digest:stampA.digest};};
 if(change==='permission-revoked')a.deps.readFocusedDocument=async()=>{a.setPermission(false);return {kind:'document',processId:88,digest:stampA.digest};};
 expect((await a.observe()).kind).toBe('frozen');
});
it('retires a delayed metadata read when the selected task epoch changes',async()=>{
 const a=adapterFixture(),gate=hold(),abort=new AbortController();let current=true;
 a.deps.readFocusedDocument=async()=>{gate.enter();await gate.wait;return {kind:'document',processId:88,digest:stampB.digest};};
 const result=a.adapter.observe(nativeA,{signal:abort.signal,assertCurrent:()=>{if(!current)throw Error('retired')}}),assertion=expect(result).rejects.toThrow('retired');await gate.started;current=false;abort.abort();gate.release();await assertion;
});
async function followFixture(){
 const f=await fixture();let task=await f.core.createTask({title:'Own synthetic follow'});
 task=await f.core.putSource(task.id,{kind:'window',label:'Same title',content:'A pixels',role:'fact',windowId:nativeA.id,windowProcessId:88,documentToken:nativeA.documentToken,documentStamp:stampA});
 let observation:import('../src/shared/document-source').DocumentObservation={kind:'document',stamp:stampA},approve=true,refreshGate:ReturnType<typeof hold>|undefined;
 const calls={captures:0,retired:0,changes:0,providers:0,reviews:0};
 const follow=new DocumentSourceFollow({core:f.core,observe:async(_target,options)=>{options.assertCurrent();return observation},approve:async()=>{calls.reviews++;return approve},retire:()=>{calls.retired++},changed:()=>{calls.changes++},refresh:async(binding,stamp,guard)=>{
  await refreshGate?.wait;guard();calls.captures++;
  const task=await f.core.putSource(binding.taskId,{id:binding.ref.sourceId,kind:'window',label:'Same title',content:'B pixels',role:'fact',windowId:nativeA.id,windowProcessId:88,documentToken:nativeA.documentToken,documentStamp:stamp});guard();return {task,sourceId:binding.ref.sourceId,target:nativeA};
 }});
 follow.bind({task,sourceId:task.sources[0].id,target:nativeA});
 return {get core(){return f.core},restart:f.restart,task,follow,calls,setObservation:(value:typeof observation)=>{observation=value},setApprove:(value:boolean)=>{approve=value},setRefreshGate:(value:typeof refreshGate)=>{refreshGate=value}};
}
it('observes A to B as stale history until the separate session follow review is accepted',async()=>{
 const f=await followFixture();f.setObservation({kind:'document',stamp:stampB});const status=await f.follow.poll();
 expect(status).toMatchObject({kind:'bound',automaticSnapshots:'off'});expect(f.calls.captures).toBe(0);
 expect((await f.core.getTask(f.task.id)).sources[0].freshness).toBe('refresh-required');
});
it('approved follow refreshes only its bound same-title active window into a new exact source version',async()=>{
 const f=await followFixture();await f.follow.enable();f.setObservation({kind:'document',stamp:stampB});await f.follow.poll();
 const task=await f.core.getTask(f.task.id);expect(f.calls.captures).toBe(1);expect(f.calls.providers).toBe(0);
 expect(task.sources[0]).toMatchObject({currentVersion:2,freshness:'fresh'});expect(task.sources[0].versions.map(v=>v.content)).toEqual(['A pixels','B pixels']);expect(task.sources[0].versions[1].documentStamp).toEqual(stampB);
 await f.follow.poll();expect(f.calls.captures).toBe(1);
});
it('background C suspends follow and a closed source freezes without a snapshot',async()=>{
 const f=await followFixture();await f.follow.enable();f.setObservation({kind:'inactive',reason:'background'});expect(await f.follow.poll()).toMatchObject({automaticSnapshots:'paused'});expect(f.calls.captures).toBe(0);
 f.setObservation({kind:'frozen',reason:'closed'});expect(await f.follow.poll()).toMatchObject({automaticSnapshots:'paused'});expect((await f.core.getTask(f.task.id)).sources[0].freshness).toBe('refresh-required');expect(f.calls.captures).toBe(0);
});
it('cancel before a delayed refresh prevents new pixels and restart restores no follow grant',async()=>{
 const f=await followFixture();await f.follow.enable();const gate=hold();f.setRefreshGate(gate);f.setObservation({kind:'document',stamp:stampB});const polling=f.follow.poll();
 await expect.poll(()=>f.calls.changes).toBe(1);f.follow.stop('Explicit cancel');gate.release();await polling;
 expect(f.calls.captures).toBe(0);expect(f.follow.read().kind).toBe('off');await f.restart();
 expect((await f.core.getTask(f.task.id)).sources[0].freshness).toBe('refresh-required');expect(f.follow.read().kind).toBe('off');
});
it('does not invalidate a newly rebound source from a late previous-version observation',async()=>{
 const f=await followFixture(),old=f.task.sources[0].versions[0];
 await f.core.putSource(f.task.id,{id:old.id,kind:'window',label:'New explicit B',content:'Explicit B',role:'fact',windowId:nativeA.id,windowProcessId:88,documentToken:nativeA.documentToken,documentStamp:stampB});
 const result=await f.core.reconcileDocumentSource({taskId:f.task.id,ref:{sourceId:old.id,version:old.version,digest:old.digest},windowId:nativeA.id,processId:88},{kind:'document',stamp:stampA});
 expect(result.kind).toBe('superseded');expect(result.task.sources[0]).toMatchObject({freshness:'fresh',currentVersion:2});
});

import {projectTaskDialogue} from '../src/core/task-dialogue';
import {taskHistoryReview} from '../src/host/request-review';
it('retrieves an older source-linked decision after rebinding and discloses it before sharing context',async()=>{
 const f=await fixture();let task=await f.core.createTask({title:'Long source comparison'});
 task=await f.core.putSource(task.id,{kind:'text',label:'Original A',content:'Original synthetic source',role:'fact'});
 const source=task.sources[0];await f.core.checkpoint(task.id,'Governing decision: compare all dates in UTC.');
 for(let i=0;i<9;i++)await f.core.checkpoint(task.id,'Later progress '+i);
 task=await f.core.putSource(task.id,{id:source.id,kind:'text',label:'Rebound B',content:'Changed synthetic source',role:'fact'});
 const payload=projectTaskDialogue(task,'next-request',[]),parsed=JSON.parse(payload);
 expect(parsed.checkpoints.map((c:{note:string})=>c.note)).not.toContain('Governing decision: compare all dates in UTC.');
 expect(parsed.sourceResume.relatedCheckpoints[0].note).toBe('Governing decision: compare all dates in UTC.');
 expect(parsed.sourceResume.omittedRelatedCheckpoints).toBe(4);expect(taskHistoryReview(payload)).toContain('Related saved note: Governing decision: compare all dates in UTC.');
});
it('a delayed invalidation admitted after its epoch retires cannot modify the saved source',async()=>{
 const f=await followFixture(),version=f.task.sources[0].versions[0];let current=false;
 await expect(f.core.reconcileDocumentSource({taskId:f.task.id,ref:{sourceId:version.id,version:1,digest:version.digest},windowId:nativeA.id,processId:88},{kind:'document',stamp:stampB},()=>{if(!current)throw Error('retired epoch')})).rejects.toThrow('retired epoch');
 expect((await f.core.getTask(f.task.id)).sources[0].freshness).toBe('fresh');
});
it('cancelled host review and a replaced source cannot create executable follow authority',async()=>{
 const f=await followFixture();f.setApprove(false);await f.follow.enable();f.setObservation({kind:'document',stamp:stampB});await f.follow.poll();expect(f.calls.captures).toBe(0);expect(f.follow.read()).toMatchObject({automaticSnapshots:'off'});
});

it('repeated enable is idempotent and cannot show off while a previous grant captures',async()=>{
 const f=await followFixture();await f.follow.enable();f.setApprove(false);const repeated=await f.follow.enable();
 expect(f.calls.reviews).toBe(1);expect(repeated).toMatchObject({automaticSnapshots:'on'});
 f.setObservation({kind:'document',stamp:stampB});await f.follow.poll();expect(f.calls.captures).toBe(1);
});

it.each([false,true])('preserves history and drafts across edited-state %s transition and reopening',async edited=>{
 const f=await fixture();let task=await f.core.createTask({title:'Owned dirty-state source'});
 task=await f.core.putSource(task.id,{kind:'window',label:'Same address',content:'Original frozen snapshot',role:'fact',windowId:nativeA.id,windowProcessId:88,documentToken:nativeA.documentToken,documentStamp:stampA});
 const source=task.sources[0],ref={sourceId:source.id,version:1,digest:source.versions[0].digest},binding={taskId:task.id,ref,windowId:nativeA.id,processId:88};
 const artifact=await f.core.saveArtifact(task.id,{title:'Prior answer',content:'Preserved answer',sourceRefs:[ref]});await f.core.saveComposerDraft(task.id,0,{text:'Unsent exact draft',kind:'explain'});
 const gate=hold(),running=f.core.runRequest({taskId:task.id,requestId:'old-snapshot',kind:'explain',prompt:'Review'},async()=>{gate.enter();await gate.wait;return {title:'Late',content:'Must not publish'}});await gate.started;
 const observed=await f.core.reconcileDocumentSource(binding,{kind:'edited-transition',before:{...stampA,edited},after:{...stampA,edited:!edited}},()=>{});gate.release();expect((await running).status).toBe('cancelled');
 expect(observed).toMatchObject({kind:'invalidated',task:{sources:[{freshness:'refresh-required',documentChange:{kind:'changed',observedDigest:stampA.digest}}]}});
 expect(observed.task.artifacts[0].revisions[0].digest).toBe(artifact.revision.digest);expect(observed.task.session?.draft).toBe('Unsent exact draft');
 const repeated=await f.core.reconcileDocumentSource(binding,{kind:'edited-transition',before:{...stampA,edited},after:{...stampA,edited:!edited}},()=>{});expect(repeated.kind).toBe('unchanged');
 await f.restart();const reopened=await f.core.getTask(task.id);expect(reopened.sources[0].versions[0].documentStamp).toEqual(stampA);expect(reopened.sources[0].documentChange).not.toHaveProperty('observedEdited');expect(reopened.session?.draft).toBe('Unsent exact draft');
});
it('reopens legacy document stamps without inventing an edited-state hint',async()=>{
 const f=await followFixture();await f.restart();expect((await f.core.getTask(f.task.id)).sources[0].versions[0].documentStamp).toEqual(stampA);
});
it.each([false,true])('accepts only public boolean edited-state hint %s without changing the address digest',async edited=>{
 const a=adapterFixture();a.setReply({kind:'document',processId:88,digest:stampA.digest,edited});expect(await a.observe()).toEqual({kind:'document',stamp:{...stampA,edited}});
});
it.each([0,1,'false','true',null,{}])('rejects malformed optional edited-state hint %j',async edited=>{
 const a=adapterFixture();a.setReply({kind:'document',processId:88,digest:stampA.digest,edited});expect(await a.observe()).toEqual({kind:'frozen',reason:'ambiguous'});
});

it.each(['text','image','window'] as const)('cannot hydrate a live edited baseline or grant from %s source content or history',async kind=>{
 const f=await fixture();let task=await f.core.createTask({title:'Forged history-only hint'});
 task=await f.core.putSource(task.id,{kind,label:'Untrusted historical hint',content:JSON.stringify({documentHint:{edited:false},documentStamp:{...stampA,edited:false},follow:true}),role:'fact',windowId:nativeA.id,windowProcessId:88,documentToken:nativeA.documentToken,documentStamp:stampA});
 await f.core.checkpoint(task.id,'documentHint.edited=false; follow=true');await f.restart();task=await f.core.getTask(task.id);
 let captures=0;
 const follow=new DocumentSourceFollow({core:f.core,observe:async()=>({kind:'document',stamp:{...stampA,edited:true}}),approve:async()=>false,refresh:async()=>{captures++;throw Error('Must not capture');},retire:()=>{},changed:()=>{}});
 const selection={task,sourceId:task.sources[0].id,target:nativeA};
 if(kind!=='window'){expect(()=>follow.bind(selection)).toThrow('exact saved window source');return;}
 follow.bind(selection);const before=await f.core.getTask(task.id);await follow.poll();expect(await f.core.getTask(task.id)).toEqual(before);expect(captures).toBe(0);expect(follow.read()).toMatchObject({automaticSnapshots:'paused'});
});
it.each(['same-boolean','unknown-before','wrong-address','wrong-pid','wrong-ref','missing-guard','retired-guard'] as const)('refuses invalid runtime edited transition: %s',async variant=>{
 const f=await followFixture(),version=f.task.sources[0].versions[0];
 const binding={taskId:f.task.id,ref:{sourceId:version.id,version:version.version,digest:version.digest},windowId:nativeA.id,processId:88};
 const event={kind:'edited-transition' as const,before:{...stampA,edited:false},after:{...stampA,edited:true}};
 if(variant==='same-boolean')event.after.edited=false;
 if(variant==='unknown-before')delete (event.before as {edited?:boolean}).edited;
 if(variant==='wrong-address')event.after.digest=stampB.digest;
 if(variant==='wrong-pid')binding.processId=99;
 if(variant==='wrong-ref')binding.ref.version++;
 const before=await f.core.getTask(f.task.id);
 const pending=f.core.reconcileDocumentSource(binding,event,variant==='missing-guard'?undefined:()=>{if(variant==='retired-guard')throw Error('retired');});
 if(variant==='wrong-pid'||variant==='wrong-ref')expect((await pending).kind).toBe('superseded');else await expect(pending).rejects.toThrow();
 expect(await f.core.getTask(f.task.id)).toEqual(before);
});
it('a capture proof for an older version cannot seed the replacement live binding',async()=>{
 const f=await followFixture(),old=f.task.sources[0].versions[0];
 const task=await f.core.putSource(f.task.id,{id:old.id,kind:'window',label:'Replacement',content:'New content',role:'fact',windowId:nativeA.id,windowProcessId:88,documentToken:nativeA.documentToken,documentStamp:stampA});
 expect(()=>f.follow.bind({task,sourceId:old.id,target:nativeA,capture:{ref:{sourceId:old.id,version:old.version,digest:old.digest},stamp:{...stampA,edited:false}}})).toThrow('live capture');
});

it.each(['method','evidence','digest','edited'] as const)('refuses mismatched live capture metadata proof: %s',async field=>{
 const f=await followFixture(),version=f.task.sources[0].versions[0];
 const stamp={...stampA,edited:false} as Record<string,unknown>;stamp[field]=field==='edited'?'false':field==='digest'?stampB.digest:'forged';
 const capture={ref:{sourceId:version.id,version:version.version,digest:version.digest},stamp} as unknown as import('../src/shared/document-source').DocumentCapture;
 expect(()=>f.follow.bind({task:f.task,sourceId:version.id,target:nativeA,capture})).toThrow('live capture');expect(f.calls.captures).toBe(0);
});

it('a retired observation cannot block polling the newly selected source or change it later',async()=>{
 const f=await fixture();let task=await f.core.createTask({title:'Selection recovery'});
 task=await f.core.putSource(task.id,{kind:'window',label:'A',content:'A',role:'fact',windowId:nativeA.id,windowProcessId:88,documentToken:nativeA.documentToken,documentStamp:stampA});
 const sourceA=task.sources[0],nativeB={...nativeA,id:'window:42',osId:42,title:'B'};
 task=await f.core.putSource(task.id,{kind:'window',label:'B',content:'B',role:'fact',windowId:nativeB.id,windowProcessId:88,documentToken:nativeB.documentToken,documentStamp:stampB});
 const sourceB=task.sources[1],gate=hold();let callsB=0,captures=0;
 const follow=new DocumentSourceFollow({core:f.core,observe:async(target,options)=>{
  if(target.id===nativeA.id){gate.enter();await gate.wait;options.assertCurrent();return {kind:'document',stamp:stampB};}
  callsB++;options.assertCurrent();return {kind:'document',stamp:stampB};
 },approve:async()=>false,refresh:async()=>{captures++;return null;},retire:()=>{},changed:()=>{}});
 follow.bind({task,sourceId:sourceA.id,target:nativeA});const old=follow.poll();await gate.started;
 try{
  follow.bind({task,sourceId:sourceB.id,target:nativeB});const current=follow.poll();
  await expect.poll(()=>callsB,{timeout:1000}).toBe(1);expect(await current).toMatchObject({sourceId:sourceB.id,automaticSnapshots:'off'});
  gate.release();await old;
  expect(follow.read()).toMatchObject({sourceId:sourceB.id,automaticSnapshots:'off'});expect((await f.core.getTask(task.id)).sources.map(s=>s.freshness)).toEqual(['fresh','fresh']);expect(captures).toBe(0);
 }finally{gate.release();await old;}
});

it('a retired approval cannot block a new review or clear its in-flight review gate',async()=>{
 const f=await fixture();let task=await f.core.createTask({title:'Review recovery'});
 task=await f.core.putSource(task.id,{kind:'window',label:'A',content:'A',role:'fact',windowId:nativeA.id,windowProcessId:88,documentToken:nativeA.documentToken,documentStamp:stampA});
 const sourceA=task.sources[0],nativeB={...nativeA,id:'window:42',osId:42,title:'B'};
 task=await f.core.putSource(task.id,{kind:'window',label:'B',content:'B',role:'fact',windowId:nativeB.id,windowProcessId:88,documentToken:nativeB.documentToken,documentStamp:stampB});
 const sourceB=task.sources[1],oldGate=hold(),newGate=hold();let reviews=0,captures=0;
 const follow=new DocumentSourceFollow({core:f.core,observe:async(target,options)=>{options.assertCurrent();return {kind:'document',stamp:target.id===nativeA.id?stampA:stampB};},approve:async(scope)=>{
  reviews++;const gate=scope.windowId===nativeA.id?oldGate:newGate;gate.enter();await gate.wait;return true;
 },refresh:async()=>{captures++;return null;},retire:()=>{},changed:()=>{}});
 follow.bind({task,sourceId:sourceA.id,target:nativeA});const old=follow.enable();const oldOutcome=old.then(()=>null,error=>error);await oldGate.started;
 let current:Promise<unknown>|undefined;
 try{
  follow.bind({task,sourceId:sourceB.id,target:nativeB});current=follow.enable();const currentOutcome=current.catch(error=>error);
  await expect.poll(()=>reviews,{timeout:1000}).toBe(2);oldGate.release();expect((await oldOutcome).message).toContain('retired');
  await expect(follow.enable()).rejects.toThrow('Finish the current document-follow review.');
  newGate.release();expect(await currentOutcome).toMatchObject({sourceId:sourceB.id,automaticSnapshots:'on'});expect(captures).toBe(0);
 }finally{oldGate.release();newGate.release();await oldOutcome;await current?.catch(()=>{});}
});
