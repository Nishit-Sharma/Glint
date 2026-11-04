import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../../src/core/companion';
import {parseModuleAnswer} from '../../src/core/interactive-modules';
import {editModule} from '../../src/core/module-state';
export const marker='WITHDRAWABLE_SKILL_NOTES_MARKER';
export const answer={schemaVersion:1,markdown:'Reviewed comparison using '+marker,modules:[{id:'ordinary-comparison',version:1,data:{kind:'comparison',schemaVersion:1,title:'Two local options',question:'Which option?',columns:['Evidence'],rows:[{id:'first',label:'First option',values:[marker]},{id:'second',label:'Second option',values:['Ordinary evidence']}]},provenance:[]}]};
export async function moduleNotesFixture(provided?:{core:Awaited<ReturnType<typeof createCompanion>>;taskId:string}){
 const directory=provided?undefined:await mkdtemp(join(tmpdir(),'module-notes-lineage-'));let core=provided?.core??await createCompanion({dataDir:directory!});let task=provided?await core.getTask(provided.taskId):await core.createTask({title:'Synthetic module notes lineage'});
 task=await core.putSource(task.id,{kind:'text',role:'fact',label:'Explicit source',content:'Ordinary comparison evidence.'});const source=task.sources.at(-1)!,version=source.versions[0],ref={sourceId:source.id,version:version.version,digest:version.digest};
 const skillOwner=await core.createTask({title:'Skill resource owner'});const withResource=await core.putSource(skillOwner.id,{kind:'text',role:'fact',label:'Skill resource',content:'Synthetic skill resource.'}),resource=withResource.sources[0],r=resource.versions[0],resourceRef={sourceId:resource.id,version:r.version,digest:r.digest};
 const skill=await core.saveInstructionSkill({taskId:skillOwner.id,intentId:'notes-skill-origin',name:'Synthetic notes skill',description:'Focused lineage',instructions:'Use marker '+marker,resources:[resourceRef]});await core.setInstructionSkill(task.id,0,skill.reference);parseModuleAnswer(answer);
 const origin=await core.runRequest({taskId:task.id,requestId:'normal-module-origin',kind:'create',prompt:'Make a comparison.',sourceIds:[ref.sourceId],expectedSourceRefs:[ref],instructionSkill:skill.reference,instructionSkillRevision:1},async()=>({title:'Reviewed comparison',mimeType:'application/vnd.window-companion.modules+json',content:JSON.stringify(answer)}));if(origin.status!=='completed')throw Error(origin.error);
 const target={taskId:task.id,artifactId:origin.artifactId!,artifactRevision:1,moduleId:'ordinary-comparison'};await editModule(core,{...target,action:{kind:'select',rowId:'first',expectedRevision:0}});
 return {get core(){return core;},directory,taskId:task.id,target,ref,skill,skillOwnerId:skillOwner.id,resourceRef,async input(){const current=await core.getTask(task.id);return {taskId:task.id,artifactId:target.artifactId,artifactRevision:target.artifactRevision,sessionRevision:current.session?.revision??0};},async reopen(){if(!directory)throw Error('Own runtime only');await core.close();core=await createCompanion({dataDir:directory});},async close(){if(directory){await core.close();await rm(directory,{recursive:true,force:true});}}};
}
