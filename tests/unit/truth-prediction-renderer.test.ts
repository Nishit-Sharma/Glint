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
async function flush(){for(let i=0;i<8;i++)await new Promise(resolve=>setTimeout(resolve,0));}
test('prediction feedback stays hidden until the actual selection commit and the recorded choice survives rerender',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'truth-prediction-view-')),core=await createCompanion({dataDir:directory});let release!:()=>void;try{const task=await core.createTask({title:'Owned prediction view'}),quote='y <= a xor b;',source=await core.putSource(task.id,{kind:'text',role:'fact',label:'Assignment',content:quote}),v=source.sources[0].versions[0],refs=[{sourceId:v.id,version:1,digest:v.digest}],doc=await core.saveArtifact(task.id,{title:'Basis',content:'Reviewed source.',sourceRefs:refs}),created=await createTruthTable(core,{taskId:task.id,basis:{artifactId:doc.artifactId,revision:1,digest:doc.revision.digest},expectedSourceRefs:refs,sourceId:v.id,start:0,end:quote.length,quote,confirmed:true,mode:'prediction'});let current=await core.getTask(task.id);const artifact=current.artifacts.find(a=>a.id===created.artifactId)!,gate=new Promise<void>(resolve=>release=resolve);let done!:()=>void;const committed=new Promise<void>(resolve=>done=resolve),r=createControlledRenderer(()=>createElement(ModuleAnswerView,{task:current,artifact,revision:artifact.revisions[0],onEdit:async(moduleId,action)=>{await gate;await editModule(core,{taskId:task.id,artifactId:artifact.id,artifactRevision:1,moduleId,action});current=await core.getTask(task.id);done();}}));r.render();expect(r.nodes().some(n=>text(n).includes('Computed output:'))).toBe(false);const label=r.find(n=>n.type==='label'&&text(n).trim()==='0'),radio=label.children.find(n=>n.type==='input')!;radio.props.onChange();r.render();expect(r.nodes().some(n=>text(n).includes('Computed output:'))).toBe(false);release();await committed;await flush();r.render();expect(r.nodes().some(n=>n.type==='p'&&text(n).includes('Computed output: 1'))).toBe(true);expect(r.nodes().some(n=>n.type==='p'&&text(n).includes('Your saved prediction: 0'))).toBe(true);expect(r.nodes().filter(n=>n.type==='input'&&n.props.type==='radio').every(n=>n.props.disabled)).toBe(true);expect(current.session!.moduleStates[0].state).toMatchObject({selectedRowId:'predict-0'});
 }finally{release?.();await core.close();await rm(directory,{recursive:true,force:true});}
});
