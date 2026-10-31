import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {selectTaskMemory,taskMemoryConsent,readMemoryPreview} from '../src/shared/project-memory';
import {userMemoryContext} from '../src/host/user-memory-context';
import {buildMetaMessages} from '../src/host/provider';
import {buildCodexInput} from '../src/host/codex-provider';
import type {UserMemory} from '../src/shared/user-memory';

const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0))await close();});
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'glint-project-memory-'));let core=await createCompanion({dataDir:directory});
 cleanup.push(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});
 return {get core(){return core;},async reopen(){await core.close();core=await createCompanion({dataDir:directory});}};
}
it('remembers an explicitly authored project fact only for member tasks after opt-in and restart',async()=>{
 const f=await fixture(),a=await f.core.createTask({title:'Project A optics'}),b=await f.core.createTask({title:'Project B optics'}),plain=await f.core.createTask({title:'Optics without a project'}),pa=await f.core.projectCommand({type:'projects.create',name:'Project A'}),pb=await f.core.projectCommand({type:'projects.create',name:'Project B'});
 await f.core.projectCommand({type:'projects.assign',taskId:a.id,projectId:pa.id,expectedProjectId:null});await f.core.projectCommand({type:'projects.assign',taskId:b.id,projectId:pb.id,expectedProjectId:null});
 await f.core.changeUserMemory({expectedRevision:0,change:{kind:'enabled',enabled:true}});const account=await f.core.getUserMemory();
 const saved=await f.core.projectCommand({type:'projects.memory.change',projectId:pa.id,expectedRevision:0,change:{kind:'save',text:'PROJECT_A_OPTICS: use millimetres for this telescope.',topics:['optics']}});
 expect(saved).toMatchObject({kind:'saved',current:{enabled:false,revision:1}});
 expect((await f.core.previewUserMemory({taskId:a.id,prompt:'Explain optics'})).projectFacts).toEqual([]);
 await f.core.projectCommand({type:'projects.memory.change',projectId:pa.id,expectedRevision:1,change:{kind:'enabled',enabled:true}});
 const selected=await f.core.previewUserMemory({taskId:a.id,prompt:'Explain optics'});expect(selected.projectFacts.map(fact=>fact.text)).toEqual(['PROJECT_A_OPTICS: use millimetres for this telescope.']);expect(selected.receipt.project).toMatchObject({projectId:pa.id,status:'included'});
 expect((await f.core.previewUserMemory({taskId:b.id,prompt:'Explain optics'})).projectFacts).toEqual([]);expect((await f.core.previewUserMemory({taskId:plain.id,prompt:'Explain optics'})).receipt.project).toBeUndefined();
 await f.reopen();expect((await f.core.previewUserMemory({taskId:a.id,prompt:'Explain optics'})).projectFacts).toEqual(selected.projectFacts);expect(await f.core.getUserMemory()).toEqual(account);
 expect((await f.core.projectCommand({type:'projects.list'})).map(({memory,...project})=>project)).toEqual([pa,pb]);
});
it('edits use project CAS and invalidate only that project memory lease, including stale membership',async()=>{
 const f=await fixture(),a=await f.core.createTask({title:'Optics A'}),b=await f.core.createTask({title:'Optics B'}),pa=await f.core.projectCommand({type:'projects.create',name:'A'}),pb=await f.core.projectCommand({type:'projects.create',name:'B'});
 await f.core.changeUserMemory({expectedRevision:0,change:{kind:'enabled',enabled:true}});
 for(const [task,project,text] of [[a,pa,'A_ORIGINAL'],[b,pb,'B_ONLY']] as const){await f.core.projectCommand({type:'projects.assign',taskId:task.id,projectId:project.id,expectedProjectId:null});await f.core.projectCommand({type:'projects.memory.change',projectId:project.id,expectedRevision:0,change:{kind:'save',text,topics:[]}});await f.core.projectCommand({type:'projects.memory.change',projectId:project.id,expectedRevision:1,change:{kind:'enabled',enabled:true}});}
 const account=await f.core.getUserMemory(),oldA=await f.core.leaseUserMemory(a.id,'Explain optics'),oldB=await f.core.leaseUserMemory(b.id,'Explain optics'),before=await f.core.getTask(a.id),saved=await f.core.projectCommand({type:'projects.memory.get',projectId:pa.id});
 await f.core.projectCommand({type:'projects.memory.change',projectId:pa.id,expectedRevision:2,change:{kind:'save',id:saved.facts[0].id,text:'A_EDITED',topics:[]}});
 expect(oldA.signal.aborted).toBe(true);expect(()=>oldA.assertCurrent()).toThrow('Memory changed');expect(oldB.signal.aborted).toBe(false);expect(()=>oldB.assertCurrent()).not.toThrow();
 await expect(f.core.runRequest({taskId:a.id,requestId:'stale-project-memory',kind:'explain',prompt:'Explain optics',memory:oldA.receipt},async()=>{throw Error('Must not run');})).rejects.toThrow('Memory changed');expect(await f.core.getTask(a.id)).toEqual(before);
 const current=await f.core.leaseUserMemory(a.id,'Explain optics');expect(current.projectFacts.map(fact=>fact.text)).toEqual(['A_EDITED']);
 await expect(f.core.runRequest({taskId:a.id,requestId:'foreign-project-memory',kind:'explain',prompt:'Explain optics',memory:{...current.receipt,project:oldB.receipt.project}},async()=>{throw Error('Must not run');})).rejects.toThrow('Memory changed');
 expect(await f.core.projectCommand({type:'projects.memory.change',projectId:pa.id,expectedRevision:0,change:{kind:'enabled',enabled:false}})).toMatchObject({kind:'conflict',current:{revision:3,enabled:true}});
 expect(()=>f.core.projectCommand({type:'projects.memory.change',projectId:pa.id,expectedRevision:3,change:{kind:'forget',id:saved.facts[0].id}})).toThrow();
 expect(()=>f.core.previewUserMemory({taskId:a.id,prompt:'Explain optics',projectId:pb.id})).toThrow();await expect(f.core.previewUserMemory({taskId:'missing',prompt:'Explain optics'})).rejects.toMatchObject({code:'not-found'});
 await f.core.projectCommand({type:'projects.assign',taskId:a.id,projectId:pb.id,expectedProjectId:pa.id});expect(()=>current.assertCurrent()).toThrow('Memory changed');expect((await f.core.previewUserMemory({taskId:a.id,prompt:'Explain optics'})).projectFacts.map(fact=>fact.text)).toEqual(['B_ONLY']);expect(await f.core.getUserMemory()).toEqual(account);
});
it('uses the same scoped selection in preview, consent and actual provider payload builders with master and project OFF',async()=>{
 const f=await fixture(),a=await f.core.createTask({title:'Optics A'}),b=await f.core.createTask({title:'Optics B'}),pa=await f.core.projectCommand({type:'projects.create',name:'A'}),pb=await f.core.projectCommand({type:'projects.create',name:'B'});
 await f.core.changeUserMemory({expectedRevision:0,change:{kind:'save',text:'ACCOUNT_CONTEXT',topics:[]}});await f.core.changeUserMemory({expectedRevision:1,change:{kind:'enabled',enabled:true}});
 for(const [task,project,text] of [[a,pa,'A_CONTEXT'],[b,pb,'B_CONTEXT']] as const){await f.core.projectCommand({type:'projects.assign',taskId:task.id,projectId:project.id,expectedProjectId:null});await f.core.projectCommand({type:'projects.memory.change',projectId:project.id,expectedRevision:0,change:{kind:'save',text,topics:[]}});await f.core.projectCommand({type:'projects.memory.change',projectId:project.id,expectedRevision:1,change:{kind:'enabled',enabled:true}});}
 const lease=await f.core.leaseUserMemory(a.id,'Explain optics'),preview=readMemoryPreview(await f.core.previewUserMemory({taskId:a.id,prompt:'Explain optics'}));expect(preview.receipt).toEqual(lease.receipt);expect(preview.facts.map(fact=>fact.text)).toEqual(['ACCOUNT_CONTEXT']);expect(preview.projectFacts.map(fact=>fact.text)).toEqual(['A_CONTEXT']);
 const context=userMemoryContext(undefined,lease)!;expect(JSON.parse(context).explicitUserMemory.facts).toEqual([{text:'ACCOUNT_CONTEXT'}]);expect(JSON.parse(context).explicitProjectMemory).toMatchObject({projectId:pa.id,facts:[{text:'A_CONTEXT'}]});
 for(const payload of [lease.consent,JSON.stringify(buildMetaMessages('Explain optics',[],context)),JSON.stringify(buildCodexInput({prompt:'Explain optics',sources:[],taskContext:context}))]){expect(payload).toContain('A_CONTEXT');expect(payload).toContain('ACCOUNT_CONTEXT');expect(payload).not.toContain('B_CONTEXT');}
 const account=await f.core.getUserMemory(),memory=await f.core.projectCommand({type:'projects.memory.get',projectId:pa.id}),projectOnly=selectTaskMemory(account,{title:a.title,goal:'',prompt:'Explain optics'},{...pa,memory,useAccountMemory:false});expect(projectOnly.facts).toEqual([]);expect(projectOnly.projectFacts.map(fact=>fact.text)).toEqual(['A_CONTEXT']);expect(taskMemoryConsent(projectOnly)).not.toContain('ACCOUNT_CONTEXT');expect(userMemoryContext(undefined,projectOnly)).not.toContain('ACCOUNT_CONTEXT');
 await f.core.changeUserMemory({expectedRevision:2,change:{kind:'enabled',enabled:false}});const off=await f.core.leaseUserMemory(a.id,'Explain optics');expect(off.facts).toEqual([]);expect(off.projectFacts).toEqual([]);expect(userMemoryContext(undefined,off)).toBeUndefined();expect(off.consent).not.toContain('A_CONTEXT');
 await f.core.changeUserMemory({expectedRevision:3,change:{kind:'enabled',enabled:true}});await f.core.projectCommand({type:'projects.memory.change',projectId:pa.id,expectedRevision:2,change:{kind:'enabled',enabled:false}});const projectOff=await f.core.previewUserMemory({taskId:a.id,prompt:'Explain optics'});expect(projectOff.projectFacts).toEqual([]);expect(projectOff.facts.map(fact=>fact.text)).toEqual(['ACCOUNT_CONTEXT']);expect((await f.core.previewUserMemory({taskId:b.id,prompt:'Explain optics'})).projectFacts.map(fact=>fact.text)).toEqual(['B_CONTEXT']);
});
it('shares the existing total fact and character limits while keeping receipt namespaces distinct',()=>{
 const account:UserMemory={revision:1,enabled:true,facts:Array.from({length:10},(_,index)=>({id:'account-'+index,revision:1,text:'Account '+index,topics:[]}))},memory:UserMemory={revision:1,enabled:true,facts:Array.from({length:6},(_,index)=>({id:'project-'+index,revision:1,text:'Project '+index,topics:[]}))},question={title:'',goal:'',prompt:'Explain'},scope={id:'project-a',name:'A',memory};
 const selected=readMemoryPreview(selectTaskMemory(account,question,scope));expect(selected.projectFacts.map(fact=>fact.text)).toEqual(['Project 0','Project 1','Project 2','Project 3','Project 4','Project 5']);expect(selected.facts.map(fact=>fact.text)).toEqual(['Account 0','Account 1']);expect(selected.receipt.omitted).toBe(8);
 const long=selectTaskMemory(account,question,{...scope,memory:{...memory,facts:memory.facts.map(fact=>({...fact,text:'x'.repeat(800)}))}});expect(long.projectFacts).toHaveLength(5);expect(long.facts).toEqual([]);expect(long.receipt.project?.omitted).toBe(1);
});
