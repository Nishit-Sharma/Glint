import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {createCompanion,type Companion} from '../src/core/companion';
import {createWorkflowArtifact} from '../src/core/workflow-lab-host';
import {editModule,saveModuleDocument} from '../src/core/module-state';
import {parseModuleAnswer} from '../src/core/interactive-modules';
import {workflowLab,type WorkflowData} from '../src/learning/workflow-lab';
import {workflowExample} from '../src/learning/workflow-example';
import {LearningDraftStore} from '../src/host/learning-drafts';
import {createLearningDrafts} from '../src/renderer/src/learning-drafts';
import {LearningDraftProvider} from '../src/renderer/src/learning-draft-context';
import {ModuleView} from '../src/renderer/src/components/InteractiveModule';
import {reviewedWorkflowDefinition,workflowRuleCitations,workflowSourceText} from './workflow-source-fixture';

let directory:string,core:Companion;
beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'first-workflow-inspection-'));core=await createCompanion({dataDir:join(directory,'core')});});
afterEach(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});

test('a stale practice-active saved module exposes the first transfer read-only without mutating work or weakening commit fences',async()=>{
 const task=await core.createTask({title:'Owned synthetic first-attempt inspection'}),sourced=await core.putSource(task.id,{kind:'text',role:'fact',label:'Owned quoted rules',content:workflowSourceText}),source=sourced.sources[0];
 const saved=await core.saveArtifact(task.id,{title:'Owned linked basis',content:'The exact synthetic quoted rules are linked separately.'}),basis={artifactId:saved.artifactId,revision:saved.revision.revision,digest:saved.revision.digest};
 const request=await createWorkflowArtifact(core,{taskId:task.id,requestId:'owned-first-transfer',definition:reviewedWorkflowDefinition,review:{basis,acknowledgement:'reviewed-rules',ruleCitations:workflowRuleCitations(source.id)}});
 const published=await core.getTask(task.id),artifact=published.artifacts.find(item=>item.id===request.artifactId)!,revision=artifact.revisions[0],data=parseModuleAnswer(JSON.parse(revision.content)).modules[0].data as WorkflowData,target={taskId:task.id,artifactId:artifact.id,artifactRevision:1,moduleId:data.id};
 await editModule(core,{...target,action:{kind:'predict',finalStateId:'ready',blockedCount:0,reasoning:'First practice prediction',expectedRevision:0}});
 await editModule(core,{...target,action:{kind:'set-rule',ruleId:'ready-edit',toStateId:'review',enabled:true,reason:'Test the changed downstream approval.',expectedRevision:1}});
 await editModule(core,{...target,action:{kind:'predict',finalStateId:'ready',blockedCount:0,reasoning:'Approval can follow the changed edit.',expectedRevision:2}});
 await editModule(core,{...target,action:{kind:'start-transfer',expectedRevision:3}});
 await editModule(core,{...target,action:{kind:'predict',finalStateId:'reserved',blockedCount:1,reasoning:'  My first independent answer.\nKeep this exact reasoning.  ',expectedRevision:4}});
 await editModule(core,{...target,action:{kind:'return-practice',expectedRevision:5}});
 const owner={taskId:task.id,artifactId:artifact.id,artifactRevision:1,artifactDigest:revision.digest,moduleId:data.id,moduleVersion:data.version},store=new LearningDraftStore({directory,lookupTask:async id=>(await core.listTasks()).find(item=>item.id===id)}),cache=createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)});await cache.load();
 cache.edit(owner,'workflow:rule:document-review:ready-edit',{target:'review',enabled:true,reason:''},'owned-first-attempt-raw',raw=>({...raw,reason:'  Unapplied rule reason\nkept separately  '}));await cache.flush();
 await core.putSource(task.id,{id:source.id,kind:'text',role:'fact',label:'Changed owned rules',content:workflowSourceText+'\nA later source version.'});
 const current=await core.getTask(task.id),state=workflowLab.parseState(data,current.session!.moduleStates[0].state),beforeTask=structuredClone(current),beforeState=structuredClone(state),beforeRaw=await readFile(join(directory,'learning-drafts.json')),onAction=vi.fn(()=>{throw Error('Read-only inspection must not dispatch a module action.');});
 expect(state.active).toBe('practice');
 const html=renderToStaticMarkup(createElement(LearningDraftProvider,{cache,children:createElement(ModuleView,{data,state,task:current,draftOwner:owner,pending:true,onAction})}));
 expect(html).toContain('<summary>Inspect first transfer answer</summary>');
 expect(html).toContain('aria-label="Saved first transfer attempt"');
 expect(html).toContain('Historical source');
 expect(html).toContain('My first independent answer.');
 expect(html).toContain('You can inspect this saved work; editing is unavailable.');
 expect(onAction).not.toHaveBeenCalled();expect(await core.getTask(task.id)).toEqual(beforeTask);expect(state).toEqual(beforeState);expect(await readFile(join(directory,'learning-drafts.json'))).toEqual(beforeRaw);
 await expect(editModule(core,{...target,action:{kind:'set-mode',mode:'visual',expectedRevision:state.revision}})).rejects.toThrow(/source changed|source.*fresh/i);
 await expect(saveModuleDocument(core,{taskId:task.id,artifactId:artifact.id,artifactRevision:1,sessionRevision:current.session!.revision})).rejects.toThrow(/source changed|source.*fresh/i);
});

