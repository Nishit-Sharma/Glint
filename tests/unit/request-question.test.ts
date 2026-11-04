import {expect,it,vi} from 'vitest';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import * as fileSystem from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../../src/core/companion';
import type {RequestQuestionDefinition,RequestQuestionDecision} from '../../src/shared/request-question';
import {taskActivityBasis} from '../../src/shared/task-attention';
import {taskAttentionLabel} from '../../src/renderer/src/task-outcome-review';
vi.mock('node:fs/promises',{spy:true});

const definition=(mode:RequestQuestionDefinition['mode']='single'):RequestQuestionDefinition=>({question:'Which details should this synthetic summary emphasize?',mode,options:[{id:'cost',label:'Cost'},{id:'time',label:'Time'},{id:'scope',label:'Scope'}]});
it.each([
 {mode:'single' as const,decision:{kind:'choices' as const,ids:['cost']}},
 {mode:'multiple' as const,decision:{kind:'choices' as const,ids:['scope','cost']}},
 {mode:'ranking' as const,decision:{kind:'choices' as const,ids:['scope','cost','time']}},
 {mode:'single' as const,decision:{kind:'alternative' as const,text:'  Quality and accessibility.\n'}},
 {mode:'single' as const,decision:{kind:'skip' as const}},
])('publishes and explicitly answers $mode/$decision.kind inside the same running canonical request',async({mode,decision})=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-running-question-')),core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Synthetic clarification'});await core.saveComposerDraft(task.id,0,{text:'UNRELATED unsent composer',kind:'explain'});let published!:()=>void;const ready=new Promise<void>(resolve=>published=resolve);let received:RequestQuestionDecision|undefined,runnerCalls=0;
  const operation=core.runRequest({taskId:task.id,requestId:'owned-request',kind:'explain',prompt:'Summarize the synthetic plan.',sourceIds:[]},async context=>{runnerCalls++;received=await context.askQuestion!(definition(mode),published);return {title:'Synthetic answer',content:'Resumed with '+JSON.stringify(received),mimeType:'text/markdown'};});
  void operation.catch(()=>{});await ready;const waiting=await core.getTask(task.id),request=waiting.requests[0],question=request.questions![0],binding={taskId:task.id,requestId:request.id,requestDigest:request.digest,questionId:question.id,questionDigest:question.digest,expectedRevision:question.revision};
  expect(request.status).toBe('running');expect(question.status).toBe('waiting');expect(waiting.artifacts).toHaveLength(0);expect(waiting.session?.draft).toBe('UNRELATED unsent composer');expect(taskAttentionLabel(waiting)).toBe('Waiting for your answer');
  const withoutQuestion=structuredClone(waiting);delete withoutQuestion.requests[0].questions;expect(taskActivityBasis(waiting)).not.toBe(taskActivityBasis(withoutQuestion));
  const command=decision.kind==='skip'?{type:'request.question.skip',...binding}:{type:'request.question.answer',...binding,decision};
  const first=await core.requestQuestionCommand(command),finished=await operation,after=await core.getTask(task.id);expect(first.question.status).toBe(decision.kind==='skip'?'skipped':'answered');expect(finished.id).toBe(request.id);expect(finished.status).toBe('completed');expect(after.requests).toHaveLength(1);expect(after.artifacts).toHaveLength(1);expect(runnerCalls).toBe(1);expect(after.session?.draft).toBe('UNRELATED unsent composer');expect(received?.kind).toBe(decision.kind);
  expect((await core.requestQuestionCommand(command)).question).toEqual(first.question);expect(runnerCalls).toBe(1);
  await expect(core.requestQuestionCommand({...binding,type:'request.question.answer',decision:{kind:'alternative',text:'Different replay'}})).rejects.toThrow('different answer');
  expect(taskActivityBasis(waiting)).not.toBe(taskActivityBasis(after));expect(taskAttentionLabel(after)).toBeUndefined();
  await core.runRequest({taskId:task.id,requestId:'later-dialogue',kind:'explain',prompt:'A separate later question.',sourceIds:[]},async context=>{const turn=JSON.parse(context.taskHistory!).previousTurns.find((item:{requestId:string})=>item.requestId===request.id);expect(turn.clarifications[0]).toMatchObject({questionId:question.id,status:decision.kind==='skip'?'skipped':'answered',mode,decision:{kind:decision.kind}});expect(context.taskHistory).not.toContain('UNRELATED unsent composer');return {title:'Later synthetic response',content:'Separate answer'};});
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

