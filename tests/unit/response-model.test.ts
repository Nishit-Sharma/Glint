import {expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createCompanion} from '../../src/core/companion';
import {readProviderModelReceipt,confirmedResponseModel} from '../../src/shared/response-model';
import {parseCurrentState} from '../../src/core/store';

it('durably binds the confirmed logical model to the exact successful answer without exposing local transport metadata',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-response-model-'));let core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Synthetic model receipt'}),receipt={requestId:'exact-response',provider:'codex' as const,model:'gpt-6.1-sol',effort:'high',tier:'default' as const,confirmation:'accepted-thread-and-completed-turn' as const};
  const completed=await core.runRequest({taskId:task.id,requestId:receipt.requestId,kind:'explain',prompt:'Synthetic only.'},async()=>({title:'Synthetic answer',content:'Local fixture answer.',modelReceipt:receipt}));
  expect(completed.status).toBe('completed');expect(completed.responseModel).toEqual({...receipt,answer:completed.answer});
  await core.close();core=await createCompanion({dataDir:directory});const reopened=(await core.getTask(task.id)).requests[0];
  expect(reopened.responseModel).toEqual({...receipt,answer:completed.answer});expect(JSON.stringify(reopened.responseModel)).not.toMatch(/cliPath|account|threadId|turnId/);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

it('rejects a wrong-request receipt before saving an answer and never infers a model for legacy output',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-response-model-owner-')),core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Receipt owner'}),receipt={requestId:'another-response',provider:'codex' as const,model:'gpt-6-luna',effort:'medium',tier:'default' as const,confirmation:'accepted-thread-and-completed-turn' as const};
  const wrong=await core.runRequest({taskId:task.id,requestId:'owned-response',kind:'explain',prompt:'Synthetic only.'},async()=>({title:'Never saved',content:'Never saved',modelReceipt:receipt}));
  expect(wrong.status).toBe('failed');expect(wrong.answer).toBeUndefined();expect(wrong.responseModel).toBeUndefined();expect((await core.getTask(task.id)).artifacts).toEqual([]);
  const legacy=await core.runRequest({taskId:task.id,requestId:'legacy-response',kind:'explain',prompt:'Synthetic only.'},async()=>({title:'Legacy answer',content:'No receipt supplied.'}));
  expect(legacy.status).toBe('completed');expect(confirmedResponseModel(legacy)).toBeUndefined();
  expect(()=>readProviderModelReceipt({...receipt,cliPath:'/not-authorized'})).toThrow();
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

it('does not save a receipt for failed or cancelled work and rejects a stored answer mismatch',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-response-model-terminal-')),core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Terminal owner'}),receipt={requestId:'cancelled',provider:'codex' as const,model:'gpt-6-luna',effort:'medium',tier:'default' as const,confirmation:'accepted-thread-and-completed-turn' as const};
  const failed=await core.runRequest({taskId:task.id,requestId:'failed',kind:'explain',prompt:'Synthetic only.'},async()=>{throw Error('Synthetic provider failed.');});expect(failed.status).toBe('failed');expect(failed.responseModel).toBeUndefined();
  const cancelled=await core.runRequest({taskId:task.id,requestId:'cancelled',kind:'explain',prompt:'Synthetic only.'},async()=>{await core.cancelRequest(task.id,'cancelled');return {title:'Never saved',content:'Cancelled local result.',modelReceipt:receipt};});
  expect(cancelled.status).toBe('cancelled');expect(cancelled.responseModel).toBeUndefined();expect((await core.getTask(task.id)).artifacts).toEqual([]);
  const saved=await core.runRequest({taskId:task.id,requestId:'recorded',kind:'explain',prompt:'Synthetic only.'},async()=>({title:'Saved answer',content:'Local result.',modelReceipt:{...receipt,requestId:'recorded'}}));
  const owner=await core.getTask(task.id),state={schemaVersion:2,tasks:[owner],usedRequestIds:['failed','cancelled','recorded']};expect(parseCurrentState(state).tasks[0].requests.at(-1)?.responseModel).toEqual(saved.responseModel);
  const last=owner.requests.at(-1)!;last.responseModel={...last.responseModel!,answer:{...last.responseModel!.answer,digest:'a'.repeat(64)}};expect(()=>parseCurrentState(state)).toThrow();
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
