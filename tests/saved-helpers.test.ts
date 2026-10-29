import {expect,test} from 'vitest';
import type {Task} from '../src/core/types';
import {emptyTaskSession} from '../src/core/task-session';
import {helperStudio,type HelperState} from '../src/learning/reusable-helper';
import {MODULE_MIME} from '../src/shared/module-contract';
import {savedHelpers,resolveSavedHelper} from '../src/shared/saved-helpers';

function fixture(owner='owner-a',saved=true){
 const data={kind:'helper-studio',schemaVersion:1,id:'helper-'+owner,title:'Clean labels',description:'Trim pasted labels.'};
 let state=helperStudio.initial(data);
 const act=(action:Record<string,unknown>)=>{state=helperStudio.update(data,state,{...action,expectedRevision:state.revision});};
 if(saved){
  act({kind:'append-operation',operation:{kind:'trim'}});
  act({kind:'add-test',test:{id:'example',label:'Trim edges',role:'example',input:' Dock ',expected:{kind:'output',text:'Dock'}}});
  act({kind:'add-test',test:{id:'empty',label:'Keep empty',role:'counterexample',input:'',expected:{kind:'output',text:''}}});
  act({kind:'save-version',changeNote:'First checked version'});
 }
 const artifact={id:'artifact-'+owner,revisions:[{revision:1,title:'Text helper',content:JSON.stringify({schemaVersion:1,markdown:'Explicit local text helper.',modules:[{id:'module-'+owner,version:1,data,provenance:[]}]}),mimeType:MODULE_MIME,sourceRefs:[],digest:'digest-'+owner,createdAt:'2026-10-26T14:00:00Z'}]};
 const task:Task={id:owner,title:'Owner '+owner,goal:'',status:'active',createdAt:'2026-10-26T14:00:00Z',updatedAt:'2026-10-26T14:00:00Z',sources:[],artifacts:[artifact],requests:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false},session:{...emptyTaskSession(),moduleStates:[{artifactId:artifact.id,artifactRevision:1,moduleId:'module-'+owner,state}]}};
 const replace=(next:HelperState)=>{state=next;task.session={...emptyTaskSession(),moduleStates:[{artifactId:artifact.id,artifactRevision:1,moduleId:'module-'+owner,state}]};};
 return {task,artifact,data,get state(){return state;},act(action:Record<string,unknown>){act(action);replace(state);},replace};
}

test('saved inactive helpers are discoverable while draft-only helpers remain outside the catalog',()=>{
 const inactive=fixture(),draft=fixture('draft',false),entries=savedHelpers([inactive.task,draft.task]);
 expect(entries).toHaveLength(1);
 expect(entries[0]).toMatchObject({taskId:'owner-a',taskTitle:'Owner owner-a',name:'Clean labels',version:1,activeVersion:null,savedVersionCount:1,example:{input:' Dock ',expected:{kind:'output',text:'Dock'}}});
 expect(entries[0]).not.toHaveProperty('draft');expect(entries[0]).not.toHaveProperty('operations');
 expect(resolveSavedHelper(inactive.task,entries[0])).toBe(inactive.artifact);
});

test('catalog labels describe the selected saved version rather than uncommitted draft corrections',()=>{
 const f=fixture();f.act({kind:'activate-version',version:1});
 f.act({kind:'set-details',name:'A new name',description:'A new description',invocation:'Find this new label'});
 expect(savedHelpers([f.task])[0]).toMatchObject({name:'Clean labels',version:1,activeVersion:1,savedVersionCount:1});
 f.act({kind:'save-version',changeNote:'Rename after checks'});
 expect(savedHelpers([f.task])[0]).toMatchObject({name:'Clean labels',version:1,activeVersion:1,savedVersionCount:2});
 f.act({kind:'activate-version',version:2});
 expect(savedHelpers([f.task])[0]).toMatchObject({name:'A new name',description:'A new description',invocation:'Find this new label',version:2,activeVersion:2});
 f.act({kind:'deactivate'});
 expect(savedHelpers([f.task])[0]).toMatchObject({name:'A new name',version:2,activeVersion:null});
});

