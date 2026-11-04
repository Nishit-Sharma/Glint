import {it,expect,vi,afterEach} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../../src/core/companion';
import {emptyTaskSession} from '../../src/core/task-session';
import {BrowserReconciliation} from '../../src/host/browser/reconciliation';
import {LocalBrowser} from '../../src/host/browser/local-browser';
import {publicErrorMessage} from '../../src/shared/public-messages';

afterEach(()=>vi.restoreAllMocks());
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'inspection-binding-')),core=await createCompanion({dataDir:dir}),task=await core.createTask({title:'Owned action review'}),taskId=task.id;
 await core.runRequest({taskId,requestId:'old',kind:'browser',prompt:'Save once'},async()=>{throw Error('Uncertain');});
 const observation={id:'before',taskId,browserId:'old-browser',documentId:'old-document',url:'https://owned.invalid/form',title:'Form',text:'Form',digest:'before-digest',targets:[]};
 await core.replaceSession(taskId,0,{...emptyTaskSession(),runs:[{id:'old',endpointKey:'fixture',origin:'https://owned.invalid',browserId:'old-browser',initialObservation:observation,operations:[{id:'action',intent:{kind:'click',snapshotId:'before',targetId:'save'},reason:'Save once',status:'uncertain'}]}]});
 const fresh={...observation,id:'fresh',browserId:'new-browser',documentId:'new-document',url:'https://owned.invalid/receipt',text:'Receipt',digest:'fresh-digest'};
 const close=vi.fn(async()=>{}),observe=vi.fn(async()=>fresh);vi.spyOn(LocalBrowser,'open').mockResolvedValue({id:'new-browser',taskId,origin:'https://owned.invalid',observe,close} as unknown as LocalBrowser);
 const reconciliation=new BrowserReconciliation(core),input={taskId,runId:'old',operationId:'action',url:'https://owned.invalid/receipt'};
 async function change(reason:string){const session=(await core.getTask(taskId)).session!;await core.replaceSession(taskId,session.revision,{...session,runs:session.runs.map(run=>({...run,operations:run.operations.map(op=>({...op,reason}))}))});}
 return {core,taskId,reconciliation,input,change,observe,close,cleanup:async()=>{await core.close();await rm(dir,{recursive:true,force:true});}};
}

it('does not present an inspection when the uncertain action changes while observing',async()=>{
 const f=await fixture();let release!:()=>void,entered!:()=>void;const wait=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{entered=r;});const observe=f.observe.getMockImplementation()!;f.observe.mockImplementation(async()=>{entered();await wait;return observe();});
 try{const pending=f.reconciliation.inspect(f.input);await started;await f.change('Different action');release();await expect(pending).rejects.toThrow('changed');expect(f.close).toHaveBeenCalledOnce();const op=(await f.core.getTask(f.taskId)).session!.runs[0].operations[0];expect(op.status).toBe('uncertain');expect(op.reconciliation).toBeUndefined();}finally{release();await f.cleanup();}
});

it('does not apply a review to an action changed while the review decision is pending',async()=>{
 const f=await fixture();let release!:()=>void,entered!:()=>void;const wait=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{entered=r;});
 try{const inspection=await f.reconciliation.inspect(f.input),pending=f.reconciliation.resolve(inspection.id,async()=>{entered();await wait;return {outcome:'completed',note:'User reviewed the earlier action.'};});await started;await f.change('Different action');release();await expect(pending).rejects.toThrow('changed');const op=(await f.core.getTask(f.taskId)).session!.runs[0].operations[0];expect(op.status).toBe('uncertain');expect(op.reconciliation).toBeUndefined();}finally{release();await f.cleanup();}
});

it('allows a review after an unrelated session update',async()=>{
 const f=await fixture();try{const inspection=await f.reconciliation.inspect(f.input),session=(await f.core.getTask(f.taskId)).session!;await f.core.replaceSession(f.taskId,session.revision,{...session,draft:'Unrelated draft'});await f.reconciliation.resolve(inspection.id,async()=>({outcome:'completed',note:'Reviewed this receipt.'}));const op=(await f.core.getTask(f.taskId)).session!.runs[0].operations[0];expect(op.status).toBe('observed');expect(op.reconciliation?.observation.id).toBe('fresh');}finally{await f.cleanup();}
});

