import {afterEach,expect,it,vi} from 'vitest';
const cleanup=vi.hoisted(()=>({callbacks:new Set<()=>void>()}));
vi.mock('react',async original=>{const hooks=(await import('../support/controlled-renderer.fixture')).hooks;return {...await original<typeof import('react')>(),...hooks,useLayoutEffect:(fn:()=>void|(()=>void),deps?:readonly unknown[])=>hooks.useLayoutEffect(()=>{const close=fn();if(!close)return;const wrapped=()=>{cleanup.callbacks.delete(wrapped);close();};cleanup.callbacks.add(wrapped);return wrapped;},deps)};});
import {createElement} from 'react';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../../src/core/companion';
import {RequestQuestion} from '../../src/renderer/src/components/RequestQuestion';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';
import {LearningDraftProvider} from '../../src/renderer/src/learning-draft-context';
import {createLearningDrafts} from '../../src/renderer/src/learning-drafts';
import {LearningDraftStore} from '../../src/host/learning-drafts';
import {dispatchRequestQuestion} from '../../src/host/request-question-runner';
import type {RequestQuestionDefinition,RequestQuestionCommand,RequestQuestionBinding} from '../../src/shared/request-question';

type Host=ReturnType<ReturnType<typeof createControlledRenderer>['nodes']>[number];
const text=(node:Host):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
afterEach(()=>{for(const close of [...cleanup.callbacks])close();vi.unstubAllGlobals();});
async function fixture(mode:RequestQuestionDefinition['mode']='single',saved=false,longLabels=false){
 const directory=await mkdtemp(join(tmpdir(),'glint-question-ui-')),core=await createCompanion({dataDir:join(directory,'core')});let task=await core.createTask({title:'Synthetic inline question'});await core.saveComposerDraft(task.id,0,{text:'UNRELATED raw composer',kind:'explain'});
 let published!:()=>void;const ready=new Promise<void>(resolve=>published=resolve);let runnerCalls=0;
 const operation=core.runRequest({taskId:task.id,requestId:'inline-question',kind:'explain',prompt:'Synthetic plan',sourceIds:[]},async context=>{runnerCalls++;const decision=await context.askQuestion!({question:longLabels?'問'.repeat(1200):'Which detail should the fictional plan emphasize?',mode,options:[{id:'schedule',label:longLabels?'A'.repeat(240):'Schedule'},{id:'cost',label:longLabels?'東京'.repeat(120):'Cost'}]},published);return {title:'Synthetic resumed result',content:JSON.stringify(decision),mimeType:'text/markdown'};});void operation.catch(()=>{});await ready;task=await core.getTask(task.id);
 const commands:RequestQuestionCommand[]=[],root={taskRef:{current:task},mainRef:{current:{isConnected:true}},pageReferenceView:{current:{page:'work'}},surfaceModeRef:{current:'workspace'},newQuestionEpoch:{current:0},incomingActivationEpoch:{current:0},surfaceIntentEpoch:{current:0},workflowContinuation:{current:{epoch:0}},questionAuthorityKey:'[0,0,0,0]'};
 // Execute the actual small App callback with synthetic live refs; no DOM/native claim.
 const app=await readFile('src/renderer/src/App.tsx','utf8'),start=app.indexOf('isQuestionCurrent={binding=>'),end=app.indexOf('}} ',start);if(start<0||end<0)throw Error('Actual root question guard not found');
 const expression=app.slice(start+'isQuestionCurrent={'.length,end+1),isCurrent=new Function(...Object.keys(root),'return ('+expression+');')(...Object.values(root)) as (binding:RequestQuestionBinding)=>boolean;
 let tail:Promise<unknown>=Promise.resolve(),loseReply=false,refreshBeforeLostReply=false,saveStarted=false,releaseSave:(()=>void)|undefined;
 const store=new LearningDraftStore({directory:join(directory,'drafts'),lookupTask:async id=>{try{return await core.getTask(id);}catch{return undefined;}}});
 let blockSave:Promise<void>|undefined,dispatchGate:Promise<void>|undefined,releaseDispatch:(()=>void)|undefined;
 const cache=createLearningDrafts({read:()=>store.read(),save:async(...args)=>{saveStarted=true;if(blockSave)await blockSave;return store.save(...args);}});if(saved)await cache.load();
 vi.stubGlobal('window',{companion:{invoke:(command:RequestQuestionCommand)=>{commands.push(command);let notification:Promise<void>=Promise.resolve();const work=(async()=>{if(dispatchGate&&command.type!=='request.question.inspect')await dispatchGate;return dispatchRequestQuestion(core,command,()=>{if(loseReply&&refreshBeforeLostReply)notification=core.getTask(task.id).then(saved=>{task=saved;root.taskRef.current=task;view.render();});});})().then(async reply=>{if(loseReply&&command.type!=='request.question.inspect'){loseReply=false;await notification;throw Error('Synthetic reply lost after commit.');}task=await core.getTask(task.id);root.taskRef.current=task;return reply;});tail=work.catch(()=>{});return work;}}});
 const view=createControlledRenderer(()=>{const request=task.requests[0],question=request.questions![0],card=createElement(RequestQuestion,{task,request,question,active:true,authorityKey:root.questionAuthorityKey,isCurrent});return saved?createElement(LearningDraftProvider,{cache,children:card}):card;});view.render();
 return {core,view,commands,root,cache,operation,runnerCalls:()=>runnerCalls,button:(label:string)=>view.find(node=>node.type==='button'&&text(node)===label),choice:(label:string)=>view.find(node=>node.type==='label'&&text(node)===label).children.find(node=>node.type==='input')!,render:()=>view.render(),refresh:async()=>{task=await core.getTask(task.id);root.taskRef.current=task;view.render();},wait:async()=>{await tail;await tick();view.render();},loseReply:(refreshFirst=false)=>{loseReply=true;refreshBeforeLostReply=refreshFirst;},blockDispatch:()=>{dispatchGate=new Promise<void>(resolve=>releaseDispatch=resolve);},releaseDispatch:()=>releaseDispatch?.(),blockSave:()=>{blockSave=new Promise<void>(resolve=>releaseSave=resolve);},saveStarted:()=>saveStarted,releaseSave:()=>{releaseSave?.();},close:async()=>{for(const close of [...cleanup.callbacks])close();await cache.flush().catch(()=>{});await core.cancelRequest(task.id,task.requests[0].id).catch(()=>{});await operation.catch(()=>{});await core.close();await rm(directory,{recursive:true,force:true});}};
}