it('registers before publication, rejects wrong identities/rankings and stops a waiting question without completing an artifact',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-question-cancel-')),core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Cancel synthetic question'});let published!:()=>void;const ready=new Promise<void>(resolve=>published=resolve);
  const operation=core.runRequest({taskId:task.id,requestId:'cancel-question',kind:'explain',prompt:'Synthetic request',sourceIds:[]},async context=>{await context.askQuestion!(definition('ranking'),published);return {title:'Must not save',content:'Unexpected'};});
  void operation.catch(()=>{});await ready;const request=(await core.getTask(task.id)).requests[0],question=request.questions![0],binding={taskId:task.id,requestId:request.id,requestDigest:request.digest,questionId:question.id,questionDigest:question.digest,expectedRevision:1};
  expect((await core.requestQuestionCommand({taskId:binding.taskId,requestId:binding.requestId,requestDigest:binding.requestDigest,questionId:binding.questionId,questionDigest:binding.questionDigest,type:'request.question.inspect'})).active).toBe(true);
  for(const ids of [['cost'],['cost','time','time'],['cost','time','foreign']])await expect(core.requestQuestionCommand({...binding,type:'request.question.answer',decision:{kind:'choices',ids}})).rejects.toThrow();
  await expect(core.requestQuestionCommand({...binding,questionDigest:'f'.repeat(64),type:'request.question.skip'})).rejects.toThrow('exact request question');
  const other=await core.createTask({title:'Other synthetic owner'});await expect(core.requestQuestionCommand({...binding,taskId:other.id,type:'request.question.skip'})).rejects.toThrow();await expect(core.requestQuestionCommand({...binding,expectedRevision:2,type:'request.question.skip'})).rejects.toThrow('no longer waiting');
  await core.cancelRequest(task.id,request.id);expect((await operation).status).toBe('cancelled');const after=await core.getTask(task.id);expect(after.requests[0].questions![0].status).toBe('closed');expect(after.artifacts).toHaveLength(0);await expect(core.requestQuestionCommand({...binding,type:'request.question.skip'})).rejects.toThrow('no longer waiting');
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

