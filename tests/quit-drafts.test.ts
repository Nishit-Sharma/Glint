import {afterEach,expect,it,vi} from 'vitest';
import {createQuitDraftBarrier} from '../src/host/quit-drafts';
afterEach(()=>vi.useRealTimers());
it('waits for the exact durable acknowledgement and shares repeated Quit',async()=>{
 let id='';const discard=vi.fn(async()=>false),barrier=createQuitDraftBarrier({send:nonce=>{id=nonce;},confirmDiscard:discard});
 const pending=barrier.request();expect(barrier.request()).toBe(pending);await Promise.resolve();expect(id).not.toBe('');
 expect(barrier.acknowledge('old-quit')).toBe(false);let settled=false;void pending.then(()=>{settled=true;});await Promise.resolve();expect(settled).toBe(false);
 expect(barrier.acknowledge(id)).toBe(true);expect(await pending).toEqual({id,allowQuit:true,saved:true});expect(discard).not.toHaveBeenCalled();expect(barrier.acknowledge(id)).toBe(false);
});
it('keeps the app open on save failure unless discarding is explicitly chosen',async()=>{
 let id='';const discard=vi.fn(async()=>false),barrier=createQuitDraftBarrier({send:nonce=>{id=nonce;},confirmDiscard:discard});
 const first=barrier.request();await Promise.resolve();barrier.acknowledge(id,'Disk unavailable');expect(await first).toEqual({id,allowQuit:false,saved:false});
 const old=id,next=barrier.request();await Promise.resolve();expect(id).not.toBe(old);expect(barrier.acknowledge(old)).toBe(false);barrier.acknowledge(id);expect((await next).saved).toBe(true);expect(discard).toHaveBeenCalledOnce();
});
it('a missing renderer cannot turn an animation timeout into silently discarded messages',async()=>{
 vi.useFakeTimers();const discard=vi.fn(async()=>false),barrier=createQuitDraftBarrier({send:()=>{},confirmDiscard:discard,timeoutMs:10});
 const pending=barrier.request();await vi.advanceTimersByTimeAsync(10);expect(await pending).toMatchObject({allowQuit:false,saved:false});expect(discard).toHaveBeenCalledOnce();
});
it('permits explicit discard after a failed flush and fails closed if its dialog fails',async()=>{
 for(const answer of [true,'failure'] as const){let id='';const barrier=createQuitDraftBarrier({send:nonce=>{id=nonce;},confirmDiscard:async()=>{if(answer==='failure')throw Error('Unavailable dialog');return answer;}});const pending=barrier.request();await Promise.resolve();barrier.acknowledge(id,'Save failed');expect((await pending).allowQuit).toBe(answer===true);}
});