it.each(['intent','initial observation','run binding','earlier review'] as const)('rejects a stale decision when its %s changes',async changed=>{
 const f=await fixture();try{const inspection=await f.reconciliation.inspect(f.input),session=(await f.core.getTask(f.taskId)).session!;const runs=session.runs.map(run=>{
  const operation=run.operations[0];
  if(changed==='intent')return {...run,operations:[{...operation,intent:{kind:'click' as const,snapshotId:'before',targetId:'other'}}]};
  if(changed==='initial observation')return {...run,initialObservation:{...run.initialObservation,digest:'changed-digest'}};
  if(changed==='run binding')return {...run,browserId:'changed-browser'};
  return {...run,operations:[{...operation,reconciliation:{id:'other-review',outcome:'uncertain' as const,basis:'user-reviewed-observation' as const,note:'Earlier review',observation:inspection.observation}}]};
 });await f.core.replaceSession(f.taskId,session.revision,{...session,runs});await expect(f.reconciliation.resolve(inspection.id,async()=>({outcome:'completed',note:'Stale review'}))).rejects.toThrow('changed');const op=(await f.core.getTask(f.taskId)).session!.runs[0].operations[0];expect(op.status).toBe('uncertain');expect(op.reconciliation?.id).not.toBe(inspection.id);}finally{await f.cleanup();}
});

it.each(['task','browser','origin'] as const)('rejects a mismatched fresh observation %s before review',async mismatch=>{
 const f=await fixture();const original=f.observe.getMockImplementation()!;f.observe.mockImplementation(async()=>{const value=await original();return {...value,...(mismatch==='task'?{taskId:'other'}:mismatch==='browser'?{browserId:'other'}:{url:'https://other.invalid/receipt'})};});
 try{await expect(f.reconciliation.inspect(f.input)).rejects.toThrow('did not match');expect(f.close).toHaveBeenCalledOnce();expect((await f.core.getTask(f.taskId)).session!.runs[0].operations[0].status).toBe('uncertain');}finally{await f.cleanup();}
});


it('does not show a review when the action changed before the review callback',async()=>{
 const f=await fixture(),review=vi.fn(async()=>({outcome:'completed' as const,note:'Stale review'}));
 try{const inspection=await f.reconciliation.inspect(f.input);await f.change('Different action');await expect(f.reconciliation.resolve(inspection.id,review)).rejects.toThrow('changed');expect(review).not.toHaveBeenCalled();const op=(await f.core.getTask(f.taskId)).session!.runs[0].operations[0];expect(op.status).toBe('uncertain');expect(op.reconciliation).toBeUndefined();}finally{await f.cleanup();}
});

it('retains the session revision check if the action changes just before commit',async()=>{
 const f=await fixture();try{const inspection=await f.reconciliation.inspect(f.input),replace=f.core.replaceSession.bind(f.core);let intercepted=false;vi.spyOn(f.core,'replaceSession').mockImplementation(async(...args)=>{if(!intercepted){intercepted=true;await f.change('Changed at commit');}return replace(...args);});const error=await f.reconciliation.resolve(inspection.id,async()=>({outcome:'completed',note:'Earlier review'})).catch(error=>error);expect(error.message).toBe('The task changed while this outcome was being reviewed. Check the action and inspect again if needed.');expect(publicErrorMessage(error)).toBe('The task changed during review. Check the action’s current status and inspect again if needed.');const op=(await f.core.getTask(f.taskId)).session!.runs[0].operations[0];expect(op.reason).toBe('Changed at commit');expect(op.status).toBe('uncertain');expect(op.reconciliation).toBeUndefined();}finally{await f.cleanup();}
});


it('preserves non-conflict storage errors without reporting a revision conflict',async()=>{
 const f=await fixture();try{const inspection=await f.reconciliation.inspect(f.input),failure=Error('Owned storage failure');vi.spyOn(f.core,'replaceSession').mockRejectedValue(failure);const result=await f.reconciliation.resolve(inspection.id,async()=>({outcome:'completed',note:'Reviewed'})).catch(error=>error);expect(result).toBe(failure);const op=(await f.core.getTask(f.taskId)).session!.runs[0].operations[0];expect(op.status).toBe('uncertain');expect(op.reconciliation).toBeUndefined();}finally{await f.cleanup();}
});
