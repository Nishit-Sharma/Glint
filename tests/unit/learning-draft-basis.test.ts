import {expect,test} from 'vitest';
import {navigationFormBasis} from '../../src/renderer/src/learning-draft-basis';
import {createLearningDrafts} from '../../src/renderer/src/learning-drafts';
import {learningDraftKey,type LearningDraftRecord} from '../../src/shared/learning-drafts';
test('the default basis bytes remain exactly compatible with existing navigation forms',()=>{
 expect(navigationFormBasis({field:'applied'},{slot:'s',basis:'b'})).toBe('{"basis":"b","initial":{"field":"applied"},"variableArrays":[]}');
 expect(navigationFormBasis({field:'applied'})).toBe('{"basis":"","initial":{"field":"applied"},"variableArrays":[]}');
 expect(navigationFormBasis({field:'applied'},{slot:'s',basisMode:'explicit',basis:'exact-ref'})).toBe('{"basis":"exact-ref","variableArrays":[]}');
});
test('explicit basis supports large initial fields while the cache still holds an exact-initial mismatch for recovery',async()=>{
 let records:LearningDraftRecord[]=[];const cache=createLearningDrafts({read:async()=>({kind:'available',epoch:'initial',records}),save:async(owner,slot,_epoch,revision,value)=>{const record={owner,slot,revision:revision+1,value};records=records.filter(r=>learningDraftKey(r.owner,r.slot)!==learningDraftKey(owner,slot));records.push(record);return {kind:'saved',epoch:'initial',record};}});await cache.load();
 const initial={rows:Array.from({length:48},(_,i)=>({id:String(i),quote:'a'.repeat(500)}))},owner={taskId:'t',artifactId:'a',artifactRevision:1,artifactDigest:'d',moduleId:'m',moduleVersion:1};
 expect(JSON.stringify(initial).length).toBeGreaterThan(16*1024);
 const basis=navigationFormBasis(initial,{slot:'large',basisMode:'explicit',basis:'exact immutable artifact reference'});expect(basis.length).toBeLessThan(100);
 expect(cache.edit(owner,'large',initial,basis,form=>({...form,rows:form.rows.map((r,i)=>i?r:{...r,quote:'corrected'})}))).toBe(true);await cache.flushForm(owner,'large');
 const reopened=createLearningDrafts({read:async()=>({kind:'available',epoch:'initial',records}),save:async()=>{throw Error('Read only');}});await reopened.load();
 expect(reopened.readForm(owner,'large',initial,basis)).toMatchObject({status:'ready',value:{rows:expect.arrayContaining([{id:'0',quote:'corrected'}])}});
 const changed={...initial,rows:initial.rows.map((r,i)=>i?r:{...r,quote:'different applied input'})};
 expect(reopened.readForm(owner,'large',changed,basis).status).toBe('recovery');
});
test('explicit mode requires nonempty bounded identity text and never relaxes the persisted basis limit',()=>{
 for(const basis of ['', '   ', 'x'.repeat(16384)])expect(()=>navigationFormBasis({field:'raw'},{slot:'s',basisMode:'explicit',basis})).toThrow();
});
