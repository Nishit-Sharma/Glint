import {it,expect} from 'vitest';
import {CodexProvider,type CodexConnection} from '../src/host/codex-provider';
import {MetaProvider,META_MODEL} from '../src/host/provider';
import {runOrdinaryQuestionRequest,REQUEST_QUESTION_MARKER} from '../src/host/request-question-runner';

// Source regression only: real adapter and runner, synthetic app-server events.
// No real CLI, network, sign-in, account file, or native app is used.
it('keeps question protocol out of the visible stream when Codex emits commentary before its final question',async()=>{
 const question={question:'Which detail matters?',mode:'single',options:[{id:'cost',label:'Cost'},{id:'time',label:'Time'}]};
 const proposal=REQUEST_QUESTION_MARKER+'\n'+JSON.stringify(question);
 const listeners=new Set<(event:{method:string;params:Record<string,any>})=>void>();
 let turns=0;
 const emit=(method:string,params:Record<string,unknown>)=>{for(const listener of listeners)listener({method,params:{threadId:'synthetic-thread',...params}});};
 const connection:CodexConnection={
  async request(method){
   if(method==='initialize')return {};
   if(method==='account/read')return {account:{type:'chatgpt',email:'synthetic@example.invalid'}};
   if(method==='model/list')return {data:[{model:'gpt-6-luna',serviceTiers:[{id:'priority',name:'Fast'}],supportedReasoningEfforts:[{reasoningEffort:'medium'}]}]};
   if(method==='thread/start')return {model:'gpt-6-luna',serviceTier:'priority',reasoningEffort:'medium',sandbox:{type:'readOnly'},thread:{id:'synthetic-thread'},instructionSources:[]};
   if(method==='turn/start'){
    const first=++turns===1;
    queueMicrotask(()=>{
     emit('turn/started',{turn:{id:'synthetic-turn'}});
     if(first){
      const commentary='I have one clarification.\n';
      emit('item/started',{item:{id:'commentary',type:'agentMessage',phase:'commentary',text:''}});
      emit('item/agentMessage/delta',{itemId:'commentary',delta:commentary});
      emit('item/completed',{item:{id:'commentary',type:'agentMessage',phase:'commentary',text:commentary}});
     }
     const text=first?proposal:'Final synthetic answer.';
     emit('item/started',{item:{id:'answer',type:'agentMessage',phase:'final_answer',text:''}});
     emit('item/agentMessage/delta',{itemId:'answer',delta:text.slice(0,5)});
     emit('item/agentMessage/delta',{itemId:'answer',delta:text.slice(5)});
     emit('item/completed',{item:{id:'answer',type:'agentMessage',phase:'final_answer',text}});
     emit('turn/completed',{turn:{id:'synthetic-turn',status:'completed'}});
    });
    return {turn:{id:'synthetic-turn'}};
   }
   throw Error('Unexpected synthetic method: '+method);
  },
  notify(){},subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},close(){},
 };
 const provider=new CodexProvider({connect:async()=>connection,cliPath:'/synthetic/no-cli'}),chunks:string[]=[];
 const content=await runOrdinaryQuestionRequest(provider,{prompt:'Plan this fictional event.',sources:[]},{signal:new AbortController().signal,onChunk:chunk=>chunks.push(chunk)},{check:async()=>{},ask:async value=>{expect(value).toEqual(question);return {kind:'choices',ids:['cost']};}});
 expect(content).toBe('Final synthetic answer.');expect(turns).toBe(2);
 expect(chunks.join('')).not.toContain(REQUEST_QUESTION_MARKER);
});

