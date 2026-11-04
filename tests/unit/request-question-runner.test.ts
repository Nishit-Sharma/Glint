import {prepareExplanationMode} from '../../src/host/explanation-modes';
import {composeOrdinaryRequest} from '../../src/host/ordinary-request-composition';
import {explanationProposal,explanationSource} from '../support/explanation.fixture';
import {EXPLANATION_MIME,readExplanation} from '../../src/shared/explanation-modes';
import {expect,it} from 'vitest';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createCompanion} from '../../src/core/companion';
import {runOrdinaryQuestionRequest,dispatchRequestQuestion,parseRequestQuestionOutput,REQUEST_QUESTION_MARKER} from '../../src/host/request-question-runner';
import type {MetaRunInput} from '../../src/host/provider';
import type {RequestQuestionDefinition,RequestQuestionDecision} from '../../src/shared/request-question';

const definition:RequestQuestionDefinition={question:'Which aspect of this fictional plan matters?',mode:'single',options:[{id:'schedule',label:'Schedule'},{id:'cost',label:'Cost'}]};
const proposal=REQUEST_QUESTION_MARKER+'\n'+JSON.stringify(definition);
it.each([{mode:'single' as const,decision:{kind:'choices' as const,ids:['cost']}},{mode:'multiple' as const,decision:{kind:'choices' as const,ids:['schedule','cost']}},{mode:'ranking' as const,decision:{kind:'choices' as const,ids:['cost','schedule']}},{mode:'single' as const,decision:{kind:'alternative' as const,text:'Quality instead'}},{mode:'single' as const,decision:{kind:'skip' as const}}])('resumes the original production request after explicit $mode/$decision.kind without exposing protocol JSON or new composer text',async({mode,decision})=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-question-host-')),core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Fictional host clarification'});await core.saveComposerDraft(task.id,0,{text:'UNSENT composer must not become the answer',kind:'explain'});let published!:()=>void;const ready=new Promise<void>(resolve=>published=resolve),calls:MetaRunInput[]=[],chunks:string[]=[],changes:string[]=[];let checks=0;
  const questionDefinition={...definition,mode},questionProposal=REQUEST_QUESTION_MARKER+'\n'+JSON.stringify(questionDefinition);
  const provider={run:async(input:MetaRunInput)=>{calls.push(input);if(calls.length===1){input.onAnswerChunk?.(questionProposal.slice(0,5));input.onAnswerChunk?.(questionProposal.slice(5));return questionProposal;}const history=JSON.parse(input.taskContext!).taskClarifications;expect(history).toEqual([{question:questionDefinition,decision}]);expect(input.prompt).toContain(decision.kind==='skip'?'Continue with the available information':'Host question protocol');expect(JSON.stringify(input)).not.toContain('UNSENT composer');input.onAnswerChunk?.('Final synthetic answer.');return 'Final synthetic answer.';}};
  const operation=core.runRequest({taskId:task.id,requestId:'original-model-request',kind:'explain',prompt:'Explain the fictional plan.',sourceIds:[]},async context=>({title:'Fictional result',mimeType:'text/markdown',content:await runOrdinaryQuestionRequest(provider,{prompt:'Explain the fictional plan.',sources:[],taskContext:context.taskHistory},{signal:context.signal,onChunk:chunk=>chunks.push(chunk)},{check:async()=>{checks++;},ask:question=>context.askQuestion!(question,()=>{changes.push(task.id);published();})})}));void operation.catch(()=>{});
  await ready;const waiting=await core.getTask(task.id),request=waiting.requests[0],question=request.questions![0];expect(chunks).toEqual([]);expect(calls).toHaveLength(1);expect(waiting.artifacts).toHaveLength(0);expect(changes).toEqual([task.id]);expect(request.status).toBe('running');
  const binding={taskId:task.id,requestId:request.id,requestDigest:request.digest,questionId:question.id,questionDigest:question.digest,expectedRevision:1};
  await dispatchRequestQuestion(core,decision.kind==='skip'?{type:'request.question.skip',...binding}:{type:'request.question.answer',...binding,decision},id=>changes.push(id));
  const finished=await operation,after=await core.getTask(task.id);expect(finished.id).toBe(request.id);expect(finished.status).toBe('completed');expect(after.requests).toHaveLength(1);expect(after.artifacts).toHaveLength(1);expect(calls).toHaveLength(2);expect(checks).toBe(3);expect(chunks.join('')).toBe('Final synthetic answer.');expect(after.session?.draft).toBe('UNSENT composer must not become the answer');expect(changes).toHaveLength(2);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

