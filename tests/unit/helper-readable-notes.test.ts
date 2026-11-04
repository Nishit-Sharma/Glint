import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,test} from 'vitest';
import {helperStudio,type HelperAction} from '../../src/learning/reusable-helper';
import {helperExample} from '../../src/learning/helper-example';
import {createCompanion} from '../../src/core/companion';
import {editModule,saveModuleDocument} from '../../src/core/module-state';
import {readTaskArtifactText} from '../../src/core/task-dialogue';
import {MODULE_MIME} from '../../src/shared/module-contract';

type WithoutRevision<Action>=Action extends unknown?Omit<Action,'expectedRevision'>:never;
function helper(){
 let state=helperStudio.initial(helperExample);
 const act=(action:WithoutRevision<HelperAction>)=>{state=helperStudio.update(helperExample,state,{...action,expectedRevision:state.revision});};
 return {get state(){return state;},act,text:()=>helperStudio.text(helperExample,state)};
}
function recorded(h:ReturnType<typeof helper>){
 h.act({kind:'start-demonstration',input:'  River   Dock  '});
 h.act({kind:'demonstrate-step',operation:{kind:'trim'}});
 h.act({kind:'demonstrate-step',operation:{kind:'collapse-spaces'}});
 h.act({kind:'finish-demonstration'});
 h.act({kind:'add-test',test:{id:'protected-internal-id',label:'Keep protected spacing',role:'counterexample',input:'KEEP:   Dock  ',expected:{kind:'output',text:'KEEP:   Dock  '}}});
}
function protectedVersion(h:ReturnType<typeof helper>){
 recorded(h);
 h.act({kind:'add-exception',exception:{id:'exception-internal-id',contains:'KEEP:',behavior:'preserve',reason:'Protected labels keep their original spacing.'}});
 h.act({kind:'save-version',changeNote:'Trim and collapse, except protected labels'});
}
function noInternalDefinitions(text:string){
 for(const value of ['"operations":','"tests":','"exceptions":','"helperId":','"activeVersion":','savedAtRevision','expectedRevision','protected-internal-id','exception-internal-id'])expect(text).not.toContain(value);
 expect(text).not.toMatch(/^(?:Say|Ask):/m);expect(text).not.toMatch(/mastered|mastery|you learned/i);
}

test('new helper notes explain scope, discovery label and unsaved status in readable text',()=>{
 const text=helper().text();
 expect(text).toContain('Discovery label');expect(text).toContain('Clean this pasted label');
 expect(text).toContain('Active version: none');expect(text).toContain('No saved versions');
 expect(text).toContain('Current draft');expect(text).toContain('No operations yet');
 expect(text).toContain('pasted text');expect(text).not.toContain('browser procedures learned');
 noInternalDefinitions(text);
});

test('recorded demonstration and failing counterexample remain distinct from draft checks',()=>{
 const h=helper();recorded(h);const text=h.text();
 expect(text).toContain('Recorded demonstration');expect(text).toContain('Recorded input');
 expect(text).toContain('  River   Dock  ');expect(text).toContain('Recorded result');expect(text).toContain('River Dock');
 expect(text).toContain('Trim edges');expect(text).toContain('Collapse spaces and tabs');
 expect(text).toContain('Counterexample');expect(text).toContain('Expected result');expect(text).toContain('Computed result');expect(text).toContain('Fail');
 expect(text).toContain('KEEP:   Dock  ');expect(text).toContain('KEEP: Dock');
 noInternalDefinitions(text);
});

test('corrected expectations do not relabel the original recorded result or active definition',()=>{
 const h=helper();protectedVersion(h);h.act({kind:'activate-version',version:1});
 h.act({kind:'append-operation',operation:{kind:'uppercase'}});
 const example=h.state.draft.tests.find(test=>test.demonstration)!;
 h.act({kind:'add-test',test:{...example,label:'Updated expectation: uppercase',expected:{kind:'output',text:'RIVER DOCK'}}});
 h.act({kind:'save-version',changeNote:'Add uppercase after spacing cleanup'});
 h.act({kind:'run-active',input:'  New   Dock  '});
 const text=h.text();
 expect(text).toContain('Active version: 1');expect(text).toContain('Version 2');expect(text).toContain('Current draft');
 expect(text).toContain('Active version operations');expect(text).toContain('Convert to uppercase');
 expect(text).toContain('Recorded result');expect(text).toContain('River Dock');expect(text).toContain('RIVER DOCK');
 expect(text).toContain('Latest run — version 1');expect(text).toContain('New Dock');expect(text).not.toContain('NEW DOCK');
 noInternalDefinitions(text);
});

