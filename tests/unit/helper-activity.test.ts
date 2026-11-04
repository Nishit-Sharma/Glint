import {expect,test,vi} from 'vitest';
import {helperStudio,checkHelper,compareSavedHelperVersions,runHelper,TEXT_HELPER_ACTIVITY_LIMIT} from '../../src/learning/reusable-helper';
import {helperExample} from '../../src/learning/helper-example';
import {recordedTextFixture} from '../support/recorded-text-helper.fixture';
import {savedHelpers,resolveSavedHelper} from '../../src/shared/saved-helpers';
import {modelModuleText} from '../../src/core/interactive-modules';

function ready(){
 let state=helperStudio.initial(helperExample);
 const act=(action:Record<string,unknown>)=>{state=helperStudio.update(helperExample,state,{...action,expectedRevision:state.revision});};
 act({kind:'append-operation',operation:{kind:'trim'}});
 act({kind:'add-test',test:{id:'plain',label:'Trim',role:'example',input:' A ',expected:{kind:'output',text:'A'}}});
 act({kind:'add-test',test:{id:'empty',label:'Empty',role:'counterexample',input:'',expected:{kind:'output',text:''}}});
 act({kind:'save-version',changeNote:'Trim'});act({kind:'activate-version',version:1});
 return {get state(){return state;},act};
}
test('a second committed text run retains the first exact version/input/outcome',()=>{
 const f=ready();f.act({kind:'run-active',input:' First QA '});const first=f.state.revision;f.act({kind:'run-active',input:' Second QA '});
 expect(f.state).toMatchObject({runActivity:{startedAtRevision:first,runs:[{atRevision:first,version:1,savedAtRevision:4,input:' First QA ',result:{kind:'output',text:'First QA'}},{atRevision:first+1,version:1,input:' Second QA ',result:{kind:'output',text:'Second QA'}}]}});
});

test('new versions, rollback and draft changes preserve exact earlier version-correlated records',()=>{
 const f=ready();f.act({kind:'run-active',input:' Mixed '});const first=f.state.revision;
 f.act({kind:'append-operation',operation:{kind:'uppercase'}});f.act({kind:'save-version',changeNote:'Uppercase'});const savedAt=f.state.versions[1].savedAtRevision,versions=JSON.stringify(f.state.versions),draft=JSON.stringify(f.state.draft);
 f.act({kind:'activate-version',version:2});f.act({kind:'run-active',input:' Mixed '});const second=f.state.revision;
 f.act({kind:'activate-version',version:1});expect(f.state.lastRun).toBeNull();expect(f.state.runActivity?.runs).toHaveLength(2);
 f.act({kind:'run-active',input:' Mixed '});expect(f.state.runActivity?.runs).toMatchObject([{atRevision:first,version:1,savedAtRevision:4,result:{text:'Mixed'}},{atRevision:second,version:2,savedAtRevision:savedAt,result:{text:'MIXED'}},{version:1,result:{text:'Mixed'}}]);expect(JSON.stringify(f.state.versions)).toBe(versions);expect(JSON.stringify(f.state.draft)).toBe(draft);expect(f.state.activeVersion).toBe(1);
});

test('legacy latest result is not backfilled and pure trials/checks/reads never append history',()=>{
 const f=ready();f.act({kind:'save-version',changeNote:'Second checked snapshot'});f.act({kind:'run-active',input:' LEGACY_ONLY '});const {runActivity:_omitted,...legacy}=f.state,before=JSON.stringify(legacy);
 expect(helperStudio.parseState(helperExample,legacy).runActivity).toBeUndefined();runHelper(legacy,' PURE_RUN ',{capability:'local-text'});checkHelper(legacy.draft);compareSavedHelperVersions(helperExample,legacy,{referenceVersion:1,candidateVersion:2,input:' TRIAL_ONLY '});expect(JSON.stringify(legacy)).toBe(before);
 const next=helperStudio.update(helperExample,legacy,{kind:'run-active',input:' NEW_ONLY ',expectedRevision:legacy.revision});expect(next.runActivity?.runs).toHaveLength(1);expect(next.runActivity?.runs[0]).toMatchObject({atRevision:next.revision,input:' NEW_ONLY '});expect(next.runActivity?.startedAtRevision).toBe(next.revision);
});

