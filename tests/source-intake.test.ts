import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion,type Companion,type RequestContext} from '../src/core/companion';
import {readSourceIntakeCommand,redactSpans,requestableSourceIds,changeInclusion,inclusionRows} from '../src/shared/source-intake';
import {projectRequestTask} from '../src/core/request-context';
import {projectTaskDialogue} from '../src/core/task-dialogue';
import {taskContext} from '../src/host/browser/coordinator';
import {emptyTaskSession} from '../src/core/task-session';
import type {SourceRef,Task} from '../src/core/types';
vi.mock('node:fs/promises',{spy:true});
let directory:string,core:Companion;
beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'source-intake-'));core=await createCompanion({dataDir:directory});});
afterEach(async()=>{vi.restoreAllMocks();await core.close().catch(()=>{});await rm(directory,{recursive:true,force:true});});
const source={id:'source',kind:'text' as const,label:'Synthetic text',content:'Visible PRIVATE_SYNTHETIC tail',role:'fact' as const};
const ref=(task:Task,id='source'):SourceRef=>{const s=task.sources.find(s=>s.id===id)!,v=s.versions.at(-1)!;return {sourceId:s.id,version:v.version,digest:v.digest};};
async function prepared(){const task=await core.createTask({title:'Synthetic owner'});return core.putSource(task.id,source);}
const output={title:'Synthetic result',content:'Safe new output'};
function hold(){let release!:()=>void,enter!:()=>void;return {started:new Promise<void>(resolve=>enter=resolve),wait:new Promise<void>(resolve=>release=resolve),enter:()=>enter(),release:()=>release()};}

