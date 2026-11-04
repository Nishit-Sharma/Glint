import {afterEach,expect,it,vi} from 'vitest';
import {readProjectCommand} from '../../src/shared/projects';
import {readMemoryChange} from '../../src/shared/user-memory';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../../src/core/companion';
import {selectTaskMemory,taskMemoryConsent,readMemoryPreview} from '../../src/shared/project-memory';
import {userMemoryContext} from '../../src/host/user-memory-context';
import {buildMetaMessages} from '../../src/host/provider';
import {buildCodexInput} from '../../src/host/codex-provider';
import type {UserMemory} from '../../src/shared/user-memory';

const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{vi.useRealTimers();for(const close of cleanup.splice(0))await close();});
async function fixture(now?:()=>Date){
 const directory=await mkdtemp(join(tmpdir(),'glint-project-memory-'));let core=await createCompanion({dataDir:directory,now});
 cleanup.push(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});
 return {get core(){return core;},async reopen(){await core.close();core=await createCompanion({dataDir:directory,now});}};
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
 await expect(f.core.projectCommand({type:'projects.memory.change',projectId:pa.id,expectedRevision:3,change:{kind:'forget',id:'foreign-or-missing'}})).rejects.toMatchObject({code:'not-found'});expect((await f.core.projectCommand({type:'projects.memory.get',projectId:pa.id})).facts[0].text).toBe('A_EDITED');
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