it('rechecks continuation authority after answering and never transmits a second turn after it changes',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-question-fence-')),core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Synthetic fenced continuation'});let published!:()=>void;const ready=new Promise<void>(resolve=>published=resolve);let current=true,calls=0;
  const operation=core.runRequest({taskId:task.id,requestId:'fenced-request',kind:'explain',prompt:'Fictional task',sourceIds:[]},async context=>({title:'Must not complete',content:await runOrdinaryQuestionRequest({run:async()=>{calls++;return proposal;}},{prompt:'Fictional task',sources:[]},{signal:context.signal},{check:async()=>{if(!current)throw Error('Synthetic lease changed.');},ask:question=>context.askQuestion!(question,published)})}));void operation.catch(()=>{});
  await ready;const request=(await core.getTask(task.id)).requests[0],question=request.questions![0];current=false;
  await core.requestQuestionCommand({type:'request.question.skip',taskId:task.id,requestId:request.id,requestDigest:request.digest,questionId:question.id,questionDigest:question.digest,expectedRevision:1});
  expect((await operation).status).toBe('failed');expect(calls).toBe(1);expect((await core.getTask(task.id)).artifacts).toHaveLength(0);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

it('keeps ordinary Markdown streaming unchanged, rejects malformed question data, and does not ask after Skip',async()=>{
 const controller=new AbortController(),chunks:string[]=[];
 const content=await runOrdinaryQuestionRequest({run:async input=>{for(const chunk of ['# A','nswer\n','Normal text.'])input.onAnswerChunk?.(chunk);return '# Answer\nNormal text.';}},{prompt:'Ordinary synthetic task',sources:[]},{signal:controller.signal,onChunk:chunk=>chunks.push(chunk)},{check:async()=>{},ask:async()=>{throw Error('Must not ask');}});expect(content).toBe('# Answer\nNormal text.');expect(chunks).toEqual(['# A','nswer\n','Normal text.']);
 for(const raw of [REQUEST_QUESTION_MARKER+'invalid',REQUEST_QUESTION_MARKER+'\n{}',REQUEST_QUESTION_MARKER+'\n'+JSON.stringify({...definition,extra:true}),REQUEST_QUESTION_MARKER+'\n'+JSON.stringify({...definition,options:[definition.options[0],definition.options[0]]}),REQUEST_QUESTION_MARKER+'\n'+'x'.repeat(12000)])expect(()=>parseRequestQuestionOutput(raw)).toThrow();
 let calls=0,asks=0;await expect(runOrdinaryQuestionRequest({run:async()=>{calls++;return proposal;}},{prompt:'Synthetic Skip task',sources:[]},{signal:controller.signal},{check:async()=>{},ask:async()=>{asks++;return {kind:'skip'};}})).rejects.toThrow('available-information');expect(calls).toBe(2);expect(asks).toBe(1);
});

