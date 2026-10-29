import {expect,test} from 'vitest';
import {createLearningDrafts} from '../src/renderer/src/learning-drafts';
import {learningDraftKey,type LearningDraftSaveResult,type LearningDraftValue} from '../src/shared/learning-drafts';
const owner={taskId:'owned',artifactId:'artifact',artifactRevision:1,artifactDigest:'digest',moduleId:'join',moduleVersion:1},slot='join:prediction:practice',initial={prediction:'',reasoning:''},basis='exact inputs';
function boundary(){
 const calls:{value:LearningDraftValue|null;finish:(value:LearningDraftSaveResult)=>void}[]=[];
 const cache=createLearningDrafts({read:async()=>({kind:'available',epoch:'initial',records:[]}),save:(owner,slot,epoch,revision,value)=>new Promise(resolve=>{calls.push({value,finish:()=>resolve({kind:'saved',epoch,record:{owner,slot,revision:revision+1,value}})});})});
 return {cache,calls,accept(index:number){calls[index].finish({kind:'stale-epoch',epoch:'initial'});}};
}
const tick=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};

test('known input rejection is explicit and atomic, shared by exact form, and never echoes attempted private text',async()=>{
 const {cache,calls,accept}=boundary();await cache.load();cache.edit(owner,slot,initial,basis,()=>({prediction:'0',reasoning:'accepted'}));await tick();accept(0);await cache.flush();const before=cache.getSnapshot().entries[learningDraftKey(owner,slot)],token=cache.capture(owner,slot);
 // Existing direct edit callers retain their throwing contract; UI callers use tryEdit.
 expect(()=>cache.edit(owner,slot,initial,basis,current=>({...current,prediction:'0'.repeat(32769)}))).toThrow('Draft text is too long.');
 const outcome=cache.tryEdit(owner,slot,initial,basis,current=>({...current,prediction:'0'.repeat(32769)}));
 expect(outcome).toMatchObject({kind:'rejected',reason:'text-too-long'});expect(cache.getSnapshot().entries[learningDraftKey(owner,slot)]).toEqual(before);expect(calls).toHaveLength(1);expect(cache.readForm(owner,slot,initial,basis).value).toEqual({prediction:'0',reasoning:'accepted'});
 expect(cache.getEditRejection({...owner},slot)).toEqual(outcome.kind==='rejected'?outcome.rejection:undefined);expect(cache.getEditRejection({...owner,moduleId:'other'},slot)).toBeUndefined();expect(JSON.stringify(cache.getSnapshot())).not.toContain('0'.repeat(100));
 expect(token&&cache.acknowledge(token)).toBe(true);await tick();accept(1);await cache.flush();expect(cache.getEditRejection(owner,slot)).toBeDefined();
 expect(cache.tryEdit(owner,slot,initial,basis,()=>({prediction:'0',reasoning:'corrected'}))).toMatchObject({kind:'accepted'});expect(cache.getEditRejection(owner,slot)).toBeUndefined();await tick();accept(2);await cache.flush();
});

test('arbitrary transformer faults escape without a false size notice, and held attempts do not erase rejection',async()=>{
 const {cache,calls}=boundary();expect(cache.tryEdit(owner,slot,initial,basis,()=>initial)).toEqual({kind:'held',reason:'loading'});await cache.load();
 expect(()=>cache.tryEdit(owner,slot,initial,basis,()=>{throw Error('private programmer fault');})).toThrow('private programmer fault');expect(cache.getEditRejection(owner,slot)).toBeUndefined();
 expect(cache.tryEdit(owner,slot,initial,basis,()=>({prediction:'0'.repeat(32769),reasoning:''}))).toMatchObject({kind:'rejected'});const rejection=cache.getEditRejection(owner,slot);cache.setFrozen(true);expect(cache.tryEdit(owner,slot,initial,basis,()=>initial)).toEqual({kind:'held',reason:'frozen'});expect(cache.getEditRejection(owner,slot)).toBe(rejection);expect(calls).toHaveLength(0);cache.setFrozen(false);
 expect(cache.dismissEditRejection(owner,slot,(rejection?.id??0)-1)).toBe(false);expect(cache.getEditRejection(owner,slot)).toBe(rejection);expect(cache.dismissEditRejection(owner,slot,rejection!.id)).toBe(true);expect(cache.getSnapshot().entries).toEqual({});
});

test('a rejected later attempt neither invalidates a registered accepted acknowledgement nor deadlocks quit drain',async()=>{
 const {cache,calls,accept}=boundary();await cache.load();cache.edit(owner,slot,initial,basis,()=>({prediction:'0',reasoning:'accepted'}));await tick();const token=cache.capture(owner,slot)!;let finish=()=>{};const submitted=cache.runSubmission(()=>new Promise<void>(resolve=>{finish=()=>{expect(cache.acknowledge(token)).toBe(true);resolve();};}));
 expect(cache.tryEdit(owner,slot,initial,basis,current=>({...current,prediction:'0'.repeat(32769)}))).toMatchObject({kind:'rejected'});cache.setFrozen(true);let drained=false;const quit=cache.flushForQuit().then(()=>{drained=true;});await tick();expect(drained).toBe(false);accept(0);finish();await submitted;await tick();expect(calls).toHaveLength(2);expect(calls[1].value).toBeNull();accept(1);await quit;expect(drained).toBe(true);expect(cache.getEditRejection(owner,slot)).toBeDefined();
});

test('shape and complete-byte rejections preserve prior values; unavailable, storage, recovery and deleted holds remain distinct',async()=>{
 const {cache,calls,accept}=boundary();await cache.load();expect(cache.tryEdit(owner,slot,initial,basis,current=>({...current,unexpected:true}))).toMatchObject({kind:'rejected',reason:'shape-changed'});expect(calls).toHaveLength(0);const notice=cache.getEditRejection(owner,slot)!;
 expect(cache.tryEdit(owner,slot,initial,basis,()=>({prediction:'0',reasoning:'accepted'}))).toMatchObject({kind:'accepted'});await tick();accept(0);await cache.flush();expect(cache.dismissEditRejection(owner,slot,notice.id)).toBe(false);
 expect(cache.tryEdit(owner,slot,initial,'changed',()=>initial)).toEqual({kind:'held',reason:'recovery'});cache.forgetTask(owner.taskId);expect(cache.tryEdit(owner,slot,initial,basis,()=>initial)).toEqual({kind:'held',reason:'deleted'});expect(cache.getEditRejection(owner,slot)).toBeUndefined();
 const bad=createLearningDrafts({read:async()=>({kind:'unavailable',message:'Owned storage failure'}),save:async()=>{throw Error('No write');}});await bad.load();expect(bad.tryEdit(owner,slot,initial,basis,()=>initial)).toEqual({kind:'held',reason:'storage'});
 const ready=createLearningDrafts({read:async()=>({kind:'available',epoch:'initial',records:[]}),save:async()=>{throw Error('No write');}});await ready.load();expect(ready.tryEdit(owner,slot,initial,'',()=>initial)).toEqual({kind:'held',reason:'unavailable'});
 const complete={fields:Array(5).fill('')};expect(ready.tryEdit(owner,'generic',complete,basis,()=>({fields:Array(5).fill('文'.repeat(10000))}))).toMatchObject({kind:'rejected',reason:'too-large'});expect(ready.getSnapshot().entries).toEqual({});
});