it('strict parser rejects unknown fields, malformed bindings, bad bounds and foreign command families',()=>{
 const expected={sourceId:'source',version:1,digest:'a'.repeat(64)};
 expect(readSourceIntakeCommand({type:'source-intake.revoke',taskId:'owner',expected})).toEqual({type:'source-intake.revoke',taskId:'owner',expected});
 for(const command of [{type:'source-intake.revoke',taskId:'owner',expected,approved:true},{type:'source-intake.restore',taskId:'owner',expected,revokedAt:'now'},{type:'source-intake.redact',taskId:'owner',expected,spans:[]},{type:'source-intake.redact',taskId:'owner',expected:{...expected,digest:'invalid'},spans:[{start:0,end:1}]},{type:'source-intake.redact',taskId:'owner',expected,spans:[{start:0.5,end:2}]},{type:'source-intake.unknown',taskId:'owner'}])expect(()=>readSourceIntakeCommand(command)).toThrow();
});
it('merges text spans without changing unselected bytes and rejects invalid UTF-16 boundaries',()=>{
 expect(redactSpans('abcde\r\nfgh',[{start:4,end:7},{start:1,end:3},{start:2,end:4}])).toBe('a[redacted]fgh');
 expect(redactSpans('a😀b',[{start:1,end:3}])).toBe('a[redacted]b');
 for(const spans of [[],[{start:-1,end:1}],[{start:1,end:1}],[{start:0,end:100}],[{start:1,end:2}],[{start:2,end:3}]])expect(()=>redactSpans('a😀b',spans)).toThrow();
});
it('revocation retains source revisions, retires export approvals and survives reopen without restoring freshness',async()=>{
 const task=await prepared(),basis=ref(task),saved=await core.saveArtifact(task.id,{...output,sourceRefs:[basis]}),proposal=await core.proposeExport(task.id,{artifactId:saved.artifactId,revision:1,path:join(directory,'synthetic.txt')});
 await core.approveExport(task.id,proposal.proposal.id,proposal.proposal.digest);
 const removed=await core.revokeSource(task.id,'source',()=>{},basis);expect(removed.sources[0].versions).toEqual(task.sources[0].versions);expect(removed.actions[0].status).toBe('retired');expect(requestableSourceIds(removed)).toEqual([]);
 await core.close();core=await createCompanion({dataDir:directory});const reopened=await core.getTask(task.id);expect(reopened.sources[0].revoked).toEqual(removed.sources[0].revoked);
 let invoked=false;await expect(core.runRequest({taskId:task.id,requestId:'blocked',kind:'explain',prompt:'Synthetic',sourceIds:['source']},async()=>{invoked=true;return output;})).rejects.toMatchObject({code:'stale'});expect(invoked).toBe(false);
 let context:RequestContext|undefined;await core.runRequest({taskId:task.id,requestId:'without-removed',kind:'explain',prompt:'Synthetic'},async ctx=>{context=ctx;return output;});expect(context?.task.sources).toEqual([]);expect(JSON.stringify(context?.task)).not.toContain('PRIVATE_SYNTHETIC');
 const restored=await core.restoreSource(task.id,'source',()=>{},basis,reopened.sources[0].revoked!.at,reopened.sources[0].revoked!.id);expect(restored.sources[0].freshness).toBe('fresh');expect(restored.sources[0].revoked).toBeUndefined();
});
it('restoration preserves stale text and always requires explicit new window capture',async()=>{
 const task=await prepared();await core.invalidateSource(task.id,'source','Synthetic existing stale reason');const removed=await core.revokeSource(task.id,'source');const restored=await core.restoreSource(task.id,'source');expect(restored.sources[0]).toMatchObject({freshness:'refresh-required',staleReason:'Synthetic existing stale reason'});
 const withWindow=await core.putSource(task.id,{id:'window',kind:'window',label:'Synthetic window',content:'Synthetic metadata',role:'fact',windowId:'synthetic-window',documentToken:'synthetic-document'});await core.revokeSource(task.id,'window');const restoredWindow=await core.restoreSource(task.id,'window');expect(restoredWindow.sources[1]).toMatchObject({freshness:'refresh-required',staleReason:expect.stringContaining('Capture this window again')});expect(removed.sources[0].versions).toEqual(task.sources[0].versions);expect(withWindow.sources[1].versions).toEqual(restoredWindow.sources[1].versions);
});
it('an older restore cannot undo a newer removal even with the same clock timestamp',async()=>{
 const task=await prepared(),first=await core.revokeSource(task.id,'source');await core.restoreSource(task.id,'source');const second=await core.revokeSource(task.id,'source');expect(second.sources[0].revoked!.id).not.toBe(first.sources[0].revoked!.id);
 await expect(core.restoreSource(task.id,'source',()=>{},ref(task),first.sources[0].revoked!.at,first.sources[0].revoked!.id)).rejects.toMatchObject({code:'conflict'});expect((await core.getTask(task.id)).sources[0].revoked).toEqual(second.sources[0].revoked);
});
it('redaction appends exactly one version, excludes earlier source-derived payloads in every projection and keeps history on disk',async()=>{
 const task=await prepared(),basis=ref(task);
 await core.runRequest({taskId:task.id,requestId:'old',kind:'create',prompt:'PRIVATE_SYNTHETIC prompt',sourceIds:['source']},async()=>({title:'PRIVATE_SYNTHETIC result',content:'PRIVATE_SYNTHETIC derived'}));await core.checkpoint(task.id,'PRIVATE_SYNTHETIC checkpoint');
 const result=await core.redactSource(task.id,basis,[{start:8,end:25}]);expect(result.sources[0].currentVersion).toBe(2);expect(result.sources[0].versions[0].content).toBe(source.content);expect(result.sources[0].versions[1].content).toBe('Visible [redacted] tail');
 expect(JSON.stringify(projectRequestTask(result,[ref(result)]))).not.toContain('PRIVATE_SYNTHETIC');expect(projectTaskDialogue(result,'new',[ref(result)])).not.toContain('PRIVATE_SYNTHETIC');expect(taskContext(result,'browser')).not.toContain('PRIVATE_SYNTHETIC');
 const preview=await core.previewInstructionRequest(task.id,0,['source']);expect(JSON.stringify(preview)).not.toContain('PRIVATE_SYNTHETIC');
 await core.runRequest({taskId:task.id,requestId:'after',kind:'explain',prompt:'Synthetic next',sourceIds:['source']},async ctx=>{expect(JSON.stringify(ctx.task)).not.toContain('PRIVATE_SYNTHETIC');expect(ctx.taskHistory).not.toContain('PRIVATE_SYNTHETIC');return output;});
 await expect(core.redactSource(task.id,basis,[{start:8,end:25}])).rejects.toMatchObject({code:'conflict'});expect(await readFile(join(directory,'tasks.json'),'utf8')).toContain('PRIVATE_SYNTHETIC');
});
it.each([['revoke',true],['revoke',false],['redact',true],['redact',false]] as const)('%s aborts a request with direct sources=%s, holds queue and refuses late output',async(action,direct)=>{
 const task=await prepared(),basis=ref(task),gate=hold(),signals:AbortSignal[]=[];
 const session=(await core.getTask(task.id)).session??emptyTaskSession();await core.replaceSession(task.id,session.revision,{...session,queuedFollowups:[{id:'queued',revision:1,prompt:'Synthetic queued',kind:'explain',createdAt:new Date().toISOString(),sourceRefs:[basis],precedingRequestIds:[],basis:'a'.repeat(64),scope:'b'.repeat(64),status:'queued'}]});
 const run=(requestId:string,sourceIds:string[])=>core.runRequest({taskId:task.id,requestId,kind:'create',prompt:'Synthetic delayed',sourceIds},async ctx=>{signals.push(ctx.signal);gate.enter();await gate.wait;return {title:'Late',content:'DO_NOT_SAVE_LATE'};});
 const pending=run(direct?'active':'history-only',direct?['source']:[]);await gate.started;
 if(action==='revoke')await core.revokeSource(task.id,'source');else await core.redactSource(task.id,basis,[{start:8,end:25}]);
 expect(signals.every(signal=>signal.aborted)).toBe(true);expect((await core.getTask(task.id)).session?.queuedFollowups?.[0].status).toBe('held');gate.release();expect((await pending).status).toBe('cancelled');expect((await core.getTask(task.id)).artifacts).toEqual([]);
});
it('bad spans, stale guards, paused/foreign owners and changed refs leave exact durable bytes unchanged',async()=>{
 const task=await prepared(),before=await readFile(join(directory,'tasks.json'),'utf8');
 for(const action of [()=>core.redactSource(task.id,ref(task),[{start:0,end:999}]),()=>core.revokeSource(task.id,'source',()=>{throw Error('Synthetic owner changed');}),()=>core.revokeSource(task.id,'source',()=>{},{...ref(task),digest:'b'.repeat(64)}),()=>core.restoreSource('foreign-task','source')]){await expect(action()).rejects.toThrow();expect(await readFile(join(directory,'tasks.json'),'utf8')).toBe(before);}
 await core.pause(task.id);await expect(core.revokeSource(task.id,'source')).rejects.toMatchObject({code:'conflict'});
});
it('a real store rename failure aborts active transport and leaves old durable source bytes unchanged',async()=>{
 const task=await prepared(),before=await readFile(join(directory,'tasks.json'),'utf8'),gate=hold();let signal:AbortSignal|undefined;
 const pending=core.runRequest({taskId:task.id,requestId:'failure-active',kind:'create',prompt:'Synthetic'},async ctx=>{signal=ctx.signal;gate.enter();await gate.wait;return output;});const caught=pending.catch(()=>undefined);await gate.started;const begun=await readFile(join(directory,'tasks.json'),'utf8');
 vi.spyOn(fs,'rename').mockRejectedValueOnce(Object.assign(Error('Synthetic disk failure'),{code:'EIO'}));await expect(core.revokeSource(task.id,'source')).rejects.toThrow('Synthetic disk failure');expect(signal?.aborted).toBe(true);expect(await readFile(join(directory,'tasks.json'),'utf8')).toBe(begun);expect(begun).toContain(source.content);expect(before).toContain(source.content);gate.release();await caught;
 await core.close();core=await createCompanion({dataDir:directory});expect((await core.getTask(task.id)).sources[0].revoked).toBeUndefined();
});
it('inclusion projection supports no sources, removed rows and explicit select-all without readding a removed source',async()=>{
 const task=await prepared();await core.putSource(task.id,{...source,id:'second',content:'Safe second'});const removed=await core.revokeSource(task.id,'source');expect(requestableSourceIds(removed)).toEqual(['second']);expect(changeInclusion(removed,[],'source',true)).toEqual([]);expect(inclusionRows(removed,[]).map(row=>row.state)).toEqual(['removed','excluded']);
});

