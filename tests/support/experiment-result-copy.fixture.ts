import {randomUUID} from 'node:crypto';
import type {Companion} from '../../src/core/companion';
import type {ExperimentResultInput} from '../../src/learning/experiment-result-copy';
export const resultSpec={title:'Result copy model',expression:{op:'multiply' as const,left:{op:'variable' as const,name:'x'},right:{op:'constant' as const,value:2}},variables:[{name:'x',unit:'m',min:0,max:10}],assumptions:['A bounded hypothetical doubling model.']};
export const resultDraft={schemaVersion:1,kind:'experiment',title:resultSpec.title,explanation:'Owned synthetic result copy.',spec:resultSpec,inputs:{x:2}};
export async function seedExperimentResult(core:Companion,taskId:string,skilled=false){
 let task=await core.putSource(taskId,{id:'a',kind:'text',role:'fact',label:'Direct evidence',content:'RESULT_DIRECT_PRIVATE'});task=await core.putSource(taskId,{id:'b',kind:'text',role:'fact',label:'Inherited evidence',content:'RESULT_INHERITED_PRIVATE'});const refs=task.sources.map(source=>({sourceId:source.id,version:1,digest:source.versions[0].digest}));
 let skill:Awaited<ReturnType<Companion['saveInstructionSkill']>>|undefined,skillOwner:string|undefined;
 if(skilled){const owner=await core.createTask({title:'Result skill owner'});skillOwner=owner.id;const sourceTask=await core.putSource(owner.id,{id:'knowledge',kind:'text',role:'fact',label:'Skill knowledge',content:'RESULT_SKILL_PRIVATE'}),v=sourceTask.sources[0].versions[0];skill=await core.saveInstructionSkill({taskId:owner.id,intentId:randomUUID(),name:'Result skill',description:'Synthetic',instructions:'Review the evidence.',resources:[{sourceId:'knowledge',version:1,digest:v.digest}]});await core.setInstructionSkill(taskId,0,skill.reference);}
 const request=await core.runRequest({taskId,requestId:randomUUID(),kind:'create',prompt:'Seed a current result model.',sourceIds:['a','b'],...(skill?{instructionSkill:skill.reference,instructionSkillRevision:1}:{})},async()=>({title:resultSpec.title,content:JSON.stringify(resultDraft),mimeType:'application/json'}));if(request.status!=='completed')throw Error(request.error);
 const model=await core.saveArtifact(taskId,{artifactId:request.artifactId,expectedRevision:1,title:resultSpec.title,content:JSON.stringify(resultDraft),mimeType:'application/json',sourceRefs:[refs[0]]});
 const input:ExperimentResultInput={intentId:randomUUID(),includeTrials:false,calculation:{shareWithTask:true,taskId,basis:{artifactId:model.artifactId,revision:2,digest:model.revision.digest},sourceRefs:[refs[0]],title:resultSpec.title,spec:resultSpec,inputs:{x:2}}};
 return {input,refs,skill,skillOwner,model};
}
