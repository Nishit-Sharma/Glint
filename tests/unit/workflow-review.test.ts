import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion,type Companion} from '../../src/core/companion';
import {prepareWorkflowReview,createReviewedWorkflow} from '../../src/core/workflow-review-host';
import {prepareWorkflowPassages,checkWorkflowReview,type WorkflowReview,type WorkflowReviewPreparation,workflowReviewLimits} from '../../src/learning/workflow-review';
import {parseModuleAnswer,moduleHistoryText,parseModelModule} from '../../src/core/interactive-modules';
import {workflowLab,type WorkflowData} from '../../src/learning/workflow-lab';
import {admitReviewedWorkflow} from '../../src/core/workflow-lab-host';
const sourceText='Owned synthetic text.\r\n  Draft + Submit -> In review  \r\nIn review + Approve → Ready\r\nReady + Edit -> Draft';
let core:Companion,root:string;
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'workflow-review-'));core=await createCompanion({dataDir:root});});
afterEach(async()=>{await core.close();await rm(root,{recursive:true,force:true});});
async function fixture(text=sourceText){
 const task=await core.createTask({title:'Owned source review'});
 const sourced=await core.putSource(task.id,{kind:'text',role:'fact',label:'Owned synthetic rules',content:text});
 const source=sourced.sources[0],version=source.versions[0],refs=[{sourceId:source.id,version:version.version,digest:version.digest}];
 const saved=await core.saveArtifact(task.id,{title:'Review document',content:'This document is different from its linked source.',mimeType:'text/markdown',sourceRefs:refs});
 return {taskId:task.id,sourceId:source.id,refs,basis:{artifactId:saved.artifactId,revision:saved.revision.revision,digest:saved.revision.digest}};
}
function draft(prepared:WorkflowReviewPreparation):WorkflowReview{
 return {rules:prepared.passages.flatMap(p=>p.candidate?[{sourceId:p.sourceId,start:p.start,end:p.end,quote:p.quote,...p.candidate,interpretation:'source-stated' as const,reason:'I reviewed this literal rule.'}]:[]),initialState:'Draft',eventSequence:['Submit','Approve','Edit','Approve'],assumptions:[],confirmed:true};
}
test('preparation reads exact linked text, preserving complete literal spans and withholding module results',async()=>{
 const f=await fixture(),prepared=await prepareWorkflowReview(core,{taskId:f.taskId,basis:f.basis});
 expect(prepared.sourceRefs).toEqual(f.refs);expect(prepared.sources[0].text).toBe(sourceText);
 expect(prepared.passages.map(p=>p.candidate)).toEqual([null,{from:'Draft',event:'Submit',to:'In review'},{from:'In review',event:'Approve',to:'Ready'},{from:'Ready',event:'Edit',to:'Draft'}]);
 for(const p of prepared.passages)expect(sourceText.slice(p.start,p.end)).toBe(p.quote);
 expect(prepared.passages[1].quote).toBe('Draft + Submit -> In review');
 expect(JSON.stringify(prepared)).not.toMatch(/equipment-checkout|transfer|finalState|blockedCount/);
 expect((await core.getTask(f.taskId)).requests).toHaveLength(0);
});
test('review creates the computed source-bound module once and preserves literal provenance and hidden transfer',async()=>{
 const f=await fixture(),prepared=await prepareWorkflowReview(core,{taskId:f.taskId,basis:f.basis}),review=draft(prepared),input={taskId:f.taskId,requestId:'review-intent',basis:f.basis,expectedSourceRefs:f.refs,review};
 const result=await createReviewedWorkflow(core,input),again=await createReviewedWorkflow(core,input);
 expect(again.artifactId).toBe(result.artifactId);expect(result.task.requests).toHaveLength(1);
 const revision=result.task.artifacts.find(item=>item.id===result.artifactId)!.revisions[0],data=parseModuleAnswer(JSON.parse(revision.content)).modules[0].data as WorkflowData;
 expect(data.basis.kind).toBe('reviewed-source');expect(revision.sourceRefs).toEqual(f.refs);expect(data.ruleOrigins.every(origin=>origin.interpretation==='source-stated')).toBe(true);
 expect(JSON.stringify(workflowLab.observe(data,workflowLab.initial(data)))).not.toContain('equipment-checkout');expect(moduleHistoryText(revision.content)).not.toContain('Available');
 expect(()=>parseModelModule(data)).toThrow(/comparison or plan/);
 const initial=workflowLab.initial(data),ready=data.practice.states.find(state=>state.label==='Ready')!,state=workflowLab.update(data,initial,{kind:'predict',finalStateId:ready.id,blockedCount:0,reasoning:'My prediction',expectedRevision:0});
 expect(workflowLab.observe(data,state).result).toMatchObject({finalStateLabel:'Draft',blockedCount:1});
 await expect(createReviewedWorkflow(core,{...input,review:{...review,assumptions:['A different assumption']}})).rejects.toThrow(/different payload/);
});
test('literal classification cannot hide a conflicting source line or select a parseable substring',async()=>{
 const f=await fixture(sourceText+'\r\nReady + Edit -> In review'),prepared=await prepareWorkflowReview(core,{taskId:f.taskId,basis:f.basis}),review=draft(prepared);
 const selected={...review,rules:review.rules.slice(0,3)};
 expect(checkWorkflowReview(prepared.sources.map(source=>({sourceId:source.ref.sourceId,text:source.text})),selected)).toMatchObject({kind:'invalid',issues:expect.arrayContaining([expect.objectContaining({message:expect.stringContaining('disagree')})])});
 const chosen={...selected,rules:selected.rules.map((rule,index)=>index===2?{...rule,interpretation:'user-interpreted' as const,reason:'I choose the draft destination for this local experiment despite the conflict.'}:rule)};
 const result=await createReviewedWorkflow(core,{taskId:f.taskId,requestId:'conflict-choice',basis:f.basis,expectedSourceRefs:f.refs,review:chosen});
 const data=parseModuleAnswer(JSON.parse(result.task.artifacts.find(item=>item.id===result.artifactId)!.revisions[0].content)).modules[0].data as WorkflowData;
 expect(data.ruleOrigins[2].interpretation).toBe('user-interpreted');
 const text='Conditional note: Draft + Submit -> Ready only after approval.';
 const start=text.indexOf('Draft'),quote='Draft + Submit -> Ready',input={rules:[{sourceId:'source',start,end:start+quote.length,quote,from:'Draft',event:'Submit',to:'Ready',interpretation:'source-stated',reason:'Selected substring'}],initialState:'Draft',eventSequence:['Submit'],assumptions:[],confirmed:true};
 expect(checkWorkflowReview([{sourceId:'source',text}],input)).toMatchObject({kind:'invalid'});
 expect(checkWorkflowReview([{sourceId:'source',text}],{...input,rules:input.rules.map(rule=>({...rule,interpretation:'user-interpreted',reason:'I deliberately omit the condition for this hypothetical test.'}))})).toMatchObject({kind:'valid'});
});
test('prose requires explicit interpretation and exact non-split UTF-16 quotes',()=>{
 const text='😀 Editing approved work restarts its draft.\r\nReady + Edit -> Draft';
 const prepared=prepareWorkflowPassages([{sourceId:'source',text}]);expect(prepared.passages[0].candidate).toBeNull();
 expect(prepared.passages[1].start).toBe(text.indexOf('Ready'));
 const rule={sourceId:'source',start:0,end:text.indexOf('\r'),quote:text.slice(0,text.indexOf('\r')),from:'Ready',event:'Edit',to:'Draft',interpretation:'user-interpreted',reason:'I interpreted the sentence as a finite rule.'};
 const input={rules:[rule],initialState:'Ready',eventSequence:['Edit'],assumptions:[],confirmed:true};
 expect(checkWorkflowReview([{sourceId:'source',text}],input)).toMatchObject({kind:'valid'});
 expect(checkWorkflowReview([{sourceId:'source',text}],{...input,rules:[{...rule,interpretation:'source-stated'}]})).toMatchObject({kind:'invalid'});
 for(const broken of [{...rule,start:1,quote:text.slice(1,rule.end)},{...rule,end:1,quote:text.slice(0,1)}])expect(checkWorkflowReview([{sourceId:'source',text}],{...input,rules:[broken]})).toMatchObject({kind:'invalid',issues:expect.arrayContaining([expect.objectContaining({message:expect.stringContaining('complete-character')})])});
 expect(checkWorkflowReview([{sourceId:'source',text}],{...input,rules:[{...rule,reason:' '}]})).toMatchObject({kind:'invalid'});
});
test('oversize and empty sources remain explicit without partial or unbounded prepared content',async()=>{
 const f=await fixture('x'.repeat(workflowReviewLimits.sourceCharacters+1)),prepared=await prepareWorkflowReview(core,{taskId:f.taskId,basis:f.basis});
 expect(prepared.passages).toEqual([]);expect(prepared.sources).toHaveLength(0);expect(prepared.issues.join(' ')).toContain('20,000');
 const many=prepareWorkflowPassages([{sourceId:'source',text:Array.from({length:81},()=> 'A + Go -> B').join('\n')}]);expect(many.passages).toEqual([]);expect(many.issues.join(' ')).toContain('no partial rule set');
 const empty=prepareWorkflowPassages([{sourceId:'source',text:' \r\n\t'}]);expect(empty.passages).toEqual([]);expect(empty.issues.join(' ')).toContain('no nonempty text');
});
test('strict preparation and review reject unsupported fields without exposing input content or identities',async()=>{
 const f=await fixture(),prepared=await prepareWorkflowReview(core,{taskId:f.taskId,basis:f.basis}),review=draft(prepared),input={taskId:f.taskId,requestId:'strict-input',basis:f.basis,expectedSourceRefs:f.refs,review};
 const bad=[{...input,definition:{hidden:'PRIVATE_SENTINEL'}},{...input,review:{...review,transfer:'PRIVATE_SENTINEL'}},{...input,review:{...review,rules:review.rules.map((rule,index)=>index?rule:{...rule,start:-1,extra:'PRIVATE_SENTINEL'})}}];
 for(const value of bad){let message='';try{await createReviewedWorkflow(core,value);}catch(error){message=(error as Error).message;}expect(message).not.toBe('');expect(message).not.toMatch(/PRIVATE_SENTINEL|ParseError|Struct|sha256/);expect(message).not.toContain(f.sourceId);expect(message).not.toContain(f.basis.digest);}
 await expect(prepareWorkflowReview(core,{taskId:f.taskId,basis:f.basis,definition:{}})).rejects.toThrow(/exact saved document/);
 expect((await core.getTask(f.taskId)).requests).toHaveLength(0);
});
test('full ordered source references, task ownership and current basis are required at review',async()=>{
 const f=await fixture(),second=await core.putSource(f.taskId,{kind:'text',role:'fact',label:'Second owned source',content:'Extra explanatory text'}),source=second.sources.at(-1)!,version=source.versions[0],refs=[...f.refs,{sourceId:source.id,version:version.version,digest:version.digest}];
 const saved=await core.saveArtifact(f.taskId,{artifactId:f.basis.artifactId,expectedRevision:1,title:'Review document',content:'Updated links',sourceRefs:refs}),basis={artifactId:saved.artifactId,revision:saved.revision.revision,digest:saved.revision.digest};
 const prepared=await prepareWorkflowReview(core,{taskId:f.taskId,basis}),input={taskId:f.taskId,requestId:'full-refs',basis,expectedSourceRefs:refs,review:draft(prepared)};
 for(const wrong of [refs.slice(0,1),[...refs].reverse(),refs.map((ref,index)=>index?ref:{...ref,digest:'not-current'})])await expect(createReviewedWorkflow(core,{...input,expectedSourceRefs:wrong})).rejects.toThrow(/selection changed/);
 await expect(prepareWorkflowReview(core,{taskId:f.taskId,basis:f.basis})).rejects.toThrow(/artifact changed/);
 const other=await core.createTask({title:'Other task'});await expect(prepareWorkflowReview(core,{taskId:other.id,basis})).rejects.toThrow(/artifact changed/);
 await core.putSource(f.taskId,{id:f.sourceId,kind:'text',role:'fact',label:'Changed source',content:sourceText+'\nChanged'});
 await expect(createReviewedWorkflow(core,input)).rejects.toThrow(/source changed|fresh capture/);
 expect((await core.getTask(f.taskId)).requests).toHaveLength(0);
});
// Local serialization now commits atomically, so races enter at its actual core boundary (no unused model runner).
test.each(['source','basis','cancel'] as const)('publication refuses a %s change between construction and atomic admission',async change=>{
 const f=await fixture(),prepared=await prepareWorkflowReview(core,{taskId:f.taskId,basis:f.basis}),input={taskId:f.taskId,requestId:'publication-'+change,basis:f.basis,expectedSourceRefs:f.refs,review:draft(prepared)},save=core.saveWorkflowArtifact.bind(core);
 const spy=vi.spyOn(core,'saveWorkflowArtifact').mockImplementation(async(request,assertCurrent)=>{
  if(change==='source')await core.putSource(f.taskId,{id:f.sourceId,kind:'text',role:'fact',label:'Changed during creation',content:sourceText+'\nChanged'});
  else if(change==='basis')await core.saveArtifact(f.taskId,{artifactId:f.basis.artifactId,expectedRevision:1,title:'Changed during creation',content:'Changed basis',sourceRefs:f.refs});
  return save(request,change==='cancel'?()=>{throw Error('Host submission retired before local commit');}:assertCurrent);
 });
 try{await expect(createReviewedWorkflow(core,input)).rejects.toThrow();}finally{spy.mockRestore();}
 const task=await core.getTask(f.taskId);expect(task.artifacts).toHaveLength(1);expect(task.requests).toHaveLength(0);
 if(change==='cancel'){const fresh=await createReviewedWorkflow(core,input);expect(fresh.task.requests).toHaveLength(1);expect(fresh.task.artifacts).toHaveLength(2);}
});
test('finite choices and limits reject unresolved rules while preserving prose as explicit interpretation',async()=>{
 const f=await fixture(),prepared=await prepareWorkflowReview(core,{taskId:f.taskId,basis:f.basis}),review=draft(prepared),sources=prepared.sources.map(source=>({sourceId:source.ref.sourceId,text:source.text}));
 const invalid=[{...review,rules:[]},{...review,rules:[review.rules[0],review.rules[0]]},{...review,initialState:'Missing'},{...review,eventSequence:['Missing']},{...review,eventSequence:Array(13).fill('Submit')},{...review,confirmed:false},{...review,assumptions:Array(13).fill('Assumed')},{...review,rules:review.rules.map((rule,index)=>index?rule:{...rule,to:'Invented',interpretation:'source-stated'})}];
 for(const input of invalid)expect(checkWorkflowReview(sources,input).kind).toBe('invalid');
 const changed={...review,rules:review.rules.map((rule,index)=>index?rule:{...rule,to:'Invented',interpretation:'user-interpreted',reason:'I intentionally test a hypothetical destination.'})};
 expect(checkWorkflowReview(sources,changed).kind).toBe('valid');
 const nineStates={...review,rules:Array.from({length:8},(_,index)=>({...review.rules[0],from:'State '+index,to:'State '+(index+1),interpretation:'user-interpreted',reason:'A hypothetical rule.'})),initialState:'State 0',eventSequence:['Submit']};
 expect(checkWorkflowReview(sources,nineStates)).toMatchObject({kind:'invalid',issues:expect.arrayContaining([expect.objectContaining({message:expect.stringContaining('two and eight states')})])});
});
test('basis must be saved text and linked sources must remain current facts',async()=>{
 const f=await fixture();
 const image=await core.saveArtifact(f.taskId,{title:'Unsupported basis',content:'Not image bytes',mimeType:'application/json',sourceRefs:f.refs});
 await expect(prepareWorkflowReview(core,{taskId:f.taskId,basis:{artifactId:image.artifactId,revision:image.revision.revision,digest:image.revision.digest}})).rejects.toThrow(/saved text document/);
 await core.putSource(f.taskId,{id:f.sourceId,kind:'text',role:'style',label:'Style source',content:sourceText});
 await expect(prepareWorkflowReview(core,{taskId:f.taskId,basis:f.basis})).rejects.toThrow(/source changed|fresh capture/);
});