it.each(['refresh','invalidate','delete'] as const)('%s of an original cancels dependent project-copy transport and marks its status stale',async action=>{
 const owner=await prepared(),target=await core.createTask({title:'Synthetic copy consumer'}),project=await core.projectCommand({type:'projects.create',name:'Synthetic project'});
 for(const task of [owner,target])await core.projectCommand({type:'projects.assign',taskId:task.id,projectId:project.id,expectedProjectId:null});
 const shared=await core.projectCommand({type:'projects.sources.add',projectId:project.id,expectedRevision:1,taskId:owner.id,reference:ref(owner)});
 const copied=await core.projectCommand({type:'projects.sources.use',projectId:project.id,expectedRevision:shared.revision,taskId:target.id,sourceKey:shared.sources[0].id});
 const gate=hold();let signal:AbortSignal|undefined;
 const pending=core.runRequest({taskId:target.id,requestId:'dependent-'+action,kind:'explain',prompt:'Synthetic question',sourceIds:[copied.sources[0].id]},async ctx=>{signal=ctx.signal;gate.enter();await gate.wait;return output;});await gate.started;
 if(action==='refresh')await core.putSource(owner.id,{...source,content:'Synthetic new current text'});else if(action==='invalidate')await core.invalidateSource(owner.id,'source','Synthetic owner changed');else await core.deleteTask(owner.id);
 expect(signal?.aborted).toBe(true);const after=await core.getTask(target.id);expect(after.sources[0].freshness).toBe('refresh-required');expect(inclusionRows(after)[0].state).toBe('needs-refresh');expect(after.sources[0].projectOrigin).toEqual(copied.sources[0].projectOrigin);gate.release();expect((await pending).status).toBe('cancelled');
});
it('withdrawn cross-task skill resources cannot return through derived artifacts or history after clearing the skill',async()=>{
 const owner=await prepared(),target=await core.createTask({title:'Synthetic skill consumer'}),skill=await core.saveInstructionSkill({taskId:owner.id,intentId:'synthetic-skill',name:'Synthetic skill',description:'Synthetic',instructions:'Use supplied evidence',resources:[ref(owner)]});await core.setInstructionSkill(target.id,0,skill.reference);
 await core.runRequest({taskId:target.id,requestId:'skill-answer',kind:'explain',prompt:'Synthetic',sourceIds:[],instructionSkill:skill.reference,instructionSkillRevision:1},async ctx=>({title:'Synthetic derived',content:ctx.instructionSkill!.resources[0].content}));
 const generated=await core.getTask(target.id);expect(generated.requests[0].contextSkillRefs).toEqual([skill.reference]);expect(generated.artifacts[0].revisions[0].contextSkillRefs).toEqual([skill.reference]);
 await core.revokeSource(owner.id,'source');await core.setInstructionSkill(target.id,1,null);
 const derived=generated.artifacts[0],procedureTask:Task={...generated,procedures:[{id:'derived-procedure',revisions:[{revision:1,title:'PRIVATE_SYNTHETIC procedure',scope:{taskId:target.id},steps:[],sourceRefs:[],createdAt:generated.updatedAt,observation:{artifactId:derived.id,revision:1,digest:derived.revisions[0].digest,summary:'PRIVATE_SYNTHETIC observation',limitations:[]}}]}]};expect(projectRequestTask(procedureTask,[],[procedureTask,await core.getTask(owner.id)]).procedures).toEqual([]);
 await core.runRequest({taskId:target.id,requestId:'without-skill',kind:'explain',prompt:'Synthetic follow-up',sourceIds:[],instructionSkillRevision:2},async ctx=>{expect(JSON.stringify(ctx.task)).not.toContain('PRIVATE_SYNTHETIC');expect(ctx.taskHistory).not.toContain('PRIVATE_SYNTHETIC');return output;});
 const legacy=structuredClone(generated);for(const request of legacy.requests)delete request.contextSkillRefs;for(const artifact of legacy.artifacts)for(const revision of artifact.revisions)delete revision.contextSkillRefs;legacy.session={...legacy.session!,instructionSkill:{revision:2,selection:null},runs:[{id:'legacy-run',endpointKey:'inert',browserId:'legacy-browser',origin:'https://synthetic.invalid',initialObservation:{id:'old-page',taskId:legacy.id,browserId:'legacy-browser',documentId:'old-document',url:'https://synthetic.invalid',title:'Synthetic page',text:'PRIVATE_SYNTHETIC page',digest:'old',targets:[]},operations:[{id:'old-op',intent:{kind:'click',snapshotId:'old-page',targetId:'old-button'},status:'retired',reason:'PRIVATE_SYNTHETIC browser reasoning'}]}]};expect(JSON.stringify(projectRequestTask(legacy,[],[legacy,await core.getTask(owner.id)]))).not.toContain('PRIVATE_SYNTHETIC');expect(taskContext(legacy,'later')).not.toContain('PRIVATE_SYNTHETIC');
});