async function lifecycle(now:()=>Date){
 const f=await fixture(now),a=await f.core.createTask({title:'Lifecycle A'}),b=await f.core.createTask({title:'Lifecycle B'}),pa=await f.core.projectCommand({type:'projects.create',name:'Lifecycle A'}),pb=await f.core.projectCommand({type:'projects.create',name:'Lifecycle B'});
 await f.core.projectCommand({type:'projects.assign',taskId:a.id,projectId:pa.id,expectedProjectId:null});await f.core.projectCommand({type:'projects.assign',taskId:b.id,projectId:pb.id,expectedProjectId:null});
 await f.core.changeUserMemory({expectedRevision:0,change:{kind:'save',text:'ACCOUNT_STAYS',topics:[]}});await f.core.changeUserMemory({expectedRevision:1,change:{kind:'enabled',enabled:true}});
 for(const project of [pa,pb])await f.core.projectCommand({type:'projects.memory.change',projectId:project.id,expectedRevision:0,change:{kind:'enabled',enabled:true}});
 return {...f,get core(){return f.core;},a,b,pa,pb};
}
it('forgets only the exact current project fact, invalidates its lease, preserves account/other project and persists removal',async()=>{
 const f=await lifecycle(()=>new Date('2026-11-03T12:00:00.000Z'));
 for(const [project,text] of [[f.pa,'FORGET_A'],[f.pb,'KEEP_B']] as const)await f.core.projectCommand({type:'projects.memory.change',projectId:project.id,expectedRevision:1,change:{kind:'save',text,topics:[]}});
 const before=await f.core.projectCommand({type:'projects.memory.get',projectId:f.pa.id}),account=await f.core.getUserMemory(),other=await f.core.projectCommand({type:'projects.memory.get',projectId:f.pb.id}),task=await f.core.getTask(f.a.id),a=await f.core.leaseUserMemory(f.a.id,'Question'),b=await f.core.leaseUserMemory(f.b.id,'Question');
 expect((await f.core.projectCommand({type:'projects.memory.change',projectId:f.pa.id,expectedRevision:1,change:{kind:'forget',id:before.facts[0].id}})).kind).toBe('conflict');
 await expect(f.core.projectCommand({type:'projects.memory.change',projectId:f.pa.id,expectedRevision:2,change:{kind:'forget',id:other.facts[0].id}})).rejects.toMatchObject({code:'not-found'});expect(await f.core.projectCommand({type:'projects.memory.get',projectId:f.pa.id})).toEqual(before);
 await f.core.projectCommand({type:'projects.memory.change',projectId:f.pa.id,expectedRevision:2,change:{kind:'forget',id:before.facts[0].id}});
 expect(a.signal.aborted).toBe(true);expect(()=>a.assertCurrent()).toThrow('Memory changed');expect(()=>b.assertCurrent()).not.toThrow();expect(await f.core.getUserMemory()).toEqual(account);expect(await f.core.projectCommand({type:'projects.memory.get',projectId:f.pb.id})).toEqual(other);expect(await f.core.getTask(f.a.id)).toEqual(task);
 a.release();b.release();await f.reopen();expect((await f.core.previewUserMemory({taskId:f.a.id,prompt:'Question'})).projectFacts).toEqual([]);expect((await f.core.previewUserMemory({taskId:f.b.id,prompt:'Question'})).projectFacts[0].text).toBe('KEEP_B');
});
it('expires at the host-clock boundary even without timer delivery, refuses stale receipts before append and explicitly reactivates on edit',async()=>{
 let now=new Date('2026-11-03T12:00:00.000Z');const f=await lifecycle(()=>now),expiresAt='2026-11-03T12:01:00.000Z';
 const saved=await f.core.projectCommand({type:'projects.memory.change',projectId:f.pa.id,expectedRevision:1,change:{kind:'save',text:'EXPIRE_A',topics:[],expiresAt}});expect(saved.kind).toBe('saved');
 const lease=await f.core.leaseUserMemory(f.a.id,'Question'),before=await f.core.getTask(f.a.id);expect(lease.projectFacts[0].expiresAt).toBe(expiresAt);now=new Date(expiresAt);
 expect(()=>lease.assertCurrent()).toThrow('Memory changed');expect(lease.signal.aborted).toBe(true);expect((await f.core.previewUserMemory({taskId:f.a.id,prompt:'Question'})).projectFacts).toEqual([]);
 await expect(f.core.runRequest({taskId:f.a.id,requestId:'expired-before-send',kind:'explain',prompt:'Question',memory:lease.receipt},async()=>{throw Error('Must not send');})).rejects.toThrow('Memory changed');expect(await f.core.getTask(f.a.id)).toEqual(before);lease.release();
 await f.reopen();const expired=await f.core.projectCommand({type:'projects.memory.get',projectId:f.pa.id});expect(expired.facts[0].expiresAt).toBe(expiresAt);expect((await f.core.previewUserMemory({taskId:f.a.id,prompt:'Question'})).projectFacts).toEqual([]);
 await f.core.projectCommand({type:'projects.memory.change',projectId:f.pa.id,expectedRevision:2,change:{kind:'save',id:expired.facts[0].id,text:expired.facts[0].text,topics:[]}});expect((await f.core.previewUserMemory({taskId:f.a.id,prompt:'Question'})).projectFacts[0]).not.toHaveProperty('expiresAt');
 await f.core.setTaskMemoryPolicy({type:'memory.task.set',taskId:f.a.id,expectedRevision:0,mode:'off'});expect((await f.core.previewUserMemory({taskId:f.a.id,prompt:'Question'})).projectFacts).toEqual([]);
});
it('strictly admits only project UTC save deadlines, preserving account and unsupported-command boundaries',()=>{
 const base={type:'projects.memory.change',projectId:'project',expectedRevision:0},save={kind:'save',text:'Fact',topics:[]};
 for(const expiresAt of ['not-a-date','2026-11-03','2026-11-03T12:00:00Z','2026-11-03T12:00:00.000+00:00','2026-02-30T12:00:00.000Z'])expect(()=>readProjectCommand({...base,change:{...save,expiresAt}})).toThrow();
 expect(()=>readProjectCommand({...base,change:{...save,expiresAt:'2026-11-03T12:00:00.000Z'}})).not.toThrow();
 for(const change of [{kind:'forget',id:'fact',expiresAt:'2026-11-03T12:00:00.000Z'},{kind:'enabled',enabled:true,expiresAt:'2026-11-03T12:00:00.000Z'},{kind:'undo',id:'fact',historyRevision:1,expectedFactRevision:1,expectedAfterHash:'0'.repeat(64)}])expect(()=>readProjectCommand({...base,change})).toThrow();
 expect(()=>readMemoryChange({expectedRevision:0,change:{...save,expiresAt:'2026-11-03T12:00:00.000Z'}})).toThrow();
});
it('cancels an in-flight selected-fact provider lease at expiry and Stop remains effective without publishing a result',async()=>{
 let now=new Date('2026-11-03T12:00:00.000Z');const f=await lifecycle(()=>now);await f.core.projectCommand({type:'projects.memory.change',projectId:f.pa.id,expectedRevision:1,change:{kind:'save',text:'TEMPORARY',topics:[],expiresAt:'2026-11-03T12:00:01.000Z'}});
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});const lease=await f.core.leaseUserMemory(f.a.id,'Question');let entered!:()=>void;const started=new Promise<void>(resolve=>entered=resolve);
 const running=f.core.runRequest({taskId:f.a.id,requestId:'inflight-expiry',kind:'explain',prompt:'Question',memory:lease.receipt},async context=>{const signal=AbortSignal.any([context.signal,lease.signal]);entered();await new Promise<void>((_,reject)=>signal.addEventListener('abort',()=>reject(Error('Provider lease cancelled')),{once:true}));return {title:'Never accepted',content:'NEVER',mimeType:'text/plain'};},lease.assertCurrent);
 await started;now=new Date('2026-11-03T12:00:01.000Z');await vi.advanceTimersByTimeAsync(1000);expect(lease.signal.aborted).toBe(true);await running;expect((await f.core.getTask(f.a.id)).artifacts).toEqual([]);lease.release();
 const current=await f.core.leaseUserMemory(f.a.id,'Question');let stopEntered!:()=>void;const stopped=new Promise<void>(resolve=>stopEntered=resolve);const stop=f.core.runRequest({taskId:f.a.id,requestId:'explicit-stop',kind:'explain',prompt:'Question',memory:current.receipt},async ctx=>{stopEntered();await new Promise<void>((_,reject)=>ctx.signal.addEventListener('abort',()=>reject(Error('Stopped')),{once:true}));return {title:'Never',content:'NEVER'};},current.assertCurrent);await stopped;await f.core.cancelRequest(f.a.id,'explicit-stop');expect((await stop).status).toBe('cancelled');current.release();
});
it('does not arm unselected or disabled fact deadlines and caps far-future lease timers without premature abort',async()=>{
 let now=new Date('2026-11-03T12:00:00.000Z');const f=await lifecycle(()=>now);await f.core.projectCommand({type:'projects.memory.change',projectId:f.pa.id,expectedRevision:1,change:{kind:'save',text:'TOPIC_ONLY',topics:['unmatched'],expiresAt:'2026-11-03T12:00:01.000Z'}});
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});const none=await f.core.leaseUserMemory(f.a.id,'Question');expect(vi.getTimerCount()).toBe(0);now=new Date('2026-11-03T12:00:02.000Z');none.assertCurrent();none.release();
 await f.core.projectCommand({type:'projects.memory.change',projectId:f.pa.id,expectedRevision:2,change:{kind:'save',text:'FAR_FUTURE',topics:[],expiresAt:'2027-11-03T12:00:00.000Z'}});
 const far=await f.core.leaseUserMemory(f.a.id,'Question');expect(vi.getTimerCount()).toBe(1);now=new Date(now.getTime()+2_147_483_647);await vi.advanceTimersByTimeAsync(2_147_483_647);expect(far.signal.aborted).toBe(false);far.assertCurrent();expect(vi.getTimerCount()).toBe(1);far.release();expect(vi.getTimerCount()).toBe(0);
 await f.core.projectCommand({type:'projects.memory.change',projectId:f.pa.id,expectedRevision:3,change:{kind:'enabled',enabled:false}});const off=await f.core.leaseUserMemory(f.a.id,'Question');expect(off.projectFacts).toEqual([]);expect(vi.getTimerCount()).toBe(0);off.release();
});
