import {expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('../support/controlled-renderer.fixture')).hooks}));
vi.mock('../../src/renderer/src/components/ReadableText',()=>({ReadableText:()=>null}));
vi.mock('../../src/renderer/src/components/ReadyArtifact',()=>({ReadyArtifact:(props:{children:unknown})=>props.children}));
import {createElement} from 'react';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';
import {createCompanion} from '../../src/core/companion';
import {createTruthTable} from '../../src/core/truth-table-host';
import {ModuleAnswerView} from '../../src/renderer/src/components/ModuleAnswer';
import {OnboardingFixture} from '../support/onboarding-fixture';
import type {Command} from '../../src/shared/bridge';
type Host=ReturnType<ReturnType<typeof createControlledRenderer>['nodes']>[number];
const text=(node:Host):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
async function flush(){for(let i=0;i<5;i++)await new Promise(resolve=>setTimeout(resolve,0));}
function gate(){let release!:()=>void,entered!:()=>void;return {waiting:new Promise<void>(r=>release=r),entered:new Promise<void>(r=>entered=r),release:()=>release(),enter:()=>entered()};}
async function setup(){const directory=await mkdtemp(join(tmpdir(),'truth-selection-timing-')),core=await createCompanion({dataDir:directory}),task=await core.createTask({title:'Owned selection'}),quote='y <= a and b;',source=await core.putSource(task.id,{kind:'text',role:'fact',label:'Owned source',content:quote}),v=source.sources[0].versions[0],refs=[{sourceId:v.id,version:v.version,digest:v.digest}],doc=await core.saveArtifact(task.id,{title:'Source basis',content:'Owned source.',sourceRefs:refs}),created=await createTruthTable(core,{taskId:task.id,basis:{artifactId:doc.artifactId,revision:1,digest:doc.revision.digest},expectedSourceRefs:refs,sourceId:v.id,start:0,end:quote.length,quote,confirmed:true}),current=await core.getTask(task.id),artifact=current.artifacts.find(a=>a.id===created.artifactId)!,commands:Command[]=[],fixture={core,commands,emit:async()=>{}} as unknown as OnboardingFixture;return {directory,core,current,artifact,fixture,async close(){await core.close();await rm(directory,{recursive:true,force:true});}};}
function radio(r:ReturnType<typeof createControlledRenderer>){const labels=r.nodes().filter(n=>n.type==='label'&&text(n)==='a = 1; b = 1');expect(labels).toHaveLength(1);return labels[0].children.find(n=>n.type==='input')!;}

test('the actual comparison remains controlled and reports Saving until the fixture dispatch commits',async()=>{
 const f=await setup(),g=gate();try{let current=f.current,finished!:()=>void;const done=new Promise<void>(r=>finished=r);const r=createControlledRenderer(()=>createElement(ModuleAnswerView,{task:current,artifact:f.artifact,revision:f.artifact.revisions[0],onEdit:async(moduleId,action)=>{g.enter();await g.waiting;const result=await OnboardingFixture.prototype.invoke.call(f.fixture,{type:'module.edit',taskId:current.id,artifactId:f.artifact.id,artifactRevision:1,moduleId,action});current=result as typeof current;finished();}}));r.render();expect(radio(r).props.checked).toBe(false);radio(r).props.onChange();await g.entered;r.render();expect(radio(r).props.checked).toBe(false);expect(radio(r).props['aria-disabled']).toBe(true);expect(r.nodes().some(n=>n.props.role==='status'&&text(n)==='Saving…')).toBe(true);expect(r.nodes().some(n=>n.props.role==='alert')).toBe(false);g.release();await done;await flush();r.render();expect(radio(r).props.checked).toBe(true);expect(current.session!.moduleStates[0].state).toMatchObject({selectedRowId:'pair-11'});expect(r.nodes().some(n=>n.props.role==='alert')).toBe(false);
 }finally{g.release();await f.close();}
});

test('closing the fixture while that edit is still pending produces the later generic error',async()=>{
 const f=await setup(),g=gate();try{let done!:()=>void;const completed=new Promise<void>(r=>done=r);const r=createControlledRenderer(()=>createElement(ModuleAnswerView,{task:f.current,artifact:f.artifact,revision:f.artifact.revisions[0],onEdit:async(moduleId,action)=>{g.enter();await g.waiting;try{await OnboardingFixture.prototype.invoke.call(f.fixture,{type:'module.edit',taskId:f.current.id,artifactId:f.artifact.id,artifactRevision:1,moduleId,action});}finally{done();}}}));r.render();radio(r).props.onChange();await g.entered;r.render();expect(r.nodes().some(n=>n.props.role==='alert')).toBe(false);await f.core.close();g.release();await completed;await flush();r.render();expect(r.nodes().filter(n=>n.props.role==='alert').map(text)).toEqual(['This action could not be completed. Review the task before continuing.']);
 }finally{g.release();await f.close();}
});
