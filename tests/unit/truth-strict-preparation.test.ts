import {expect,test,vi} from 'vitest';
vi.mock('react',async original=>{const actual=await original<typeof import('react')>(),{hooks}=await import('../support/controlled-renderer.fixture');return {...actual,...hooks,useEffect:(fn:()=>void|(()=>void),deps:readonly unknown[])=>hooks.useEffect(()=>{const cleanup=fn();if(typeof cleanup==='function')cleanup();return fn();},deps)};});
import {createElement} from 'react';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';
import {TruthSourceReview} from '../../src/renderer/src/components/TruthSourceReview';
import {createCompanion} from '../../src/core/companion';
import {prepareWorkflowReview} from '../../src/core/workflow-review-host';
import type {Run} from '../../src/renderer/src/ui';
type Host=ReturnType<ReturnType<typeof createControlledRenderer>['nodes']>[number];
const text=(node:Host):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
async function flush(){for(let i=0;i<5;i++)await new Promise(resolve=>setTimeout(resolve,0));}
test('StrictMode effect replay shares one pending source preparation under the actual run lock',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'truth-strict-preparation-')),core=await createCompanion({dataDir:directory});let release!:()=>void;
 try{const task=await core.createTask({title:'Owned strict preparation'}),sourced=await core.putSource(task.id,{kind:'text',role:'fact',label:'Assignment',content:'y <= a and b;'}),v=sourced.sources[0].versions[0],refs=[{sourceId:v.id,version:v.version,digest:v.digest}],document=await core.saveArtifact(task.id,{title:'Source basis',content:'Explicit source.',sourceRefs:refs}),basis={artifactId:document.artifactId,revision:1,digest:document.revision.digest},current=await core.getTask(task.id),gate=new Promise<void>(resolve=>release=resolve);let locked=false,attempts=0,hostCalls=0;
 const run=(async(command:any)=>{attempts++;if(locked)return undefined;locked=true;try{if(command.type!=='workflow.prepare')throw Error('Unexpected command');hostCalls++;await gate;const {type,...input}=command;return await prepareWorkflowReview(core,input);}finally{locked=false;}}) as Run;
 const r=createControlledRenderer(()=>createElement(TruthSourceReview,{task:current,basis,busy:false,run,isCurrent:()=>true,onCreated:()=>{},onCancel:()=>{}}));r.render();await flush();r.render();release();await flush();r.render();expect(hostCalls).toBe(1);expect(r.nodes().filter(node=>node.props.role==='alert').map(text)).toEqual([]);expect(r.nodes().some(node=>node.type==='select')).toBe(true);expect(attempts).toBe(1);
 }finally{release?.();await core.close();await rm(directory,{recursive:true,force:true});}
});

test('a different document basis cannot inherit the old source selection or confirmation',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'truth-preparation-owner-')),core=await createCompanion({dataDir:directory});try{const task=await core.createTask({title:'Owned basis change'}),a=await core.putSource(task.id,{kind:'text',role:'fact',label:'A',content:'y <= a and b;'}),b=await core.putSource(task.id,{kind:'text',role:'fact',label:'B',content:'z <= c or d;'}),v1=a.sources[0].versions[0],v2=b.sources[1].versions[0],doc1=await core.saveArtifact(task.id,{title:'A',content:'A',sourceRefs:[{sourceId:v1.id,version:1,digest:v1.digest}]}),doc2=await core.saveArtifact(task.id,{title:'B',content:'B',sourceRefs:[{sourceId:v2.id,version:1,digest:v2.digest}]});let basis={artifactId:doc1.artifactId,revision:1,digest:doc1.revision.digest};const current=await core.getTask(task.id);let sent=0;const run=(async(command:any)=>{if(command.type==='workflow.prepare'){const {type,...input}=command;return prepareWorkflowReview(core,input);}sent++;return undefined;}) as Run;const r=createControlledRenderer(()=>createElement(TruthSourceReview,{task:current,basis,busy:false,run,isCurrent:()=>true,onCreated:()=>{},onCancel:()=>{}}));r.render();await flush();r.render();r.find(n=>n.type==='select').props.onChange({target:{value:'0'}});r.render();r.find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});r.render();expect(r.find(n=>n.type==='button'&&text(n)==='Create truth table').props.disabled).toBe(false);basis={artifactId:doc2.artifactId,revision:1,digest:doc2.revision.digest};r.render();await flush();r.render();expect(r.find(n=>n.type==='select').props.value).toBe('');expect(r.nodes().some(n=>n.type==='input'&&n.props.type==='checkbox')).toBe(false);expect(r.nodes().some(n=>n.type==='button'&&text(n)==='Create truth table')).toBe(false);expect(sent).toBe(0);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
