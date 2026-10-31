import {afterEach,expect,it} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion,type RequestContext,type RequestOutput} from '../src/core/companion';
import {readProjectCommand} from '../src/shared/projects';

const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0))await close();});
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'glint-project-create-'));let core=await createCompanion({dataDir:directory});
 cleanup.push(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});
 return {directory,get core(){return core;},async reopen(){await core.close();core=await createCompanion({dataDir:directory});}};
}

it('creates one project around the explicitly included task while retaining its saved work, draft and browser route across reopen',async()=>{
 const f=await fixture(),task=await f.core.createTask({title:'Synthetic field notes'}),outside=await f.core.createTask({title:'Outside this scope'}),old=await f.core.projectCommand({type:'projects.create',name:'Previous scope'});
 await f.core.projectCommand({type:'projects.assign',taskId:task.id,projectId:old.id,expectedProjectId:null});
 await f.core.projectCommand({type:'projects.update',projectId:old.id,expectedRevision:1,name:old.name,instructions:'OLD_SCOPE_ONLY'});
 await f.core.putSource(task.id,{kind:'text',label:'Saved guide',role:'fact',content:'The synthetic doors open at 18:00.'});
 await f.core.saveArtifact(task.id,{title:'Saved draft',content:'Arrive at 17:50.'});
 await f.core.runRequest({taskId:task.id,requestId:'synthetic-earlier-answer',kind:'explain',prompt:'Earlier local history.'},async()=>({title:'Earlier answer',content:'Retain this history.'}));
 await f.core.saveComposerDraft(task.id,0,{text:'  SYNTHETIC_UNSENT\n',kind:'create'});
 const draft=await f.core.getTask(task.id),route={origin:'https://owned.invalid',url:'https://owned.invalid/retained',requestId:'synthetic-prior-browser'};
 await f.core.replaceSession(task.id,draft.session!.revision,{...draft.session!,browserContext:route});
 const before=await f.core.getTask(task.id),command={type:'projects.create' as const,intentId:'synthetic-create-with-current',name:' New field scope ',includeTask:{taskId:task.id,expectedProjectId:old.id}};
 const project=await f.core.projectCommand(command),saved=await f.core.getTask(task.id);
 expect(project).toMatchObject({name:'New field scope',instructions:'',sources:[],revision:1});
 expect(saved).toEqual({...before,projectId:project.id,updatedAt:saved.updatedAt});
 expect(await f.core.getTask(outside.id)).toEqual(outside);
 expect(await f.core.projectCommand(command)).toEqual(project);
 expect(await f.core.getTask(task.id)).toEqual(saved);
 await f.reopen();expect(await f.core.projectCommand(command)).toEqual(project);
 const reopened=await f.core.getTask(task.id);expect(reopened).toEqual({...saved,session:{...saved.session!,revision:saved.session!.revision+1}});
 expect((await f.core.projectCommand({type:'projects.list'})).map(item=>item.id)).toEqual([old.id,project.id]);
 let context!:RequestContext;await f.core.runRequest({taskId:task.id,requestId:'synthetic-new-scope-answer',kind:'explain',prompt:'Observe local scope.'},async value=>{context=value;return {title:'Local observation',content:'No provider was called.'};});
 expect(context.projectInstructions).toMatchObject({projectId:project.id,text:''});
 expect(JSON.stringify(context.projectInstructions)).not.toContain('OLD_SCOPE_ONLY');
});

it('creates an empty project without changing any task unless inclusion is explicit',async()=>{
 const f=await fixture(),task=await f.core.createTask({title:'Keep independent'});await f.core.saveComposerDraft(task.id,0,{text:'Keep this unsent.',kind:'explain'});
 const before=await f.core.listTasks(),command={type:'projects.create' as const,name:'Empty scope',intentId:'synthetic-empty-creation'};
 const [first,repeated]=await Promise.all([f.core.projectCommand(command),f.core.projectCommand(command)]);
 expect(repeated).toEqual(first);expect(await f.core.projectCommand({type:'projects.list'})).toEqual([first]);expect(await f.core.listTasks()).toEqual(before);
 expect((await f.core.projectCommand({type:'projects.create',name:'EMPTY SCOPE'})).id).toBe(first.id);
});

it('rejects stale or missing included tasks and name collisions before changing any saved state',async()=>{
 const f=await fixture(),task=await f.core.createTask({title:'Explicit member'}),old=await f.core.projectCommand({type:'projects.create',name:'Existing scope'});
 await f.core.projectCommand({type:'projects.assign',taskId:task.id,projectId:old.id,expectedProjectId:null});
 const command={type:'projects.create' as const,intentId:'synthetic-stale-membership',name:'New scope',includeTask:{taskId:task.id,expectedProjectId:null}},bytes=await readFile(join(f.directory,'tasks.json'),'utf8');
 for(const input of [command,{...command,includeTask:{...command.includeTask,taskId:'missing'}},{...command,name:'EXISTING SCOPE',includeTask:{taskId:task.id,expectedProjectId:old.id}}]){
  await expect(f.core.projectCommand(input)).rejects.toThrow();expect(await readFile(join(f.directory,'tasks.json'),'utf8')).toBe(bytes);
 }
 const created=await f.core.projectCommand({...command,includeTask:{taskId:task.id,expectedProjectId:old.id}});expect((await f.core.getTask(task.id)).projectId).toBe(created.id);
 expect((await f.core.projectCommand({type:'projects.list'})).map(project=>project.name)).toEqual(['Existing scope','New scope']);
});

