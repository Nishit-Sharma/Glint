import {sqlOwner,sqlSlot,fourColumnLesson,largeWindowForm} from './raw-form-capacity.fixture';
import {expect,test} from 'vitest';
import {joinLab} from '../src/learning/join-lab';
import {windowReviewDraft} from '../src/renderer/src/window-review-form';
import {checkWindowWorkflowReview,windowWorkflowReviewSnapshot} from '../src/learning/window-workflow-review';
import {learningDraftJsonPolicy,serializeLearningDraftJson,parseLearningDraftValue} from '../src/shared/learning-drafts';
import {createLearningDrafts} from '../src/renderer/src/learning-drafts';
import {navigationFormBasis} from '../src/renderer/src/learning-draft-basis';

test('a formerly submit-capable four-column numeric row preserves every leading zero through the scoped cache',async()=>{
 const data=fourColumnLesson(),initial={cells:data.practice.left.rows[0].values.map(value=>({text:String(value),isNull:false}))},raw={cells:Array.from({length:4},()=>({text:'0'.repeat(32768),isNull:false}))};
 expect(Buffer.byteLength(JSON.stringify(raw))).toBe(131191);
 expect(joinLab.update(data,joinLab.initial(data),{kind:'edit-row',side:'left',rowId:'owned-row',values:raw.cells.map(cell=>Number(cell.text)),expectedRevision:0}).revision).toBe(1);
 const cache=createLearningDrafts({read:async()=>({kind:'available',epoch:'initial',records:[]}),save:async(owner,slot,epoch,revision,value)=>({kind:'saved',epoch,record:{owner,slot,revision:revision+1,value}})});await cache.load();
 expect(()=>cache.edit(sqlOwner,sqlSlot,initial,'exact row identity',()=>raw)).not.toThrow();await cache.flush();expect(cache.readForm(sqlOwner,sqlSlot,initial,'exact row identity').value).toEqual(raw);
 const policy=learningDraftJsonPolicy(sqlOwner,sqlSlot),text=serializeLearningDraftJson(raw,policy);expect(parseLearningDraftValue({initial:text,value:text,basis:'exact row identity'},sqlOwner,sqlSlot)?.value).toBe(text);
});

test('the complete host-valid reviewed image preserves unfinished Unicode evidence rows and large initial restore',async()=>{
 const {candidate,initial,raw}=largeWindowForm(),draft=windowReviewDraft(candidate,raw),snapshot=windowWorkflowReviewSnapshot(candidate,draft);expect(checkWindowWorkflowReview(candidate,{draft,confirmation:{kind:'reviewed-window-transcription',snapshot}}).kind).toBe('valid');expect(Buffer.byteLength(JSON.stringify(raw))).toBeGreaterThan(128*1024);
 const owner={kind:'window-workflow-review' as const,taskId:'owned-task',artifactId:'owned-brief',artifactRevision:1,artifactDigest:'brief-digest'},slot='window-workflow:review:owned-candidate',policy=learningDraftJsonPolicy(owner,slot),basis=navigationFormBasis(initial,{slot,basisMode:'explicit',basis:'exact candidate reference'});
 const cache=createLearningDrafts({read:async()=>({kind:'available',epoch:'initial',records:[]}),save:async(owner,slot,epoch,revision,value)=>({kind:'saved',epoch,record:{owner,slot,revision:revision+1,value}})});await cache.load();
 expect(()=>cache.edit(owner,slot,initial,basis,()=>raw)).not.toThrow();await cache.flush();expect(cache.readForm(owner,slot,initial,basis).value).toEqual(raw);
 const text=serializeLearningDraftJson(raw,policy);expect(()=>parseLearningDraftValue({initial:text,value:text,basis},owner,slot)).not.toThrow();expect(()=>cache.readForm(owner,slot,raw,basis)).not.toThrow();
});