it.each(['single','multiple','ranking','alternative','skip'] as const)('uses real inline %s controls to continue the same pending request without consuming the composer',async mode=>{
 const f=await fixture(mode==='multiple'?'multiple':mode==='ranking'?'ranking':'single',true);
 try{
  if(mode==='ranking'){f.view.find(node=>node.type==='button'&&node.props['aria-label']==='Move Schedule down').props.onClick();f.render();}
  else if(mode==='alternative'||mode==='skip'){f.choice('Use my own answer').props.onChange({currentTarget:{checked:true}});f.render();f.view.find(node=>node.type==='textarea').props.onChange({currentTarget:{value:'  Quality and 東京 instead.\n'}});f.render();}
  else {f.choice('Schedule').props.onChange();f.render();if(mode==='multiple'){f.choice('Cost').props.onChange();f.render();}}
  expect(f.commands).toEqual([]);expect((await f.core.getTask(f.root.taskRef.current.id)).requests[0].questions![0].status).toBe('waiting');
  if(mode==='skip')f.button('Skip').props.onClick();else {const form=f.view.find(node=>node.type==='form');form.props.onSubmit({preventDefault(){}});form.props.onSubmit({preventDefault(){}});}
  await f.wait();expect((await f.operation).status).toBe('completed');await f.wait();expect(f.commands).toHaveLength(1);expect(f.runnerCalls()).toBe(1);expect(f.view.nodes().some(node=>node.type==='button'&&text(node)==='Inspect question')).toBe(false);expect(f.view.nodes().some(node=>node.type==='#text'&&node.props.text.includes('lesson result'))).toBe(false);
  const command=f.commands[0];expect(command.type).toBe(mode==='skip'?'request.question.skip':'request.question.answer');if(command.type==='request.question.answer')expect(command.decision).toEqual(mode==='alternative'?{kind:'alternative',text:'  Quality and 東京 instead.\n'}:{kind:'choices',ids:mode==='ranking'?['cost','schedule']:mode==='multiple'?['schedule','cost']:['schedule']});
  expect((await f.core.getTask(f.root.taskRef.current.id)).session?.draft).toBe('UNRELATED raw composer');if(mode==='alternative'||mode==='skip')expect(f.view.find(node=>node.type==='textarea').props.value).toBe('  Quality and 東京 instead.\n');if(mode==='skip')expect(JSON.stringify(command)).not.toContain('Quality');
 }finally{await f.close();}
});

it('does not answer from normal text and reconciles a lost decision reply without starting another continuation',async()=>{
 const f=await fixture('single',true);try{
  await f.core.saveComposerDraft(f.root.taskRef.current.id,1,{text:'Ordinary new chat text',kind:'create'});expect(f.commands).toEqual([]);expect((await f.core.getTask(f.root.taskRef.current.id)).requests[0].questions![0].status).toBe('waiting');
  f.choice('Cost').props.onChange();f.render();f.loseReply();f.view.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await f.wait();await f.operation;await f.wait();
  expect(f.view.nodes().some(node=>node.type==='#text'&&node.props.text.includes('not confirmed'))).toBe(true);f.button('Inspect question').props.onClick();await f.wait();expect(f.view.nodes().some(node=>node.type==='button'&&text(node)==='Inspect question')).toBe(false);expect(f.commands.map(command=>command.type)).toEqual(['request.question.answer','request.question.inspect']);expect(f.runnerCalls()).toBe(1);expect(f.view.nodes().some(node=>node.type==='button'&&text(node)==='Retry original response')).toBe(false);
 }finally{await f.close();}
});