test('run notes identify exact saved version and exception reason after rollback',()=>{
 const h=helper();protectedVersion(h);h.act({kind:'activate-version',version:1});
 h.act({kind:'append-operation',operation:{kind:'uppercase'}});
 const example=h.state.draft.tests.find(test=>test.demonstration)!;
 h.act({kind:'add-test',test:{...example,expected:{kind:'output',text:'RIVER DOCK'}}});
 h.act({kind:'save-version',changeNote:'Uppercase correction'});h.act({kind:'activate-version',version:2});
 h.act({kind:'run-active',input:' New Dock '});expect(h.text()).toContain('NEW DOCK');
 h.act({kind:'activate-version',version:1});h.act({kind:'run-active',input:'KEEP:   Dock  '});
 const text=h.text();
 expect(text).toContain('Active version: 1');expect(text).toContain('Latest run — version 1');
 expect(text).toContain('KEEP:   Dock  ');expect(text).toContain('Protected labels keep their original spacing.');
 expect(text).toContain('First matching exception wins');noInternalDefinitions(text);
});

test('a short latest run stays visible in a task-history-sized excerpt before repeated definitions',()=>{
 const h=helper();protectedVersion(h);h.act({kind:'activate-version',version:1});
 h.act({kind:'run-active',input:'  New   Dock  '});
 const excerpt=h.text().slice(0,2000);
 expect(excerpt).toContain('Last run used version 1');expect(excerpt).toContain('  New   Dock  ');expect(excerpt).toContain('New Dock');
 h.act({kind:'run-active',input:'KEEP:   Dock  '});
 expect(h.text().slice(0,2000)).toContain('Protected labels keep their original spacing.');
});

test('all five operations have readable meanings and literal replacement text stays safely quoted',()=>{
 const h=helper(),literal='```\n# Keep **this** {"operations":"my literal text"}\n  ';
 h.act({kind:'append-operation',operation:{kind:'trim'}});
 h.act({kind:'append-operation',operation:{kind:'collapse-spaces'}});
 h.act({kind:'append-operation',operation:{kind:'lowercase'}});
 h.act({kind:'append-operation',operation:{kind:'uppercase'}});
 h.act({kind:'append-operation',operation:{kind:'replace-literal',find:'**',replacement:'__'}});
 h.act({kind:'add-test',test:{id:'literal-check',label:'Literal Markdown',role:'example',input:literal,expected:{kind:'output',text:literal}}});
 const text=h.text();
 for(const meaning of ['Trim edges','Collapse spaces and tabs','Convert to lowercase','Convert to uppercase','Replace exact text'])expect(text).toContain(meaning);
 expect(text).toContain('Find');expect(text).toContain('Replace with');
 expect(text).toContain('````text\n'+literal+'\n````');
 expect(text).not.toContain('literal-check');expect(text).toContain('{"operations":"my literal text"}');
});

test('notes preserve abstention separately from an output and explain the matching exception',()=>{
 const h=helper();recorded(h);
 h.act({kind:'remove-test',id:'protected-internal-id'});
 h.act({kind:'add-exception',exception:{id:'abstain-internal-id',contains:'PRIVATE:',behavior:'abstain',reason:'Leave private labels for manual review.'}});
 h.act({kind:'add-test',test:{id:'private-internal-id',label:'Private label',role:'counterexample',input:'PRIVATE: Dock',expected:{kind:'abstain'}}});
 h.act({kind:'save-version',changeNote:'Leave private labels alone'});h.act({kind:'activate-version',version:1});
 h.act({kind:'run-active',input:'PRIVATE: New Dock'});
 const text=h.text();expect(text).toContain('Abstained');expect(text).toContain('Leave private labels for manual review.');expect(text).not.toContain('abstain-internal-id');
});

test('explicit saved document and restart retain helper text while automatic task history contains only metadata',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'readable-helper-notes-'));let core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Owned helper notes fixture'});
  const artifact=await core.saveArtifact(task.id,{title:'Text helper',mimeType:MODULE_MIME,sourceRefs:[],content:JSON.stringify({schemaVersion:1,markdown:'Local helper.',modules:[{id:'helper',version:1,data:helperExample,provenance:[]}]})});
  const target={taskId:task.id,artifactId:artifact.artifactId,artifactRevision:1,moduleId:'helper'};
  await editModule(core,{...target,action:{kind:'start-demonstration',input:'  Dock  ',expectedRevision:0}});
  await editModule(core,{...target,action:{kind:'demonstrate-step',operation:{kind:'trim'},expectedRevision:1}});
  await editModule(core,{...target,action:{kind:'finish-demonstration',expectedRevision:2}});
  const current=await core.getTask(task.id),state=helperStudio.parseState(helperExample,current.session!.moduleStates[0].state),text=helperStudio.text(helperExample,state);
  const projected=readTaskArtifactText(current,artifact.artifactId,1);expect(projected.available).toBe(true);if(projected.available){expect(projected.text).toContain('Local helper metadata');expect(projected.text).not.toContain('  Dock  ');expect(projected.text).not.toContain('Recorded result');}
  const saved=await saveModuleDocument(core,{...target,sessionRevision:current.session!.revision});
  await core.close();core=await createCompanion({dataDir:directory});
  const reopened=await core.getTask(task.id),notes=reopened.artifacts.find(a=>a.id===saved.artifactId)!.revisions.at(-1)!;
  expect(notes.content).toContain(text);expect(notes.content).toContain('Recorded result');noInternalDefinitions(notes.content);
  expect(helperStudio.parseState(helperExample,reopened.session!.moduleStates[0].state)).toEqual(state);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
