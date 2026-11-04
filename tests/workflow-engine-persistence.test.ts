import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,test} from 'vitest';
import {createCompanion} from '../src/core/companion';
import {createWorkflowExample,createWorkflowArtifact,workflowExplanationContext} from '../src/core/workflow-lab-host';
import {editModule,saveModuleDocument} from '../src/core/module-state';
import {parseModuleAnswer} from '../src/core/interactive-modules';
import {workflowLab} from '../src/learning/workflow-lab';
import {defaultWorkflowExperiment,practiceVariantRules,compareWorkflowVariants,validateWorkflowExperiment} from '../src/learning/workflow-engine';
import {workflowSourceText,reviewedWorkflowDefinition,workflowRuleCitations} from './workflow-source-fixture';
test('engine inputs, checks, comparison and notes survive real core close/reopen with artifact bytes unchanged',async()=>{
 const root=await mkdtemp(join(tmpdir(),'workflow-engine-store-'));let core=await createCompanion({dataDir:root});
 try{
  const task=await core.createTask({title:'Synthetic workflow engine persistence'}),created=await createWorkflowExample(core,{taskId:task.id,requestId:'example'}),artifact=(await core.getTask(task.id)).artifacts.find(a=>a.id===created.artifactId)!,bytes=artifact.revisions[0].content,data=parseModuleAnswer(JSON.parse(bytes)).modules[0].data;
  if(data.kind!=='workflow-lab')throw Error('Expected finite workflow');
  const target={taskId:task.id,artifactId:artifact.id,artifactRevision:1,moduleId:data.id};
  await editModule(core,{...target,action:{kind:'predict',finalStateId:'draft',blockedCount:1,reasoning:'Synthetic checked prediction',expectedRevision:0}});
  const exp=validateWorkflowExperiment(data.practice,{...defaultWorkflowExperiment(data.practice),properties:[{id:'never',kind:'never',stateId:'ready'},{id:'follows',kind:'never-follows',stateId:'ready',afterStateId:'draft',unlessStateId:'review'}],fixtures:[{id:'f1',label:'Edited review',initialStateId:'draft',eventIds:['submit','approve','edit','approve'],expectedFinalStateId:'ready'}],variants:[{id:'repair',label:'Return edits to review',origin:'muse-proposed',note:'Synthetic proposed repair',rules:practiceVariantRules(data.practice).map(r=>r.id==='ready-edit'?{...r,toStateId:'review'}:r)}],comparison:{leftId:'practice',rightId:'repair'}});
  await editModule(core,{...target,action:{kind:'set-experiment',experiment:exp,expectedRevision:1}});
  const expected=compareWorkflowVariants(data.practice,exp,'practice','repair');
  const race=await Promise.allSettled([editModule(core,{...target,action:{kind:'set-experiment',experiment:{...exp,assumptions:{...exp.assumptions,maxDepth:5}},expectedRevision:2}}),editModule(core,{...target,action:{kind:'set-experiment',experiment:{...exp,assumptions:{...exp.assumptions,maxDepth:4}},expectedRevision:2}})]);
  expect(race.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(race.filter(r=>r.status==='rejected')).toHaveLength(1);
  await core.close();core=await createCompanion({dataDir:root});
  const reopened=await core.getTask(task.id),state=workflowLab.parseState(data,reopened.session!.moduleStates[0].state);
  expect(state.revision).toBe(3);expect(state.experiment?.comparison).toEqual(exp.comparison);expect(state.experiment?.variants).toEqual(exp.variants);expect(reopened.artifacts.find(a=>a.id===artifact.id)!.revisions[0].content).toBe(bytes);
  const actual=compareWorkflowVariants(state.practice,state.experiment!,'practice','repair');expect(actual.fixtures).toEqual(expected.fixtures);expect(actual.properties.map(p=>p.changed)).toEqual(expected.properties.map(p=>p.changed));
  const context=workflowExplanationContext(reopened,{...target,stateRevision:3});expect(context.observation.experiment?.text).toContain('Bounded workflow experiment');expect(context.observation.experiment?.text).not.toContain('equipment-checkout');
  const note=await saveModuleDocument(core,{taskId:task.id,artifactId:artifact.id,artifactRevision:1,sessionRevision:reopened.session!.revision}),saved=(await core.getTask(task.id)).artifacts.find(a=>a.id===note.artifactId)!.revisions[0].content;
  expect(saved).toContain('Muse-proposed, unverified');expect(saved).toContain('not a guarantee');expect(saved).toContain('Event');expect(saved).not.toContain('equipment-checkout');
  await expect(editModule(core,{...target,action:{kind:'set-experiment',experiment:exp,expectedRevision:2}})).rejects.toThrow(/changed/);
 }finally{await core.close();await rm(root,{recursive:true,force:true});}
});
test('reviewed source staleness blocks experiment mutation and leaves saved state intact',async()=>{
 const root=await mkdtemp(join(tmpdir(),'workflow-engine-source-')),core=await createCompanion({dataDir:root});
 try{
  const task=await core.createTask({title:'Synthetic reviewed workflow'}),sourced=await core.putSource(task.id,{kind:'text',label:'Synthetic rules',role:'fact',content:workflowSourceText}),basis=await core.saveArtifact(task.id,{title:'Reviewed basis',content:'Synthetic explicit review.'}),created=await createWorkflowArtifact(core,{taskId:task.id,requestId:'reviewed',definition:reviewedWorkflowDefinition,review:{basis:{artifactId:basis.artifactId,revision:1,digest:basis.revision.digest},acknowledgement:'reviewed-rules',ruleCitations:workflowRuleCitations(sourced.sources[0].id)}}),artifact=(await core.getTask(task.id)).artifacts.find(a=>a.id===created.artifactId)!,data=parseModuleAnswer(JSON.parse(artifact.revisions[0].content)).modules[0].data;
  if(data.kind!=='workflow-lab')throw Error('Expected workflow');const target={taskId:task.id,artifactId:artifact.id,artifactRevision:1,moduleId:data.id};
   await editModule(core,{...target,action:{kind:'predict',finalStateId:'draft',blockedCount:1,reasoning:'Synthetic prediction',expectedRevision:0}});const beforeSourceChange=(await core.getTask(task.id)).session!;
   if(beforeSourceChange.contextRevision===undefined)throw Error('Expected a saved context revision before changing the reviewed source.');
  await core.putSource(task.id,{id:sourced.sources[0].id,kind:'text',label:'Synthetic rules',role:'fact',content:workflowSourceText+'\nChanged.'});
  const beforeRejectedEdit=await core.getTask(task.id);
  expect(beforeRejectedEdit.session!.revision).toBe(beforeSourceChange.revision+2);
  expect(beforeRejectedEdit.session!.contextRevision).toBe(beforeSourceChange.contextRevision+2);
  expect(beforeRejectedEdit.session!.moduleStates).toEqual(beforeSourceChange.moduleStates);
  await expect(editModule(core,{...target,action:{kind:'set-experiment',experiment:defaultWorkflowExperiment(data.practice),expectedRevision:1}})).rejects.toThrow(/source changed/);
  expect(await core.getTask(task.id)).toEqual(beforeRejectedEdit);
 }finally{await core.close();await rm(root,{recursive:true,force:true});}
});
