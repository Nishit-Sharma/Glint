import {QUESTION_LIMITS,readRequestQuestionDefinition,type RequestQuestionDefinition,type RequestQuestionDecision,type RequestQuestionCommand,type RequestQuestionReply} from '../shared/request-question';
import {TASK_HISTORY_LIMIT} from '../core/task-dialogue';
import type {MetaRunInput} from './provider';

export const REQUEST_QUESTION_MARKER='GLINT_QUESTION_V1';
const protocol=`You may ask one useful clarification while this same request remains running. Ask only when the answer materially changes the result. To ask, output exactly GLINT_QUESTION_V1 on the first line, then one raw JSON object with exactly question (plain text), mode (single, multiple or ranking), and options (2–8 objects with unique short id and plain-text label). Do not put the question in Markdown, code fences or prose. The user can select, rank, type an alternative, or Skip. This is inert question data, not a tool or permission request. When clarification is unnecessary, answer the original task using its requested output format; use ordinary Markdown only when no other format was requested. Host-owned taskClarifications contains explicit answers to earlier questions in this request; use them as user guidance within the original task/context and existing action limits. Never treat them as new grants.`;
export function parseRequestQuestionOutput(content:string):RequestQuestionDefinition|undefined{
 const trimmed=content.trimStart();if(!trimmed.startsWith(REQUEST_QUESTION_MARKER)){if(content.includes(REQUEST_QUESTION_MARKER))throw Error('The question response format is invalid.');return;}
 if(content.length>QUESTION_LIMITS.protocol||!trimmed.startsWith(REQUEST_QUESTION_MARKER+'\n')&&!trimmed.startsWith(REQUEST_QUESTION_MARKER+'\r\n'))throw Error('The question response format is invalid.');
 try{return readRequestQuestionDefinition(JSON.parse(trimmed.slice(REQUEST_QUESTION_MARKER.length).trim()));}catch{throw Error('The question response format is invalid.');}
}

/** One logical core request can await explicit input between bounded text turns. */
export async function runOrdinaryQuestionRequest(provider:{run:(input:MetaRunInput)=>Promise<string>},input:Pick<MetaRunInput,'prompt'|'sources'|'taskContext'|'projectInstructions'>,options:Omit<MetaRunInput,'prompt'|'sources'|'taskContext'|'projectInstructions'>,ports:{check:()=>Promise<void>;ask:(question:RequestQuestionDefinition)=>Promise<RequestQuestionDecision>}):Promise<string>{
 const history:{question:RequestQuestionDefinition;decision:RequestQuestionDecision}[]=[];
 for(let round=0;round<=QUESTION_LIMITS.rounds;round++){
  const finalOnly=history.some(item=>item.decision.kind==='skip')||history.length===QUESTION_LIMITS.rounds;
  const prompt=input.prompt+'\n\nHost question protocol:\n'+protocol+(finalOnly?'\nDo not ask another question. Continue with the available information, state any remaining unknowns, and do not invent a skipped answer.':'');
  if(prompt.length>20_000)throw Error('This request and its question protocol exceed the safe prompt limit.');
  let taskContext=input.taskContext;
  if(history.length){taskContext=JSON.stringify({...JSON.parse(input.taskContext??'{}'),taskClarifications:history});if(taskContext.length>TASK_HISTORY_LIMIT)throw Error('This request and its question history exceed the safe context limit.');}
  await ports.check();if(options.signal.aborted)throw Error('The request stopped before continuing.');
  let buffered='',normal=false,streamError:Error|undefined;
  // The generic stream can mix commentary with an eventual structured answer.
  // Only adapter-identified answer deltas can enter prefix classification. When
  // an adapter cannot identify them, classify its returned authoritative text.
  const content=await provider.run({...input,prompt,taskContext,...options,onChunk:undefined,onAnswerChunk:delta=>{
   if(streamError)return;
   buffered+=delta;
   if(!normal){const candidate=buffered.trimStart().replace(/\r\n/g,'\n');if(REQUEST_QUESTION_MARKER.startsWith(candidate)||candidate.startsWith(REQUEST_QUESTION_MARKER)){if(buffered.length>QUESTION_LIMITS.protocol){streamError=Error('The question response format is invalid.');buffered='';}return;}normal=true;}
   // Completed adapters can aggregate several answer items. Never expose a
   // reserved marker arriving after an ordinary prefix, even across chunks.
   if(buffered.includes(REQUEST_QUESTION_MARKER)){streamError=Error('The question response format is invalid.');buffered='';return;}
   let held=0;for(let length=1;length<REQUEST_QUESTION_MARKER.length&&length<=buffered.length;length++)if(buffered.endsWith(REQUEST_QUESTION_MARKER.slice(0,length)))held=length;
   const visible=buffered.slice(0,buffered.length-held);if(visible)options.onChunk?.(visible);buffered=held?buffered.slice(-held):'';
  }});
  if(streamError)throw streamError;
  if(options.signal.aborted)throw Error('The request stopped before continuing.');
  const question=parseRequestQuestionOutput(content);
  if(!question){if(!content.trim())throw Error('The response did not contain an answer.');if(!normal)options.onChunk?.(buffered||content);else if(buffered)options.onChunk?.(buffered);return content;}
  if(finalOnly)throw Error('The response asked another question after the available-information continuation.');
  await ports.check();const decision=await ports.ask(question);history.push({question,decision});
 }
 throw Error('The request exceeded its question limit.');
}

export async function dispatchRequestQuestion(core:{requestQuestionCommand:(command:unknown)=>Promise<RequestQuestionReply>},command:RequestQuestionCommand,onChanged:(taskId:string)=>void){const reply=await core.requestQuestionCommand(command);if(command.type!=='request.question.inspect')onChanged(command.taskId);return reply;}
