import {expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('../support/controlled-renderer.fixture')).hooks}));
import {createElement} from 'react';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';
import {TruthSourceReview} from '../../src/renderer/src/components/TruthSourceReview';
import {createCompanion} from '../../src/core/companion';
import {prepareWorkflowReview} from '../../src/core/workflow-review-host';
import {createTruthTable,inspectTruthTable} from '../../src/core/truth-table-host';
import type {Run} from '../../src/renderer/src/ui';
type Host=ReturnType<ReturnType<typeof createControlledRenderer>['nodes']>[number];
const text=(node:Host):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
async function flush(){for(let i=0;i<8;i++)await new Promise(resolve=>setTimeout(resolve,0));}
test('reviewed prediction entry preserves mode through a lost acknowledgement and explicit inspection',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'truth-prediction-review-')),core=await createCompanion({dataDir:directory});try{const task=await core.createTask({title:'Owned prediction entry'}),quote='y <= a and b;',source=await core.putSource(task.id,{kind:'text',role:'fact',label:'Assignment',content:quote}),v=source.sources[0].versions[0],refs=[{sourceId:v.id,version:1,digest:v.digest}],doc=await core.saveArtifact(task.id,{title:'Basis',content:'Reviewed source.',sourceRefs:refs}),basis={artifactId:doc.artifactId,revision:1,digest:doc.revision.digest};let current=await core.getTask(task.id),opened='',finished!:()=>void;const committed=new Promise<void>(resolve=>finished=resolve),commands:any[]=[];const run=(async(command:any)=>{commands.push(command);if(command.type==='workflow.prepare'){const {type,...input}=command;return prepareWorkflowReview(core,input);}if(command.type==='truth.review'){const {type,...input}=command;const result=await createTruthTable(core,input);current=result.task;finished();return undefined;}if(command.type==='truth.inspect'){const {type,...input}=command;return inspectTruthTable(core,input);}if(command.type==='tasks.get')return core.getTask(command.taskId);throw Error('Unexpected command');}) as Run;const r=createControlledRenderer(()=>createElement(TruthSourceReview,{task:current,basis,busy:false,run,isCurrent:()=>true,onCreated:result=>{opened=result.artifactId;},onCancel:()=>{}}));r.render();await flush();r.render();r.find(n=>n.type==='select').props.onChange({target:{value:'0'}});r.render();expect(r.find(n=>n.type==='button'&&text(n)==='Predict an output').props.disabled).toBe(true);r.find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});r.render();r.find(n=>n.type==='button'&&text(n)==='Predict an output').props.onClick();r.render();expect(r.find(n=>n.type==='button'&&text(n)==='Creating…').props.disabled).toBe(true);expect(r.find(n=>n.type==='button'&&text(n)==='Create truth table').props.disabled).toBe(true);await committed;await flush();r.render();expect(opened).toBe('');r.find(n=>n.type==='button'&&text(n)==='Check publication').props.onClick();await flush();r.render();expect(opened).toBeTruthy();expect(commands.filter(c=>c.type==='truth.review')).toHaveLength(1);expect(commands.find(c=>c.type==='truth.review').mode).toBe('prediction');expect(commands.find(c=>c.type==='truth.inspect').mode).toBe('prediction');expect((await core.getTask(task.id)).requests).toHaveLength(1);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