test('strict admission rejects forged outcome/version/save-revision and unordered or future records',()=>{
 const f=ready();f.act({kind:'run-active',input:' First '});f.act({kind:'run-active',input:' Second '});const activity=f.state.runActivity!,runs=activity.runs;
 for(const corrupt of [
  {...activity,runs:[runs[1],runs[0]]},
  {...activity,runs:[runs[0],runs[0]]},
  {...activity,runs:[{...runs[0],atRevision:f.state.revision+1}]},
  {...activity,runs:[{...runs[0],version:2}]},
  {...activity,runs:[{...runs[0],savedAtRevision:3}]},
  {...activity,runs:[{...runs[0],result:{kind:'output',text:'FORGED',exceptionId:null}}]},
  {...activity,runs:[{...runs[0],input:' CHANGED '}]},
  {...activity,startedAtRevision:f.state.revision+1},
 ])expect(()=>helperStudio.parseState(helperExample,{...f.state,runActivity:corrupt})).toThrow();
 expect(()=>helperStudio.update(helperExample,f.state,{kind:'run-active',input:'Fake',expectedRevision:f.state.revision,runActivity:activity})).toThrow();
});

test('retains exactly the newest20 records without inventing dates or changing the recording start',()=>{
 const f=ready(),start=f.state.revision+1;
 for(let i=0;i<25;i++)f.act({kind:'run-active',input:`  QA 日本語 ${i}  `});
 const activity=f.state.runActivity!;expect(activity.runs).toHaveLength(TEXT_HELPER_ACTIVITY_LIMIT);expect(activity.startedAtRevision).toBe(start);expect(activity.runs[0]).toMatchObject({atRevision:start+5,input:'  QA 日本語 5  ',result:{text:'QA 日本語 5'}});expect(activity.runs.at(-1)?.atRevision).toBe(f.state.revision);expect(activity.runs.every(run=>!('at' in run))).toBe(true);
});

test('stale, inactive and failed executions never append a successful activity record',()=>{
 const f=ready();f.act({kind:'run-active',input:' Saved '});const first=JSON.stringify(f.state);
 expect(()=>helperStudio.update(helperExample,f.state,{kind:'run-active',input:'Stale',expectedRevision:f.state.revision-1})).toThrow();expect(JSON.stringify(f.state)).toBe(first);
 f.act({kind:'deactivate'});const inactive=JSON.stringify(f.state);expect(()=>f.act({kind:'run-active',input:'Inactive'})).toThrow();expect(JSON.stringify(f.state)).toBe(inactive);
 f.act({kind:'append-operation',operation:{kind:'replace-literal',find:'x',replacement:'X'.repeat(80)}});f.act({kind:'save-version',changeNote:'Bounded expansion'});f.act({kind:'activate-version',version:2});const before=JSON.stringify(f.state);expect(()=>f.act({kind:'run-active',input:'x'.repeat(4000)})).toThrow(/limit/);expect(JSON.stringify(f.state)).toBe(before);expect(f.state.runActivity?.runs).toHaveLength(1);
});

test('public module commits persist activity atomically, derive index metadata and keep raw runs out of automatic model context',async()=>{
 const f=await recordedTextFixture();
 try{
  await f.act({kind:'append-operation',operation:{kind:'trim'}});await f.act({kind:'add-test',test:{id:'plain',label:'Trim',role:'example',input:' A ',expected:{kind:'output',text:'A'}}});await f.act({kind:'add-test',test:{id:'empty',label:'Empty',role:'counterexample',input:'',expected:{kind:'output',text:''}}});await f.act({kind:'save-version',changeNote:'Trim'});await f.act({kind:'activate-version',version:1});
  const before=await f.read(),taskBefore=await f.core.getTask(f.owner.taskId),spy=vi.spyOn(f.core,'replaceSession').mockRejectedValueOnce(Error('Owned commit rejected'));
  await expect(f.act({kind:'run-active',input:' NOT_COMMITTED '})).rejects.toThrow('Owned commit rejected');spy.mockRestore();expect(await f.read()).toEqual(before);
  await f.act({kind:'run-active',input:' ACTUAL_FIRST_QA '});await f.act({kind:'run-active',input:' ACTUAL_SECOND_QA '});const state=await f.read(),task=await f.core.getTask(f.owner.taskId),entry=savedHelpers([task])[0];
  expect(entry.textRunActivity).toEqual({retainedCount:2,startedAtRevision:before.revision+1,latest:{atRevision:state.revision,version:1}});expect(JSON.stringify(entry.textRunActivity)).not.toMatch(/ACTUAL|input|result/);expect(resolveSavedHelper(task,entry).id).toBe(f.owner.artifactId);
  const automatic=modelModuleText(f.data,state);expect(automatic).not.toContain('ACTUAL_FIRST_QA');expect(automatic).not.toContain('ACTUAL_SECOND_QA');expect(automatic).not.toContain('runActivity');expect(task.requests).toEqual(taskBefore.requests);
  await f.reopen();expect(await f.read()).toEqual(state);expect((await f.read()).versions).toEqual(before.versions);expect((await f.read()).draft).toEqual(before.draft);expect((await f.read()).activeVersion).toBe(1);
 }finally{await f.close();}
});
