import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Effect} from 'effect';
import {expect,test} from 'vitest';
import {createCompanion} from '../../src/core/companion';
import {createTextHelper} from '../../src/core/text-helper-host';
import {editModule,saveModuleDocument} from '../../src/core/module-state';
import {parseModuleAnswer,readableModuleIntro,moduleHistoryText,LOCAL_HELPER_CONTEXT_NOTICE} from '../../src/core/interactive-modules';
import {semanticHelper} from '../../src/learning/semantic-helper';
import {savedHelpers,resolveSavedHelper} from '../../src/shared/saved-helpers';
import {readState as readOldState} from '../fixtures/a91/src/core/store';
import {expectPinnedReaderRefusal} from '../support/pinned-reader-refusal.fixture';
import {moduleHistoryText as oldModuleHistoryText} from '../fixtures/a91/src/core/interactive-modules';

const plan={schemaVersion:1,id:'local-route',version:1,intent:'Route a local request.',target:'local-record',input:{name:'request',fields:[{name:'amount',kind:'number',minimum:0,maximum:10000},{name:'approved',kind:'boolean'},{name:'sensitive',kind:'boolean'}]},output:{name:'result',fields:[{name:'route',kind:'string',minLength:1,maxLength:30}]},preconditions:[{id:'approved',reason:'Approval is required.',predicate:{kind:'compare',operator:'eq',left:{kind:'input',field:'approved'},right:{kind:'literal',value:true}}}],postconditions:[{id:'route-valid',reason:'Return a permitted route.',predicate:{kind:'any',terms:[{kind:'compare',operator:'eq',left:{kind:'output',field:'route'},right:{kind:'literal',value:'standard'}},{kind:'compare',operator:'eq',left:{kind:'output',field:'route'},right:{kind:'literal',value:'review'}}]}}],root:{kind:'branch',id:'sensitivity',intent:'Check sensitivity.',predicate:{kind:'compare',operator:'eq',left:{kind:'input',field:'sensitive'},right:{kind:'literal',value:true}},then:{kind:'abstain',id:'sensitive-stop',intent:'Stop for review.',reason:'Sensitive input needs review.'},else:{kind:'branch',id:'threshold',intent:'Check the amount.',predicate:{kind:'compare',operator:'gte',left:{kind:'input',field:'amount'},right:{kind:'literal',value:1000}},then:{kind:'assign',id:'review',intent:'Choose review.',field:'route',value:{kind:'literal',value:'review'},next:{kind:'return',id:'review-done',intent:'Return.'}},else:{kind:'assign',id:'standard',intent:'Choose standard.',field:'route',value:{kind:'literal',value:'standard'},next:{kind:'return',id:'standard-done',intent:'Return.'}}}}};
const evidence={rationales:[{id:'reason',kind:'inferred-rationale',stepId:'threshold',basis:[{recordingId:'recording-3',traceStepId:'threshold'}],reason:'The amount appears to select the route.'}],corrections:[],examples:[{id:'fresh',role:'held-out',input:{amount:1200,approved:true,sensitive:false},expected:{status:'completed',output:{route:'review'}}},{id:'no-approval',role:'counterexample',input:{amount:100,approved:false,sensitive:false},expected:{status:'abstained',haltedStepId:'approved',code:'precondition'}},{id:'sensitive',role:'exception',input:{amount:100,approved:true,sensitive:true},expected:{status:'abstained',haltedStepId:'sensitive-stop',code:'explicit-stop'}}]};

