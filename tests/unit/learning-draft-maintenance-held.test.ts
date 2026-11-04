import {expect,it,vi} from 'vitest';
import {createLearningDrafts} from '../../src/renderer/src/learning-drafts';

it('publishes the active maintenance interval until cleanup and reconciliation finish',async()=>{
 let release:()=>void=()=>{};const held=new Promise<void>(resolve=>{release=resolve;});
 const read=vi.fn(async()=>({kind:'available' as const,epoch:'initial',records:[]}));
 const cleanup=vi.fn(async()=>{await held;return {kind:'cleaned' as const,epoch:'initial',removed:0};});
 const drafts=createLearningDrafts({read,cleanup,save:async()=>{throw Error('No draft save belongs to this test.');}});
 await drafts.load();const snapshots:unknown[]=[];drafts.subscribe(()=>snapshots.push(drafts.getSnapshot()));
 const cleaning=drafts.cleanupDeleted();
 try{
  expect(drafts.getSnapshot()).toMatchObject({maintenance:true});
  await vi.waitFor(()=>expect(cleanup).toHaveBeenCalledOnce());
  expect(drafts.getSnapshot()).toMatchObject({maintenance:true});
 }finally{release();await cleaning;}
 await vi.waitFor(()=>expect(drafts.getSnapshot()).toMatchObject({maintenance:false}));
 expect(read).toHaveBeenCalledTimes(2);
 expect(snapshots).toContainEqual(expect.objectContaining({maintenance:true}));
 expect(snapshots.at(-1)).toMatchObject({maintenance:false});
});
