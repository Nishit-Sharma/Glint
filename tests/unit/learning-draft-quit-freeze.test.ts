import {expect,it} from 'vitest';
import {createLearningDrafts} from '../../src/renderer/src/learning-drafts';

it('publishes freeze and resume transitions without replacing the saved draft',async()=>{
 const owner={taskId:'task-a',artifactId:'answer-a',artifactRevision:1,artifactDigest:'digest-a',moduleId:'join',moduleVersion:1};
 const initial={reason:''},slot='prediction',basis='example-1';
 const value={initial:'{"reason":""}',value:'{"reason":"  Before quit.  "}',basis};
 const record={owner,slot,revision:1,value};
 const drafts=createLearningDrafts({read:async()=>({kind:'available',epoch:'initial',records:[record]}),save:async()=>{throw Error('This test never saves.');}});
 await drafts.load();const published:unknown[]=[];drafts.subscribe(()=>published.push(drafts.getSnapshot()));
 drafts.setFrozen(true);expect(drafts.getSnapshot()).toMatchObject({frozen:true});
 expect(drafts.edit(owner,slot,initial,basis,()=>({reason:'Rejected while frozen'}))).toBe(false);
 expect(drafts.readForm(owner,slot,initial,basis).value).toEqual({reason:'  Before quit.  '});
 drafts.setFrozen(false);expect(drafts.getSnapshot()).toMatchObject({frozen:false});
 expect(drafts.readForm(owner,slot,initial,basis).value).toEqual({reason:'  Before quit.  '});
 expect(published).toContainEqual(expect.objectContaining({frozen:true}));expect(published.at(-1)).toMatchObject({frozen:false});
});

it('drains an exact acknowledgement captured before freeze without admitting a new capture',async()=>{
 const owner={taskId:'task-a',artifactId:'answer-a',artifactRevision:1,artifactDigest:'digest-a',moduleId:'join',moduleVersion:1};
 const initial={reason:''},slot='prediction',basis='example-1';
 const value={initial:'{"reason":""}',value:'{"reason":"Submitted before quit."}',basis},record={owner,slot,revision:1,value};
 const writes:(typeof value|null)[]=[];
 const drafts=createLearningDrafts({read:async()=>({kind:'available',epoch:'initial',records:[record]}),save:async(currentOwner,currentSlot,epoch,revision,next)=>{
  writes.push(next);return {kind:'saved',epoch,record:{owner:currentOwner,slot:currentSlot,revision:revision+1,value:next}};
 }});
 await drafts.load();const token=drafts.capture(owner,slot);if(!token)throw Error('Expected a pre-quit draft token.');
 drafts.setFrozen(true);expect(drafts.capture(owner,slot)).toBeUndefined();expect(drafts.acknowledge(token)).toBe(true);
 await drafts.flush();expect(writes).toEqual([null]);expect(drafts.readForm(owner,slot,initial,basis).value).toEqual(initial);
 expect(drafts.acknowledge(token)).toBe(false);
});
