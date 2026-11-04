import {expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('../support/controlled-renderer.fixture')).hooks}));
vi.mock('../../src/renderer/src/components/ReadableText',()=>({ReadableText:()=>null}));
import {createElement} from 'react';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';
import {createCompanion} from '../../src/core/companion';
import {createTruthTable} from '../../src/core/truth-table-host';
import {editModule} from '../../src/core/module-state';
import {ModuleAnswerView} from '../../src/renderer/src/components/ModuleAnswer';
type Host=ReturnType<ReturnType<typeof createControlledRenderer>['nodes']>[number];
const text=(node:Host):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
test('the selected pair produces a source-bound trace, persists and is marked historical after a source change',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'truth-change-view-'));let core=await createCompanion({dataDir:directory});try{
  let task=await core.createTask({title:'Owned source'});const quote='y <= a xor b;';task=await core.putSource(task.id,{kind:'text',role:'fact',label:'Assignment',content:quote});const v=task.sources[0].versions[0],refs=[{sourceId:v.id,version:1,digest:v.digest}],doc=await core.saveArtifact(task.id,{title:'Basis',content:'Exact linked source.',sourceRefs:refs});
  const created=await createTruthTable(core,{taskId:task.id,basis:{artifactId:doc.artifactId,revision:1,digest:doc.revision.digest},expectedSourceRefs:refs,sourceId:v.id,start:0,end:quote.length,quote,confirmed:true});task=await core.getTask(task.id);const artifact=structuredClone(task.artifacts.find(a=>a.id===created.artifactId)!),answer=JSON.parse(artifact.revisions[0].content),moduleId=answer.modules[0].id;
  const render=()=>{const r=createControlledRenderer(()=>createElement(ModuleAnswerView,{task,artifact,revision:artifact.revisions[0],onEdit:async()=>{}}));r.render();return r;};
  let r=render();expect(r.nodes().some(n=>n.type==='p'&&text(n).includes('Select an input pair'))).toBe(true);expect(r.nodes().some(n=>text(n).includes('XOR returns'))).toBe(false);
  await editModule(core,{taskId:task.id,artifactId:artifact.id,artifactRevision:1,moduleId,action:{kind:'select',rowId:'pair-11',expectedRevision:0}});task=await core.getTask(task.id);r=render();expect(r.nodes().some(n=>n.type==='p'&&text(n)==='XOR returns 0 because the inputs are the same.')).toBe(true);expect(r.nodes().some(n=>text(n).includes('Output stays 0'))).toBe(true);
  await core.close();core=await createCompanion({dataDir:directory});task=await core.getTask(task.id);r=render();expect(r.nodes().some(n=>n.type==='p'&&text(n)==='XOR returns 0 because the inputs are the same.')).toBe(true);
  task=await core.putSource(task.id,{id:v.id,kind:'text',role:'fact',label:'Assignment',content:'y <= a or b;'});r=render();expect(r.nodes().some(n=>n.type==='p'&&text(n).includes('saved reviewed assignment; the source now needs review'))).toBe(true);expect(r.nodes().some(n=>n.type==='p'&&text(n)==='XOR returns 0 because the inputs are the same.')).toBe(true);expect(task.artifacts.find(a=>a.id===artifact.id)).toEqual(artifact);
  await expect(editModule(core,{taskId:task.id,artifactId:artifact.id,artifactRevision:1,moduleId,action:{kind:'select',rowId:'pair-10',expectedRevision:1}})).rejects.toThrow();
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