test('identical names in different tasks resolve only to their original owners and never run or copy',()=>{
 const first=fixture(),second=fixture('owner-b'),before=JSON.stringify([first.task,second.task]),entries=savedHelpers([first.task,second.task]);
 expect(entries.map(entry=>entry.name)).toEqual(['Clean labels','Clean labels']);
 expect(resolveSavedHelper(first.task,entries[0])).toBe(first.artifact);
 expect(resolveSavedHelper(second.task,entries[1])).toBe(second.artifact);
 expect(()=>resolveSavedHelper(first.task,entries[1])).toThrow(/changed or is no longer available/);
 expect(JSON.stringify([first.task,second.task])).toBe(before);
});

test('lookup rejects exact artifact, module, helper or state drift without name fallback',()=>{
 const f=fixture(),entry=savedHelpers([f.task])[0];
 for(const changed of [
  {...entry,taskId:'another'}, {...entry,artifactId:'another'}, {...entry,artifactRevision:2},
  {...entry,artifactDigest:'changed'}, {...entry,moduleId:'another'}, {...entry,helperId:'another'},
  {...entry,stateRevision:entry.stateRevision+1}, {...entry,version:2}, {...entry,activeVersion:1}, {...entry,savedVersionCount:2},
 ])expect(()=>resolveSavedHelper(f.task,changed)).toThrow(/Refresh Saved helpers/);
 f.act({kind:'activate-version',version:1});
 expect(()=>resolveSavedHelper(f.task,entry)).toThrow(/Refresh Saved helpers/);
 const fresh=savedHelpers([f.task])[0];expect(resolveSavedHelper(f.task,fresh)).toBe(f.artifact);
 f.task.artifacts=[];
 expect(()=>resolveSavedHelper(f.task,fresh)).toThrow(/Refresh Saved helpers/);
});

test('unrelated composer changes do not invalidate a helper lookup',()=>{
 const f=fixture(),entry=savedHelpers([f.task])[0];
 f.task.session={...f.task.session!,revision:40,draft:'Keep my unrelated message',draftKind:'explain',draftRevision:3};
 expect(resolveSavedHelper(f.task,entry)).toBe(f.artifact);
 expect(f.task.session.draft).toBe('Keep my unrelated message');
});

test('an artifact with a malformed sibling is omitted because the product cannot open it',()=>{
 const f=fixture(),answer=JSON.parse(f.artifact.revisions[0].content);
 f.artifact.revisions[0].content=JSON.stringify({...answer,modules:[{id:'malformed-neighbor',version:1,data:{kind:'helper-studio'},provenance:[]},...answer.modules]});
 expect(savedHelpers([f.task])).toEqual([]);
 f.artifact.revisions[0].content=JSON.stringify({...answer,modules:[...answer.modules,{...answer.modules[0],data:{kind:'helper-studio'}}]});
 expect(savedHelpers([f.task])).toEqual([]);
});

test('invalid envelopes, mismatched state and ambiguous stored state are excluded independently',()=>{
 const good=fixture(),bad=fixture('bad');
 bad.replace({...bad.state,helperId:'another-helper'});
 expect(savedHelpers([bad.task,good.task]).map(entry=>entry.taskId)).toEqual(['owner-a']);
 bad.artifact.revisions[0].content='{not valid JSON';
 expect(savedHelpers([bad.task,good.task]).map(entry=>entry.taskId)).toEqual(['owner-a']);
 good.task.session={...good.task.session!,moduleStates:[...good.task.session!.moduleStates,{...good.task.session!.moduleStates[0]}]};
 expect(savedHelpers([good.task])).toEqual([]);
});

test('only current artifact revisions appear, with legacy single-module state still supported',()=>{
 const f=fixture(),stored=f.task.session!.moduleStates[0];
 f.task.session={...f.task.session!,moduleStates:[{artifactId:stored.artifactId,artifactRevision:stored.artifactRevision,state:stored.state}]};
 expect(savedHelpers([f.task])).toHaveLength(1);
 f.artifact.revisions.push({...f.artifact.revisions[0],revision:2,digest:'revised-digest'});
 expect(savedHelpers([f.task])).toEqual([]);
});
