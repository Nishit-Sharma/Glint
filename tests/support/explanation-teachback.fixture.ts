import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../../src/core/companion';
import {parseExplanationModel,EXPLANATION_MIME} from '../../src/shared/explanation-modes';
import {prepareExplanationTeachback} from '../../src/host/explanation-teachback';
import {teachbackBody,type TeachbackInput} from '../../src/shared/explanation-teachback';
import type {Command} from '../../src/shared/bridge';
import {explanationProposal,explanationSource} from './explanation.fixture';
export async function teachbackFixture(skillEnabled=false){
 const directory=await mkdtemp(join(tmpdir(),'glint-teachback-')),core=await createCompanion({dataDir:directory}),created=await core.createTask({title:'Teach-back evidence'}),sourced=await core.putSource(created.id,{id:'science',kind:'text',role:'fact',label:'Evaporation notes',content:explanationSource}),version=sourced.sources[0].versions[0],refs=[{sourceId:version.id,version:version.version,digest:version.digest}];
 const skill=skillEnabled?await core.saveInstructionSkill({taskId:created.id,intentId:'teaching-style',name:'Teaching style',description:'Synthetic',instructions:'Use plain language.',resources:[]}):undefined;if(skill)await core.setInstructionSkill(created.id,0,skill.reference);
 const explanation=parseExplanationModel(JSON.stringify(explanationProposal('deep')),{depth:'deep',sources:[version],fallbackTitle:'Explanation'}),original=await core.runRequest({taskId:created.id,requestId:'initial-explanation',kind:'explain',prompt:'Explain evaporation.',sourceIds:['science'],explainDepth:'deep',...(skill?{instructionSkill:skill.reference,instructionSkillRevision:1}:{})},async()=>({title:explanation.title,content:JSON.stringify(explanation),mimeType:EXPLANATION_MIME}));
 const basis=original.answer!;
 const command=(requestId:string,input:TeachbackInput):Extract<Command,{type:'model.run'}>=>({type:'model.run',taskId:created.id,requestId,kind:'revise',prompt:input.answer,artifactId:basis.artifactId,teachback:input,sourceIds:['science'],expectedSourceRefs:refs});
 const feedback=(input:TeachbackInput)=>({learner:{start:0,quote:input.answer.slice(0,2000)},explanation:{section:'coreIdea',start:0,quote:'Water changes phase.'},sources:[{source:{...refs[0]},start:explanationSource.indexOf('Water evaporates into vapor.'),quote:'Water evaporates into vapor.'}],feedback:input.answer.includes('disappears')?'You said the water disappears. Consider whether a change of phase destroys it.':'You describe a change of phase. Clarify how the vapor remains water.',...(input.replyTo?{}:{followUp:'How is water vapor different from water being destroyed?'})});
 let runnerCalls=0;const prompts:string[]=[];
 async function submit(requestId:string,input:TeachbackInput,output=JSON.stringify(feedback(input))){const task=await core.getTask(created.id),plan=(await prepareExplanationTeachback(core,task,command(requestId,input),()=>{}))!;const result=await core.runRequest(plan.request,async ctx=>{runnerCalls++;const bound=plan.bind(ctx.task);prompts.push(bound.prompt);return bound.finish(output);});return {result,task:await core.getTask(created.id),plan};}
 async function readyParent(){const input={basis,answer:'I predicted 10 but the water disappears.'},saved=await submit('first-teachback',input),artifact=saved.task.artifacts.find(artifact=>teachbackBody(artifact.revisions.at(-1)!)?.requestId==='first-teachback')!,revision=artifact.revisions.at(-1)!;return {saved,input,reference:{artifactId:artifact.id,revision:revision.revision,digest:revision.digest}};}
 return {directory,core,taskId:created.id,refs,basis,skill,explanation,command,feedback,submit,readyParent,prompts,get runnerCalls(){return runnerCalls;}};
}