test('actual helper owner saves and runs a local record version without creating another store; the pinned older store refuses it unchanged',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'semantic-helper-core-'));let core=await createCompanion({dataDir:dir});
 try{
  const task=await core.createTask({title:'Record helper owner'}),created=await createTextHelper(core,{taskId:task.id,requestId:'create-one'});
  const artifact=created.task.artifacts.find(item=>item.id===created.artifactId)!,module=parseModuleAnswer(JSON.parse(artifact.revisions[0].content)).modules[0];
  if(module.data.kind!=='helper-studio')throw Error('Expected a host-owned helper.');
  const identity={taskId:task.id,artifactId:artifact.id,artifactRevision:1,moduleId:module.id};let rev=0;
  const act=async(action:Record<string,unknown>)=>{await editModule(core,{...identity,action:{...action,expectedRevision:rev++} as never});};
  await act({kind:'begin-semantic-helper'});await act({kind:'set-semantic-procedure',procedure:plan});
  await act({kind:'record-semantic-input',input:{amount:100,approved:true,sensitive:false}});await act({kind:'set-semantic-evidence',...evidence});
  await expect(editModule(core,{...identity,action:{kind:'record-semantic-input',input:{amount:1,approved:true,sensitive:false},result:{status:'completed'},expectedRevision:rev} as never})).rejects.toThrow();
  await act({kind:'set-semantic-evidence',...evidence,corrections:[{id:'reason-correction',proposalId:'reason',before:evidence.rationales[0].reason,after:'The amount selects a local route.',reason:'Clarify scope.'}]});
  await act({kind:'save-semantic-version',changeNote:'First local record version.'});
  let saved=await core.getTask(task.id),state=semanticHelper.parseState(module.data.id,saved.session!.moduleStates[0].state);
  expect(state.activeVersion).toBeNull();expect(state.recordings[0]).toMatchObject({externalObservationVerified:false,effectAuthority:'none'});
  await act({kind:'activate-semantic-version',version:1});await act({kind:'run-semantic-active',input:{amount:1500,approved:true,sensitive:false}});
  saved=await core.getTask(task.id);state=semanticHelper.parseState(module.data.id,saved.session!.moduleStates[0].state);
  expect(state.lastRun).toMatchObject({version:1,result:{status:'completed',output:{route:'review'},effectAuthority:'none'}});
  const changed={...plan,root:{...plan.root,else:{...plan.root.else,predicate:{...plan.root.else.predicate,right:{kind:'literal',value:2000}}}}};
  await act({kind:'replace-semantic-procedure',procedure:changed,rationales:[],corrections:[],examples:[]});
  await act({kind:'set-semantic-evidence',...evidence,examples:evidence.examples.map(item=>item.id==='fresh'?{...item,expected:{status:'completed',output:{route:'standard'}}}:item)});
  await act({kind:'save-semantic-version',changeNote:'Higher threshold.'});
  await act({kind:'activate-semantic-version',version:2});await act({kind:'run-semantic-active',input:{amount:1500,approved:true,sensitive:false}});
  saved=await core.getTask(task.id);state=semanticHelper.parseState(module.data.id,saved.session!.moduleStates[0].state);expect(state.lastRun).toMatchObject({version:2,result:{status:'completed',output:{route:'standard'}}});
  await act({kind:'activate-semantic-version',version:1});await act({kind:'run-semantic-active',input:{amount:1500,approved:true,sensitive:false}});
  saved=await core.getTask(task.id);state=semanticHelper.parseState(module.data.id,saved.session!.moduleStates[0].state);
  expect(state.lastRun).toMatchObject({version:1,result:{status:'completed',output:{route:'review'}}});expect(state.evidenceHistory.some(item=>item.candidate.corrections.some(correction=>correction.id==='reason-correction'))).toBe(true);
  const entry=savedHelpers([saved])[0];expect(entry).toMatchObject({taskId:task.id,artifactId:artifact.id,version:1,activeVersion:1});expect(resolveSavedHelper(saved,entry).id).toBe(artifact.id);
  const answer=parseModuleAnswer(JSON.parse(artifact.revisions[0].content)),originalIntro='Local text helper. Teach only the listed text operations on text you paste here.';
  expect(answer.markdown).toBe(originalIntro);
  expect(readableModuleIntro(answer,()=>state)).toBe('Local record helper. Choose fields and check local computations here.');
  expect(readableModuleIntro(answer,()=>undefined)).toBe(originalIntro);
  expect(readableModuleIntro({...answer,markdown:'A user-authored introduction.'},()=>state)).toBe('A user-authored introduction.');
  const history=moduleHistoryText(artifact.revisions[0].content,()=>state);expect(history).toContain('Local helper answer. Its text and values are excluded from automatic AI and browser context.');expect(history).toContain(LOCAL_HELPER_CONTEXT_NOTICE);expect(history).toContain('semantic-record-v1');for(const privateText of [plan.intent,evidence.rationales[0].reason,'The amount selects a local route.',originalIntro])expect(history).not.toContain(privateText);
  const notes=await saveModuleDocument(core,{...identity,sessionRevision:saved.session!.revision});const note=(await core.getTask(task.id)).artifacts.find(item=>item.id===notes.artifactId)!.revisions[0].content;
  expect(note).toContain('Local record helper. Choose fields and check local computations here.');expect(note).not.toContain(originalIntro);expect(note).toContain('The amount selects a local route.');
  const before=saved.session!.moduleStates,other=await core.createTask({title:'Unrelated old-reader task'}),beforeTask=await core.getTask(task.id);
  await core.close();
  // Refusal contract: replaces the unrelated update through the pinned older store; that store now refuses the provenance-bearing store with tasks.json unchanged. The pinned module text reader still renders the saved state.
  expect(oldModuleHistoryText(artifact.revisions[0].content,()=>before[0].state)).toBe('An interactive answer is saved, but its current stage needs review. No raw module data is included.');
  await expectPinnedReaderRefusal(dir,()=>Effect.runPromise(readOldState(dir)));
  core=await createCompanion({dataDir:dir});const reopenedTask=await core.getTask(task.id);expect(reopenedTask.session!.moduleStates).toEqual(before);expect(reopenedTask.artifacts).toEqual(beforeTask.artifacts);expect(reopenedTask.requests).toEqual(beforeTask.requests);
  expect((await core.getTask(other.id)).title).toBe('Unrelated old-reader task');
 }finally{await core.close();await rm(dir,{recursive:true,force:true});}
});
