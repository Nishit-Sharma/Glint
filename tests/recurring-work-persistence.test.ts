import {expect,test,vi} from 'vitest';
vi.mock('node:fs/promises',{spy:true});
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
const real=await vi.importActual<typeof fs>('node:fs/promises');

test.each(['before replacement','after replacement'] as const)('failed schedule preparation %s reconciles on reopen without duplicate drafts',async phase=>{
 const directory=await real.mkdtemp(join(tmpdir(),'glint-recurring-save-fail-')),now=()=>new Date('2026-10-31T08:00:00.000Z');let core=await createCompanion({dataDir:directory,now});
 try{
  await core.changeRecurringWork({kind:'save',id:'owned',expectedRevision:0,title:'Durable draft',instruction:'Keep this unsent.',intervalHours:24,nextDueAt:now().toISOString()});
  if(phase==='before replacement')vi.spyOn(fs,'rename').mockRejectedValueOnce(Error('Synthetic replacement failure'));
  else vi.spyOn(fs,'open').mockImplementationOnce((...args)=>real.open(...args)).mockImplementationOnce(async(...args)=>{const handle=await real.open(...args);handle.sync=async()=>{throw Error('Synthetic directory sync failure');};return handle;});
  await expect(core.prepareRecurringWork('bot')).rejects.toThrow();await expect(core.prepareRecurringWork('bot')).rejects.toThrow('persistence failed');
  vi.restoreAllMocks();await core.close();core=await createCompanion({dataDir:directory,now});
  const prepared=await core.prepareRecurringWork('bot');expect(prepared).toHaveLength(phase==='before replacement'?1:0);expect(await core.listTasks()).toHaveLength(1);const [schedule]=await core.getRecurringWork();expect(schedule.history).toHaveLength(1);expect((await core.getTask(schedule.history[0].taskId)).session?.draft).toBe('Keep this unsent.');expect(await core.prepareRecurringWork('bot')).toEqual([]);
 }finally{vi.restoreAllMocks();await core.close();await real.rm(directory,{recursive:true,force:true});}
});

test.each(['before replacement','after replacement'] as const)('response claim failure %s never replays an unverified durable occurrence',async phase=>{
 const directory=await real.mkdtemp(join(tmpdir(),'glint-response-claim-fail-')),now=()=>new Date('2026-10-31T08:00:00.000Z');let core=await createCompanion({dataDir:directory,now});
 try{
  await core.changeRecurringWork({kind:'save',id:'response',expectedRevision:0,title:'Synthetic response',instruction:'Owned synthetic question.',mode:'response',timeZone:'Etc/UTC',intervalHours:24,nextDueAt:now().toISOString()});let [item]=await core.getRecurringWork();await core.changeRecurringWork({kind:'resume',id:item.id,expectedRevision:item.revision});
  if(phase==='before replacement')vi.spyOn(fs,'rename').mockRejectedValueOnce(Error('Synthetic claim replacement failure'));
  else vi.spyOn(fs,'open').mockImplementationOnce((...args)=>real.open(...args)).mockImplementationOnce(async(...args)=>{const handle=await real.open(...args);handle.sync=async()=>{throw Error('Synthetic claim acknowledgement failure');};return handle;});
  await expect(core.prepareRecurringWork('bot',()=>{},['response'])).rejects.toThrow();vi.restoreAllMocks();await core.close();core=await createCompanion({dataDir:directory,now});[item]=await core.getRecurringWork();expect(item.enabled).toBe(false);expect(await core.prepareRecurringWork('bot',()=>{},['response'])).toEqual([]);
  expect(item.history).toHaveLength(phase==='before replacement'?0:1);if(phase==='after replacement'){expect(item.history[0].status).toBe('interrupted');expect((await core.listTasks())[0].requests).toEqual([]);}expect(await core.listTasks()).toHaveLength(phase==='before replacement'?0:1);
 }finally{vi.restoreAllMocks();await core.close();await real.rm(directory,{recursive:true,force:true});}
});
