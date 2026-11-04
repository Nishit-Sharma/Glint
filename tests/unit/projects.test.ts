import {afterEach,expect,it} from 'vitest';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion,type RequestContext,type RequestOutput} from '../../src/core/companion';
import {buildMetaMessages} from '../../src/host/provider';
import {buildCodexInput} from '../../src/host/codex-provider';
import {readProjectCommand,projectInstructionsText,projectSourceInTask} from '../../src/shared/projects';
import {parseCurrentState} from '../../src/core/store';
import {LOCAL_CODE_MIME} from '../../src/shared/code-workspace';

const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0))await close();});
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'glint-projects-'));let core=await createCompanion({dataDir:directory});
 cleanup.push(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});
 return {directory,get core(){return core;},async reopen(){await core.close();core=await createCompanion({dataDir:directory});}};
}
it('creates and renames a project, moves a task and reopens its original sources, saved work and unsent message',async()=>{
 const f=await fixture(),task=await f.core.createTask({title:'Field trip'});
 await f.core.putSource(task.id,{kind:'text',label:'Visit guide',role:'fact',content:'Doors open at 18:00.'});
 await f.core.saveArtifact(task.id,{title:'Visit plan',content:'Arrive at 17:50.'});
 await f.core.saveComposerDraft(task.id,0,{kind:'create',text:'  PRIVATE_UNSENT\n'});
 const before=await f.core.getTask(task.id),project=await f.core.projectCommand({type:'projects.create',name:' Observatory '});
 const duplicate=await f.core.projectCommand({type:'projects.create',name:'OBSERVATORY'});expect(duplicate.id).toBe(project.id);
 const saved=await f.core.projectCommand({type:'projects.update',projectId:project.id,expectedRevision:1,name:'Night visits',instructions:'Keep timings in UTC.\nExplain uncertainties.'});
 await f.core.projectCommand({type:'projects.assign',taskId:task.id,projectId:project.id,expectedProjectId:null});
 await f.reopen();expect(await f.core.projectCommand({type:'projects.list'})).toEqual([saved]);
 const reopened=await f.core.getTask(task.id);expect(reopened).toEqual({...before,projectId:project.id,updatedAt:reopened.updatedAt,session:{...before.session!,revision:reopened.session!.revision}});
 const ungrouped=await f.core.projectCommand({type:'projects.assign',taskId:task.id,projectId:null,expectedProjectId:project.id});expect(ungrouped.projectId).toBeUndefined();expect(ungrouped.sources).toEqual(before.sources);
});
it('deletes a reviewed local project while keeping its member tasks and resolves the exact same deletion after restart',async()=>{
 const f=await fixture(),member=await f.core.createTask({title:'Synthetic retained member'}),outside=await f.core.createTask({title:'Unrelated retained task'}),project=await f.core.projectCommand({type:'projects.create',name:'Synthetic deletion C'});
 await f.core.projectCommand({type:'projects.assign',taskId:member.id,projectId:project.id,expectedProjectId:null});await f.core.projectCommand({type:'projects.pins.set',projectId:project.id,pinned:true,expectedRevision:0});
 await f.core.putSource(member.id,{kind:'text',label:'Retained source',content:'Keep this independent task content.',role:'fact'});await f.core.saveComposerDraft(member.id,0,{text:'UNSENT_KEEP_MEMBER',kind:'explain'});const before=await f.core.getTask(member.id);
 const review=await f.core.projectCommand({type:'projects.delete.preview',projectId:project.id}),command={type:'projects.delete' as const,intentId:'synthetic-keep-project-delete',projectId:project.id,expectedRevision:review.revision,expectedSnapshot:review.snapshot,mode:'keep-tasks' as const,members:review.members.map(({taskId,snapshot})=>({taskId,snapshot})),confirmed:'delete-local-project' as const};
 expect(review.members.map(item=>item.taskId)).toEqual([member.id]);expect(await f.core.projectCommand({type:'projects.list'})).toEqual([project]);
 const result=await f.core.projectCommand(command);expect(result).toMatchObject({kind:'deleted',projectId:project.id,mode:'keep-tasks',taskIds:[member.id]});expect(await f.core.projectCommand({type:'projects.list'})).toEqual([]);expect(await f.core.projectCommand({type:'projects.pins.get'})).toEqual({revision:2,projectIds:[]});
 const kept=await f.core.getTask(member.id);expect(kept.projectId).toBeUndefined();expect(kept.sources).toEqual(before.sources);expect(kept.session).toEqual(before.session);expect(await f.core.getTask(outside.id)).toEqual(outside);expect(await f.core.projectCommand(command)).toEqual(result);
 await f.reopen();expect(await f.core.projectCommand(command)).toEqual(result);expect((await f.core.getTask(member.id)).sources).toEqual(before.sources);await expect(f.core.projectCommand({...command,mode:'delete-tasks'})).rejects.toThrow('different');
});
it('atomically deletes only the exact reviewed members, preserves independent copies and all earlier request claims',async()=>{
 const f=await fixture(),intake={intentId:'synthetic-original-intake',kind:'text' as const,title:'Synthetic C owner',content:'Original synthetic source.'},started=await f.core.startLocalTask(intake,'synthetic-bot'),owner=started.task,member=await f.core.createTask({title:'Synthetic C member'}),outside=await f.core.createTask({title:'Independent outside copy'}),project=await f.core.projectCommand({type:'projects.create',name:'Synthetic destructive C'}),other=await f.core.projectCommand({type:'projects.create',name:'Keep this other project'});
 for(const task of [owner,member,outside])await f.core.projectCommand({type:'projects.assign',taskId:task.id,projectId:project.id,expectedProjectId:null});
 const source=owner.sources[0],shared=await f.core.projectCommand({type:'projects.sources.add',projectId:project.id,expectedRevision:1,taskId:owner.id,reference:{sourceId:source.id,version:1,digest:source.versions[0].digest}});await f.core.projectCommand({type:'projects.sources.use',projectId:project.id,expectedRevision:shared.revision,sourceKey:shared.sources[0].id,taskId:outside.id});await f.core.projectCommand({type:'projects.assign',taskId:outside.id,projectId:other.id,expectedProjectId:project.id});
 await f.core.runRequest({taskId:owner.id,requestId:'synthetic-deleted-request',kind:'explain',prompt:'Synthetic saved history.'},async()=>({title:'Synthetic answer',content:'Keep its request claim.'}));const kept=await f.core.getTask(outside.id),memory=await f.core.getUserMemory(),before=JSON.parse(await readFile(join(f.directory,'tasks.json'),'utf8'));
 const originalFile=join(f.directory,'original-file.txt');await writeFile(originalFile,'Original disk bytes stay.');
 const review=await f.core.projectCommand({type:'projects.delete.preview',projectId:project.id}),command={type:'projects.delete' as const,intentId:'i'.repeat(200),projectId:project.id,expectedRevision:review.revision,expectedSnapshot:review.snapshot,mode:'delete-tasks' as const,members:review.members.map(({taskId,snapshot})=>({taskId,snapshot})),confirmed:'delete-local-project' as const},result=await f.core.projectCommand(command);
 expect([...result.taskIds].sort()).toEqual([owner.id,member.id].sort());const retained=await f.core.getTask(outside.id);expect(retained.sources[0].versions).toEqual(kept.sources[0].versions);expect(retained.sources[0].freshness).toBe('refresh-required');expect(retained.sources[0].projectOrigin).toEqual(kept.sources[0].projectOrigin);expect(await f.core.projectCommand({type:'projects.list'})).toEqual([other]);expect(await f.core.getUserMemory()).toEqual(memory);expect(await readFile(originalFile,'utf8')).toBe('Original disk bytes stay.');
 const after=JSON.parse(await readFile(join(f.directory,'tasks.json'),'utf8'));for(const claim of before.usedRequestIds)expect(after.usedRequestIds).toContain(claim);
 await expect(f.core.startLocalTask(intake,'synthetic-bot')).rejects.toThrow('no longer available');await expect(f.core.runRequest({taskId:outside.id,requestId:'synthetic-deleted-request',kind:'explain',prompt:'Synthetic saved history.'},async()=>({title:'Never',content:'Never'}))).rejects.toThrow('already used');
 expect(await f.core.projectCommand(command)).toEqual(result);await f.reopen();expect(await f.core.projectCommand(command)).toEqual(result);expect((await f.core.getTask(outside.id)).sources).toEqual(retained.sources);
});
it.each(['project','membership','member-draft','project-memory','source'] as const)('rejects a changed %s before deleting any reviewed project data',async scenario=>{
 const f=await fixture(),task=await f.core.createTask({title:'Synthetic reviewed member'}),project=await f.core.projectCommand({type:'projects.create',name:'Synthetic stale C'});await f.core.projectCommand({type:'projects.assign',taskId:task.id,projectId:project.id,expectedProjectId:null});
 const review=await f.core.projectCommand({type:'projects.delete.preview',projectId:project.id}),command={type:'projects.delete' as const,intentId:'synthetic-stale-'+scenario,projectId:project.id,expectedRevision:review.revision,expectedSnapshot:review.snapshot,mode:'delete-tasks' as const,members:review.members.map(({taskId,snapshot})=>({taskId,snapshot})),confirmed:'delete-local-project' as const};
 if(scenario==='project')await f.core.projectCommand({type:'projects.update',projectId:project.id,expectedRevision:1,name:'New project name',instructions:''});
 if(scenario==='membership'){const extra=await f.core.createTask({title:'New member after review'});await f.core.projectCommand({type:'projects.assign',taskId:extra.id,projectId:project.id,expectedProjectId:null});}
 if(scenario==='member-draft')await f.core.saveComposerDraft(task.id,0,{text:'New unsent message after review.',kind:'explain'});
 if(scenario==='project-memory')await f.core.projectCommand({type:'projects.memory.change',projectId:project.id,expectedRevision:0,change:{kind:'save',text:'SYNTHETIC_NEW_PROJECT_FACT',topics:[]}});
 if(scenario==='source')await f.core.putSource(task.id,{kind:'text',label:'New source after review',content:'Keep new evidence.',role:'fact'});
 const bytes=await readFile(join(f.directory,'tasks.json'),'utf8');await expect(f.core.projectCommand(command)).rejects.toThrow('changed');expect(await readFile(join(f.directory,'tasks.json'),'utf8')).toBe(bytes);
 expect(()=>readProjectCommand({...command,members:[...command.members,...command.members]})).toThrow();expect(()=>readProjectCommand({...command,approved:true})).toThrow();
});
it.each(['linked-code','uncertain-browser','executing-browser','running-browser'] as const)('keeps %s outcomes inspectable by blocking member deletion while allowing project-only deletion',async scenario=>{
 const f=await fixture(),task=await f.core.createTask({title:'Synthetic guarded member'}),project=await f.core.projectCommand({type:'projects.create',name:'Synthetic guarded C'});await f.core.projectCommand({type:'projects.assign',taskId:task.id,projectId:project.id,expectedProjectId:null});let finish:((value:RequestOutput)=>void)|undefined,pending:Promise<unknown>|undefined;
 if(scenario==='linked-code'){const saved=await f.core.saveArtifact(task.id,{title:'Linked file',content:'First linked bytes.',mimeType:LOCAL_CODE_MIME});await f.core.saveArtifact(task.id,{artifactId:saved.artifactId,expectedRevision:1,title:'Later plain version',content:'The historical linked receipt must stay.',mimeType:'text/plain'});}
 else if(scenario==='running-browser'){let entered!:()=>void;const ready=new Promise<void>(done=>entered=done);pending=f.core.runRequest({taskId:task.id,requestId:'synthetic-running-browser',kind:'browser',prompt:'Synthetic held browser request.'},async()=>{entered();return new Promise(done=>finish=done);});await ready;}
 else{const observation={id:'observation',taskId:task.id,browserId:'synthetic-browser',documentId:'synthetic-document',url:'https://owned.invalid',title:'Synthetic page',text:'Synthetic observation',digest:'synthetic-digest',targets:[]};await f.core.replaceSession(task.id,0,{revision:0,draft:'',moduleStates:[],runs:[{id:'run',endpointKey:'synthetic-route',origin:'https://owned.invalid',browserId:'synthetic-browser',initialObservation:observation,operations:[{id:'operation',intent:{kind:'click',snapshotId:'observation',targetId:'target'},status:scenario==='uncertain-browser'?'uncertain':'executing',reason:'Synthetic unresolved action.'}]}]});}
 const review=await f.core.projectCommand({type:'projects.delete.preview',projectId:project.id}),command={type:'projects.delete' as const,intentId:'synthetic-guard-'+scenario,projectId:project.id,expectedRevision:review.revision,expectedSnapshot:review.snapshot,mode:'delete-tasks' as const,members:review.members.map(({taskId,snapshot})=>({taskId,snapshot})),confirmed:'delete-local-project' as const};expect(review.members[0].blocker).toBeTruthy();const bytes=await readFile(join(f.directory,'tasks.json'),'utf8');await expect(f.core.projectCommand(command)).rejects.toThrow();expect(await readFile(join(f.directory,'tasks.json'),'utf8')).toBe(bytes);
 await f.core.projectCommand({...command,mode:'keep-tasks'});expect((await f.core.getTask(task.id)).projectId).toBeUndefined();if(finish){finish({title:'Stopped synthetic browser',content:'Not committed.'});await pending;}
});
it('copies exact pinned project sources only on opted-in joins without backfilling existing members',async()=>{
 const f=await fixture(),owner=await f.core.createTask({title:'Shared source owner'}),existing=await f.core.createTask({title:'Existing member'}),joining=await f.core.createTask({title:'New member'}),project=await f.core.projectCommand({type:'projects.create',name:'Shared context'});
 for(const task of [owner,existing])await f.core.projectCommand({type:'projects.assign',taskId:task.id,projectId:project.id,expectedProjectId:null});
 const sourced=await f.core.putSource(owner.id,{kind:'text',label:'Pinned guide',role:'style',content:'PINNED_V1: use a short explanation.'}),source=sourced.sources[0],reference={sourceId:source.id,version:1,digest:source.versions[0].digest};
 const shared=await f.core.projectCommand({type:'projects.sources.add',projectId:project.id,expectedRevision:1,taskId:owner.id,reference}),before=await f.core.getTask(existing.id);
 await f.core.saveComposerDraft(joining.id,0,{text:'  Preserve this unsent message.\n',kind:'create'});
 const on=await f.core.projectCommand({type:'projects.update',projectId:project.id,expectedRevision:shared.revision,name:project.name,instructions:'',addSharedSourcesOnJoin:true,expectedAddSharedSourcesOnJoin:false});
 expect(on.revision).toBe(shared.revision);expect(await f.core.getTask(existing.id)).toEqual(before);
 const saved=await f.core.projectCommand({type:'projects.assign',taskId:joining.id,projectId:project.id,expectedProjectId:null,expectedProjectRevision:on.revision,expectedAddSharedSourcesOnJoin:true});
 expect(saved.sources).toHaveLength(1);expect(saved.sources[0].versions[0]).toMatchObject({kind:'text',label:'Pinned guide',role:'style',content:'PINNED_V1: use a short explanation.'});expect(saved.sources[0].projectOrigin).toMatchObject({projectId:project.id,sourceKey:shared.sources[0].id,taskId:owner.id,reference});expect(saved.session?.draft).toBe('  Preserve this unsent message.\n');
 let selected!:RequestContext;await f.core.runRequest({taskId:joining.id,requestId:'local-shared-context-only',kind:'explain',prompt:'Controlled local source-selection fixture.'},async context=>{selected=context;return {title:'Local fixture',content:'No provider was called.'};});expect(selected.sourceRefs).toEqual([{sourceId:saved.sources[0].id,version:1,digest:saved.sources[0].versions[0].digest}]);expect(selected.task.sources[0].versions[0].content).toBe('PINNED_V1: use a short explanation.');
 await f.reopen();expect((await f.core.getTask(joining.id)).sources).toEqual(saved.sources);expect((await f.core.projectCommand({type:'projects.list'}))[0].addSharedSourcesOnJoin).toBe(true);
});
it('keeps a member response and memory lease current on flag-only saves and preserves the flag for old update callers',async()=>{
 const f=await fixture(),task=await f.core.createTask({title:'Existing member'}),project=await f.core.projectCommand({type:'projects.create',name:'Project'});await f.core.projectCommand({type:'projects.assign',taskId:task.id,projectId:project.id,expectedProjectId:null});
 const lease=await f.core.leaseUserMemory(task.id,'Explain');let context!:RequestContext,entered!:()=>void,finish!:(output:RequestOutput)=>void;const ready=new Promise<void>(done=>entered=done),pending=f.core.runRequest({taskId:task.id,requestId:'join-setting-only',kind:'create',prompt:'Controlled pending work.'},async value=>{context=value;entered();return new Promise(done=>finish=done);});await ready;const before=await f.core.getTask(task.id);
 const on=await f.core.projectCommand({type:'projects.update',projectId:project.id,expectedRevision:1,name:project.name,instructions:'',addSharedSourcesOnJoin:true,expectedAddSharedSourcesOnJoin:false});expect(on.revision).toBe(1);expect(context.signal.aborted).toBe(false);expect(()=>lease.assertCurrent()).not.toThrow();expect(await f.core.getTask(task.id)).toEqual(before);
 await expect(f.core.projectCommand({type:'projects.update',projectId:project.id,expectedRevision:1,name:project.name,instructions:'',addSharedSourcesOnJoin:false,expectedAddSharedSourcesOnJoin:false})).rejects.toMatchObject({code:'conflict'});
 finish({title:'Original work',content:'Still current.'});expect((await pending).status).toBe('completed');
 const renamed=await f.core.projectCommand({type:'projects.update',projectId:project.id,expectedRevision:1,name:'Renamed',instructions:''});expect(renamed.addSharedSourcesOnJoin).toBe(true);expect(renamed.revision).toBe(2);
});
it('keeps old, edited and stale originals or project copies on rejoin while new joins get the newly pinned shared version',async()=>{
 const f=await fixture(),owner=await f.core.createTask({title:'Owner'}),first=await f.core.createTask({title:'First'}),second=await f.core.createTask({title:'Second'}),third=await f.core.createTask({title:'Third'}),project=await f.core.projectCommand({type:'projects.create',name:'Pinned context'});await f.core.projectCommand({type:'projects.assign',taskId:owner.id,projectId:project.id,expectedProjectId:null});
 const original=await f.core.putSource(owner.id,{kind:'text',label:'Guide',role:'style',content:'SHARED_V1'}),source=original.sources[0],v1={sourceId:source.id,version:1,digest:source.versions[0].digest};let shared=await f.core.projectCommand({type:'projects.sources.add',projectId:project.id,expectedRevision:1,taskId:owner.id,reference:v1});
 await f.core.projectCommand({type:'projects.update',projectId:project.id,expectedRevision:shared.revision,name:project.name,instructions:'',addSharedSourcesOnJoin:true,expectedAddSharedSourcesOnJoin:false});
 await f.core.saveComposerDraft(first.id,0,{text:'PRIVATE_JOIN_DRAFT',kind:'create'});const before=await f.core.getTask(first.id),route={origin:'https://owned.invalid',url:'https://owned.invalid/stays',requestId:'prior-browser'};await f.core.replaceSession(first.id,before.session!.revision,{...before.session!,browserContext:route});
 const joined=await f.core.projectCommand({type:'projects.assign',taskId:first.id,projectId:project.id,expectedProjectId:null,expectedProjectRevision:shared.revision,expectedAddSharedSourcesOnJoin:true});expect(joined.session?.browserContext).toEqual(route);expect(joined.session?.draft).toBe('PRIVATE_JOIN_DRAFT');
 const updated=await f.core.putSource(owner.id,{id:source.id,kind:'text',label:'Guide',role:'inspiration',content:'SHARED_V2'}),v2={sourceId:source.id,version:2,digest:updated.sources[0].versions[1].digest};
 await expect(f.core.projectCommand({type:'projects.assign',taskId:second.id,projectId:project.id,expectedProjectId:null,expectedProjectRevision:shared.revision,expectedAddSharedSourcesOnJoin:true})).rejects.toThrow('unavailable');expect((await f.core.getTask(first.id)).sources[0]).toMatchObject({freshness:'refresh-required',versions:joined.sources[0].versions});
 shared=await f.core.projectCommand({type:'projects.sources.update',projectId:project.id,expectedRevision:shared.revision,sourceKey:shared.sources[0].id,taskId:owner.id,expectedReference:v1,reference:v2});
 const newest=await f.core.projectCommand({type:'projects.assign',taskId:third.id,projectId:project.id,expectedProjectId:null,expectedProjectRevision:shared.revision,expectedAddSharedSourcesOnJoin:true});expect(newest.sources[0].versions[0]).toMatchObject({content:'SHARED_V2',role:'inspiration'});expect((await f.core.getTask(second.id)).sources).toEqual([]);
 await f.core.putSource(first.id,{id:joined.sources[0].id,kind:'text',label:'Local edit',role:'fact',content:'KEEP_LOCAL_EDIT'});await f.core.invalidateSource(first.id,joined.sources[0].id,'Keep the explicit stale marker.');await f.core.projectCommand({type:'projects.assign',taskId:first.id,projectId:null,expectedProjectId:project.id});const kept=await f.core.getTask(first.id);
 const rejoined=await f.core.projectCommand({type:'projects.assign',taskId:first.id,projectId:project.id,expectedProjectId:null,expectedProjectRevision:shared.revision,expectedAddSharedSourcesOnJoin:true});expect(rejoined.sources).toEqual(kept.sources);expect(rejoined.sources).toHaveLength(1);expect(rejoined.sources[0].projectOrigin?.reference).toEqual(v1);
 await f.core.invalidateSource(owner.id,source.id,'Owner is stale.');await f.core.projectCommand({type:'projects.assign',taskId:owner.id,projectId:null,expectedProjectId:project.id});const ownerSources=(await f.core.getTask(owner.id)).sources;const ownerRejoined=await f.core.projectCommand({type:'projects.assign',taskId:owner.id,projectId:project.id,expectedProjectId:null,expectedProjectRevision:shared.revision,expectedAddSharedSourcesOnJoin:true});expect(ownerRejoined.sources).toEqual(ownerSources);
});
it('binds bulk joins to reviewed setting and source versions and rejects needed stale or unavailable copies atomically',async()=>{
 const f=await fixture(),owner=await f.core.createTask({title:'Owner'}),a=await f.core.createTask({title:'First joining task'}),b=await f.core.createTask({title:'Second joining task'}),project=await f.core.projectCommand({type:'projects.create',name:'Bulk knowledge'});await f.core.projectCommand({type:'projects.assign',taskId:owner.id,projectId:project.id,expectedProjectId:null});
 const original=await f.core.putSource(owner.id,{kind:'text',label:'First shared',role:'fact',content:'FIRST_PINNED'}),source=original.sources[0];let shared=await f.core.projectCommand({type:'projects.sources.add',projectId:project.id,expectedRevision:1,taskId:owner.id,reference:{sourceId:source.id,version:1,digest:source.versions[0].digest}});
 await f.core.projectCommand({type:'projects.update',projectId:project.id,expectedRevision:shared.revision,name:project.name,instructions:'',addSharedSourcesOnJoin:true,expectedAddSharedSourcesOnJoin:false});
 const before=await Promise.all([a,b].map(task=>f.core.getTask(task.id))),tasks=[{taskId:a.id,expectedProjectId:null},{taskId:b.id,expectedProjectId:null}],reviewed={type:'projects.assign.bulk' as const,projectId:project.id,tasks,expectedProjectRevision:shared.revision,expectedAddSharedSourcesOnJoin:true};
 await expect(f.core.projectCommand({type:'projects.assign',taskId:a.id,projectId:project.id,expectedProjectId:null})).rejects.toMatchObject({code:'conflict'});await expect(f.core.projectCommand({type:'projects.assign.bulk',projectId:project.id,tasks})).rejects.toMatchObject({code:'conflict'});expect(await Promise.all([a,b].map(task=>f.core.getTask(task.id)))).toEqual(before);
 const next=await f.core.putSource(owner.id,{kind:'text',label:'Second shared',role:'style',content:'SECOND_PINNED'}),second=next.sources[1];shared=await f.core.projectCommand({type:'projects.sources.add',projectId:project.id,expectedRevision:shared.revision,taskId:owner.id,reference:{sourceId:second.id,version:1,digest:second.versions[0].digest}});
 await expect(f.core.projectCommand(reviewed)).rejects.toMatchObject({code:'conflict'});const current={...reviewed,expectedProjectRevision:shared.revision};
 await f.core.projectCommand({type:'projects.update',projectId:project.id,expectedRevision:shared.revision,name:project.name,instructions:'',addSharedSourcesOnJoin:false,expectedAddSharedSourcesOnJoin:true});await expect(f.core.projectCommand(current)).rejects.toMatchObject({code:'conflict'});
 await f.core.projectCommand({type:'projects.update',projectId:project.id,expectedRevision:shared.revision,name:project.name,instructions:'',addSharedSourcesOnJoin:true,expectedAddSharedSourcesOnJoin:false});await expect(f.core.projectCommand({...current,expectedAddSharedSourcesOnJoin:false})).rejects.toMatchObject({code:'conflict'});
 await f.core.invalidateSource(owner.id,second.id,'Review before copying.');await expect(f.core.projectCommand(current)).rejects.toMatchObject({code:'conflict'});expect(await Promise.all([a,b].map(task=>f.core.getTask(task.id)))).toEqual(before);
 const refreshed=await f.core.putSource(owner.id,{id:second.id,kind:'text',label:'Second shared',role:'style',content:'NEWER_NOT_PINNED'});await expect(f.core.projectCommand(current)).rejects.toThrow('unavailable');const repinned=await f.core.projectCommand({type:'projects.sources.update',projectId:project.id,expectedRevision:shared.revision,sourceKey:shared.sources[1].id,taskId:owner.id,expectedReference:shared.sources[1].reference,reference:{sourceId:second.id,version:2,digest:refreshed.sources[1].versions[1].digest}});const latest={...current,expectedProjectRevision:repinned.revision};const joined=await f.core.projectCommand(latest);for(const task of joined)expect(task.sources.map(source=>source.versions[0].content)).toEqual(['FIRST_PINNED','NEWER_NOT_PINNED']);expect(await f.core.projectCommand(latest)).toEqual(joined);
 await f.core.deleteTask(owner.id);const c=await f.core.createTask({title:'Unavailable first'}),d=await f.core.createTask({title:'Unavailable second'}),unavailable=await Promise.all([c,d].map(task=>f.core.getTask(task.id)));await expect(f.core.projectCommand({...current,tasks:[{taskId:c.id,expectedProjectId:null},{taskId:d.id,expectedProjectId:null}]})).rejects.toMatchObject({code:'conflict'});expect(await Promise.all([c,d].map(task=>f.core.getTask(task.id)))).toEqual(unavailable);
});
it('moves an exact selected task set together and reopens its saved work, drafts and browser routes',async()=>{
 const f=await fixture(),a=await f.core.createTask({title:'First conversation'}),b=await f.core.createTask({title:'Second conversation'}),other=await f.core.createTask({title:'Unrelated conversation'});
 const source=await f.core.projectCommand({type:'projects.create',name:'Original project'}),destination=await f.core.projectCommand({type:'projects.create',name:'Destination project'});
 await f.core.projectCommand({type:'projects.assign',taskId:a.id,projectId:source.id,expectedProjectId:null});
 await f.core.projectCommand({type:'projects.update',projectId:source.id,expectedRevision:1,name:source.name,instructions:'Original project guidance.'});
 await f.core.projectCommand({type:'projects.update',projectId:destination.id,expectedRevision:1,name:destination.name,instructions:'Destination guidance.'});
 for(const task of [a,b]){
  await f.core.putSource(task.id,{kind:'text',label:'Saved source',role:'fact',content:task.title+' source.'});
  await f.core.saveArtifact(task.id,{title:'Saved document',content:task.title+' document.'});
  await f.core.saveComposerDraft(task.id,0,{text:'  '+task.title+' unsent\n',kind:'create'});
  const current=await f.core.getTask(task.id);await f.core.replaceSession(task.id,current.session!.revision,{...current.session!,browserContext:{origin:'https://owned.invalid',url:'https://owned.invalid/'+task.id,requestId:'prior-'+task.id}});
 }
 const before=await Promise.all([a,b].map(task=>f.core.getTask(task.id))),unchanged=await f.core.getTask(other.id),projects=await f.core.projectCommand({type:'projects.list'});
 const command={type:'projects.assign.bulk' as const,projectId:destination.id,tasks:[{taskId:a.id,expectedProjectId:source.id},{taskId:b.id,expectedProjectId:null}]},saved=await f.core.projectCommand(command);
 expect(saved).toHaveLength(2);for(let index=0;index<before.length;index++)expect(saved[index]).toEqual({...before[index],projectId:destination.id,updatedAt:saved[index].updatedAt});
 expect(await f.core.projectCommand(command)).toEqual(saved);expect(await f.core.getTask(other.id)).toEqual(unchanged);expect(await f.core.projectCommand({type:'projects.list'})).toEqual(projects);
 await f.reopen();for(const task of saved)expect(await f.core.getTask(task.id)).toEqual({...task,session:{...task.session!,revision:task.session!.revision+1}});
 expect(await f.core.projectCommand({type:'projects.list'})).toEqual(projects);
});
it('rejects missing or stale bulk members without partial moves or saved-byte changes',async()=>{
 const f=await fixture(),a=await f.core.createTask({title:'First'}),b=await f.core.createTask({title:'Second'}),source=await f.core.projectCommand({type:'projects.create',name:'Source'}),destination=await f.core.projectCommand({type:'projects.create',name:'Destination'});
 for(const task of [a,b])await f.core.projectCommand({type:'projects.assign',taskId:task.id,projectId:source.id,expectedProjectId:null});
 const command={type:'projects.assign.bulk' as const,projectId:destination.id,tasks:[{taskId:a.id,expectedProjectId:source.id},{taskId:b.id,expectedProjectId:source.id}]},before=await f.core.listTasks(),bytes=await readFile(join(f.directory,'tasks.json'),'utf8');
 for(const entry of [{command:{...command,tasks:[command.tasks[0],{taskId:'missing',expectedProjectId:null}]},code:'not-found'},{command:{...command,tasks:[command.tasks[0],{taskId:b.id,expectedProjectId:null}]},code:'conflict'},{command:{...command,projectId:'missing'},code:'not-found'}]){
  await expect(f.core.projectCommand(entry.command)).rejects.toMatchObject({code:entry.code});expect(await f.core.listTasks()).toEqual(before);expect(await readFile(join(f.directory,'tasks.json'),'utf8')).toBe(bytes);
 }
 for(const invalid of [{...command,tasks:[]},{...command,tasks:[command.tasks[0],command.tasks[0]]},{...command,tasks:[{taskId:a.id}]},{...command,extra:true},{...command,tasks:[{...command.tasks[0],extra:true}]}])expect(()=>readProjectCommand(invalid)).toThrow();
 await f.core.projectCommand({type:'projects.assign',taskId:b.id,projectId:destination.id,expectedProjectId:source.id});const mixed=await f.core.listTasks();
 await expect(f.core.projectCommand(command)).rejects.toMatchObject({code:'conflict'});expect(await f.core.listTasks()).toEqual(mixed);
});
it.each([[0,2],[1,3]])('cancels only actually moved task responses after a successful atomic bulk move (%s, %s)',async(movedIndex,retainedIndex)=>{
 const f=await fixture(),a=await f.core.createTask({title:'Move first'}),b=await f.core.createTask({title:'Move second'}),same=await f.core.createTask({title:'Already there'}),other=await f.core.createTask({title:'Unrelated'}),source=await f.core.projectCommand({type:'projects.create',name:'Source'}),destination=await f.core.projectCommand({type:'projects.create',name:'Destination'});
 for(const task of [a,b,other])await f.core.projectCommand({type:'projects.assign',taskId:task.id,projectId:source.id,expectedProjectId:null});
 await f.core.projectCommand({type:'projects.assign',taskId:same.id,projectId:destination.id,expectedProjectId:null});
 const all=[a,b,same,other],contexts=new Map<string,RequestContext>(),finishes=new Map<string,(output:RequestOutput)=>void>(),ready:Promise<void>[]=[];
 const running=[all[movedIndex],all[retainedIndex]],pending=running.map(task=>{let entered!:()=>void;ready.push(new Promise<void>(done=>entered=done));return f.core.runRequest({taskId:task.id,requestId:'bulk-'+task.id,kind:'create',prompt:'Controlled pending response.'},async context=>{contexts.set(task.id,context);entered();return new Promise<RequestOutput>(done=>finishes.set(task.id,done));});});await Promise.all(ready);
 const command={type:'projects.assign.bulk' as const,projectId:destination.id,tasks:[{taskId:a.id,expectedProjectId:source.id},{taskId:b.id,expectedProjectId:source.id},{taskId:same.id,expectedProjectId:destination.id}]},before=await f.core.listTasks();
 await expect(f.core.projectCommand({...command,tasks:[command.tasks[0],{taskId:b.id,expectedProjectId:null}]})).rejects.toMatchObject({code:'conflict'});
 expect(await f.core.listTasks()).toEqual(before);for(const task of running)expect(contexts.get(task.id)!.signal.aborted).toBe(false);
 await f.core.projectCommand(command);expect(contexts.get(all[movedIndex].id)!.signal.aborted).toBe(true);
 for(const task of [same,other]){if(contexts.has(task.id))expect(contexts.get(task.id)!.signal.aborted).toBe(false);expect(await f.core.getTask(task.id)).toEqual(before.find(item=>item.id===task.id));}
 for(const task of running)finishes.get(task.id)!({title:'Controlled result',content:'Original response.'});expect((await Promise.all(pending)).map(request=>request.status)).toEqual(['cancelled','completed']);
});
it('stars and unstars a project across reopen without changing its saved content or task',async()=>{
 const f=await fixture(),task=await f.core.createTask({title:'Visit checklist'}),project=await f.core.projectCommand({type:'projects.create',name:'Observatory'});
 await f.core.projectCommand({type:'projects.assign',taskId:task.id,projectId:project.id,expectedProjectId:null});
 await f.core.putSource(task.id,{kind:'text',label:'Visit guide',role:'fact',content:'Doors open at 18:00.'});
 await f.core.saveArtifact(task.id,{title:'Plan',content:'Arrive at 17:50.'});
 await f.core.saveComposerDraft(task.id,0,{text:'  Keep this unsent message.\n',kind:'create'});
 const before=await f.core.getTask(task.id);
 expect(await f.core.projectCommand({type:'projects.pins.get'})).toEqual({revision:0,projectIds:[]});
 const pinned=await f.core.projectCommand({type:'projects.pins.set',projectId:project.id,pinned:true,expectedRevision:0});
 expect(pinned).toEqual({revision:1,projectIds:[project.id]});
 expect(await f.core.getTask(task.id)).toEqual(before);
 await f.reopen();expect(await f.core.projectCommand({type:'projects.pins.get'})).toEqual(pinned);
 const reopened={...before,session:{...before.session!,revision:before.session!.revision+1}};
 expect(await f.core.projectCommand({type:'projects.list'})).toEqual([project]);expect(await f.core.getTask(task.id)).toEqual(reopened);
 expect(await f.core.projectCommand({type:'projects.pins.set',projectId:project.id,pinned:false,expectedRevision:1})).toEqual({revision:2,projectIds:[]});
 expect(await f.core.getTask(task.id)).toEqual(reopened);
 await f.reopen();expect(await f.core.projectCommand({type:'projects.pins.get'})).toEqual({revision:2,projectIds:[]});
 expect(await f.core.projectCommand({type:'projects.list'})).toEqual([project]);expect(await f.core.getTask(task.id)).toEqual({...before,session:{...before.session!,revision:before.session!.revision+2}});
});
it('keeps project stars idempotent and refuses stale choices, missing projects and invalid metadata',async()=>{
 const f=await fixture(),a=await f.core.projectCommand({type:'projects.create',name:'One'}),b=await f.core.projectCommand({type:'projects.create',name:'Two'});
 const command={type:'projects.pins.set' as const,projectId:a.id,pinned:true,expectedRevision:0},pinned=await f.core.projectCommand(command);
 expect(await f.core.projectCommand(command)).toEqual(pinned);
 await expect(f.core.projectCommand({...command,projectId:b.id})).rejects.toThrow('Project stars changed');
 await expect(f.core.projectCommand({...command,pinned:false})).rejects.toThrow('Project stars changed');
 await expect(f.core.projectCommand({...command,projectId:'missing',pinned:false,expectedRevision:1})).rejects.toMatchObject({code:'not-found'});
 expect(await f.core.projectCommand({type:'projects.pins.get'})).toEqual(pinned);
 for(const value of [{...command,expectedRevision:-1},{...command,pinned:'yes'},{...command,accessFiles:true},{type:'projects.pins.get',extra:true}])expect(()=>readProjectCommand(value)).toThrow();
 const state={schemaVersion:2,tasks:[],usedRequestIds:[],projects:[a,b],projectPins:pinned};expect(parseCurrentState(state).projectPins).toEqual(pinned);
 for(const projectPins of [{revision:1,projectIds:[a.id,a.id]},{revision:1,projectIds:['missing']},{revision:Number.MAX_SAFE_INTEGER+1,projectIds:[]},{revision:1,projectIds:[a.id],extra:true}])expect(()=>parseCurrentState({...state,projectPins})).toThrow();
});
it('reopens collapsed and expanded Projects without changing stars, project content or the unsent message',async()=>{
 const f=await fixture(),task=await f.core.createTask({title:'Current task'}),project=await f.core.projectCommand({type:'projects.create',name:'Starred project'});
 await f.core.projectCommand({type:'projects.assign',taskId:task.id,projectId:project.id,expectedProjectId:null});
 await f.core.saveComposerDraft(task.id,0,{text:'  Preserve this unsent draft.\n',kind:'create'});
 const pins=await f.core.projectCommand({type:'projects.pins.set',projectId:project.id,pinned:true,expectedRevision:0}),before=await f.core.getTask(task.id);
 expect(await f.core.projectCommand({type:'projects.sidebar.get'})).toEqual({revision:0,collapsed:false});
 expect(await f.core.projectCommand({type:'projects.sidebar.set',collapsed:true,expectedRevision:0})).toEqual({revision:1,collapsed:true});
 expect(await f.core.getTask(task.id)).toEqual(before);
 await f.reopen();expect(await f.core.projectCommand({type:'projects.sidebar.get'})).toEqual({revision:1,collapsed:true});
 const reopened={...before,session:{...before.session!,revision:before.session!.revision+1}};expect(await f.core.getTask(task.id)).toEqual(reopened);
 expect(await f.core.projectCommand({type:'projects.sidebar.set',collapsed:false,expectedRevision:1})).toEqual({revision:2,collapsed:false});
 expect(await f.core.getTask(task.id)).toEqual(reopened);
 await f.reopen();expect(await f.core.projectCommand({type:'projects.sidebar.get'})).toEqual({revision:2,collapsed:false});
 expect(await f.core.getTask(task.id)).toEqual({...before,session:{...before.session!,revision:before.session!.revision+2}});
 expect(await f.core.projectCommand({type:'projects.pins.get'})).toEqual(pins);expect(await f.core.projectCommand({type:'projects.list'})).toEqual([project]);
});
it('keeps repeated Projects visibility choices idempotent and rejects stale or invalid changes',async()=>{
 const f=await fixture(),command={type:'projects.sidebar.set' as const,collapsed:true,expectedRevision:0},collapsed=await f.core.projectCommand(command);
 expect(await f.core.projectCommand(command)).toEqual(collapsed);
 await expect(f.core.projectCommand({...command,collapsed:false})).rejects.toMatchObject({code:'conflict'});
 expect(await f.core.projectCommand({type:'projects.sidebar.get'})).toEqual({revision:1,collapsed:true});
 expect(await f.core.projectCommand({...command,collapsed:false,expectedRevision:1})).toEqual({revision:2,collapsed:false});
 for(const value of [{...command,collapsed:'yes'},{...command,expectedRevision:-1},{...command,extra:true},{type:'projects.sidebar.get',extra:true}])expect(()=>readProjectCommand(value)).toThrow();
 const state={schemaVersion:2,tasks:[],usedRequestIds:[],projectSidebar:{revision:2,collapsed:false}};expect(parseCurrentState(state).projectSidebar).toEqual({revision:2,collapsed:false});
 for(const projectSidebar of [{revision:-1,collapsed:false},{revision:0,collapsed:'yes'},{revision:0,collapsed:false,extra:true}])expect(()=>parseCurrentState({...state,projectSidebar})).toThrow();
});
it('keeps a pending response current through project star and unstar changes',async()=>{
 const f=await fixture(),task=await f.core.createTask({title:'Owned task'}),project=await f.core.projectCommand({type:'projects.create',name:'Project'});
 await f.core.projectCommand({type:'projects.assign',taskId:task.id,projectId:project.id,expectedProjectId:null});
 let context!:RequestContext,entered!:()=>void,finish!:(output:RequestOutput)=>void;const ready=new Promise<void>(done=>entered=done),pending=f.core.runRequest({taskId:task.id,requestId:'star-pending',kind:'create',prompt:'Keep the original response.'},async ctx=>{context=ctx;entered();return new Promise(done=>finish=done);});await ready;
 const before=await f.core.getTask(task.id);
 await f.core.projectCommand({type:'projects.pins.set',projectId:project.id,pinned:true,expectedRevision:0});
 expect(context.signal.aborted).toBe(false);expect(await f.core.getTask(task.id)).toEqual(before);
 await f.core.projectCommand({type:'projects.pins.set',projectId:project.id,pinned:false,expectedRevision:1});
 expect(context.signal.aborted).toBe(false);expect(await f.core.getTask(task.id)).toEqual(before);
 finish({title:'Original answer',content:'Still current.'});expect((await pending).status).toBe('completed');
 expect((await f.core.getTask(task.id)).artifacts[0].revisions[0].content).toBe('Still current.');expect(await f.core.projectCommand({type:'projects.list'})).toEqual([project]);
});
it('shares exact saved versions into independent task copies once and keeps copies after removal or owner deletion',async()=>{
 const f=await fixture(),a=await f.core.createTask({title:'Trip research'}),b=await f.core.createTask({title:'Visit checklist'}),project=await f.core.projectCommand({type:'projects.create',name:'Observatory'});
 for(const task of [a,b])await f.core.projectCommand({type:'projects.assign',taskId:task.id,projectId:project.id,expectedProjectId:null});
 const original=await f.core.putSource(a.id,{kind:'text',label:'Visit guide',role:'fact',content:'Original saved text.'}),source=original.sources[0],reference={sourceId:source.id,version:1,digest:source.versions[0].digest};
 const shared=await f.core.projectCommand({type:'projects.sources.add',projectId:project.id,expectedRevision:1,taskId:a.id,reference});
 const command={type:'projects.sources.use' as const,projectId:project.id,expectedRevision:shared.revision,sourceKey:shared.sources[0].id,taskId:b.id},copied=await f.core.projectCommand(command);
 expect(copied.sources).toHaveLength(1);expect(copied.sources[0].id).not.toBe(source.id);expect(copied.sources[0].versions[0]).toMatchObject({kind:'text',label:'Visit guide',content:'Original saved text.'});expect(await f.core.projectCommand(command)).toEqual(copied);
 expect(copied.sources[0].projectOrigin).toMatchObject({taskId:a.id,reference});
 await f.core.putSource(b.id,{id:copied.sources[0].id,kind:'text',label:'Edited task copy',role:'fact',content:'Keep my local edit.'});
 const addedAgain=await f.core.projectCommand(command);expect(addedAgain.sources).toHaveLength(2);expect(addedAgain.sources[0].versions.at(-1)?.content).toBe('Keep my local edit.');expect(addedAgain.sources[1].versions[0].content).toBe('Original saved text.');expect(await f.core.projectCommand(command)).toEqual(addedAgain);
 await f.reopen();expect((await f.core.getTask(b.id)).sources).toEqual(addedAgain.sources);
 await f.core.deleteTask(a.id);await expect(f.core.projectCommand({...command,taskId:b.id})).rejects.toThrow('unavailable');const retained=(await f.core.getTask(b.id)).sources;expect(retained.map(source=>source.versions)).toEqual(addedAgain.sources.map(source=>source.versions));expect(retained.every(source=>source.freshness==='refresh-required')).toBe(true);
 await f.core.projectCommand({type:'projects.sources.remove',projectId:project.id,expectedRevision:shared.revision,sourceKey:shared.sources[0].id});await f.reopen();expect((await f.core.getTask(b.id)).sources).toEqual(retained);expect((await f.core.getTask(b.id)).sources[1].projectOrigin).toMatchObject({taskId:a.id,reference});
});
it('updates a shared reference deliberately while keeping old copies and pinning new copies to the reviewed version',async()=>{
 const f=await fixture(),owner=await f.core.createTask({title:'Reference owner'}),target=await f.core.createTask({title:'Independent copies'}),project=await f.core.projectCommand({type:'projects.create',name:'Night visits'});
 for(const task of [owner,target])await f.core.projectCommand({type:'projects.assign',taskId:task.id,projectId:project.id,expectedProjectId:null});
 const original=await f.core.putSource(owner.id,{kind:'text',label:'Visit guide',role:'fact',content:'Doors open at 18:00.'}),source=original.sources[0],oldReference={sourceId:source.id,version:1,digest:source.versions[0].digest};
 const shared=await f.core.projectCommand({type:'projects.sources.add',projectId:project.id,expectedRevision:1,taskId:owner.id,reference:oldReference}),sourceKey=shared.sources[0].id;
 const first=await f.core.projectCommand({type:'projects.sources.use',projectId:project.id,expectedRevision:shared.revision,sourceKey,taskId:target.id});
 const edited=await f.core.putSource(owner.id,{id:source.id,kind:'text',label:'Updated visit guide',role:'fact',content:'Doors now open at 19:00.'}),current=edited.sources[0].versions.at(-1)!,reference={sourceId:source.id,version:2,digest:current.digest};
 await f.core.saveComposerDraft(target.id,0,{text:'PRIVATE_UNSENT',kind:'explain'});
 const before=await f.core.getTask(target.id),browserContext={origin:'https://owned.invalid',url:'https://owned.invalid/current',requestId:'prior-browser'};
 await f.core.replaceSession(target.id,before.session!.revision,{...before.session!,browserContext});
 const command={type:'projects.sources.update' as const,projectId:project.id,expectedRevision:shared.revision,sourceKey,taskId:owner.id,expectedReference:oldReference,reference};
 const updated=await f.core.projectCommand(command);
 expect(updated.sources).toEqual([{id:sourceKey,taskId:owner.id,reference}]);expect(updated.revision).toBe(3);expect(updated.name).toBe('Night visits');
 expect(await f.core.projectCommand(command)).toEqual(updated);expect((await f.core.getTask(target.id)).sources[0]).toMatchObject({versions:first.sources[0].versions,freshness:'refresh-required',projectOrigin:first.sources[0].projectOrigin});
 expect(projectSourceInTask(await f.core.getTask(target.id),project.id,updated.sources[0])).toBe(false);
 const copied=await f.core.projectCommand({type:'projects.sources.use',projectId:project.id,expectedRevision:updated.revision,sourceKey,taskId:target.id});
 expect(copied.sources.map(item=>item.versions.at(-1)?.content)).toEqual(['Doors open at 18:00.','Doors now open at 19:00.']);
 expect(copied.sources[0].projectOrigin?.reference).toEqual(oldReference);expect(copied.sources[1].projectOrigin?.reference).toEqual(reference);
 expect(copied.session?.draft).toBe('PRIVATE_UNSENT');expect(copied.session?.browserContext).toEqual(browserContext);expect(projectSourceInTask(copied,project.id,updated.sources[0])).toBe(true);
 await f.reopen();expect((await f.core.getTask(target.id)).sources).toEqual(copied.sources);expect(await f.core.projectCommand({type:'projects.list'})).toEqual([updated]);
});
it.each(['project','advanced','stale','owner-moved','old-reference','foreign-owner','different-source','not-newer','removed','window'] as const)('refuses a %s shared-source update review without changing saved project or task content',async scenario=>{
 const f=await fixture(),owner=await f.core.createTask({title:'Reference owner'}),other=await f.core.createTask({title:'Other task'}),project=await f.core.projectCommand({type:'projects.create',name:'Night visits'});
 for(const task of [owner,other])await f.core.projectCommand({type:'projects.assign',taskId:task.id,projectId:project.id,expectedProjectId:null});
 const original=await f.core.putSource(owner.id,{kind:'text',label:'Guide',role:'fact',content:'First saved version.'}),source=original.sources[0],expectedReference={sourceId:source.id,version:1,digest:source.versions[0].digest};
 const shared=await f.core.projectCommand({type:'projects.sources.add',projectId:project.id,expectedRevision:1,taskId:owner.id,reference:expectedReference});
 const newer=await f.core.putSource(owner.id,{id:source.id,kind:'text',label:'Guide',role:'fact',content:'Second saved version.'}),version=newer.sources[0].versions.at(-1)!;
 let command={type:'projects.sources.update' as const,projectId:project.id,expectedRevision:shared.revision,sourceKey:shared.sources[0].id,taskId:owner.id,expectedReference,reference:{sourceId:source.id,version:2,digest:version.digest}};
 if(scenario==='project')await f.core.projectCommand({type:'projects.update',projectId:project.id,expectedRevision:shared.revision,name:'Latest project name',instructions:'Keep this saved guidance.'});
 if(scenario==='advanced')await f.core.putSource(owner.id,{id:source.id,kind:'text',label:'Guide',role:'fact',content:'Third saved version.'});
 if(scenario==='stale')await f.core.invalidateSource(owner.id,source.id,'Explicit source refresh required.');
 if(scenario==='owner-moved')await f.core.projectCommand({type:'projects.assign',taskId:owner.id,projectId:null,expectedProjectId:project.id});
 if(scenario==='old-reference')command={...command,expectedReference:{...expectedReference,digest:'wrong-old-digest'}};
 if(scenario==='foreign-owner')command={...command,taskId:other.id};
 if(scenario==='different-source')command={...command,reference:{...command.reference,sourceId:'another-source'}};
 if(scenario==='not-newer')command={...command,reference:expectedReference};
 if(scenario==='removed')await f.core.projectCommand({type:'projects.sources.remove',projectId:project.id,expectedRevision:shared.revision,sourceKey:shared.sources[0].id});
 if(scenario==='window'){const changed=await f.core.putSource(owner.id,{id:source.id,kind:'window',label:'Window binding',role:'fact',content:'Frozen metadata',windowId:'window:7',documentToken:'owner-token'}),window=changed.sources[0].versions.at(-1)!;command={...command,reference:{sourceId:source.id,version:window.version,digest:window.digest}};}
 const savedProjects=await f.core.projectCommand({type:'projects.list'}),savedOwner=await f.core.getTask(owner.id),savedOther=await f.core.getTask(other.id);
 await expect(f.core.projectCommand(command)).rejects.toMatchObject({code:scenario==='advanced'||scenario==='stale'?'stale':scenario==='not-newer'||scenario==='window'?'invalid':scenario==='removed'?'not-found':'conflict'});
 expect(await f.core.projectCommand({type:'projects.list'})).toEqual(savedProjects);expect(await f.core.getTask(owner.id)).toEqual(savedOwner);expect(await f.core.getTask(other.id)).toEqual(savedOther);
 expect(()=>readProjectCommand({...command,followOriginal:true})).toThrow();
});
it('refuses foreign membership, stale references and live-window bindings without changing saved projects',async()=>{
 const f=await fixture(),task=await f.core.createTask({title:'Original'}),foreign=await f.core.createTask({title:'Other'}),project=await f.core.projectCommand({type:'projects.create',name:'One'});
 await f.core.projectCommand({type:'projects.assign',taskId:task.id,projectId:project.id,expectedProjectId:null});
 const t=await f.core.putSource(task.id,{kind:'text',label:'Text',role:'fact',content:'Exact original'}),source=t.sources[0],reference={sourceId:source.id,version:1,digest:source.versions[0].digest};
 await expect(f.core.projectCommand({type:'projects.sources.add',projectId:project.id,expectedRevision:1,taskId:foreign.id,reference})).rejects.toThrow('Move this task');
 await expect(f.core.projectCommand({type:'projects.sources.add',projectId:project.id,expectedRevision:1,taskId:task.id,reference:{...reference,digest:'wrong'}})).rejects.toThrow('Source changed');
 const windows=await f.core.putSource(task.id,{kind:'window',label:'Private native binding',role:'fact',content:'frozen metadata',windowId:'window:7',documentToken:'owner-token'}),window=windows.sources.at(-1)!;
 await expect(f.core.projectCommand({type:'projects.sources.add',projectId:project.id,expectedRevision:1,taskId:task.id,reference:{sourceId:window.id,version:1,digest:window.versions[0].digest}})).rejects.toThrow('Window captures');
 expect(await f.core.projectCommand({type:'projects.list'})).toEqual([project]);
});
it('keeps the destination browser route and unsent draft when adding a shared snapshot, including after reopen',async()=>{
 const f=await fixture(),owner=await f.core.createTask({title:'Source owner'}),target=await f.core.createTask({title:'Browser task'}),project=await f.core.projectCommand({type:'projects.create',name:'Shared research'});
 for(const task of [owner,target])await f.core.projectCommand({type:'projects.assign',taskId:task.id,projectId:project.id,expectedProjectId:null});
 const sourced=await f.core.putSource(owner.id,{kind:'text',label:'Saved notes',role:'fact',content:'Read the current page alongside these notes.'}),source=sourced.sources[0],shared=await f.core.projectCommand({type:'projects.sources.add',projectId:project.id,expectedRevision:1,taskId:owner.id,reference:{sourceId:source.id,version:1,digest:source.versions[0].digest}});
 await f.core.saveComposerDraft(target.id,0,{text:'PRIVATE_BROWSER_DRAFT',kind:'explain'});
 const before=await f.core.getTask(target.id),browserContext={origin:'https://owned.invalid',url:'https://owned.invalid/current',requestId:'prior-browser'};
 await f.core.replaceSession(target.id,before.session!.revision,{...before.session!,browserContext});
 const copied=await f.core.projectCommand({type:'projects.sources.use',projectId:project.id,expectedRevision:shared.revision,sourceKey:shared.sources[0].id,taskId:target.id});
 expect(copied.session?.browserContext).toEqual(browserContext);expect(copied.session?.draft).toBe('PRIVATE_BROWSER_DRAFT');expect(copied.session?.draftRevision).toBe(before.session?.draftRevision);expect(copied.requests).toEqual([]);
 await f.reopen();expect((await f.core.getTask(target.id)).session?.browserContext).toEqual(browserContext);
});
it('refuses shared source use after destination membership changes and applies only the new project instructions',async()=>{
 const f=await fixture(),owner=await f.core.createTask({title:'Source owner'}),target=await f.core.createTask({title:'Moving task'}),a=await f.core.projectCommand({type:'projects.create',name:'One'}),b=await f.core.projectCommand({type:'projects.create',name:'Two'});
 for(const task of [owner,target])await f.core.projectCommand({type:'projects.assign',taskId:task.id,projectId:a.id,expectedProjectId:null});
 const sourced=await f.core.putSource(owner.id,{kind:'text',label:'Only project One',role:'fact',content:'PRIVATE_PROJECT_ONE_SOURCE'}),source=sourced.sources[0],shared=await f.core.projectCommand({type:'projects.sources.add',projectId:a.id,expectedRevision:1,taskId:owner.id,reference:{sourceId:source.id,version:1,digest:source.versions[0].digest}});
 await f.core.projectCommand({type:'projects.update',projectId:a.id,expectedRevision:shared.revision,name:a.name,instructions:'PRIVATE_PROJECT_ONE_GUIDANCE'});
 await f.core.projectCommand({type:'projects.update',projectId:b.id,expectedRevision:1,name:b.name,instructions:'Use the second project guidance.'});
 await f.core.projectCommand({type:'projects.assign',taskId:target.id,projectId:b.id,expectedProjectId:a.id});
 await expect(f.core.projectCommand({type:'projects.sources.use',projectId:a.id,expectedRevision:shared.revision+1,sourceKey:shared.sources[0].id,taskId:target.id})).rejects.toThrow('Move this task');
 await expect(f.core.projectCommand({type:'projects.assign',taskId:target.id,projectId:null,expectedProjectId:a.id})).rejects.toThrow('moved');
 let context!:RequestContext;await f.core.runRequest({taskId:target.id,requestId:'new-project',kind:'explain',prompt:'Which guidance applies?'},async ctx=>{context=ctx;return {title:'Local result',content:'No provider call.'};});
 expect(context.projectInstructions).toMatchObject({projectId:b.id,text:'Use the second project guidance.'});expect(JSON.stringify(context)).not.toContain('PRIVATE_PROJECT_ONE');expect((await f.core.getTask(target.id)).sources).toEqual([]);
});
it('keeps project guidance separate from source data and other tasks, and excludes it from browser planning',async()=>{
 const f=await fixture(),a=await f.core.createTask({title:'Project owner'}),b=await f.core.createTask({title:'Unrelated task'}),p=await f.core.projectCommand({type:'projects.create',name:'Night research'}),instruction='Use metric units. Mark missing evidence.';
 await f.core.projectCommand({type:'projects.update',projectId:p.id,expectedRevision:1,name:p.name,instructions:instruction});await f.core.projectCommand({type:'projects.assign',taskId:a.id,projectId:p.id,expectedProjectId:null});
 await f.core.putSource(a.id,{kind:'text',label:'Inert reference',role:'fact',content:'UNTRUSTED_SOURCE_TEXT'});await f.core.saveComposerDraft(a.id,0,{kind:'create',text:'PRIVATE_UNSENT'});
 let own!:RequestContext,other!:RequestContext,browser!:RequestContext;
 await f.core.runRequest({taskId:a.id,requestId:'own',kind:'explain',prompt:'Explain saved evidence.'},async ctx=>{own=ctx;return {title:'Synthetic',content:'Local output'};});
 await f.core.runRequest({taskId:b.id,requestId:'other',kind:'explain',prompt:'Unrelated question'},async ctx=>{other=ctx;return {title:'Synthetic',content:'Local output'};});
 await f.core.runRequest({taskId:a.id,requestId:'browser',kind:'browser',prompt:'No real browser',sourceIds:[]},async ctx=>{browser=ctx;return {title:'Synthetic',content:'Local output'};});
 expect(own.projectInstructions).toMatchObject({projectId:p.id,name:p.name,revision:2,text:instruction});expect(other.projectInstructions).toBeUndefined();expect(browser.projectInstructions).toBeUndefined();
 const sources=own.task.sources.map(source=>source.versions[0]);
 const meta=buildMetaMessages('Explain',sources,own.taskHistory,own.projectInstructions),codex=buildCodexInput({prompt:'Explain',sources,taskContext:own.taskHistory,projectInstructions:own.projectInstructions});
 for(const parts of [meta,codex]){const serialized=JSON.stringify(parts);expect(serialized).toContain("User's saved project instructions");expect(serialized).toContain(instruction);expect(serialized).toContain('UNTRUSTED_SOURCE_TEXT');expect(serialized).not.toContain('PRIVATE_UNSENT');expect(serialized).toContain('Does not authorize tools');}
 expect(projectInstructionsText(undefined)).toBeUndefined();expect(()=>projectInstructionsText({...own.projectInstructions!,text:'x'.repeat(8001)})).toThrow();
});
it.each(['instructions','membership'] as const)('cancels a response on %s change and cannot commit a late answer',async kind=>{
 const f=await fixture(),task=await f.core.createTask({title:'Owned task'}),project=await f.core.projectCommand({type:'projects.create',name:'Project'});await f.core.projectCommand({type:'projects.assign',taskId:task.id,projectId:project.id,expectedProjectId:null});
 let context!:RequestContext,entered!:()=>void,finish!:(output:RequestOutput)=>void;const ready=new Promise<void>(done=>entered=done),pending=f.core.runRequest({taskId:task.id,requestId:'pending',kind:'create',prompt:'Local cancellation check.'},async ctx=>{context=ctx;entered();return new Promise(done=>finish=done);});await ready;
 if(kind==='instructions')await f.core.projectCommand({type:'projects.update',projectId:project.id,expectedRevision:1,name:project.name,instructions:'Updated user guidance.'});
 else await f.core.projectCommand({type:'projects.assign',taskId:task.id,projectId:null,expectedProjectId:project.id});
 expect(context.signal.aborted).toBe(true);finish({title:'Late answer',content:'Must not be saved'});expect((await pending).status).toBe('cancelled');expect((await f.core.getTask(task.id)).artifacts).toEqual([]);
});
it('rejects stale project edits, unsafe commands and corrupt membership without overwriting saved bytes',async()=>{
 const f=await fixture(),task=await f.core.createTask({title:'Owned task'}),project=await f.core.projectCommand({type:'projects.create',name:'Original'});
 await f.core.projectCommand({type:'projects.update',projectId:project.id,expectedRevision:1,name:'Latest',instructions:''});
 await expect(f.core.projectCommand({type:'projects.update',projectId:project.id,expectedRevision:1,name:'Obsolete',instructions:'Stale text'})).rejects.toThrow('changed');
 for(const command of [{type:'projects.list',accessFiles:true},{type:'projects.update',projectId:project.id,expectedRevision:2,name:'',instructions:''},{type:'projects.assign',taskId:task.id,projectId:project.id},{type:'projects.create',name:'\0bad'},{type:'projects.update',projectId:project.id,expectedRevision:2,name:'Latest',instructions:'x'.repeat(8001)}])expect(()=>readProjectCommand(command)).toThrow();
 await f.core.close();const path=join(f.directory,'tasks.json'),state=JSON.parse(await readFile(path,'utf8'));state.tasks[0].projectId='missing-project';const bytes=JSON.stringify(state);await writeFile(path,bytes);await expect(createCompanion({dataDir:f.directory})).rejects.toThrow('unreadable');expect(await readFile(path,'utf8')).toBe(bytes);
});