it('binds an outcome to the exact name and task choice and never recreates a deleted or subsequently moved result',async()=>{
 const f=await fixture(),task=await f.core.createTask({title:'Included member'}),other=await f.core.createTask({title:'Other member'}),command={type:'projects.create' as const,intentId:'synthetic-bound-creation',name:'Bound scope',includeTask:{taskId:task.id,expectedProjectId:null}},project=await f.core.projectCommand(command);
 expect(await f.core.projectCommand({...command,includeTask:{expectedProjectId:null,taskId:task.id}})).toEqual(project);
 const bytes=await readFile(join(f.directory,'tasks.json'),'utf8');
 for(const input of [{...command,name:'Changed payload'},{...command,includeTask:undefined},{...command,includeTask:{taskId:other.id,expectedProjectId:null}},{...command,includeTask:{taskId:task.id,expectedProjectId:project.id}}]){
  await expect(f.core.projectCommand(input)).rejects.toMatchObject({code:'conflict'});expect(await readFile(join(f.directory,'tasks.json'),'utf8')).toBe(bytes);
 }
 await f.core.projectCommand({type:'projects.assign',taskId:task.id,projectId:null,expectedProjectId:project.id});
 const moved=await f.core.contentSnapshot();await expect(f.core.projectCommand(command)).rejects.toMatchObject({code:'conflict'});expect(await f.core.contentSnapshot()).toEqual(moved);
 const review=await f.core.projectCommand({type:'projects.delete.preview',projectId:project.id});await f.core.projectCommand({type:'projects.delete',projectId:project.id,intentId:'synthetic-delete-created-scope',expectedRevision:review.revision,expectedSnapshot:review.snapshot,mode:'keep-tasks',members:[],confirmed:'delete-local-project'});
 const replacement=await f.core.projectCommand({type:'projects.create',name:command.name}),after=await f.core.contentSnapshot();
 await expect(f.core.projectCommand(command)).rejects.toThrow('No replacement');expect(await f.core.contentSnapshot()).toEqual(after);expect(replacement.id).not.toBe(project.id);
 await f.reopen();await expect(f.core.projectCommand(command)).rejects.toThrow('No replacement');expect((await f.core.getTask(task.id)).projectId).toBeUndefined();
});

it('serializes competing creations around one membership and cancels only the committed task response after persistence',async()=>{
 const f=await fixture(),task=await f.core.createTask({title:'Included pending member'}),other=await f.core.createTask({title:'Unrelated pending member'}),contexts=new Map<string,RequestContext>(),finishes=new Map<string,(output:RequestOutput)=>void>(),ready:Promise<void>[]=[];
 const pending=[task,other].map(member=>{let entered!:()=>void;ready.push(new Promise<void>(done=>entered=done));return f.core.runRequest({taskId:member.id,requestId:'synthetic-pending-'+member.id,kind:'create',prompt:'Controlled local pending response.'},async context=>{contexts.set(member.id,context);entered();return new Promise<RequestOutput>(done=>finishes.set(member.id,done));});});await Promise.all(ready);
 const before=await f.core.getTask(other.id);let persistedAtAbort:Promise<string>|undefined;contexts.get(task.id)!.signal.addEventListener('abort',()=>{persistedAtAbort=readFile(join(f.directory,'tasks.json'),'utf8');});
 const command={type:'projects.create' as const,intentId:'synthetic-competing-one',name:'Winning scope',includeTask:{taskId:task.id,expectedProjectId:null}},outcomes=await Promise.allSettled([f.core.projectCommand(command),f.core.projectCommand({...command,intentId:'synthetic-competing-two',name:'Losing stale scope'})]);
 expect(outcomes[0].status).toBe('fulfilled');expect(outcomes[1].status).toBe('rejected');const project=await f.core.projectCommand(command);
 expect(contexts.get(task.id)!.signal.aborted).toBe(true);expect(contexts.get(other.id)!.signal.aborted).toBe(false);
 expect(JSON.parse(await persistedAtAbort!).tasks.find((item:{id:string})=>item.id===task.id)).toMatchObject({projectId:project.id,requests:[{status:'cancelled'}]});
 expect(await f.core.getTask(other.id)).toEqual(before);expect(await f.core.projectCommand({type:'projects.list'})).toEqual([project]);
 for(const member of [task,other])finishes.get(member.id)!({title:'Controlled result',content:'No provider was called.'});expect((await Promise.all(pending)).map(request=>request.status)).toEqual(['cancelled','completed']);
 let latest!:RequestContext,entered!:()=>void,finish!:(output:RequestOutput)=>void;const started=new Promise<void>(done=>entered=done),newPending=f.core.runRequest({taskId:task.id,requestId:'synthetic-after-creation',kind:'create',prompt:'Keep the new scoped request running.'},async context=>{latest=context;entered();return new Promise(done=>finish=done);});await started;
 await f.core.projectCommand(command);expect(latest.signal.aborted).toBe(false);finish({title:'New scope result',content:'The retry does not cancel this response.'});expect((await newPending).status).toBe('completed');
});

it('rejects implicit inclusion, missing membership and excess creation fields at the command seam',()=>{
 const command={type:'projects.create',intentId:'synthetic-validated-create',name:'Scope',includeTask:{taskId:'task',expectedProjectId:null}};
 expect(readProjectCommand(command)).toEqual(command);
 for(const input of [{...command,intentId:undefined},{...command,intentId:''},{...command,includeTask:{taskId:'task'}},{...command,includeTask:{...command.includeTask,extra:true}},{...command,extra:true},{...command,name:' '},{...command,name:'a'.repeat(201)}])expect(()=>readProjectCommand(input)).toThrow();
});