// Known final item deltas remain incremental; unknown-phase and late items are
// withheld until the adapter's returned answer can be classified authoritatively.
function codexStream(events:(emit:(method:string,params:Record<string,unknown>)=>void)=>void){
 const listeners=new Set<(event:{method:string;params:Record<string,any>})=>void>();
 const emit=(method:string,params:Record<string,unknown>)=>{for(const listener of listeners)listener({method,params:{threadId:'stream-thread',...params}});};
 const connection:CodexConnection={async request(method){
  if(method==='initialize')return {};if(method==='account/read')return {account:{type:'chatgpt',email:'synthetic@example.invalid'}};
  if(method==='model/list')return {data:[{model:'gpt-6-luna',serviceTiers:[{id:'priority',name:'Fast'}],supportedReasoningEfforts:[{reasoningEffort:'medium'}]}]};
  if(method==='thread/start')return {model:'gpt-6-luna',serviceTier:'priority',reasoningEffort:'medium',sandbox:{type:'readOnly'},thread:{id:'stream-thread'},instructionSources:[]};
  if(method==='turn/start'){queueMicrotask(()=>{emit('turn/started',{turn:{id:'stream-turn'}});events(emit);});return {turn:{id:'stream-turn'}};}throw Error('Unexpected method '+method);
 },notify(){},subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},close(){}};
 return new CodexProvider({connect:async()=>connection,cliPath:'/synthetic/no-cli'});
}
const noQuestion={check:async()=>{},ask:async()=>{throw Error('Ordinary answer must not ask');}};
it('fails an oversized answer-protocol stream through the real adapter without throwing out of its event callback or showing JSON',async()=>{
 const chunks:string[]=[],proposal=REQUEST_QUESTION_MARKER+'\n'+'x'.repeat(12000);
 const provider=codexStream(emit=>{emit('item/started',{item:{id:'oversized',type:'agentMessage',phase:'final_answer'}});emit('item/agentMessage/delta',{itemId:'oversized',delta:proposal});emit('item/completed',{item:{id:'oversized',type:'agentMessage',phase:'final_answer',text:proposal}});emit('turn/completed',{turn:{id:'stream-turn',status:'completed'}});});
 await expect(runOrdinaryQuestionRequest(provider,{prompt:'Synthetic oversized protocol',sources:[]},{signal:new AbortController().signal,onChunk:chunk=>chunks.push(chunk)},noQuestion)).rejects.toThrow('format is invalid');expect(chunks).toEqual([]);
});
it('streams known ordinary final answer chunks before completion and excludes commentary, wrong item/turn and completed-item deltas',async()=>{
 const chunks:string[]=[];
 const provider=codexStream(emit=>{
  emit('item/started',{item:{id:'comment',type:'agentMessage',phase:'commentary'}});emit('item/agentMessage/delta',{itemId:'comment',delta:'Not visible.'});emit('item/completed',{item:{id:'comment',type:'agentMessage',phase:'commentary',text:'Not visible.'}});
  emit('item/started',{item:{id:'final',type:'agentMessage',phase:'final_answer'}});emit('item/agentMessage/delta',{itemId:'other',delta:'Wrong item.'});emit('item/agentMessage/delta',{itemId:'final',turnId:'other-turn',delta:'Wrong turn.'});
  emit('item/agentMessage/delta',{itemId:'final',delta:'# Plan\n'});expect(chunks).toEqual(['# Plan\n']);
  emit('item/agentMessage/delta',{itemId:'final',delta:'Ordinary answer.'});expect(chunks).toEqual(['# Plan\n','Ordinary answer.']);
  emit('item/completed',{item:{id:'final',type:'agentMessage',phase:'final_answer',text:'# Plan\nOrdinary answer.'}});emit('item/agentMessage/delta',{itemId:'final',delta:'Late stale delta.'});
  emit('turn/completed',{turn:{id:'stream-turn',status:'completed'}});
 });
 const result=await runOrdinaryQuestionRequest(provider,{prompt:'Synthetic ordinary task',sources:[]},{signal:new AbortController().signal,onChunk:chunk=>chunks.push(chunk)},noQuestion);expect(chunks.join('')).toBe(result);expect(result).toBe('# Plan\nOrdinary answer.');
});
it.each(['partial_answer',undefined])('buffers unknown/legacy %s item deltas and uses only the completed ordinary answer',async phase=>{
 const chunks:string[]=[];const provider=codexStream(emit=>{
  emit('item/started',{item:{id:'legacy',type:'agentMessage',phase}});emit('item/agentMessage/delta',{itemId:'legacy',delta:'Unverified delta.'});expect(chunks).toEqual([]);
  emit('item/completed',{item:{id:'legacy',type:'agentMessage',phase,text:'Completed fallback Markdown.'}});expect(chunks).toEqual([]);emit('turn/completed',{turn:{id:'stream-turn',status:'completed'}});
 });
 expect(await runOrdinaryQuestionRequest(provider,{prompt:'Synthetic fallback',sources:[]},{signal:new AbortController().signal,onChunk:chunk=>chunks.push(chunk)},noQuestion)).toBe('Completed fallback Markdown.');expect(chunks).toEqual(['Completed fallback Markdown.']);
});
it('does not trust an unknown-phase delta when a later completed final item is a question',async()=>{
 const proposal=REQUEST_QUESTION_MARKER+'\n'+JSON.stringify({question:'Which?',mode:'single',options:[{id:'a',label:'A'},{id:'b',label:'B'}]});let turns=0;const chunks:string[]=[];
 const provider=codexStream(emit=>{const first=++turns===1;emit('item/agentMessage/delta',{itemId:'late-phase',delta:first?'Unverified commentary.':'Unverified final delta.'});emit('item/completed',{item:{id:'late-phase',type:'agentMessage',phase:'final_answer',text:first?proposal:'Completed final answer.'}});emit('turn/completed',{turn:{id:'stream-turn',status:'completed'}});});
 expect(await runOrdinaryQuestionRequest(provider,{prompt:'Synthetic question',sources:[]},{signal:new AbortController().signal,onChunk:chunk=>chunks.push(chunk)},{check:async()=>{},ask:async()=>{expect(chunks).toEqual([]);return {kind:'skip'};}})).toBe('Completed final answer.');expect(chunks).toEqual(['Completed final answer.']);
});
function metaEvent(content:string,finish_reason:string|null=null){return 'data: '+JSON.stringify({id:'local-only',object:'chat.completion.chunk',created:1,model:META_MODEL,choices:[{index:0,delta:{content},finish_reason}]})+'\n\n';}
it('streams actual Meta answer deltas incrementally and suppresses a split question marker through the installed SDK',async()=>{
 const question={question:'Which?',mode:'multiple',options:[{id:'a',label:'A'},{id:'b',label:'B'}]},proposal=REQUEST_QUESTION_MARKER+'\n'+JSON.stringify(question),chunks:string[]=[];let turns=0;
 const provider=new MetaProvider({getKey:async()=> 'synthetic-only-key',fetch:async()=>{const first=++turns===1,parts=first?[proposal.slice(0,5),proposal.slice(5)]:['# Meta\n','Ordinary answer.'];return new Response(new ReadableStream({start(stream){for(const part of parts)stream.enqueue(new TextEncoder().encode(metaEvent(part)));stream.enqueue(new TextEncoder().encode(metaEvent('','stop')+'data: [DONE]\n\n'));stream.close();}}),{headers:{'Content-Type':'text/event-stream'}});}});
 expect(await runOrdinaryQuestionRequest(provider,{prompt:'Synthetic Meta task',sources:[]},{signal:new AbortController().signal,onChunk:chunk=>chunks.push(chunk)},{check:async()=>{},ask:async received=>{expect(received).toEqual(question);expect(chunks).toEqual([]);return {kind:'choices',ids:['b']};}})).toBe('# Meta\nOrdinary answer.');expect(chunks).toEqual(['# Meta\n','Ordinary answer.']);expect(turns).toBe(2);
});