function firstAnsweredTransfer(){
 let state=workflowLab.initial(workflowExample);
 state=workflowLab.update(workflowExample,state,{kind:'set-rule',ruleId:'ready-edit',toStateId:'review',enabled:true,reason:'Explore changed downstream approval.',expectedRevision:0});
 state=workflowLab.update(workflowExample,state,{kind:'predict',finalStateId:'ready',blockedCount:0,reasoning:'Practice reasoning before transfer',expectedRevision:1});
 state=workflowLab.update(workflowExample,state,{kind:'start-transfer',expectedRevision:2});
 return state;
}
test('the inspection projection reveals no held-out result before the first submitted answer',()=>{
 for(const state of [workflowLab.initial(workflowExample),firstAnsweredTransfer()]){
  expect(workflowLab.firstTransfer(workflowExample,state)).toBeNull();
  const html=renderToStaticMarkup(createElement(ModuleView,{data:workflowExample,state,onAction:()=>{throw Error('No inspection action');}}));
  expect(html).not.toContain('Saved first transfer attempt');expect(html).not.toContain('Computed final state: Available');
 }
});
test('read-only inspection recomputes the first answer and original practice snapshot after newer practice changes',()=>{
 let state=firstAnsweredTransfer();state=workflowLab.update(workflowExample,state,{kind:'predict',finalStateId:'reserved',blockedCount:1,reasoning:'  First\nreasoning  ',expectedRevision:3});
 state=workflowLab.update(workflowExample,state,{kind:'return-practice',expectedRevision:4});
 state=workflowLab.update(workflowExample,state,{kind:'set-rule',ruleId:'ready-edit',toStateId:'draft',enabled:true,reason:'A later practice edit must not rewrite the first transfer.',expectedRevision:5});
 const before=JSON.stringify({data:workflowExample,state}),first=workflowLab.firstTransfer(workflowExample,state)!;
 expect(first.prediction.reasoning).toBe('  First\nreasoning  ');expect(first.predictedStateLabel).toBe('Reserved');expect(first.result).toMatchObject({finalStateLabel:'Available',blockedCount:2});expect(first.assessment).toMatchObject({score:0,maxScore:2});
 expect(first.practiceAtStart).toMatchObject({prediction:{reasoning:'Practice reasoning before transfer'},result:{finalStateLabel:'Ready',blockedCount:0}});
 first.prediction.reasoning='Local projection only';expect(JSON.stringify({data:workflowExample,state})).toBe(before);
 expect(()=>workflowLab.firstTransfer(workflowExample,{...state,lessonVersion:2})).toThrow(/another lesson/);
});