it('accepts an answer launched immediately by publication, after its waiter is registered, exactly once',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-question-publish-race-')),core=await createCompanion({dataDir:directory});let answering:Promise<unknown>|undefined;
 try{const task=await core.createTask({title:'Immediate synthetic answer'});let continued=0;
  const saved=await core.runRequest({taskId:task.id,requestId:'immediate-question',kind:'explain',prompt:'Synthetic race',sourceIds:[]},async context=>{await context.askQuestion!(definition(),()=>{answering=(async()=>{const request=(await core.getTask(task.id)).requests[0],question=request.questions![0];const command={type:'request.question.answer',taskId:task.id,requestId:request.id,requestDigest:request.digest,questionId:question.id,questionDigest:question.digest,expectedRevision:1,decision:{kind:'choices',ids:['cost']}};const replies=await Promise.all([core.requestQuestionCommand(command),core.requestQuestionCommand(command)]);expect(replies[0].question).toEqual(replies[1].question);})();});continued++;return {title:'Immediate result',content:'One continuation'};});
  await answering;expect(saved.status).toBe('completed');expect(continued).toBe(1);expect((await core.getTask(task.id)).artifacts).toHaveLength(1);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

it.each(['pause','source'] as const)('retires the live question when %s invalidates its running owner',async action=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-question-retire-')),core=await createCompanion({dataDir:directory});
 try{let task=await core.createTask({title:'Synthetic retiring question'});task=await core.putSource(task.id,{kind:'text',label:'Selected synthetic source',role:'fact',content:'Fictional event.'});const source=task.sources[0];let published!:()=>void;const ready=new Promise<void>(resolve=>published=resolve);
  const operation=core.runRequest({taskId:task.id,requestId:'retiring-question',kind:'explain',prompt:'Synthetic source task',sourceIds:[source.id]},async context=>{await context.askQuestion!(definition(),published);return {title:'Must not publish',content:'Unexpected'};});void operation.catch(()=>{});await ready;
  if(action==='pause')await core.pause(task.id);else await core.invalidateSource(task.id,source.id,'Synthetic selected source changed.');
  expect((await operation).status).toBe('cancelled');const after=await core.getTask(task.id);expect(after.requests[0].questions![0].status).toBe('closed');expect(after.artifacts).toHaveLength(0);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

it('does not wake a continuation if committing its answer fails',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-question-commit-failure-')),core=await createCompanion({dataDir:directory});
 try{const task=await core.createTask({title:'Synthetic failed answer commit'});let published!:()=>void;const ready=new Promise<void>(resolve=>published=resolve);let continued=false;
  const operation=core.runRequest({taskId:task.id,requestId:'uncommitted-question',kind:'explain',prompt:'Synthetic persistence task',sourceIds:[]},async context=>{await context.askQuestion!(definition(),published);continued=true;return {title:'Must not publish',content:'Unexpected'};});void operation.catch(()=>{});await ready;
  const request=(await core.getTask(task.id)).requests[0],question=request.questions![0],before=await readFile(join(directory,'tasks.json'));const failure=vi.spyOn(fileSystem,'rename').mockRejectedValueOnce(Error('Synthetic answer commit failure.'));
  await expect(core.requestQuestionCommand({type:'request.question.skip',taskId:task.id,requestId:request.id,requestDigest:request.digest,questionId:question.id,questionDigest:question.digest,expectedRevision:1})).rejects.toThrow();failure.mockRestore();await operation.catch(()=>{});expect(continued).toBe(false);expect(await readFile(join(directory,'tasks.json'))).toEqual(before);
 }finally{vi.restoreAllMocks();await core.close();await rm(directory,{recursive:true,force:true});}
});

it('keeps matching ordinary queued text separate while the original question remains occupied',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-question-followup-')),core=await createCompanion({dataDir:directory});
 try{const task=await core.createTask({title:'Question and queued chat'});let published!:()=>void;const ready=new Promise<void>(resolve=>published=resolve);
  const operation=core.runRequest({taskId:task.id,requestId:'waiting-original',kind:'explain',prompt:'Synthetic original task',sourceIds:[]},async context=>{const answer=await context.askQuestion!(definition(),published);return {title:'Original completed',content:JSON.stringify(answer)};});void operation.catch(()=>{});await ready;
  const request=(await core.getTask(task.id)).requests[0],question=request.questions![0],draft=await core.saveComposerDraft(task.id,0,{text:'Cost',kind:'explain'}),basis=await core.queuedFollowupBasis(task.id,[],[request.id]),queued={id:'separate-followup',revision:1,prompt:'Cost',kind:'explain' as const,createdAt:'2026-11-02T00:00:00Z',sourceRefs:[],status:'queued' as const,basis,scope:'a'.repeat(64),precedingRequestIds:[request.id]};await core.saveQueuedFollowup(task.id,queued,0,draft);
  const input={taskId:task.id,requestId:queued.id,kind:queued.kind,prompt:queued.prompt,sourceIds:[],queuedFollowup:{id:queued.id,revision:queued.revision,basis:queued.basis,scope:queued.scope}};
  await expect(core.runRequest(input,async()=>({title:'Wrong early dispatch',content:'Must not run'}))).rejects.toThrow();expect((await core.getTask(task.id)).requests[0].questions![0].status).toBe('waiting');
  await core.requestQuestionCommand({type:'request.question.skip',taskId:task.id,requestId:request.id,requestDigest:request.digest,questionId:question.id,questionDigest:question.digest,expectedRevision:1});expect((await operation).status).toBe('completed');const next=await core.runRequest(input,async()=>({title:'Separate follow-up answer',content:'A new ordinary request after completion.'}));expect(next.status).toBe('completed');expect((await core.getTask(task.id)).requests.map(item=>item.id)).toEqual([request.id,queued.id]);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

it('keeps unanswered history after actual close/reopen while retiring the dead waiter without automatic resend',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-question-restart-'));let core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Restart synthetic question'});let published!:()=>void;const ready=new Promise<void>(resolve=>published=resolve);let runnerCalls=0;
  const operation=core.runRequest({taskId:task.id,requestId:'restart-question',kind:'explain',prompt:'Synthetic request',sourceIds:[]},async context=>{runnerCalls++;await context.askQuestion!(definition(),published);return {title:'Must not replay',content:'Unexpected'};});void operation.catch(()=>{});await ready;const before=(await core.getTask(task.id)).requests[0],question=before.questions![0];await core.close();await operation.catch(()=>{});core=await createCompanion({dataDir:directory});
  const request=(await core.getTask(task.id)).requests[0];expect(request.status).toBe('interrupted');expect(request.questions![0]).toMatchObject({id:question.id,digest:question.digest,status:'closed',revision:2});expect(runnerCalls).toBe(1);
  const inspected=await core.requestQuestionCommand({type:'request.question.inspect',taskId:task.id,requestId:request.id,requestDigest:request.digest,questionId:question.id,questionDigest:question.digest});expect(inspected.active).toBe(false);expect(inspected.question.reason).toContain('restarted');
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
