import {expect,test,vi} from 'vitest';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {createRecurringWorkRunner,RECURRING_CHECK_INTERVAL_MS} from '../src/host/recurring-work-runner';
import {readRecurringWorkChange} from '../src/shared/recurring-work';

const first='2026-10-31T08:00:00.000Z';
const save={kind:'save' as const,id:'daily-review',expectedRevision:0,title:'Review draft',instruction:'Review this week’s priorities.',intervalHours:24 as const,nextDueAt:first};
test('a recurring schedule prepares unsent tasks exactly once across ticks/restart, coalesces missed times and supports edits/pause/resume/delete',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-recurring-'));let time=new Date('2026-10-31T07:59:00.000Z'),core=await createCompanion({dataDir:directory,now:()=>time});
 try{
  const original=await core.createTask({title:'Keep unrelated task'});
  expect(await core.getRecurringWork()).toEqual([]);await core.changeRecurringWork(save);
  expect(await core.prepareRecurringWork('bot-a')).toEqual([]);
  time=new Date(first);
  const results=await Promise.all([core.prepareRecurringWork('bot-a'),core.prepareRecurringWork('bot-a')]),id=results.flat()[0];expect(results.map(result=>result.length)).toEqual([1,0]);
  expect(await core.getTask(id)).toMatchObject({goal:save.instruction,assignedBotId:'bot-a',session:{draft:save.instruction,draftKind:'explain'},requests:[],sources:[],artifacts:[],actions:[]});
  let [schedule]=await core.getRecurringWork();expect(schedule).toMatchObject({revision:2,nextDueAt:'2026-11-01T08:00:00.000Z',history:[{taskId:id,scheduledFor:first,preparedAt:first,skipped:0}]});
  await expect(core.changeRecurringWork({...save,title:'Stale edit'})).rejects.toThrow('changed');
  await core.close();core=await createCompanion({dataDir:directory,now:()=>time});expect(await core.prepareRecurringWork('bot-a')).toEqual([]);
  time=new Date('2026-11-04T09:00:00.000Z');const overdue=await core.prepareRecurringWork('bot-a');expect(overdue).toHaveLength(1);
  [schedule]=await core.getRecurringWork();expect(schedule.history.at(-1)).toMatchObject({taskId:overdue[0],scheduledFor:'2026-11-04T08:00:00.000Z',skipped:3});expect(schedule.nextDueAt).toBe('2026-11-05T08:00:00.000Z');
  await core.changeRecurringWork({kind:'pause',id:save.id,expectedRevision:schedule.revision});time=new Date('2026-11-12T08:00:00.000Z');expect(await core.prepareRecurringWork('bot-b')).toEqual([]);
  [schedule]=await core.getRecurringWork();await core.changeRecurringWork({...save,expectedRevision:schedule.revision,title:'Weekly review',intervalHours:168,nextDueAt:'2026-11-13T08:00:00.000Z'});
  [schedule]=await core.getRecurringWork();expect(schedule.enabled).toBe(false);expect(schedule.history).toHaveLength(2);
  await core.changeRecurringWork({kind:'resume',id:save.id,expectedRevision:schedule.revision});expect(await core.prepareRecurringWork('bot-b')).toEqual([]);
  time=new Date('2026-11-13T08:00:00.000Z');expect(await core.prepareRecurringWork('bot-b')).toHaveLength(1);
  [schedule]=await core.getRecurringWork();expect(schedule.nextDueAt).toBe('2026-11-20T08:00:00.000Z');await core.changeRecurringWork({kind:'delete',id:save.id,expectedRevision:schedule.revision});expect(await core.getRecurringWork()).toEqual([]);expect(await core.getTask(original.id)).toEqual(original);expect(await core.listTasks()).toHaveLength(4);
  time=new Date('2026-12-20T08:00:00.000Z');expect(await core.prepareRecurringWork('bot-a')).toEqual([]);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

test('strict schedule inputs and stopped guards preserve saved schedules; invalid store bytes are never overwritten',async()=>{
 for(const value of [{...save,provider:'run'},{...save,intervalHours:1},{...save,nextDueAt:'2026-10-31 08:00'},{...save,instruction:' '},{...save,expectedRevision:-1}])expect(()=>readRecurringWorkChange(value)).toThrow();
 const directory=await mkdtemp(join(tmpdir(),'glint-recurring-invalid-')),core=await createCompanion({dataDir:directory,now:()=>new Date(first)});
 try{
  await core.changeRecurringWork(save);const before=await readFile(join(directory,'tasks.json'),'utf8');await expect(core.prepareRecurringWork('bot',()=>{throw Error('Stopped');})).rejects.toThrow('Stopped');expect(await readFile(join(directory,'tasks.json'),'utf8')).toBe(before);
  await core.close();const bad=JSON.stringify({...JSON.parse(before),recurringWork:[{...JSON.parse(before).recurringWork[0],provider:'run'}]});await writeFile(join(directory,'tasks.json'),bad);await expect(createCompanion({dataDir:directory})).rejects.toThrow('unreadable');expect(await readFile(join(directory,'tasks.json'),'utf8')).toBe(bad);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

test('app-lifetime runner checks automatically, prevents overlap, drains on stop, and reports errors truthfully',async()=>{
 vi.useFakeTimers();let release:()=>void=()=>{},guard:()=>void=()=>{},calls=0;const changes:string[][]=[];
 const runner=createRecurringWorkRunner({prepare:async current=>{calls++;guard=current;await new Promise<void>(resolve=>{release=resolve;});current();return ['task'];},changed:ids=>changes.push(ids)});
 try{
  runner.start();expect(calls).toBe(1);await vi.advanceTimersByTimeAsync(RECURRING_CHECK_INTERVAL_MS*3);expect(calls).toBe(1);
  const stop=runner.stop();expect(()=>guard()).toThrow('stopped');release();await stop;expect(changes).toEqual([]);expect(runner.read().state).toBe('stopped');await vi.advanceTimersByTimeAsync(RECURRING_CHECK_INTERVAL_MS);expect(calls).toBe(1);
  runner.start();expect(calls).toBe(2);release();await vi.advanceTimersByTimeAsync(0);expect(changes).toEqual([['task']]);expect(runner.read().state).toBe('ready');
  await vi.advanceTimersByTimeAsync(RECURRING_CHECK_INTERVAL_MS);expect(calls).toBe(3);release();await vi.advanceTimersByTimeAsync(0);
 }finally{release();await runner.stop();vi.useRealTimers();}
 const failing=createRecurringWorkRunner({prepare:async()=>{throw Error('Store unavailable');},changed:()=>{}});failing.start();await new Promise(resolve=>setImmediate(resolve));expect(failing.read()).toMatchObject({state:'error'});await failing.stop();
});


test('response occurrences are durably claimed once, restart requires authorization, and known completion reconciles without replay',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-response-recovery-'));let time=new Date(first),core=await createCompanion({dataDir:directory,now:()=>time});
 try{
  await core.changeRecurringWork({...save,mode:'response',timeZone:'America/New_York'});let [item]=await core.getRecurringWork();expect(item.enabled).toBe(false);await core.changeRecurringWork({kind:'resume',id:item.id,expectedRevision:item.revision});
  expect(await core.prepareRecurringWork('bot')).toEqual([]);const [taskId]=await core.prepareRecurringWork('bot',()=>{},[save.id]);[item]=await core.getRecurringWork();const run=item.history[0];expect(run.status).toBe('running');expect(run.requestId).toBeTruthy();expect(await core.prepareRecurringWork('bot',()=>{},[save.id])).toEqual([]);
  await core.runRequest({taskId,requestId:run.requestId!,kind:'explain',prompt:save.instruction,sourceIds:[],expectedSourceRefs:[],executionScope:'synthetic-recurring'},async()=>({title:'Synthetic response',content:'Saved known completion.'}));
  await core.close();core=await createCompanion({dataDir:directory,now:()=>time});[item]=await core.getRecurringWork();expect(item.enabled).toBe(false);expect(item.history[0]).toMatchObject({taskId,status:'completed',requestId:run.requestId});expect(await core.prepareRecurringWork('bot',()=>{},[save.id])).toEqual([]);
  time=new Date('2026-11-03T08:00:00.000Z');await core.changeRecurringWork({kind:'resume',id:item.id,expectedRevision:item.revision});const [unknownId]=await core.prepareRecurringWork('bot',()=>{},[save.id]);await core.close();core=await createCompanion({dataDir:directory,now:()=>time});[item]=await core.getRecurringWork();expect(item.enabled).toBe(false);expect(item.history.at(-1)).toMatchObject({taskId:unknownId,status:'interrupted',skipped:2});expect(await core.prepareRecurringWork('bot',()=>{},[save.id])).toEqual([]);expect(await core.listTasks()).toHaveLength(2);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

test('elapsed-hour cadence preserves instants across DST and rejects invalid timezones and overflow dates',()=>{
 expect(()=>readRecurringWorkChange({...save,timeZone:'not/a-zone'})).toThrow();expect(()=>readRecurringWorkChange({...save,nextDueAt:'+275760-09-13T00:00:00.000Z'})).toThrow();
 const before=new Date('2026-10-31T12:00:00.000Z'),after=new Date(before.getTime()+24*3_600_000),format=new Intl.DateTimeFormat('en',{timeZone:'America/New_York',hour:'numeric',hourCycle:'h23'});expect(format.format(before)).toBe('08');expect(format.format(after)).toBe('07');
});


test('a held response edited to draft reconciles its running history after crash/reopen and later drafts remain schedulable',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-response-mode-recovery-'));let time=new Date(first),core=await createCompanion({dataDir:directory,now:()=>time}),release:()=>void=()=>{};
 try{
  await core.changeRecurringWork({...save,mode:'response'});let [item]=await core.getRecurringWork();await core.changeRecurringWork({kind:'resume',id:item.id,expectedRevision:item.revision});const [taskId]=await core.prepareRecurringWork('bot',()=>{},[item.id]);[item]=await core.getRecurringWork();const requestId=item.history[0].requestId!;
  let started:()=>void=()=>{};const observed=new Promise<void>(resolve=>started=resolve),held=new Promise<void>(resolve=>release=resolve);
  const pending=core.runRequest({taskId,requestId,kind:'explain',prompt:save.instruction,sourceIds:[],expectedSourceRefs:[]},async()=>{started();await held;return {title:'Late synthetic answer',content:'Must not be accepted after close.'};});await observed;
  await core.changeRecurringWork({...save,expectedRevision:item.revision});expect((await core.getRecurringWork())[0].mode).toBeUndefined();await core.close();release();await expect(pending).rejects.toThrow('closed');
  core=await createCompanion({dataDir:directory,now:()=>time});[item]=await core.getRecurringWork();expect(item.mode).toBeUndefined();expect(item.enabled).toBe(true);expect(item.history[0]).toMatchObject({taskId,status:'interrupted'});expect((await core.getTask(taskId)).requests[0].status).toBe('interrupted');
  time=new Date(item.nextDueAt);expect(await core.prepareRecurringWork('bot')).toHaveLength(1);[item]=await core.getRecurringWork();expect(item.history).toHaveLength(2);expect(item.history[1].status).toBeUndefined();expect((await core.getTask(item.history[1].taskId)).session?.draft).toBe(save.instruction);
 }finally{release();await core.close();await rm(directory,{recursive:true,force:true});}
});
