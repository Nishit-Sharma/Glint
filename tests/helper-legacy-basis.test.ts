import {expect,test} from 'vitest';
import {navigationFormBasis} from '../src/renderer/src/learning-draft-basis';
import {createLearningDrafts} from '../src/renderer/src/learning-drafts';
import {learningDraftKey,type LearningDraftRecord} from '../src/shared/learning-drafts';
import {legacyHelperDraftBasis} from '../src/renderer/src/legacy-helper-draft-basis';
import {helperStudio} from '../src/learning/reusable-helper';
import {helperExample} from '../src/learning/helper-example';

test('a 16000-character legacy check keeps exact initial and selected-check identity outside the compact basis',async()=>{
 let records:LearningDraftRecord[]=[];
 const transport={read:async()=>({kind:'available' as const,epoch:'initial',records}),save:async(owner:LearningDraftRecord['owner'],slot:string,_epoch:string,revision:number,value:LearningDraftRecord['value'])=>{const record={owner,slot,revision:revision+1,value};records=records.filter(item=>learningDraftKey(item.owner,item.slot)!==learningDraftKey(owner,slot));records.push(record);return {kind:'saved' as const,epoch:'initial',record};}};
 const owner={taskId:'task',artifactId:'answer',artifactRevision:1,artifactDigest:'digest',moduleId:'helper',moduleVersion:1},slot='helper:text:check';
 const initial={editingTest:'demo-1',testInput:' A ',testOutput:'x'.repeat(16000),testKind:'output',testRole:'example'};
 const basis=navigationFormBasis(initial,{slot,basisMode:'explicit',basis:'legacy-check:revision-7'});expect(basis.length).toBeLessThan(200);
 const cache=createLearningDrafts(transport);await cache.load();expect(cache.edit(owner,slot,initial,basis,current=>({...current,testOutput:'  edited  '}))).toBe(true);await cache.flushForm(owner,slot);
 const reopened=createLearningDrafts(transport);await reopened.load();expect(reopened.readForm(owner,slot,initial,basis)).toMatchObject({status:'ready',value:{editingTest:'demo-1',testOutput:'  edited  '}});
 expect(reopened.readForm(owner,slot,{...initial,editingTest:'demo-2'},basis).status).toBe('recovery');
 expect(reopened.readForm(owner,slot,{...initial,testOutput:'x'.repeat(15999)+'y'},basis).status).toBe('recovery');
});

test('legacy form bases are bounded and invalidate edits when the relevant saved state changes',()=>{
 const state=helperStudio.initial(helperExample),later={...state,revision:1};
 expect(legacyHelperDraftBasis(state,'check')).not.toBe(legacyHelperDraftBasis(later,'check'));
 expect(legacyHelperDraftBasis(state,'version')).not.toBe(legacyHelperDraftBasis(later,'version'));
 expect(legacyHelperDraftBasis(state,'details')).toBe(legacyHelperDraftBasis(later,'details'));
 expect(legacyHelperDraftBasis(state,'run')).not.toBe(legacyHelperDraftBasis({...state,activeVersion:1},'run'));
 expect(legacyHelperDraftBasis(state,'operation')).not.toBe(legacyHelperDraftBasis({...state,draft:{...state.draft,operations:[{kind:'trim'}]}},'operation'));
});