test('direct admission cannot label a changed finite rule as source-stated and legacy origins remain valid',async()=>{
 const f=await fixture(),prepared=await prepareWorkflowReview(core,{taskId:f.taskId,basis:f.basis}),review=draft(prepared);
 const created=await createReviewedWorkflow(core,{taskId:f.taskId,requestId:'direct-basis',basis:f.basis,expectedSourceRefs:f.refs,review});
 const data=parseModuleAnswer(JSON.parse(created.task.artifacts.find(item=>item.id===created.artifactId)!.revisions[0].content)).modules[0].data as WorkflowData;
 const definition={...data,basis:{kind:'local-sample' as const,contextDigest:'temporary-local'},citations:[],ruleOrigins:data.ruleOrigins.map(origin=>({ruleId:origin.ruleId,reason:origin.reason,citationId:null})),practice:{...data.practice,rules:data.practice.rules.map((rule,index)=>index?rule:{...rule,toStateId:data.practice.states.find(state=>state.label==='Ready')!.id})}};
 const ruleCitations=review.rules.map((rule,index)=>({ruleId:data.practice.rules[index].id,sourceId:rule.sourceId,start:rule.start,end:rule.end,quote:rule.quote,reason:rule.reason,interpretation:rule.interpretation}));
 expect(()=>admitReviewedWorkflow(created.task,{definition,review:{basis:f.basis,acknowledgement:'reviewed-rules',ruleCitations}})).toThrow(/source-stated|literal/);
 const disabled={...definition,practice:{...data.practice,rules:data.practice.rules.map((rule,index)=>index?rule:{...rule,enabled:false})}};
 expect(()=>admitReviewedWorkflow(created.task,{definition:disabled,review:{basis:f.basis,acknowledgement:'reviewed-rules',ruleCitations}})).toThrow(/disabled|source-stated/);
 const legacy=ruleCitations.map(({interpretation,...citation})=>citation);
 expect(admitReviewedWorkflow(created.task,{definition,review:{basis:f.basis,acknowledgement:'reviewed-rules',ruleCitations:legacy}}).ruleOrigins.every(origin=>origin.interpretation===undefined)).toBe(true);
});
test('malformed separator order remains reviewable without guessed fields or a parser crash',()=>{
 const result=prepareWorkflowPassages([{sourceId:'source',text:'Draft -> Ready + Submit\nDraft + -> Ready\nDraft + Submit -> Ready -> Done'}]);
 expect(result.passages).toHaveLength(3);expect(result.passages.every(passage=>passage.candidate===null)).toBe(true);expect(result.passages.every(passage=>passage.issues.length>0)).toBe(true);
});