it('ordinary unrelated refresh preserves transport while holding queues, advancing context and retiring exports',async()=>{
 const task=await prepared(),basis=ref(task),saved=await core.saveArtifact(task.id,{...output,sourceRefs:[basis]}),proposal=await core.proposeExport(task.id,{artifactId:saved.artifactId,revision:1,path:join(directory,'ordinary.txt')});await core.approveExport(task.id,proposal.proposal.id,proposal.proposal.digest);
 const session=(await core.getTask(task.id)).session!;await core.replaceSession(task.id,session.revision,{...session,queuedFollowups:[{id:'ordinary-queued',revision:1,prompt:'Queued',kind:'explain',createdAt:new Date().toISOString(),sourceRefs:[basis],precedingRequestIds:[],basis:'a'.repeat(64),scope:'b'.repeat(64),status:'queued'}]});
 const gate=hold();let signal:AbortSignal|undefined;
 const pending=core.runRequest({taskId:task.id,requestId:'unrelated-ordinary',kind:'create',prompt:'Only this prompt',sourceIds:[]},async ctx=>{signal=ctx.signal;expect(ctx.task.sources).toEqual([]);expect(ctx.task.artifacts).toEqual([]);expect(ctx.taskHistory).not.toContain('PRIVATE_SYNTHETIC');gate.enter();await gate.wait;return output;});await gate.started;
 const before=await core.getTask(task.id),after=await core.putSource(task.id,{...source,content:'Changed excluded text'});expect(signal?.aborted).toBe(false);expect(after.requests.at(-1)).toMatchObject({status:'running',sourceRefs:[],contextSourceRefs:[],contextSkillRefs:[]});expect(after.session!.contextRevision).toBeGreaterThan(before.session!.contextRevision!);expect(after.session!.queuedFollowups![0].status).toBe('held');expect(after.actions[0].status).toBe('retired');gate.release();expect((await pending).status).toBe('completed');
});
it.each(['resource','unrelated'] as const)('ordinary %s refresh checks inherited history and artifact skill resources without direct sources',async changed=>{
 const owner=await prepared();await core.putSource(owner.id,{...source,id:'unrelated',content:'Other skill-owner text'});
 const target=await core.createTask({title:'Inherited skill consumer'}),skill=await core.saveInstructionSkill({taskId:owner.id,intentId:'inherited-skill',name:'Inherited skill',description:'Synthetic',instructions:'Use supplied evidence',resources:[ref(owner)]});await core.setInstructionSkill(target.id,0,skill.reference);
 const first=await core.runRequest({taskId:target.id,requestId:'skill-origin',kind:'create',prompt:'Initial skill response',sourceIds:[],instructionSkill:skill.reference,instructionSkillRevision:1},async()=>({title:'Skill origin',content:'INHERITED_SKILL_HISTORY'}));expect(first.status).toBe('completed');
 const gate=hold();let signal:AbortSignal|undefined;
 const pending=core.runRequest({taskId:target.id,requestId:'inherited-revision',kind:'revise',artifactId:first.artifactId,expectedRevision:1,prompt:'Revise inherited response',sourceIds:[]},async ctx=>{signal=ctx.signal;expect(ctx.taskHistory).toContain('INHERITED_SKILL_HISTORY');expect(ctx.task.artifacts[0].revisions[0].contextSkillRefs).toEqual([skill.reference]);gate.enter();await gate.wait;return output;});await gate.started;
 const record=(await core.getTask(target.id)).requests.at(-1)!;expect(record.sourceRefs).toEqual([]);expect(record.contextSourceRefs).toEqual([]);expect(record.instructionSkill).toBeUndefined();expect(record.contextSkillRefs).toEqual([skill.reference]);expect(record.contextArtifactRefs).toHaveLength(1);
 await core.putSource(owner.id,{...source,id:changed==='resource'?'source':'unrelated',content:'Changed '+changed});expect(signal?.aborted).toBe(changed==='resource');gate.release();expect((await pending).status).toBe(changed==='resource'?'cancelled':'completed');expect((await core.getTask(target.id)).artifacts[0].revisions).toHaveLength(changed==='resource'?1:2);
});
it('an explicit artifact dependency keeps original local-note provenance after its editable links are removed',async()=>{
 const task=await prepared(),basis=ref(task),note=await core.createAuthoredDocument({taskId:task.id,intentId:'original-note',title:'Original source-linked note',content:'Local note body',sourceRefs:[basis]});
 await core.saveArtifact(task.id,{artifactId:note.artifactId,expectedRevision:1,title:'Unlinked note',content:'Edited local note body',mimeType:'text/markdown',sourceRefs:[]});
 const current=(await core.getTask(task.id)).artifacts[0].revisions.at(-1)!,expected={artifactId:note.artifactId,revision:current.revision,digest:current.digest};expect(current.sourceRefs).toEqual([]);
 const gate=hold();let signal:AbortSignal|undefined;
 const pending=core.runRequest({taskId:task.id,requestId:'artifact-dependent',kind:'experiment',prompt:'Work bound to the explicit saved basis',sourceIds:[],expectedArtifacts:[expected]},async ctx=>{signal=ctx.signal;expect(ctx.task.sources).toEqual([]);expect(ctx.task.artifacts).toEqual([]);gate.enter();await gate.wait;return output;});await gate.started;
 const record=(await core.getTask(task.id)).requests.at(-1)!;expect(record.sourceRefs).toEqual([]);expect(record.contextSourceRefs).toEqual([]);expect(record.contextArtifactRefs).toEqual([expected]);await core.putSource(task.id,{...source,content:'Changed original note source'});expect(signal?.aborted).toBe(true);gate.release();expect((await pending).status).toBe('cancelled');expect((await core.getTask(task.id)).artifacts).toHaveLength(1);
});
it.each([['refresh',true],['refresh',false],['revoke',false],['redact',false],['delete',false]] as const)('%s through a transitive project copy, selected=%s, preserves source and privacy boundaries',async(action,selected)=>{
 const original=await prepared(),middle=await core.createTask({title:'Middle source owner'}),target=await core.createTask({title:'Transitive source consumer'}),project=await core.projectCommand({type:'projects.create',name:'Transitive source project'});
 for(const task of [original,middle,target])await core.projectCommand({type:'projects.assign',taskId:task.id,projectId:project.id,expectedProjectId:null});
 const shared=await core.projectCommand({type:'projects.sources.add',projectId:project.id,expectedRevision:1,taskId:original.id,reference:ref(original)}),copied=await core.projectCommand({type:'projects.sources.use',projectId:project.id,expectedRevision:shared.revision,taskId:middle.id,sourceKey:shared.sources[0].id});
 const sharedAgain=await core.projectCommand({type:'projects.sources.add',projectId:project.id,expectedRevision:shared.revision,taskId:middle.id,reference:ref(copied,copied.sources[0].id)}),copiedAgain=await core.projectCommand({type:'projects.sources.use',projectId:project.id,expectedRevision:sharedAgain.revision,taskId:target.id,sourceKey:sharedAgain.sources.at(-1)!.id});
 const gate=hold();let signal:AbortSignal|undefined;
 const pending=core.runRequest({taskId:target.id,requestId:'transitive-consumer',kind:'create',prompt:'Synthetic transitive request',sourceIds:selected?[copiedAgain.sources[0].id]:[]},async ctx=>{signal=ctx.signal;gate.enter();await gate.wait;return output;});await gate.started;
 if(action==='refresh')await core.putSource(original.id,{...source,content:'Changed original'});else if(action==='revoke')await core.revokeSource(original.id,'source');else if(action==='redact')await core.redactSource(original.id,ref(original),[{start:8,end:25}]);else await core.deleteTask(original.id);
 const cancelled=selected||action!=='refresh';expect(signal?.aborted).toBe(cancelled);expect((await core.getTask(target.id)).sources[0].freshness).toBe('refresh-required');gate.release();expect((await pending).status).toBe(cancelled?'cancelled':'completed');expect((await core.getTask(target.id)).artifacts).toHaveLength(cancelled?0:1);
});
it('restoring a removed source still cancels prompt-only transport and refuses late publication',async()=>{
 const task=await prepared();await core.revokeSource(task.id,'source');const gate=hold();let signal:AbortSignal|undefined;
 const pending=core.runRequest({taskId:task.id,requestId:'restore-prompt-only',kind:'create',prompt:'Only this prompt',sourceIds:[]},async ctx=>{signal=ctx.signal;gate.enter();await gate.wait;return output;});await gate.started;await core.restoreSource(task.id,'source');expect(signal?.aborted).toBe(true);gate.release();expect((await pending).status).toBe('cancelled');expect((await core.getTask(task.id)).artifacts).toEqual([]);
});
it.each(['missing-capture','unknown-artifact','missing-artifact'] as const)('%s provenance remains conservative during an ordinary refresh',async missing=>{
 const task=await prepared(),gate=hold(),artifact=missing==='unknown-artifact'?await core.saveArtifact(task.id,{title:'UNKNOWN local text',content:'Unproven body',sourceRefs:[]}):undefined;let signal:AbortSignal|undefined;
 const pending=core.runRequest({taskId:task.id,requestId:'unknown-context',kind:'create',prompt:'Only this prompt',sourceIds:[]},async ctx=>{signal=ctx.signal;gate.enter();await gate.wait;return output;});await gate.started;
 // Deliberately damage only provenance after real admission to exercise legacy/UNKNOWN fail-closed handling.
 const owner=(core as unknown as {state:{tasks:Task[]}}).state.tasks.find(owner=>owner.id===task.id)!,record=owner.requests.at(-1)!;
 if(missing==='missing-capture')delete record.contextSourceRefs;
 else record.contextArtifactRefs=[{artifactId:artifact?.artifactId??'missing',revision:1,digest:artifact?.revision.digest??'a'.repeat(64)}];
 await core.putSource(task.id,{...source,content:'Ordinary refresh with unknown provenance'});expect(signal?.aborted).toBe(true);gate.release();expect((await pending).status).toBe('cancelled');expect((await core.getTask(task.id)).artifacts.some(artifact=>artifact.revisions.some(revision=>revision.content===output.content))).toBe(false);
});
it.each([true,false])('ordinary refresh persistence failure aborts selected=%s and prevents late output',async selected=>{
 const task=await prepared(),gate=hold();let signal:AbortSignal|undefined;
 const pending=core.runRequest({taskId:task.id,requestId:'ordinary-write-failure',kind:'create',prompt:'Pending ordinary response',sourceIds:selected?['source']:[]},async ctx=>{signal=ctx.signal;gate.enter();await gate.wait;return output;}),caught=pending.catch(()=>undefined);await gate.started;const begun=await readFile(join(directory,'tasks.json'),'utf8');
 vi.spyOn(fs,'rename').mockRejectedValueOnce(Object.assign(Error('Ordinary refresh disk failure'),{code:'EIO'}));await expect(core.putSource(task.id,{...source,content:'Must not persist'})).rejects.toThrow('Ordinary refresh disk failure');expect(signal?.aborted).toBe(true);expect(await readFile(join(directory,'tasks.json'),'utf8')).toBe(begun);gate.release();await caught;await core.close();core=await createCompanion({dataDir:directory});const reopened=await core.getTask(task.id);expect(reopened.sources[0].versions).toEqual(task.sources[0].versions);expect(reopened.artifacts).toEqual([]);expect(reopened.requests[0].status).toBe('interrupted');
});
it.each(['refresh','revoke','restore','redact-unrelated'] as const)('%s follows a captured artifact skill origin even when that artifact is excluded from outgoing history',async action=>{
 const owner=await prepared(),target=await core.createTask({title:'Explicit artifact skill dependency'}),skill=await core.saveInstructionSkill({taskId:owner.id,intentId:'artifact-skill-origin',name:'Artifact origin skill',description:'Synthetic',instructions:'Use the resource',resources:[ref(owner)]});await core.setInstructionSkill(target.id,0,skill.reference);
 if(action==='redact-unrelated')await core.putSource(owner.id,{...source,id:'unrelated'});
 const first=await core.runRequest({taskId:target.id,requestId:'artifact-skill-answer',kind:'create',prompt:'Create original answer',sourceIds:[],instructionSkill:skill.reference,instructionSkillRevision:1},async()=>output);await core.setInstructionSkill(target.id,1,null);if(action==='restore')await core.revokeSource(owner.id,'source');
 const original=(await core.getTask(target.id)).artifacts[0].revisions[0],basis={artifactId:first.artifactId!,revision:1,digest:original.digest},gate=hold();let signal:AbortSignal|undefined;
 const pending=core.runRequest({taskId:target.id,requestId:'captured-artifact-skill',kind:'experiment',prompt:'Bound to the original artifact',sourceIds:[],expectedArtifacts:[basis]},async ctx=>{signal=ctx.signal;expect(ctx.task.artifacts).toEqual([]);gate.enter();await gate.wait;return {title:'Late derived output',content:'DO_NOT_SAVE'};});await gate.started;
 const record=(await core.getTask(target.id)).requests.at(-1)!;expect(record.contextArtifactRefs).toEqual([basis]);expect(record.contextSkillRefs).toEqual([]);if(action==='refresh')await core.putSource(owner.id,{...source,content:'Changed pinned resource'});else if(action==='revoke')await core.revokeSource(owner.id,'source');else if(action==='restore')await core.restoreSource(owner.id,'source');else await core.redactSource(owner.id,ref(await core.getTask(owner.id),'unrelated'),[{start:8,end:25}]);const aborted=signal?.aborted;gate.release();const result=await pending;expect(aborted).toBe(true);expect(result.status).toBe('cancelled');expect((await core.getTask(target.id)).artifacts).toHaveLength(1);
});