it('bounds repeated questions and cancels a waiting canonical question when its live guidance signal retires',async()=>{
 let rounds=0,answers=0;await expect(runOrdinaryQuestionRequest({run:async()=>{rounds++;return proposal;}},{prompt:'Synthetic bounded questioning',sources:[]},{signal:new AbortController().signal},{check:async()=>{},ask:async()=>{answers++;return {kind:'choices',ids:['cost']};}})).rejects.toThrow('available-information');expect(rounds).toBe(4);expect(answers).toBe(3);
 const directory=await mkdtemp(join(tmpdir(),'glint-question-guidance-abort-')),core=await createCompanion({dataDir:directory});
 try{const task=await core.createTask({title:'Synthetic retired guidance'}),guidance=new AbortController();let published!:()=>void;const ready=new Promise<void>(resolve=>published=resolve);let calls=0;
  const operation=core.runRequest({taskId:task.id,requestId:'guidance-question',kind:'explain',prompt:'Synthetic task',sourceIds:[]},async context=>{const signal=AbortSignal.any([context.signal,guidance.signal]);return {title:'Must not publish',content:await runOrdinaryQuestionRequest({run:async()=>{calls++;return proposal;}},{prompt:'Synthetic task',sources:[]},{signal},{check:async()=>{},ask:question=>context.askQuestion!(question,published,signal)})};});void operation.catch(()=>{});await ready;guidance.abort();expect((await operation).status).toBe('failed');const after=await core.getTask(task.id);expect(after.requests[0].questions![0].status).toBe('closed');expect(after.artifacts).toHaveLength(0);expect(calls).toBe(1);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

it('honors Stop after the answer commits and before the continuation transmission',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-question-stop-after-answer-')),core=await createCompanion({dataDir:directory});
 try{const task=await core.createTask({title:'Synthetic Stop before continuation'});let published!:()=>void,atContinuation!:()=>void,release!:()=>void;const ready=new Promise<void>(resolve=>published=resolve),continuationReady=new Promise<void>(resolve=>atContinuation=resolve),barrier=new Promise<void>(resolve=>release=resolve);let checks=0,calls=0;
  const operation=core.runRequest({taskId:task.id,requestId:'stop-continuation',kind:'explain',prompt:'Synthetic original',sourceIds:[]},async context=>({title:'Must not publish',content:await runOrdinaryQuestionRequest({run:async()=>{calls++;return proposal;}},{prompt:'Synthetic original',sources:[]},{signal:context.signal},{check:async()=>{if(++checks===3){atContinuation();await barrier;}},ask:question=>context.askQuestion!(question,published)})}));void operation.catch(()=>{});await ready;
  const request=(await core.getTask(task.id)).requests[0],question=request.questions![0];await core.requestQuestionCommand({type:'request.question.answer',taskId:task.id,requestId:request.id,requestDigest:request.digest,questionId:question.id,questionDigest:question.digest,expectedRevision:1,decision:{kind:'choices',ids:['cost']}});await continuationReady;await core.cancelRequest(task.id,request.id);release();expect((await operation).status).toBe('cancelled');const after=await core.getTask(task.id);expect(after.requests[0].questions![0].status).toBe('answered');expect(after.artifacts).toHaveLength(0);expect(calls).toBe(1);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

it('production closed bridge and IPC map admit question commands independently of the still-pending model key',async()=>{
 const host=await readFile('src/host/index.ts','utf8'),bridge=await readFile('src/shared/bridge.ts','utf8');expect(host).toContain("if(String(c.type).startsWith('request.question.'))return readRequestQuestionCommand(c)");expect(host).toContain("case 'request.question.inspect':case 'request.question.answer':case 'request.question.skip':return dispatchRequestQuestion(core,c,changed)");expect(host).toContain('await runOrdinaryQuestionRequest(provider,composed,options');expect(bridge).toContain('| RequestQuestionCommand');
 const key=host.slice(host.indexOf("const key=",host.indexOf("async function dispatchCompanionCommand")),host.indexOf("if(key&&pendingEffects.has(key))"));expect(key).toContain("`model:${c.taskId}`");expect(key).not.toContain('request.question');
});

it.each(['quick','deep','visual'] as const)('continues the requested %s structured explanation contract after a real same-request question',async depth=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-question-depth-')),core=await createCompanion({dataDir:directory});
 try{
  const created=await core.createTask({title:'Structured explanation'}),task=await core.putSource(created.id,{id:'science',kind:'text',role:'fact',label:'Science notes',content:explanationSource}),mode=prepareExplanationMode(task,{type:'model.run',taskId:task.id,requestId:'depth',kind:'explain',prompt:'Explain evaporation',explainDepth:depth})!;
  let published!:()=>void;const ready=new Promise<void>(resolve=>published=resolve),calls:MetaRunInput[]=[];
  const provider={run:async(input:MetaRunInput)=>{calls.push(input);expect(input.prompt).toContain('using its requested output format');expect(input.prompt).not.toContain('answer the original task directly in ordinary Markdown');expect(input.prompt).toContain('JSON');return calls.length===1?proposal:JSON.stringify(explanationProposal(depth));}};
  const operation=core.runRequest({taskId:task.id,requestId:'depth',kind:'explain',prompt:'Explain evaporation',explainDepth:depth,sourceIds:['science']},async context=>{const sources=context.task.sources.map(source=>source.versions[0]),composed=composeOrdinaryRequest({prompt:mode.prompt('Explain evaporation',sources,context.task),sources,taskHistory:context.taskHistory,responseMode:context.responseMode});return mode.finish(await runOrdinaryQuestionRequest(provider,composed,{signal:context.signal},{check:()=>core.assertRequestCurrent(task.id,'depth'),ask:question=>context.askQuestion!(question,published)}),sources);});void operation.catch(()=>{});
  await ready;const request=(await core.getTask(task.id)).requests[0],question=request.questions![0];await core.requestQuestionCommand({type:'request.question.answer',taskId:task.id,requestId:request.id,requestDigest:request.digest,questionId:question.id,questionDigest:question.digest,expectedRevision:1,decision:{kind:'choices',ids:['cost']}});
  expect((await operation).status).toBe('completed');expect(calls).toHaveLength(2);const after=await core.getTask(task.id);expect(after.requests).toHaveLength(1);expect(after.artifacts[0].revisions[0].mimeType).toBe(EXPLANATION_MIME);expect(readExplanation(after.artifacts[0].revisions[0].content)?.depth).toBe(depth);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
