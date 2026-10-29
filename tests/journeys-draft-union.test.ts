import {expect,test} from 'vitest';
import {emptyLocalTaskDraft,localTaskDraftBasis,localTaskDraftOwner,LOCAL_TASK_DRAFT_SLOT} from '../src/shared/local-task-draft';
import {learningDraftJsonPolicy,parseLearningDraftFile,serializeLearningDraftJson} from '../src/shared/learning-drafts';
import {workflowSourceAdmissions} from '../src/shared/workflow-source-admission';

test('taskless, contextual, and picking raw records coexist without sharing their policies',()=>{
 const local=localTaskDraftOwner('draft');
 const source={kind:'workflow-source-review' as const,taskId:'task',artifactId:'source',artifactRevision:1,artifactDigest:'digest'};
 const helper={taskId:'task',artifactId:'helper',artifactRevision:1,artifactDigest:'digest',moduleId:'module',moduleVersion:1};
 const localValue={...emptyLocalTaskDraft,content:'A'.repeat(40000)};
 const initial=serializeLearningDraftJson(emptyLocalTaskDraft,'local-task-form');
 const picking={reason:'Keep the original correction'};
 const sourceValue={rules:[],initialState:'',eventSequence:[''],assumptions:'Context stays separate'};
 const records=[
  {owner:local,slot:LOCAL_TASK_DRAFT_SLOT,revision:1,value:{initial,value:serializeLearningDraftJson(localValue,'local-task-form'),basis:localTaskDraftBasis('draft')}},
  {owner:source,slot:workflowSourceAdmissions.contextual.reviewSlot,revision:1,value:{initial:serializeLearningDraftJson({...sourceValue,assumptions:''}),value:serializeLearningDraftJson(sourceValue,'workflow-source-review'),basis:'source basis'}},
  {owner:helper,slot:'helper:table:correction',revision:1,value:{initial:serializeLearningDraftJson({reason:''},'picking-helper-correction'),value:serializeLearningDraftJson(picking,'picking-helper-correction'),basis:'helper basis'}},
 ];
 expect(learningDraftJsonPolicy(local,LOCAL_TASK_DRAFT_SLOT)).toBe('local-task-form');
 expect(learningDraftJsonPolicy(source,workflowSourceAdmissions.contextual.reviewSlot)).toBe('workflow-source-review');
 expect(learningDraftJsonPolicy(helper,'helper:table:correction')).toBe('picking-helper-correction');
 expect(parseLearningDraftFile({schemaVersion:2,epoch:'initial',records}).records).toEqual(records);
 expect(()=>parseLearningDraftFile({schemaVersion:2,epoch:'initial',records:[{...records[0],slot:'helper:table:correction'}]})).toThrow();
 expect(()=>parseLearningDraftFile({schemaVersion:2,epoch:'initial',records:[{...records[2],value:{...records[2].value,value:JSON.stringify({reason:'ok',extra:'refused'})}}]})).toThrow();
});
