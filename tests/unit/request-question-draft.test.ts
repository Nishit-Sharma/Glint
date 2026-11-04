import {expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createCompanion} from '../../src/core/companion';
import {LearningDraftStore} from '../../src/host/learning-drafts';
import {serializeLearningDraftJson,learningDraftKey} from '../../src/shared/learning-drafts';
import {REQUEST_QUESTION_SLOT,requestQuestionDraftBasis,initialRequestQuestionDraft,type RequestQuestionDraftOwner} from '../../src/shared/request-question';

it('persists an exact separate question draft and pending decision across real core/draft reopen without auto-answering or rebinding',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-question-raw-'));let core=await createCompanion({dataDir:join(directory,'core')});
 try{
  const task=await core.createTask({title:'Question draft owner'});await core.saveComposerDraft(task.id,0,{text:'Unrelated saved composer',kind:'create'});let published!:()=>void;const ready=new Promise<void>(resolve=>published=resolve);
  const operation=core.runRequest({taskId:task.id,requestId:'draft-question',kind:'explain',prompt:'Synthetic question',sourceIds:[]},async context=>{await context.askQuestion!({question:'Choose a fictional approach',mode:'ranking',options:[{id:'a',label:'Approach A'},{id:'b',label:'Approach B'}]},published);return {title:'Must not save',content:'Unexpected'};});void operation.catch(()=>{});await ready;
  const request=(await core.getTask(task.id)).requests[0],question=request.questions![0],owner:RequestQuestionDraftOwner={kind:'request-question',taskId:task.id,requestId:request.id,requestDigest:request.digest,questionId:question.id,questionDigest:question.digest},initial=initialRequestQuestionDraft(question),pending={type:'request.question.answer',taskId:task.id,requestId:request.id,requestDigest:request.digest,questionId:question.id,questionDigest:question.digest,expectedRevision:1,decision:{kind:'alternative',text:'Exact raw alternative 😀\r\n'}};
  const store=()=>new LearningDraftStore({directory:join(directory,'drafts'),lookupTask:async id=>{try{return await core.getTask(id);}catch{return undefined;}}}),value={basis:requestQuestionDraftBasis(owner),initial:serializeLearningDraftJson(initial),value:serializeLearningDraftJson({...initial,ranking:['b','a'],useAlternative:true,alternative:pending.decision.text,pendingText:JSON.stringify(pending)})};
  const saved=await store().save(owner,REQUEST_QUESTION_SLOT,'initial',0,value);expect(saved.kind).toBe('saved');expect((await core.getTask(task.id)).requests[0].questions![0].status).toBe('waiting');
  await expect(store().save({...owner,questionDigest:'f'.repeat(64)},REQUEST_QUESTION_SLOT,'initial',0,{...value,basis:requestQuestionDraftBasis({...owner,questionDigest:'f'.repeat(64)})})).rejects.toThrow();
  await core.close();await operation.catch(()=>{});core=await createCompanion({dataDir:join(directory,'core')});const reopened=await store().read();expect(reopened.kind).toBe('available');if(reopened.kind!=='available')throw Error('Draft unavailable');expect(reopened.records.find(record=>learningDraftKey(record.owner,record.slot)===learningDraftKey(owner,REQUEST_QUESTION_SLOT))?.value).toEqual(value);
  const after=await core.getTask(task.id);expect(after.requests[0].questions![0].status).toBe('closed');expect(after.artifacts).toHaveLength(0);expect(after.session?.draft).toBe('Unrelated saved composer');
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