it.each([undefined,'final_answer'] as const)('rejects mixed %s completed items without leaking a late split protocol or guessing a question',async phase=>{
 const question={question:'Which?',mode:'single',options:[{id:'a',label:'A'},{id:'b',label:'B'}]},proposal=REQUEST_QUESTION_MARKER+'\n'+JSON.stringify(question),chunks:string[]=[];let asks=0;
 const provider=codexStream(emit=>{
  emit('item/started',{item:{id:'preamble',type:'agentMessage',phase}});emit('item/agentMessage/delta',{itemId:'preamble',delta:'I have one clarification.\n'});emit('item/completed',{item:{id:'preamble',type:'agentMessage',phase,text:'I have one clarification.\n'}});
  emit('item/started',{item:{id:'question',type:'agentMessage',phase}});
  for(const delta of [proposal.slice(0,3),proposal.slice(3,9),proposal.slice(9)])emit('item/agentMessage/delta',{itemId:'question',delta});
  emit('item/completed',{item:{id:'question',type:'agentMessage',phase,text:proposal}});emit('turn/completed',{turn:{id:'stream-turn',status:'completed'}});
 });
 await expect(runOrdinaryQuestionRequest(provider,{prompt:'Synthetic ambiguous question',sources:[]},{signal:new AbortController().signal,onChunk:chunk=>chunks.push(chunk)},{check:async()=>{},ask:async()=>{asks++;return {kind:'skip'};}})).rejects.toThrow('format is invalid');
 expect(asks).toBe(0);expect(chunks.join('')).not.toContain(REQUEST_QUESTION_MARKER);expect(chunks.join('')).not.toContain('"question"');expect(chunks.join('')).not.toContain('"options"');
 expect(chunks.join('')).toBe(phase?'I have one clarification.\n':'');
});
it('flushes a harmless partial reserved-marker suffix only after ordinary completed output is validated',async()=>{
 const chunks:string[]=[];const provider=codexStream(emit=>{emit('item/started',{item:{id:'ordinary',type:'agentMessage',phase:'final_answer'}});emit('item/agentMessage/delta',{itemId:'ordinary',delta:'An ordinary G'});expect(chunks).toEqual(['An ordinary ']);emit('item/agentMessage/delta',{itemId:'ordinary',delta:'L'});expect(chunks).toEqual(['An ordinary ']);emit('item/completed',{item:{id:'ordinary',type:'agentMessage',phase:'final_answer',text:'An ordinary GL'}});emit('turn/completed',{turn:{id:'stream-turn',status:'completed'}});});
 expect(await runOrdinaryQuestionRequest(provider,{prompt:'Synthetic harmless suffix',sources:[]},{signal:new AbortController().signal,onChunk:chunk=>chunks.push(chunk)},noQuestion)).toBe('An ordinary GL');expect(chunks).toEqual(['An ordinary ','GL']);
});
