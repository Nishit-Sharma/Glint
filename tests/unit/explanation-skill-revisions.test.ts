import {afterEach,beforeEach,expect,test} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion,type Companion,type RequestContext} from '../../src/core/companion';
import {readTaskArtifactText} from '../../src/core/task-dialogue';
import {prepareExplanationMode} from '../../src/host/explanation-modes';
import type {ExplainDepth} from '../../src/shared/explanation-modes';
import {explanationProposal,explanationSource} from '../support/explanation.fixture';
let core:Companion,directory:string;
beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'glint-explanation-skill-'));core=await createCompanion({dataDir:directory});});
afterEach(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});
async function fixture(resources=true){
 const owner=await core.createTask({title:'Cross-task skill owner'}),created=await core.createTask({title:'Explanation consumer'});
 const resourceTask=await core.putSource(owner.id,{id:'knowledge',kind:'text',role:'fact',label:'Skill knowledge',content:'PRIVATE_SKILL_KNOWLEDGE'}),v=resourceTask.sources[0].versions[0],resource={sourceId:v.id,version:v.version,digest:v.digest};
 const definition={taskId:owner.id,intentId:'revision-skill',name:'Explanation skill',description:'Synthetic',instructions:'Explain supplied evidence simply.',resources:resources?[resource]:[]},skill=await core.saveInstructionSkill(definition);
 await core.setInstructionSkill(created.id,0,skill.reference);
 await core.putSource(created.id,{id:'science',kind:'text',role:'fact',label:'Science',content:explanationSource});
 const command={type:'model.run' as const,taskId:created.id,requestId:'initial',kind:'explain' as const,prompt:'Explain evaporation',explainDepth:'quick' as const,sourceIds:['science'],instructionSkill:skill.reference,instructionSkillRevision:1},mode=prepareExplanationMode(await core.getTask(created.id),command)!;
 expect((await core.runRequest(command,async ctx=>mode.finish(JSON.stringify(explanationProposal('quick')),ctx.task.sources.map(s=>s.versions[0])))).status).toBe('completed');
 const task=await core.getTask(created.id),artifact=task.artifacts[0],revision=artifact.revisions[0];
 function revise(depth:ExplainDepth='deep'){
  // Match the production host: revisions carry exact artifact identity, never instructionSkill.
  const input={type:'model.run' as const,taskId:task.id,requestId:'revision-'+depth,kind:'revise' as const,prompt:'Change explanation depth',explainDepth:depth,artifactId:artifact.id,expectedRevision:1,sourceIds:['science'],explanationBasis:{artifactId:artifact.id,revision:1,digest:revision.digest}};
  const next=prepareExplanationMode(task,input)!;
  return {input,finish:(ctx:RequestContext)=>next.finish(JSON.stringify(explanationProposal(depth)),ctx.task.sources.map(s=>s.versions[0]))};
 }
 return {owner,task,artifact,revision,resource,definition,skill,revise};
}
test.each([['quick',false],['deep',false],['visual',false],['deep',true]] as const)('explicit %s revision retains the same chosen valid skill (resources=%s)',async(depth,resources)=>{
 const f=await fixture(resources),r=f.revise(depth);let calls=0;
 const result=await core.runRequest(r.input,async ctx=>{
  const target=readTaskArtifactText(ctx.task,f.artifact.id,1);expect(target.available).toBe(true);expect(JSON.stringify(target)).not.toContain('citations');expect(JSON.stringify(target)).not.toContain('Water evaporates into vapor.');expect(ctx.instructionSkill).toBeUndefined();expect(ctx.task.session).not.toHaveProperty('instructionSkill');
  await core.assertRequestCurrent(f.task.id,r.input.requestId);calls++;return r.finish(ctx);
 });
 expect(result.status).toBe('completed');expect(calls).toBe(1);expect(result.instructionSkill).toBeUndefined();expect(result.contextSkillRefs).toEqual([f.skill.reference]);expect((await core.getTask(f.task.id)).artifacts[0].revisions[1].contextSkillRefs).toEqual([f.skill.reference]);
 await core.close();core=await createCompanion({dataDir:directory});expect((await core.getTask(f.task.id)).requests[1].contextSkillRefs).toEqual([f.skill.reference]);
});
const changes=['clear','change','disable','revoke','refresh','stale','delete'] as const;
type Change=typeof changes[number];
async function change(f:Awaited<ReturnType<typeof fixture>>,action:Change){
 if(action==='clear')await core.setInstructionSkill(f.task.id,1,null);
 if(action==='change'){const other=await core.saveInstructionSkill({...f.definition,intentId:'other-skill',name:'Different skill'});await core.setInstructionSkill(f.task.id,1,other.reference);}
 if(action==='disable')await core.setInstructionSkillAvailability({type:'skills.availability.set',taskId:f.owner.id,artifactId:f.skill.reference.artifactId,expectedRevision:0,enabled:false});
 if(action==='revoke')await core.revokeSource(f.owner.id,'knowledge');
 if(action==='refresh')await core.putSource(f.owner.id,{id:'knowledge',kind:'text',role:'fact',label:'Changed knowledge',content:'NEW_PRIVATE_KNOWLEDGE'});
 if(action==='stale')await core.invalidateSource(f.owner.id,'knowledge','Synthetic stale resource');
 if(action==='delete')await core.deleteTask(f.owner.id);
}
test.each(changes)('%s before revision rejects inherited skill context before the runner',async action=>{
 const f=await fixture(),r=f.revise();await change(f,action);let calls=0;
 await expect(core.runRequest(r.input,async ctx=>{calls++;return r.finish(ctx);})).rejects.toThrow();expect(calls).toBe(0);expect((await core.getTask(f.task.id)).artifacts[0].revisions).toHaveLength(1);
});
for(const phase of ['preparation','publication'] as const)test.each(changes)('%s during pending revision cancels at '+phase+' without stale output',async action=>{
 const f=await fixture(),r=f.revise();let enter!:()=>void,release!:()=>void,signal:AbortSignal|undefined,calls=0;
 const started=new Promise<void>(done=>enter=done),wait=new Promise<void>(done=>release=done);
 const pending=core.runRequest(r.input,async ctx=>{signal=ctx.signal;expect(readTaskArtifactText(ctx.task,f.artifact.id,1).available).toBe(true);if(phase==='publication')calls++;enter();await wait;if(phase==='preparation'){await core.assertRequestCurrent(f.task.id,r.input.requestId);calls++;}return r.finish(ctx);});
 await started;await change(f,action);expect(signal?.aborted).toBe(true);await expect(core.assertRequestCurrent(f.task.id,r.input.requestId)).rejects.toThrow();release();expect((await pending).status).toBe('cancelled');expect(calls).toBe(phase==='preparation'?0:1);expect((await core.getTask(f.task.id)).artifacts[0].revisions).toHaveLength(1);
});
test('an intentionally pinned older skill keeps its existing exact-version contract',async()=>{
 const f=await fixture(),newer=await core.saveInstructionSkill({...f.definition,artifactId:f.skill.reference.artifactId,expectedRevision:1,instructions:'A newer saved skill not chosen by this task.'});expect(newer.reference.revision).toBe(2);
 const r=f.revise(),result=await core.runRequest(r.input,async ctx=>{expect(readTaskArtifactText(ctx.task,f.artifact.id,1).available).toBe(true);return r.finish(ctx);});expect(result.status).toBe('completed');expect(result.contextSkillRefs).toEqual([f.skill.reference]);
});
test('clearing then restoring the same skill never revives a cancelled revision',async()=>{
 const f=await fixture(),r=f.revise();let enter!:()=>void,release!:()=>void;const started=new Promise<void>(done=>enter=done),wait=new Promise<void>(done=>release=done);
 const pending=core.runRequest(r.input,async ctx=>{enter();await wait;return r.finish(ctx);});await started;await core.setInstructionSkill(f.task.id,1,null);await core.setInstructionSkill(f.task.id,2,f.skill.reference);release();expect((await pending).status).toBe('cancelled');expect((await core.getTask(f.task.id)).artifacts[0].revisions).toHaveLength(1);
});
