import {expect,it,vi} from 'vitest';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {sourceIntakeHostFixture,hold} from './source-intake-host.fixture';
import type {Command} from '../src/shared/bridge';
import type {Task} from '../src/core/types';
vi.mock('node:fs/promises',{spy:true});
const expected=(task:Task)=>{const source=task.sources[0],version=source.versions.at(-1)!;return {sourceId:source.id,version:version.version,digest:version.digest};};
async function textFixture(){const f=await sourceIntakeHostFixture(),task=await f.core.putSource(f.task.id,{id:'synthetic-text',kind:'text',role:'fact',label:'Synthetic text',content:'Visible PRIVATE_SYNTHETIC tail'});return {...f,task};}
it('production parser and IPC dispatch bind source removal to the selected owner and exact saved ref',async()=>{
 const f=await textFixture(),before=await fs.readFile(join(f.directory,'store/tasks.json'),'utf8');
 await expect(f.host.dispatch({type:'source-intake.revoke',taskId:f.task.id,expected:expected(f.task),approved:true} as Command)).rejects.toThrow();expect(await fs.readFile(join(f.directory,'store/tasks.json'),'utf8')).toBe(before);
 const other=await f.core.createTask({title:'Other synthetic owner'});await f.host.command({type:'context.view',taskId:other.id});await expect(f.host.dispatch({type:'source-intake.revoke',taskId:f.task.id,expected:expected(f.task)})).rejects.toThrow();expect((await f.core.getTask(f.task.id)).sources[0].revoked).toBeUndefined();
 await f.host.command({type:'context.view',taskId:f.task.id});await f.host.dispatch({type:'source-intake.revoke',taskId:f.task.id,expected:expected(f.task)});expect((await f.core.getTask(f.task.id)).sources[0].revoked).toBeDefined();expect(f.calls.transports).toBe(0);
});
it('host releases capture/follow only after successful persistence and restoration cannot reuse its old pixels',async()=>{
 const f=await sourceIntakeHostFixture();await f.capture();await f.host.command({type:'source.follow.enable'});let task=await f.core.getTask(f.task.id);expect(f.host.captureCache.size).toBe(1);expect(f.host.documentFollow.read().kind).toBe('bound');
 await f.host.dispatch({type:'source-intake.revoke',taskId:task.id,expected:expected(task)});task=await f.core.getTask(task.id);expect(f.host.captureCache.size).toBe(0);expect(f.host.documentFollow.read().kind).toBe('off');
 await f.host.dispatch({type:'source-intake.restore',taskId:task.id,expected:expected(task),revokedAt:task.sources[0].revoked!.at,revocationId:task.sources[0].revoked!.id});expect((await f.core.getTask(task.id)).sources[0].freshness).toBe('refresh-required');expect(f.host.captureCache.size).toBe(0);expect(f.calls.transports).toBe(0);
});
it('a real core persistence failure publishes no source success and leaves the host capture binding intact',async()=>{
 const f=await sourceIntakeHostFixture();await f.capture();await f.host.command({type:'source.follow.enable'});const task=await f.core.getTask(f.task.id),events=f.calls.events.length;
 vi.spyOn(fs,'rename').mockRejectedValueOnce(Object.assign(Error('Synthetic disk failure'),{code:'EIO'}));try{await expect(f.host.dispatch({type:'source-intake.revoke',taskId:task.id,expected:expected(task)})).rejects.toThrow();}finally{vi.restoreAllMocks();}
 expect(f.host.captureCache.size).toBe(1);expect(f.host.documentFollow.read().kind).toBe('bound');expect(f.calls.events.slice(events)).not.toContainEqual({type:'changed',taskId:task.id});expect(JSON.parse(await fs.readFile(join(f.directory,'store/tasks.json'),'utf8')).tasks[0].sources[0].revoked).toBeUndefined();
});
it.each(['explain','create','experiment','procedure'] as const)('production %s dispatch sends only projected current sources after redaction',async kind=>{
 const f=await textFixture();await f.core.runRequest({taskId:f.task.id,requestId:'old',kind:'create',prompt:'PRIVATE_SYNTHETIC old prompt',sourceIds:['synthetic-text']},async()=>({title:'Old',content:'PRIVATE_SYNTHETIC derived'}));
 await f.host.dispatch({type:'source-intake.redact',taskId:f.task.id,expected:expected(f.task),spans:[{start:8,end:25}]});
 // Structured output intentionally fails parsing after the inert boundary; its payload is still inspected.
 const pending=f.host.dispatch({type:'model.run',taskId:f.task.id,requestId:'after-'+kind,kind,prompt:'Synthetic question',sourceIds:['synthetic-text']});if(kind==='experiment'||kind==='procedure')await expect(pending).rejects.toThrow();else await pending;
 expect(f.calls.transports).toBe(1);expect(JSON.stringify(f.state.payloads)).not.toContain('PRIVATE_SYNTHETIC');expect(f.state.payloads[0]).toMatchObject({expectedAccountScope:'synthetic-account',sources:[{content:'Visible [redacted] tail',version:2}]});
});
it('revision target and study material from a removed source are rejected before the inert provider boundary',async()=>{
 const f=await textFixture(),basis=expected(f.task),saved=await f.core.saveArtifact(f.task.id,{title:'Synthetic study result',content:'PRIVATE_SYNTHETIC result',sourceRefs:[basis]});await f.host.dispatch({type:'source-intake.revoke',taskId:f.task.id,expected:basis});
 await expect(f.host.dispatch({type:'model.run',taskId:f.task.id,requestId:'blocked-revision',kind:'revise',prompt:'Synthetic revision',artifactId:saved.artifactId,sourceIds:[]})).rejects.toThrow();await expect(f.host.dispatch({type:'study.preview',taskId:f.task.id,reference:basis})).rejects.toThrow();expect(f.calls.transports).toBe(0);
});
it.each(['revoke','redact','account'] as const)('%s during provider preparation is rejected at the actual host send fence',async action=>{
 const f=await textFixture(),gate=hold();f.state.providerGate=gate;const pending=f.host.dispatch({type:'model.run',taskId:f.task.id,requestId:'delayed',kind:'explain',prompt:'Synthetic question',sourceIds:['synthetic-text']}),assertion=expect(pending).rejects.toThrow();await gate.started;
 if(action==='account')f.state.account='different-synthetic-account';else await f.host.dispatch(action==='revoke'?{type:'source-intake.revoke',taskId:f.task.id,expected:expected(f.task)}:{type:'source-intake.redact',taskId:f.task.id,expected:expected(f.task),spans:[{start:8,end:25}]});gate.release();await assertion;expect(f.calls.transports).toBe(0);expect((await f.core.getTask(f.task.id)).artifacts).toHaveLength(0);
});

it('removal and restoration retire a manual refresh already waiting on native capture preparation',async()=>{
 const f=await sourceIntakeHostFixture();await f.capture();const task=await f.core.getTask(f.task.id),reference=expected(task),gate=hold();f.state.pixelGate=gate;
 const pending=f.host.dispatch({type:'windows.capture',taskId:task.id,windowId:f.target.id,sourceId:reference.sourceId}),settled=pending.catch(error=>error);await gate.started;
 await f.host.dispatch({type:'source-intake.revoke',taskId:task.id,expected:reference});const removed=await f.core.getTask(task.id);await f.host.dispatch({type:'source-intake.restore',taskId:task.id,expected:reference,revokedAt:removed.sources[0].revoked!.at,revocationId:removed.sources[0].revoked!.id});gate.release();expect(await settled).toBeInstanceOf(Error);expect(f.host.captureCache.size).toBe(0);expect((await f.core.getTask(task.id)).sources[0]).toMatchObject({currentVersion:1,freshness:'refresh-required'});expect(f.calls.pixels).toBe(1);
});