it('uses root live navigation/surface refs after a real durable draft flush, retaining input instead of submitting a stale handler',async()=>{
 const f=await fixture('single',true);try{
  f.blockSave();f.choice('Schedule').props.onChange();f.render();f.view.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await expect.poll(f.saveStarted,{message:JSON.stringify({cache:f.cache.getSnapshot(),shown:f.view.nodes().filter(node=>node.props.role==='alert').map(text)})}).toBe(true);
  f.root.newQuestionEpoch.current++;f.root.surfaceModeRef.current='companion';f.releaseSave();await f.cache.flush();await tick();f.render();expect(f.commands).toEqual([]);expect((await f.core.getTask(f.root.taskRef.current.id)).requests[0].questions![0].status).toBe('waiting');
  const entries=Object.values(f.cache.getSnapshot().entries);expect(entries.some(entry=>entry.local?.value.includes('request.question.answer'))).toBe(true);
 }finally{f.releaseSave();await f.close();}
});

it.each(['single','multiple'] as const)('keeps maximal unbroken %s question/choice text inside scoped shrinkable wrapping boxes',async mode=>{
 // Source/control guard only: no layout engine or native narrow-width proof.
 const f=await fixture(mode,true,true);try{
  expect(text(f.view.find(node=>node.type==='h4'))).toBe('問'.repeat(1200));
  const labels=f.view.nodes().filter(node=>node.type==='span'&&node.props.className==='request-question-choice-text');expect(labels.map(text)).toEqual(['A'.repeat(240),'東京'.repeat(120)]);
  expect(f.choice('A'.repeat(240)).props.type).toBe(mode==='single'?'radio':'checkbox');
  const css=await readFile('src/renderer/src/components/request-question.css','utf8'),rule=(selector:string)=>css.slice(css.indexOf(selector+'{')).split('}')[0];
  expect(rule('.request-question-card')).toContain('overflow-wrap:anywhere');expect(rule('.request-question-card')).toContain('max-width:100%');expect(rule('.request-question-card')).toContain('box-sizing:border-box');
  expect(rule('.request-question-card label')).toContain('min-width:0');expect(rule('.request-question-card .request-question-choice-text')).toContain('min-width:0');expect(rule('.request-question-card .request-question-choice-text')).toContain('flex:1');
 }finally{await f.close();}
});

it.each(['refresh-first','rejection-first'] as const)('settles a lost ACK when its matching canonical receipt arrives %s without erasing unsent input',async order=>{
 const f=await fixture('single',true);try{
  f.choice('Use my own answer').props.onChange({currentTarget:{checked:true}});f.render();f.view.find(node=>node.type==='textarea').props.onChange({currentTarget:{value:'Unsent alternative 東京\n'}});f.render();f.choice('Use my own answer').props.onChange({currentTarget:{checked:false}});f.render();f.choice('Schedule').props.onChange();f.render();
  f.loseReply(order==='refresh-first');f.view.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await f.wait();await f.operation;await f.wait();
  if(order==='rejection-first'){expect(f.view.nodes().some(node=>node.type==='#text'&&node.props.text.includes('not confirmed'))).toBe(true);await f.refresh();await tick();f.render();}
  await f.cache.flush();f.render();const rendered=f.view.nodes().filter(node=>node.type==='#text').map(node=>node.props.text).join(' ');
  expect(rendered).toContain('Answer recorded');expect(rendered).not.toContain('not confirmed');expect(rendered).not.toContain('Inspect this question before retrying');expect(f.view.nodes().some(node=>node.type==='button'&&text(node)==='Inspect question')).toBe(false);
  expect(f.commands).toHaveLength(1);expect(f.runnerCalls()).toBe(1);expect(f.view.find(node=>node.type==='textarea').props.value).toBe('Unsent alternative 東京\n');
  expect(Object.values(f.cache.getSnapshot().entries).filter(entry=>entry.local).every(entry=>JSON.parse(entry.local!.value).pendingText==='')).toBe(true);
 }finally{await f.close();}
});


it('preserves a conflicting saved intent without retrying it as a new response',async()=>{
 const f=await fixture('single',true);try{
  f.blockDispatch();f.choice('Schedule').props.onChange();f.render();f.view.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await expect.poll(()=>f.commands.length).toBe(1);
  const local=f.commands[0];if(local.type!=='request.question.answer')throw Error('Expected explicit local answer');
  await dispatchRequestQuestion(f.core,{...local,decision:{kind:'choices',ids:['cost']}},()=>{});await f.refresh();f.releaseDispatch();await f.wait();await f.operation;await f.wait();
  const rendered=f.view.nodes().filter(node=>node.type==='#text').map(node=>node.props.text).join(' ');expect(rendered).toContain('A different response is already recorded');expect(rendered).toContain('Recorded response:');expect(rendered).toContain('Cost');
  expect(f.commands).toHaveLength(1);expect(f.runnerCalls()).toBe(1);expect(f.view.nodes().some(node=>node.type==='button'&&text(node)==='Retry original response')).toBe(false);
  await f.cache.flush();expect(Object.values(f.cache.getSnapshot().entries).some(entry=>entry.local?.value.includes('schedule'))).toBe(true);
 }finally{f.releaseDispatch();await f.close();}
});
