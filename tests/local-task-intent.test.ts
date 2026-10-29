import {expect,test,vi} from 'vitest';
import {createLocalTaskIntent} from '../src/renderer/src/local-task-intent';
import type {LocalTaskStartInput,LocalTaskStartResult,LocalTaskStartValue} from '../src/shared/local-task-start';

const value:LocalTaskStartValue={kind:'text',title:'Owned notes',content:'Keep this exact text.\nSecond line.'};
const result:LocalTaskStartResult={kind:'text',sourceId:'owned-source',task:{id:'owned-task',title:'Owned notes',goal:'',status:'active',createdAt:'2026-10-26T00:00:00Z',updatedAt:'2026-10-26T00:00:00Z',sources:[],artifacts:[],requests:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false}}};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}

test('rapid duplicate creates send one immutable local save and navigate once',async()=>{
 const response=deferred<LocalTaskStartResult|undefined>(),send=vi.fn((_input:Readonly<LocalTaskStartInput>)=>response.promise),onCreated=vi.fn(),createId=vi.fn(()=>'local-intent-one');
 const intent=createLocalTaskIntent({send,onCreated,createId});
 const pending=intent.submit(value);await intent.submit({...value,content:'A different click must not replace the in-flight text.'});
 expect(intent.snapshot().kind).toBe('saving');expect(send).toHaveBeenCalledTimes(1);expect(createId).toHaveBeenCalledTimes(1);
 expect(send.mock.calls[0][0]).toEqual({intentId:'local-intent-one',...value});
 response.resolve(result);await pending;
 expect(intent.snapshot().kind).toBe('completed');expect(onCreated).toHaveBeenCalledTimes(1);expect(onCreated).toHaveBeenCalledWith(result);
 await intent.submit(value);await intent.retry();expect(send).toHaveBeenCalledTimes(1);
});

test('a lost response retries the same frozen payload and intent despite later form mutations',async()=>{
 const send=vi.fn<(input:Readonly<LocalTaskStartInput>)=>Promise<LocalTaskStartResult|undefined>>().mockResolvedValueOnce(undefined).mockResolvedValueOnce(result),onCreated=vi.fn(),createId=vi.fn(()=>'lost-response-intent');
 const intent=createLocalTaskIntent({send,onCreated,createId}),editable={...value,title:'',content:'First source line\r\n  Preserve spacing.  '};
 await intent.submit(editable);expect(intent.snapshot().kind).toBe('uncertain');expect(onCreated).not.toHaveBeenCalled();
 editable.content='Later edit must not change the saved attempt.';editable.title='Later title';
 await intent.submit(editable);expect(send).toHaveBeenCalledTimes(1);
 await intent.retry();
 expect(send).toHaveBeenCalledTimes(2);expect(createId).toHaveBeenCalledTimes(1);expect(send.mock.calls[1][0]).toBe(send.mock.calls[0][0]);
 expect(send.mock.calls[1][0]).toEqual({intentId:'lost-response-intent',kind:'text',title:'First source line',content:'First source line\r\n  Preserve spacing.  '});
 expect(Object.isFrozen(send.mock.calls[1][0])).toBe(true);expect(onCreated).toHaveBeenCalledTimes(1);
});

test('a rejected save stays uncertain and a deliberate retry uses the original intent',async()=>{
 const send=vi.fn<(input:Readonly<LocalTaskStartInput>)=>Promise<LocalTaskStartResult|undefined>>().mockRejectedValueOnce(Error('The reply was lost after saving.')).mockResolvedValueOnce(result),onCreated=vi.fn();
 const intent=createLocalTaskIntent({send,onCreated,createId:()=> 'rejected-reply-intent'});
 await expect(intent.submit(value)).resolves.toBeUndefined();expect(intent.snapshot().kind).toBe('uncertain');
 await intent.retry();expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]);expect(onCreated).toHaveBeenCalledWith(result);
});

test('cancel before creation sends nothing and allocates no save intent',async()=>{
 const send=vi.fn(),createId=vi.fn(()=>'unused-intent'),onCreated=vi.fn(),intent=createLocalTaskIntent({send,createId,onCreated});
 intent.leave();await intent.submit(value);await intent.retry();
 expect(intent.snapshot().kind).toBe('left');expect(createId).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();expect(onCreated).not.toHaveBeenCalled();
});

test('unmount during a save suppresses both late navigation and UI notifications',async()=>{
 let active=true;const response=deferred<LocalTaskStartResult|undefined>(),onCreated=vi.fn(),onState=vi.fn(),send=vi.fn((_input:Readonly<LocalTaskStartInput>)=>response.promise);
 const intent=createLocalTaskIntent({send,onCreated,onState,createId:()=> 'unmounted-intent',isActive:()=>active});
 const pending=intent.submit(value);expect(onState).toHaveBeenCalledTimes(1);active=false;response.resolve(result);await pending;
 expect(onState).toHaveBeenCalledTimes(1);expect(onCreated).not.toHaveBeenCalled();expect(intent.snapshot().kind).toBe('completed');
 await intent.submit(value);await intent.retry();expect(send).toHaveBeenCalledTimes(1);
});

test('leaving an uncertain save prevents further attempts without claiming a rollback',async()=>{
 const send=vi.fn<(input:Readonly<LocalTaskStartInput>)=>Promise<LocalTaskStartResult|undefined>>().mockResolvedValue(undefined),onCreated=vi.fn();
 const intent=createLocalTaskIntent({send,onCreated,createId:()=> 'abandoned-intent'});
 await intent.submit(value);intent.leave();await intent.retry();await intent.submit(value);
 expect(intent.snapshot().kind).toBe('left');expect(send).toHaveBeenCalledTimes(1);expect(onCreated).not.toHaveBeenCalled();
});

test('a deliberate new form receives a new intent while an effect remount does not disable the current form',async()=>{
 let active=false,serial=0;const send=vi.fn<(input:Readonly<LocalTaskStartInput>)=>Promise<LocalTaskStartResult|undefined>>().mockResolvedValue(result),createId=()=>`form-intent-${++serial}`;
 const first=createLocalTaskIntent({send,createId,onCreated:vi.fn(),isActive:()=>active});
 await first.submit(value);expect(send).not.toHaveBeenCalled();active=true;await first.submit(value);
 const second=createLocalTaskIntent({send,createId,onCreated:vi.fn(),isActive:()=>active});await second.submit(value);
 expect(send.mock.calls.map(call=>call[0].intentId)).toEqual(['form-intent-1','form-intent-2']);
});
