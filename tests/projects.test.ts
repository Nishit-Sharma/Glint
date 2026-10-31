import {afterEach,expect,it} from 'vitest';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion,type RequestContext,type RequestOutput} from '../src/core/companion';
import {buildMetaMessages} from '../src/host/provider';
import {buildCodexInput} from '../src/host/codex-provider';
import {readProjectCommand,projectInstructionsText} from '../src/shared/projects';

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
it('shares exact saved versions into independent task copies once and keeps copies after removal or owner deletion',async()=>{
 const f=await fixture(),a=await f.core.createTask({title:'Trip research'}),b=await f.core.createTask({title:'Visit checklist'}),project=await f.core.projectCommand({type:'projects.create',name:'Observatory'});
 for(const task of [a,b])await f.core.projectCommand({type:'projects.assign',taskId:task.id,projectId:project.id,expectedProjectId:null});
 const original=await f.core.putSource(a.id,{kind:'text',label:'Visit guide',role:'fact',content:'Original saved text.'}),source=original.sources[0],reference={sourceId:source.id,version:1,digest:source.versions[0].digest};
 const shared=await f.core.projectCommand({type:'projects.sources.add',projectId:project.id,expectedRevision:1,taskId:a.id,reference});
 await f.core.putSource(a.id,{id:source.id,kind:'text',label:'New guide',role:'fact',content:'Newer owner text.'});
 const command={type:'projects.sources.use' as const,projectId:project.id,expectedRevision:shared.revision,sourceKey:shared.sources[0].id,taskId:b.id},copied=await f.core.projectCommand(command);
 expect(copied.sources).toHaveLength(1);expect(copied.sources[0].id).not.toBe(source.id);expect(copied.sources[0].versions[0]).toMatchObject({kind:'text',label:'Visit guide',content:'Original saved text.'});expect(await f.core.projectCommand(command)).toEqual(copied);
 expect(copied.sources[0].projectOrigin).toMatchObject({taskId:a.id,reference});
 await f.core.putSource(b.id,{id:copied.sources[0].id,kind:'text',label:'Edited task copy',role:'fact',content:'Keep my local edit.'});
 const addedAgain=await f.core.projectCommand(command);expect(addedAgain.sources).toHaveLength(2);expect(addedAgain.sources[0].versions.at(-1)?.content).toBe('Keep my local edit.');expect(addedAgain.sources[1].versions[0].content).toBe('Original saved text.');expect(await f.core.projectCommand(command)).toEqual(addedAgain);
 await f.reopen();expect((await f.core.getTask(b.id)).sources).toEqual(addedAgain.sources);
 await f.core.deleteTask(a.id);await expect(f.core.projectCommand({...command,taskId:b.id})).rejects.toThrow('unavailable');expect((await f.core.getTask(b.id)).sources).toEqual(addedAgain.sources);
 await f.core.projectCommand({type:'projects.sources.remove',projectId:project.id,expectedRevision:shared.revision,sourceKey:shared.sources[0].id});await f.reopen();expect((await f.core.getTask(b.id)).sources).toEqual(addedAgain.sources);expect((await f.core.getTask(b.id)).sources[1].projectOrigin).toMatchObject({taskId:a.id,reference});
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
