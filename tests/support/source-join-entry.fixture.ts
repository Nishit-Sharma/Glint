import type {Page} from '@playwright/test';
import {OnboardingFixture} from './onboarding-fixture';
import {extractionFixture} from './grounded-join-fixture';
import {prepareBriefActionPlan} from '../../src/host/brief-action-plan';
import {parseScreenBriefModel,SCREEN_BRIEF_DELIMITER} from '../../src/core/screen-brief';
import type {Command} from '../../src/shared/bridge';
import type {JoinExtractionProposal} from '../../src/learning/grounded-join';

/** Real App, bridge, ready bot, Companion ledger and stores. All source text and
 * provider/native transport are synthetic; this is not OCR or native send review. */
export async function sourceJoinEntry(page:Page,kind:'sql'|'hardware'='sql',port=Number(process.env.WINDOW_COMPANION_TEST_PORT??4180)){
 const fixture=await OnboardingFixture.open(page,{ready:true,port});fixture.configured=true;
 const catalog=await fixture.ready(),task=await fixture.core.createTask({title:kind==='sql'?'Review supplied tables':'Explain supplied hardware',assignedBotId:catalog.defaultBotId});
 const supplied=extractionFixture(true);
 const unknownKeys=(table:JoinExtractionProposal['extraction']['left'])=>({...table,columns:table.columns.map((column,index)=>index===0?{...column,type:'unknown' as const,typeCitationId:null}:column)});
 const proposal:JoinExtractionProposal={...supplied.proposal,extraction:{...supplied.proposal.extraction,left:unknownKeys(supplied.proposal.extraction.left),right:unknownKeys(supplied.proposal.extraction.right),join:{kind:'ambiguous',reason:'No join condition is visible; equality on the displayed Team columns is only a proposed interpretation.'}}};
 const sourceLabel=kind==='sql'?'Synthetic supplied Members and invitations':'Synthetic supplied hardware excerpt';
 const content=kind==='sql'?supplied.content:'VHDL excerpt: signal ready : std_logic; ready <= enable and clock_ok;\nNo testbench, timing trace or evaluated output is supplied.';
 const withSource=await fixture.core.putSource(task.id,{id:'supplied-source',kind:'text',role:'fact',label:sourceLabel,content});
 const source=withSource.sources[0],refs=[{sourceId:source.id,version:source.currentVersion,digest:source.versions.at(-1)!.digest}];
 const label=kind==='sql'?'Review the join':'Explain the ready signal';
 const action={label,outcome:kind==='sql'?'Review rows and predict matching pairs.':'Explain the expression and missing timing evidence.',requestKind:kind==='sql'?'experiment':'explain',seedPrompt:kind==='sql'?'Prepare a reviewed equality join from the supplied tables.':'Explain the supplied ready expression and its limits.',sourceRefs:['S1'],...(kind==='sql'?{capability:'sql-join'}:{})};
 const briefText=(kind==='sql'?'The supplied tables show Team values; one key is unreadable and the join condition needs review.':'The excerpt combines enable and clock_ok; it supplies no timing evidence or testbench.')+SCREEN_BRIEF_DELIMITER+JSON.stringify({actions:[action]});
 // The first synthetic model response still uses real runRequest and strict S1 binding.
 const initial=await fixture.core.runRequest({taskId:task.id,requestId:'synthetic-initial-brief',kind:'explain',prompt:'Read the supplied synthetic source.',sourceIds:[source.id],expectedSourceRefs:refs},async ctx=>({title:'Screen brief',mimeType:'application/json',content:JSON.stringify(parseScreenBriefModel(briefText,ctx.sourceRefs))}));
 if(initial.status!=='completed')throw Error(initial.error??'Initial synthetic brief failed.');
 const counters={modelRequests:[] as {requestId:string;kind:string;hasBriefAction:boolean}[],safeChunks:[] as string[],bindings:[] as {commandId:string;planId:string;sourceRefs:typeof refs}[],ordinary:0};
 const invoke=fixture.invoke.bind(fixture);let finish:((text:string)=>void)|undefined;let rejectPending:((error:Error)=>void)|undefined;
 fixture.invoke=async(command:Command)=>{
  if(command.type!=='model.run')return invoke(command);
  fixture.commands.push(structuredClone(command));counters.modelRequests.push({requestId:command.requestId,kind:command.kind,hasBriefAction:!!command.briefAction});
  const current=await fixture.core.getTask(command.taskId),plan=prepareBriefActionPlan(current,command);
  if(!plan)throw Error('The actual contextual action did not forward its saved selection.');
  counters.bindings.push({commandId:command.requestId,planId:plan.request.requestId,sourceRefs:structuredClone(plan.request.expectedSourceRefs!)});
  const result=await fixture.core.runRequest(plan.request,async ctx=>{
   const bound=plan.bind(ctx);
   if(bound.kind==='ordinary'){
    counters.ordinary++;
    return {title:'Ready signal explanation',mimeType:'text/markdown',content:'The supplied VHDL expression sets ready from enable and clock_ok. No timing trace or testbench was supplied, so this is a grounded explanation only. No HDL simulation or evaluated hardware experiment was run.'};
   }
   counters.safeChunks.push(bound.progress);await fixture.emit({type:'stream',taskId:task.id,requestId:command.requestId,text:bound.progress});
   const text=await new Promise<string>((resolve,reject)=>{finish=resolve;rejectPending=reject;ctx.signal.addEventListener('abort',()=>reject(Error('Synthetic request cancelled.')),{once:true});});
   finish=undefined;rejectPending=undefined;return bound.finish(text);
  });
  await fixture.emit({type:'changed',taskId:task.id});
  if(result.status!=='completed')throw Error(result.error??'Synthetic transport request failed.');
  return fixture.core.getTask(command.taskId);
 };
 const close=fixture.close.bind(fixture);fixture.close=async()=>{rejectPending?.(Error('Synthetic fixture closed.'));await close();};
 await fixture.viewPreferences.select(task.id);await fixture.restart();
 await page.getByRole('button',{name:task.title,exact:true}).click();await page.getByRole('heading',{name:task.title,exact:true}).waitFor();
 return {fixture,task,sourceLabel,refs,label,proposal,counters,
  proposalPending(){return !!finish;},
  completeProposal(){if(!finish)throw Error('No deferred synthetic proposal is pending.');finish(JSON.stringify(proposal));},
  async changedSource(){await fixture.core.putSource(task.id,{id:source.id,kind:'text',role:'fact',label:sourceLabel,content:content+'\nSynthetic source changed after review.'});await fixture.emit({type:'changed',taskId:task.id});},
 };
}
