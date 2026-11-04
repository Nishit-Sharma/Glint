import {afterEach,expect,it} from 'vitest';
import {rm} from 'node:fs/promises';
import {createCompanion} from '../../src/core/companion';
import {teachbackFixture} from '../support/explanation-teachback.fixture';
import {confirmedTeachback,teachbackBody,TEACHBACK_MIME,readTeachbackInput} from '../../src/shared/explanation-teachback';
import {prepareExplanationTeachback} from '../../src/host/explanation-teachback';
import {parseExplanationModel,EXPLANATION_MIME} from '../../src/shared/explanation-modes';
import {explanationProposal} from '../support/explanation.fixture';
const fixtures:Awaited<ReturnType<typeof teachbackFixture>>[]=[];async function fixture(skill=false){const f=await teachbackFixture(skill);fixtures.push(f);return f;}afterEach(async()=>{for(const f of fixtures.splice(0)){await f.core.close();await rm(f.directory,{recursive:true,force:true});}});
it('saves a tailored first answer, one targeted follow-up and an explicit second answer without changing the explanation, then reopens',async()=>{
 const f=await fixture(),original=(await f.core.getTask(f.taskId)).artifacts.find(artifact=>artifact.id===f.basis.artifactId),parent=await f.readyParent();expect(parent.saved.result.status).toBe('completed');
 const second=await f.submit('second-teachback',{basis:f.basis,replyTo:parent.reference,answer:'The water remains water as vapor rather than being destroyed.'});expect(second.result.status).toBe('completed');const reports=second.task.artifacts.flatMap(artifact=>{const revision=artifact.revisions.at(-1)!,body=confirmedTeachback(second.task,artifact.id,revision);return body?[body]:[];});
 expect(reports).toHaveLength(2);expect(reports[0].feedback?.followUp).toBe(reports[1].question);expect(reports[1].input.replyTo).toEqual(parent.reference);expect(reports[1].feedback?.followUp).toBeUndefined();expect(reports[0].input.answer).toBe(parent.input.answer);expect(second.task.artifacts.find(artifact=>artifact.id===f.basis.artifactId)).toEqual(original);
 await f.core.close();const reopened=await createCompanion({dataDir:f.directory});try{expect((await reopened.getTask(f.taskId)).artifacts).toEqual(second.task.artifacts);}finally{await reopened.close();}
});
it('binds differing own-words explanations for the same stated numeric prediction to distinct prompts/receipts (fixture feedback, no semantic-quality claim)',async()=>{
 const f=await fixture(),wrong=await f.submit('wrong',{basis:f.basis,answer:'I predicted 10 but the water disappears.'}),other=await f.submit('other',{basis:f.basis,answer:'I predicted 10 and the water changes phase.'});const body=(task:typeof wrong.task,id:string)=>teachbackBody(task.artifacts.find(artifact=>teachbackBody(artifact.revisions.at(-1)!)?.requestId===id)!.revisions.at(-1)!)!;
 expect(f.prompts[0]).toContain('I predicted 10 but the water disappears.');expect(f.prompts[1]).toContain('I predicted 10 and the water changes phase.');expect(body(wrong.task,'wrong').feedback?.feedback).not.toBe(body(other.task,'other').feedback?.feedback);expect(body(wrong.task,'wrong').feedback?.learner.quote).toBe('I predicted 10 but the water disappears.');expect(body(other.task,'other').feedback).not.toHaveProperty('grade');
});
it.each(['learner','explanation','source','parent','third-turn','extra-grade','learner-offset','explanation-offset','source-offset','missing-followup'] as const)('rejects invented or inconsistent %s evidence before ready publication',async invalid=>{
 const f=await fixture(),input={basis:f.basis,answer:'The water disappears.'},output:any=f.feedback(input);
 if(invalid==='learner-offset')output.learner.start=1;if(invalid==='explanation-offset')output.explanation.start=1;if(invalid==='source-offset')output.sources[0].start=0;if(invalid==='missing-followup')delete output.followUp;
 if(invalid==='learner')output.learner.quote='A different learner';if(invalid==='explanation')output.explanation.quote='An invented section';if(invalid==='source')output.sources[0].source.digest='a'.repeat(64);if(invalid==='extra-grade')output.grade='mastered';
 if(invalid==='parent'){await expect(f.submit('bad-parent',{...input,replyTo:{...f.basis,artifactId:'forged-feedback'}})).rejects.toThrow();return;}
 if(invalid==='third-turn'){const parent=await f.readyParent(),second=await f.submit('second',{...input,replyTo:parent.reference}),revision=second.task.artifacts.find(artifact=>teachbackBody(artifact.revisions.at(-1)!)?.requestId==='second')!;await expect(f.submit('third',{...input,replyTo:{artifactId:revision.id,revision:2,digest:revision.revisions.at(-1)!.digest}})).rejects.toThrow();return;}
 const result=await f.submit('invalid-'+invalid,input,JSON.stringify(output));expect(result.result.status).toBe('failed');expect(result.task.artifacts.find(artifact=>artifact.id===f.basis.artifactId)!.revisions).toHaveLength(1);expect(result.task.artifacts.at(-1)!.revisions).toHaveLength(1);
});
it.each(['revoke','deselect','skill','revision'] as const)('blocks %s before feedback and never uses a captured raw target fallback',async change=>{
 const f=await fixture(change==='skill'),input={basis:f.basis,answer:'The water changes phase.'};
 if(change==='revoke')await f.core.revokeSource(f.taskId,'science');if(change==='deselect')await f.core.setSourceSelection({type:'source-selection.set',taskId:f.taskId,expectedRevision:0,sourceIds:[]});if(change==='skill')await f.core.setInstructionSkill(f.taskId,1,null);if(change==='revision')await f.core.saveArtifact(f.taskId,{artifactId:f.basis.artifactId,expectedRevision:f.basis.revision,title:'Changed explanation',content:'Changed manually',mimeType:'text/plain',sourceRefs:f.refs});await expect(f.submit('blocked',input)).rejects.toThrow();
});
it('refuses hidden outgoing context, forged generic saves, and reuse of an intent for different learner text',async()=>{
 const f=await fixture(),input={basis:f.basis,answer:'Water changes phase.'},task=await f.core.getTask(f.taskId),plan=(await prepareExplanationTeachback(f.core,task,f.command('retained',input),()=>{}))!,pending=await f.core.getTask(f.taskId);
 expect(()=>plan.bind({...pending,artifacts:pending.artifacts.filter(artifact=>artifact.id!==f.basis.artifactId)})).toThrow();await expect(f.core.beginExplanationTeachback(f.taskId,'retained',{...input,answer:'Replacement text'})).rejects.toThrow('different learner input');await expect(f.core.saveArtifact(f.taskId,{title:'Forged feedback',content:'{}',mimeType:TEACHBACK_MIME})).rejects.toThrow();expect(()=>readTeachbackInput({...input,grade:'mastered'})).toThrow();
});
it('keeps exact-ID replay idempotent and includes canonical first answer plus feedback in the second prompt',async()=>{
 const f=await fixture(),parent=await f.readyParent(),replay=await f.submit('first-teachback',parent.input);expect(replay.task.artifacts).toEqual(parent.saved.task.artifacts);
 const input={basis:f.basis,replyTo:parent.reference,answer:'Vapor is still water.'},task=await f.core.getTask(f.taskId),plan=(await prepareExplanationTeachback(f.core,task,f.command('second',input),()=>{}))!;await f.core.runRequest(plan.request,async ctx=>{const bound=plan.bind(ctx.task);expect(bound.prompt).toContain(parent.input.answer);expect(bound.prompt).toContain(parent.saved.task.artifacts.at(-1)!.revisions.at(-1)!.content.match(/You said[^"\\]*/)?.[0]);return bound.finish(JSON.stringify(f.feedback(input)));});
});
it.each(['Stop','source','skill','selection'] as const)('cancels or fences %s while feedback is pending without publishing stale feedback',async change=>{
 const f=await fixture(change==='skill'),input={basis:f.basis,answer:'The water changes phase.'},task=await f.core.getTask(f.taskId),plan=(await prepareExplanationTeachback(f.core,task,f.command('pending',input),()=>{}))!;let enter!:()=>void,release!:()=>void;const started=new Promise<void>(done=>enter=done),wait=new Promise<void>(done=>release=done);
 const pending=f.core.runRequest(plan.request,async ctx=>{const bound=plan.bind(ctx.task);enter();await wait;await f.core.assertRequestCurrent(f.taskId,'pending');return bound.finish(JSON.stringify(f.feedback(input)));});await started;
 if(change==='Stop')await f.core.cancelRequest(f.taskId,'pending');if(change==='source')await f.core.revokeSource(f.taskId,'science');if(change==='skill')await f.core.setInstructionSkill(f.taskId,1,null);if(change==='selection')await f.core.setSourceSelection({type:'source-selection.set',taskId:f.taskId,expectedRevision:0,sourceIds:[]});release();expect((await pending).status).not.toBe('completed');expect((await f.core.getTask(f.taskId)).artifacts.find(artifact=>artifact.id===plan.request.artifactId)!.revisions).toHaveLength(1);
});
it('inherits exact selected skill/source lineage on both saved turns and refuses another turn after withdrawal',async()=>{
 const f=await fixture(true),parent=await f.readyParent(),second=await f.submit('second-lineage',{basis:f.basis,replyTo:parent.reference,answer:'Vapor remains water.'});expect(second.result.status).toBe('completed');for(const artifact of second.task.artifacts.filter(artifact=>teachbackBody(artifact.revisions[0])))for(const revision of artifact.revisions){expect(revision.contextSourceRefs).toEqual(f.refs);expect(revision.contextSkillRefs).toEqual([f.skill!.reference]);}await f.core.setInstructionSkill(f.taskId,1,null);await expect(f.submit('after-clear',{basis:f.basis,replyTo:parent.reference,answer:'More thoughts.'})).rejects.toThrow();
});
it('persists revision-owned raw answers/intents across store reload and source withdrawal, while rejecting foreign slots/fields',async()=>{
 const f=await fixture(),{LearningDraftStore}=await import('../../src/host/learning-drafts'),{parseLearningDraftValue,serializeLearningDraftJson}=await import('../../src/shared/learning-drafts'),{teachbackDraftBasis,teachbackSlot,emptyTeachbackDraft}=await import('../../src/shared/explanation-teachback');
 const owner={kind:'explanation-teachback' as const,taskId:f.taskId,artifactId:f.basis.artifactId,artifactRevision:f.basis.revision,artifactDigest:f.basis.digest},slot=teachbackSlot(),raw={text:'  My original unsure explanation.\n',requestId:'retained-identity'},value={initial:serializeLearningDraftJson(emptyTeachbackDraft),value:serializeLearningDraftJson(raw),basis:teachbackDraftBasis(owner,slot)},store=new LearningDraftStore({directory:f.directory,lookupTask:async id=>(await f.core.listTasks()).find(task=>task.id===id)});
 expect(parseLearningDraftValue(value,owner,slot)).toEqual(value);expect(()=>parseLearningDraftValue({...value,value:serializeLearningDraftJson({...raw,autoSend:true})},owner,slot)).toThrow();expect(()=>parseLearningDraftValue(value,owner,'foreign-slot')).toThrow();const saved=await store.save(owner,slot,'initial',0,value);expect(saved.kind).toBe('saved');await f.core.revokeSource(f.taskId,'science');const reloaded=new LearningDraftStore({directory:f.directory,lookupTask:async id=>(await f.core.listTasks()).find(task=>task.id===id)}),read=await reloaded.read();expect(read.kind).toBe('available');if(read.kind==='available')expect(read.records[0].value).toEqual(value);
});

it.each(['none','image'] as const)('refuses %s-only feedback before creating a pending artifact or request, including direct core calls',async kind=>{
 const f=await fixture(),withImage=kind==='image';
 if(withImage)await f.core.putSource(f.taskId,{id:'picture',kind:'image',role:'fact',label:'Water image',content:'data:image/png;base64,aA=='});
 const task=await f.core.getTask(f.taskId),sources=withImage?[task.sources.find(source=>source.id==='picture')!.versions[0]]:[],refs=sources.map(source=>({sourceId:source.id,version:source.version,digest:source.digest})),proposal=explanationProposal('deep','picture');
 const explanation=parseExplanationModel(JSON.stringify({...proposal,...(!withImage?{answer:'Water becomes vapor.',citations:[]}:{})}),{depth:'deep',sources,fallbackTitle:'Explanation'});
 const original=await f.core.runRequest({taskId:f.taskId,requestId:'deep-'+kind,kind:'explain',prompt:'Explain evaporation.',sourceIds:refs.map(ref=>ref.sourceId),expectedSourceRefs:refs,explainDepth:'deep'},async()=>({title:explanation.title,content:JSON.stringify(explanation),mimeType:EXPLANATION_MIME}));
 expect(original.status).toBe('completed');const input={basis:original.answer!,answer:'Water changes phase.'},before=await f.core.getTask(f.taskId);
 // An unrelated text source in the task cannot satisfy the explanation's exact linked-source requirement.
 for(const requestId of ['unsupported-first','unsupported-next']){
  await expect(prepareExplanationTeachback(f.core,before,{...f.command(requestId,input),artifactId:input.basis.artifactId,sourceIds:refs.map(ref=>ref.sourceId),expectedSourceRefs:refs},()=>{})).rejects.toThrow('add a text source');
  await expect(f.core.beginExplanationTeachback(f.taskId,requestId,input)).rejects.toThrow('add a text source');
 }
 expect(await f.core.getTask(f.taskId)).toEqual(before);expect(f.runnerCalls).toBe(0);
});

it('keeps exact text-backed feedback available when the same explanation also links an image',async()=>{
 const f=await fixture();await f.core.putSource(f.taskId,{id:'picture',kind:'image',role:'fact',label:'Water image',content:'data:image/png;base64,aA=='});
 const task=await f.core.getTask(f.taskId),refs=task.sources.map(source=>{const version=source.versions.at(-1)!;return {sourceId:source.id,version:version.version,digest:version.digest};});
 const original=await f.core.runRequest({taskId:f.taskId,requestId:'deep-mixed',kind:'explain',prompt:'Explain evaporation.',sourceIds:refs.map(ref=>ref.sourceId),expectedSourceRefs:refs,explainDepth:'deep'},async()=>({title:f.explanation.title,content:JSON.stringify(f.explanation),mimeType:EXPLANATION_MIME}));
 const input={basis:original.answer!,answer:'The water changes phase.'},before=await f.core.getTask(f.taskId),plan=(await prepareExplanationTeachback(f.core,before,{...f.command('mixed-feedback',input),artifactId:input.basis.artifactId,sourceIds:refs.map(ref=>ref.sourceId),expectedSourceRefs:refs},()=>{}))!;
 const result=await f.core.runRequest(plan.request,async ctx=>plan.bind(ctx.task).finish(JSON.stringify(f.feedback(input))));expect(result.status).toBe('completed');const saved=await f.core.getTask(f.taskId),artifact=saved.artifacts.find(artifact=>artifact.id===result.answer?.artifactId)!;expect(confirmedTeachback(saved,artifact.id,artifact.revisions.at(-1)!)?.feedback?.sources[0].source).toEqual(f.refs[0]);
});
