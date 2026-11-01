import {afterEach,expect,test,vi} from 'vitest';
const failure=vi.hoisted(()=>({rename:false}));
vi.mock('node:fs/promises',async original=>{const fs=await original<typeof import('node:fs/promises')>();return {...fs,rename:async(...args:Parameters<typeof fs.rename>)=>{if(failure.rename){failure.rename=false;throw Error('Owned synthetic publish failure');}return fs.rename(...args);}};});
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {readProjectCommand} from '../src/shared/projects';

const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{failure.rename=false;for(const close of cleanup.splice(0))await close();});
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'glint-project-archive-'));let core=await createCompanion({dataDir:directory});
 cleanup.push(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});
 return {directory,get core(){return core;},async reopen(){await core.close();core=await createCompanion({dataDir:directory});}};
}

test('archive and restore retain the same project, member content, drafts and exact context across reopen',async()=>{
 const f=await fixture(),task=await f.core.createTask({title:'Owned archive QA'}),other=await f.core.createTask({title:'Unrelated QA'});
 const created=await f.core.projectCommand({type:'projects.create',name:'Archive QA'});
 const project=await f.core.projectCommand({type:'projects.update',projectId:created.id,expectedRevision:1,name:created.name,instructions:'Keep the saved project context.',useAccountMemory:false});
 await f.core.projectCommand({type:'projects.assign',taskId:task.id,projectId:project.id,expectedProjectId:null});
 const withSource=await f.core.putSource(task.id,{kind:'text',label:'QA knowledge',role:'fact',content:'Archive preserves this knowledge.'}),source=withSource.sources[0].versions[0];
 const shared=await f.core.projectCommand({type:'projects.sources.add',projectId:project.id,expectedRevision:project.revision,taskId:task.id,reference:{sourceId:source.id,version:source.version,digest:source.digest}});
 await f.core.projectCommand({type:'projects.memory.change',projectId:project.id,expectedRevision:0,change:{kind:'save',text:'Owned project fact.',topics:['qa']}});
 await f.core.saveComposerDraft(task.id,0,{text:'  QA unsent draft\n',kind:'explain'});
 const before=await f.core.listTasks(),saved=(await f.core.projectCommand({type:'projects.list'}))[0],lease=await f.core.leaseUserMemory(task.id,'QA');
 const command={type:'projects.archive' as const,projectId:project.id,expectedRevision:0,archived:true};
 const archived=await f.core.projectCommand(command);
 expect(archived).toEqual({...saved,archive:{revision:1,archived:true,updatedAt:archived.archive!.updatedAt}});
 expect(archived.revision).toBe(shared.revision);expect(await f.core.listTasks()).toEqual(before);await lease.check();
 expect(await f.core.projectCommand(command)).toEqual(archived);
 expect((await f.core.previewUserMemory({taskId:task.id,prompt:'QA'})).project).toMatchObject({id:project.id,name:project.name,useAccountMemory:false});
 expect(await f.core.getTask(other.id)).toEqual(before.find(item=>item.id===other.id));
 await f.reopen();expect((await f.core.projectCommand({type:'projects.list'}))[0]).toEqual(archived);
 const reopened=await f.core.getTask(task.id),prior=before.find(item=>item.id===task.id)!;
 expect(reopened).toEqual({...prior,session:{...prior.session!,revision:prior.session!.revision+1}});
 const restored=await f.core.projectCommand({type:'projects.archive',projectId:project.id,expectedRevision:1,archived:false});
 expect(restored).toEqual({...saved,archive:{revision:2,archived:false,updatedAt:restored.archive!.updatedAt}});
 expect(await f.core.getTask(task.id)).toEqual(reopened);
 expect(await f.core.projectCommand({type:'projects.archive',projectId:project.id,expectedRevision:1,archived:false})).toEqual(restored);
 await expect(f.core.projectCommand(command)).rejects.toThrow(/changed/);
});

test('archived project reads remain available while mutation, stale joins and deletion require Restore',async()=>{
 const f=await fixture(),task=await f.core.createTask({title:'Existing chat'}),outside=await f.core.createTask({title:'New candidate'}),project=await f.core.projectCommand({type:'projects.create',name:'Guard QA'});
 await f.core.projectCommand({type:'projects.assign',taskId:task.id,projectId:project.id,expectedProjectId:null});
 const review=await f.core.projectCommand({type:'projects.delete.preview',projectId:project.id});
 const deletion={type:'projects.delete' as const,intentId:'owned-stale-deletion',projectId:project.id,expectedRevision:review.revision,expectedSnapshot:review.snapshot,mode:'keep-tasks' as const,members:review.members.map(({taskId,snapshot})=>({taskId,snapshot})),confirmed:'delete-local-project' as const};
 await f.core.projectCommand({type:'projects.archive',projectId:project.id,expectedRevision:0,archived:true});
 const before=await readFile(join(f.directory,'tasks.json'),'utf8');
 const commands=[
  {type:'projects.delete.preview',projectId:project.id},deletion,
  {type:'projects.update',projectId:project.id,expectedRevision:1,name:project.name,instructions:'Changed'},
  {type:'projects.memory.change',projectId:project.id,expectedRevision:0,change:{kind:'enabled',enabled:true}},
  {type:'projects.assign',taskId:outside.id,projectId:project.id,expectedProjectId:null},
  {type:'projects.assign.bulk',projectId:project.id,tasks:[{taskId:outside.id,expectedProjectId:null}]},
  {type:'projects.assign',taskId:task.id,projectId:null,expectedProjectId:project.id},
  {type:'projects.create',intentId:'owned-new-scope',name:'Another project',includeTask:{taskId:task.id,expectedProjectId:project.id}}
 ];
 for(const command of commands){await expect(f.core.projectCommand(readProjectCommand(command))).rejects.toThrow(/Restore/);expect(await readFile(join(f.directory,'tasks.json'),'utf8')).toBe(before);}
 expect(await f.core.projectCommand({type:'projects.memory.get',projectId:project.id})).toMatchObject({enabled:false,facts:[]});
 expect((await f.core.getTask(task.id)).projectId).toBe(project.id);
 await f.core.projectCommand({type:'projects.archive',projectId:project.id,expectedRevision:1,archived:false});
 expect((await f.core.projectCommand({type:'projects.delete.preview',projectId:project.id})).members[0].taskId).toBe(task.id);
});

test('archive is strict, CAS-bound and atomic on failure without changing other state or active context',async()=>{
 const f=await fixture(),project=await f.core.projectCommand({type:'projects.create',name:'Atomic QA'}),command={type:'projects.archive' as const,projectId:project.id,expectedRevision:0,archived:true};
 for(const invalid of [{...command,extra:true},{...command,expectedRevision:-1},{...command,expectedRevision:0.5},{...command,archived:'true'}])expect(()=>readProjectCommand(invalid)).toThrow();
 const before=await readFile(join(f.directory,'tasks.json'),'utf8');failure.rename=true;
 await expect(f.core.projectCommand(command)).rejects.toThrow();expect(await readFile(join(f.directory,'tasks.json'),'utf8')).toBe(before);
 await f.reopen();expect((await f.core.projectCommand({type:'projects.list'}))[0]).toEqual(project);
 const [first,repeated]=await Promise.all([f.core.projectCommand(command),f.core.projectCommand(command)]);expect(repeated).toEqual(first);expect(first.archive?.revision).toBe(1);
 await expect(f.core.projectCommand({...command,archived:false})).rejects.toThrow(/changed/);
});
