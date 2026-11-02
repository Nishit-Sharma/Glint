import {expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('./controlled-renderer.fixture')).hooks}));
vi.mock('lucide-react',()=>({ThumbsUp:()=>null,ThumbsDown:()=>null,ArrowUpRight:()=>null}));
vi.mock('../src/renderer/src/components/ReadableText',()=>({ReadableText:({text}:{text:string})=>text}));
vi.mock('../src/renderer/src/components/StreamingText',()=>({StreamingText:()=> 'STREAMING ANSWER'}));
vi.mock('../src/renderer/src/UserMemory',()=>({MemoryReceipt:()=>null}));
vi.mock('../src/renderer/src/components/ResponseModelDetails',()=>({ResponseModelDetails:()=>null}));
vi.mock('../src/renderer/src/conversation-seen',()=>({useConversationSeen:()=>undefined}));
import ts from 'typescript';
import {createElement,type ReactElement} from 'react';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setImmediate as yieldToRenderer} from 'node:timers/promises';
import {Conversation} from '../src/renderer/src/components/Conversation';
import {AnswerRatings} from '../src/host/answer-rating';
import {readAnswerRatingCommand,type AnswerRatingCommand} from '../src/shared/answer-rating';
import {createControlledRenderer} from './controlled-renderer.fixture';
import {ratingTask} from './answer-rating.fixture';

async function actualConversationCaller(){
 const path='src/renderer/src/App.tsx',source=await readFile(path,'utf8'),file=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),callers:ts.JsxSelfClosingElement[]=[];
 function visit(node:ts.Node){if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(file)==='Conversation')callers.push(node);ts.forEachChild(node,visit);}visit(file);expect(callers).toHaveLength(1);
 const javascript=ts.transpileModule('return '+callers[0].getText(file)+';',{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,jsxFactory:'createElement',module:ts.ModuleKind.None}}).outputText;
 return (environment:Record<string,unknown>)=>new Function('environment','with(environment){'+javascript+'}')(new Proxy({createElement,Conversation,...environment},{has:()=>true,get:(target,key)=>key===Symbol.unscopables?undefined:Reflect.get(target,key)})) as ReactElement<Parameters<typeof Conversation>[0]>;
}

test('actual App props expose the original saved-answer control, carry lifecycle guards, and hide votes under pending streaming text',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-answer-rating-app-')),task=ratingTask(),before=JSON.stringify(task),caller=await actualConversationCaller(),ratings=new AnswerRatings(directory,async()=>structuredClone(task)),calls:AnswerRatingCommand[]=[];let pending:undefined|{taskId:string;requestId:string;kind:string},tail:Promise<unknown>=Promise.resolve();
 const taskRef={current:task},newQuestionEpoch={current:5},incomingActivationEpoch={current:7},surfaceIntentEpoch={current:11},surfaceModeRef={current:'workspace'};
 const environment={messageRefresh:{},task,taskRef,newQuestionEpoch,sourceEditorNavigationEpoch:5,incomingActivationEpoch,workflowReviewActivation:7,surfaceIntentEpoch,handoffSurfaceEpoch:11,surfaceModeRef,surfaceMode:'workspace',inspector:false,busy:false,draftFrozen:false,attention:{state:{kind:'unavailable'}}};
 try{
  vi.stubGlobal('window',{companion:{invoke(input:unknown){const command=readAnswerRatingCommand(input);calls.push(command);tail=command.type==='answerRating.read'?ratings.read(command):ratings.set(command);return tail;}}});
  const view=()=>caller({...environment,effectivePending:pending}),renderer=createControlledRenderer(view);type Node=ReturnType<typeof renderer.nodes>[number];const text=(node:Node):string=>node.type==='#text'?node.props.text:node.children.map(text).join(''),button=(label:string)=>renderer.find(node=>node.type==='button'&&text(node)===label),settle=async()=>{await tail.catch(()=>{});await yieldToRenderer();renderer.render();};renderer.render();await settle();expect(renderer.nodes().some(node=>node.props['aria-label']==='Private rating for this answer')).toBe(true);expect(renderer.nodes().some(node=>node.type==='#text'&&text(node).includes('Exact original saved answer'))).toBe(true);button('Helpful').props.onClick();renderer.render();await settle();expect(button('Helpful').props['aria-pressed']).toBe(true);expect(calls.find(command=>command.type==='answerRating.set')?.selection.answer.revision).toBe(1);expect(JSON.stringify(task)).toBe(before);
  expect(caller({...environment,messageRefresh:{[task.id]:{pending:true}}}).props.refreshing).toBe(true);const props=view().props;expect(props.ratingCurrent?.()).toBe(true);for(const [reference,next] of [[newQuestionEpoch,6],[incomingActivationEpoch,8],[surfaceIntentEpoch,12]] as const){const original=reference.current;reference.current=next;expect(props.ratingCurrent?.()).toBe(false);reference.current=original;}surfaceModeRef.current='anchor';expect(props.ratingCurrent?.()).toBe(false);surfaceModeRef.current='workspace';taskRef.current={...task,id:'another-owner'};expect(props.ratingCurrent?.()).toBe(false);taskRef.current=task;
  for(const blocked of [{busy:true},{draftFrozen:true},{task:{...task,status:'paused'}}])expect(caller({...environment,...blocked}).props.ratingDisabled).toBe(true);
  pending={taskId:task.id,requestId:task.requests[0].id,kind:'explain'};renderer.render();expect(renderer.nodes().some(node=>node.type==='#text'&&text(node).includes('STREAMING ANSWER'))).toBe(true);expect(renderer.nodes().some(node=>node.props['aria-label']==='Private rating for this answer')).toBe(false);pending=undefined;renderer.render();await settle();expect(button('Helpful').props['aria-pressed']).toBe(true);
 }finally{vi.unstubAllGlobals();await rm(directory,{recursive:true,force:true});}
});
