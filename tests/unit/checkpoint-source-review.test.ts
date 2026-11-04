import {afterEach,expect,test,vi} from 'vitest';
const probe=vi.hoisted(()=>({focus:vi.fn(),scrollIntoView:vi.fn(),isConnected:true,closest:()=>null}));
vi.mock('react',async original=>{
 const fixture=await import('../support/controlled-renderer.fixture');return {...await original<typeof import('react')>(),...fixture.hooks,useRef(initial:unknown){const ref=fixture.hooks.useRef(initial) as {current:unknown};if(initial===null&&ref.current===null)ref.current=probe;return ref;}};
});
import {createElement} from 'react';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Task} from '../../src/core/types';
import {createCompanion} from '../../src/core/companion';
import {TaskHistory} from '../../src/renderer/src/components/TaskHistory';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';

type Node=ReturnType<ReturnType<typeof createControlledRenderer>['nodes']>[number];
const text=(node:Node):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
const disclosure=(r:ReturnType<typeof createControlledRenderer>,open=true)=>{r.find(node=>node.type==='details'&&node.props.className==='history-checkpoint-revisions').props.onToggle({currentTarget:{open}});r.render();};
const contains=(r:ReturnType<typeof createControlledRenderer>,value:string)=>r.nodes().some(node=>text(node).includes(value));
afterEach(()=>{vi.unstubAllGlobals();probe.focus.mockClear();probe.scrollIntoView.mockClear();});
function task():Task{
 return {id:'owned-task',title:'Visit plan',goal:'',status:'active',createdAt:'2026-10-29T10:00:00Z',updatedAt:'2026-10-29T12:00:00Z',sources:[{id:'policy',currentVersion:2,freshness:'fresh',versions:[{id:'policy',version:1,digest:'first',kind:'text',role:'fact',label:'Arrival policy',content:'Keep\nArrive at 09:30.\n',capturedAt:'2026-10-29T10:00:00Z'},{id:'policy',version:2,digest:'second',kind:'text',role:'fact',label:'Updated arrival policy',content:'Keep\nArrive at 10:15.\n',capturedAt:'2026-10-29T12:00:00Z'}]}],artifacts:[],requests:[],procedures:[],checkpoints:[{id:'settled-time',note:'Arrival agreed. Recheck before travelling.',createdAt:'2026-10-29T11:00:00Z',sourceRefs:[{sourceId:'policy',version:1,digest:'first'}],artifacts:[]}],actions:[],memory:{enabled:false}};
}

test('History exposes the exact source evidence for a note without saved artifacts and compares only on request',()=>{
 const current=task(),before=structuredClone(current),unexpected=vi.fn(async()=>undefined),r=createControlledRenderer(()=>createElement(TaskHistory,{task:current,busy:false,run:unexpected}));
 r.render();
 expect(r.nodes().some(node=>node.type==='summary'&&text(node)==='Saved at this point')).toBe(true);
 expect(r.nodes().some(node=>node.props['aria-label']==='Task sources recorded with this note')).toBe(false);
 disclosure(r);
 expect(r.nodes().some(node=>node.props['aria-label']==='Task sources recorded with this note')).toBe(true);
 expect(r.nodes().some(node=>node.type==='pre'&&text(node)==='Keep\nArrive at 09:30.\n')).toBe(true);
 expect(r.nodes().some(node=>node.type==='pre'&&text(node).includes('10:15'))).toBe(false);
 r.find(node=>node.type==='button'&&text(node)==='Compare with saved version 2').props.onClick();r.render();
 expect(r.nodes().some(node=>node.props['aria-label']==='Text changes since this note')).toBe(true);
 expect(r.nodes().some(node=>node.type==='pre'&&text(node)==='Arrive at 09:30.\n')).toBe(true);
 expect(r.nodes().some(node=>node.type==='pre'&&text(node)==='Arrive at 10:15.\n')).toBe(true);
 expect(unexpected).not.toHaveBeenCalled();expect(current).toEqual(before);
});

test.each(['source','version','digest','snapshot-owner'])('an unavailable %s never falls back to a different snapshot or claims deletion',missing=>{
 const current=task();
 if(missing==='source')current.sources=[];
 else if(missing==='version')current.sources[0].versions=current.sources[0].versions.slice(1);
 else if(missing==='digest')current.checkpoints[0].sourceRefs[0].digest='mismatched';
 else current.sources[0].versions[0].id='foreign-source';
 const r=createControlledRenderer(()=>createElement(TaskHistory,{task:current,busy:false,run:async()=>undefined}));r.render();disclosure(r);
 expect(contains(r,'This exact saved snapshot is unavailable.')).toBe(true);expect(contains(r,'does not mean its content was deleted.')).toBe(true);
 expect(r.nodes().some(node=>node.type==='pre')).toBe(false);expect(r.nodes().some(node=>node.type==='button'&&text(node).startsWith('Compare with'))).toBe(false);
});

test('unavailable same-version rows retain readable source identities and the exact mismatched digest',()=>{
 const current=task();current.checkpoints[0].sourceRefs=[{sourceId:'missing-north',version:1,digest:'north-exact-digest'},{sourceId:'missing-east',version:1,digest:'east-exact-digest'},{sourceId:'policy',version:1,digest:'mismatched-policy-digest'}];
 const r=createControlledRenderer(()=>createElement(TaskHistory,{task:current,busy:false,run:async()=>undefined}));r.render();disclosure(r);
 const rows=r.nodes().filter(node=>node.type==='section'&&node.props.className==='history-checkpoint-source');expect(rows).toHaveLength(3);
 expect(rows[0].props['aria-label']).toBe('Unavailable source missing-north · Version 1');expect(rows[1].props['aria-label']).toBe('Unavailable source missing-east · Version 1');
 expect(text(rows[0])).toContain('north-exact-digest');expect(text(rows[1])).toContain('east-exact-digest');expect(text(rows[2])).toContain('mismatched-policy-digest');
 expect(r.nodes().filter(node=>node.type==='summary'&&text(node)==='Exact saved reference')).toHaveLength(3);expect(r.nodes().some(node=>node.type==='pre')).toBe(false);expect(r.nodes().some(node=>node.type==='code'&&text(node)==='first')).toBe(false);
});

test('a same-version note distinguishes saved evidence from refresh-required live content',()=>{
 const current=task();current.sources[0].currentVersion=1;current.sources[0].versions=current.sources[0].versions.slice(0,1);current.sources[0].freshness='refresh-required';
 const r=createControlledRenderer(()=>createElement(TaskHistory,{task:current,busy:false,run:async()=>undefined}));r.render();disclosure(r);
 expect(contains(r,'Matches the latest saved version.')).toBe(true);expect(contains(r,'Refresh or review is required.')).toBe(true);expect(contains(r,'current live content is unknown.')).toBe(true);
 expect(r.nodes().some(node=>node.type==='pre'&&text(node)==='Keep\nArrive at 09:30.\n')).toBe(true);expect(r.nodes().some(node=>node.type==='button'&&text(node).startsWith('Compare with'))).toBe(false);
 current.sources[0].currentVersion=99;r.render();expect(contains(r,'The latest saved snapshot is unavailable.')).toBe(true);expect(r.nodes().some(node=>node.type==='pre'&&text(node)==='Keep\nArrive at 09:30.\n')).toBe(true);
});

test('a comparison stays pinned after a newer save and changes its target only when explicitly chosen',()=>{
 const current=task(),r=createControlledRenderer(()=>createElement(TaskHistory,{task:current,busy:false,run:async()=>undefined})),button=(label:string)=>r.find(node=>node.type==='button'&&text(node)===label);
 r.render();disclosure(r);button('Compare with saved version 2').props.onClick();r.render();expect(probe.focus).toHaveBeenCalledWith({preventScroll:true});
 current.sources[0]={...current.sources[0],currentVersion:3,versions:[...current.sources[0].versions,{...current.sources[0].versions[1],version:3,digest:'third',content:'Keep\nArrive at 11:45.\n'}]};r.render();
 expect(contains(r,'This comparison keeps version 2')).toBe(true);expect(r.nodes().some(node=>node.type==='pre'&&text(node)==='Arrive at 10:15.\n')).toBe(true);expect(r.nodes().some(node=>node.type==='pre'&&text(node).includes('11:45'))).toBe(false);
 button('Compare with saved version 3').props.onClick();r.render();expect(contains(r,'Compared with: Updated arrival policy · Version 3')).toBe(true);expect(r.nodes().some(node=>node.type==='pre'&&text(node)==='Arrive at 11:45.\n')).toBe(true);
});

test('late close and focus callbacks cannot retire a reopened comparison',()=>{
 const frames:Array<()=>void>=[];vi.stubGlobal('requestAnimationFrame',(callback:()=>void)=>{frames.push(callback);return frames.length;});
 const current=task(),r=createControlledRenderer(()=>createElement(TaskHistory,{task:current,busy:false,run:async()=>undefined})),button=(label:string)=>r.find(node=>node.type==='button'&&text(node)===label);
 r.render();disclosure(r);button('Compare with saved version 2').props.onClick();r.render();const oldClose=button('Close source comparison').props.onClick;oldClose();r.render();
 expect(r.nodes().some(node=>node.props['aria-label']==='Checkpoint source comparison')).toBe(false);button('Compare with saved version 2').props.onClick();r.render();const focusCalls=probe.focus.mock.calls.length;frames[0]();oldClose();r.render();
 expect(probe.focus).toHaveBeenCalledTimes(focusCalls);expect(r.nodes().some(node=>node.props['aria-label']==='Checkpoint source comparison')).toBe(true);
 button('Close source comparison').props.onClick();r.render();frames[1]();expect(probe.focus).toHaveBeenCalledTimes(focusCalls+1);
});

test('an unavailable source keeps the open comparison closable without substituting another saved version',()=>{
 const frames:Array<()=>void>=[];vi.stubGlobal('requestAnimationFrame',(callback:()=>void)=>{frames.push(callback);return frames.length;});
 const current=task(),r=createControlledRenderer(()=>createElement(TaskHistory,{task:current,busy:false,run:async()=>undefined}));r.render();disclosure(r);r.find(node=>node.type==='button'&&text(node)==='Compare with saved version 2').props.onClick();r.render();
 current.sources=[];r.render();expect(r.nodes().some(node=>node.props['aria-label']==='Checkpoint source comparison')).toBe(true);expect(contains(r,'No replacement was selected.')).toBe(true);expect(r.nodes().some(node=>node.type==='pre')).toBe(false);
 r.find(node=>node.type==='button'&&text(node)==='Close source comparison').props.onClick();r.render();frames[0]();expect(r.nodes().some(node=>node.props['aria-label']==='Checkpoint source comparison')).toBe(false);
});

test('image and window source records expose only references without loading pixels or transport',()=>{
 const current=task(),unexpected=vi.fn(async()=>{throw Error('History must not invoke transport');});
 current.sources=[{...current.sources[0],currentVersion:1,versions:[{...current.sources[0].versions[0],kind:'image',content:'data:image/png;base64,PRIVATE_IMAGE_BYTES'}]},{id:'window',currentVersion:1,freshness:'refresh-required',versions:[{...current.sources[0].versions[0],id:'window',kind:'window',content:'PRIVATE_CAPTURE_METADATA',digest:'window-first',windowId:'private-window'}]}];
 current.checkpoints[0].sourceRefs.push({sourceId:'window',version:1,digest:'window-first'});
 const before=structuredClone(current),r=createControlledRenderer(()=>createElement(TaskHistory,{task:current,busy:false,run:unexpected}));r.render();disclosure(r);
 expect(contains(r,'Only their saved references are shown.')).toBe(true);expect(contains(r,'PRIVATE_IMAGE_BYTES')).toBe(false);expect(contains(r,'PRIVATE_CAPTURE_METADATA')).toBe(false);
 expect(r.nodes().some(node=>['img','canvas','iframe','video'].includes(node.type))).toBe(false);expect(unexpected).not.toHaveBeenCalled();expect(current).toEqual(before);
});

test('large comparisons keep the complete source texts with an explicit inline-diff limit',()=>{
 const current=task(),complete='Beginning\n'+'x'.repeat(100001)+'\nExact ending\n';current.sources[0].versions[0].content=complete;
 const r=createControlledRenderer(()=>createElement(TaskHistory,{task:current,busy:false,run:async()=>undefined}));r.render();disclosure(r);r.find(node=>node.type==='button'&&text(node)==='Compare with saved version 2').props.onClick();r.render();
 expect(contains(r,'too large or complex for an inline comparison')).toBe(true);expect(r.nodes().some(node=>node.type==='pre'&&text(node)===complete)).toBe(true);expect(r.nodes().some(node=>node.type==='pre'&&text(node)==='Keep\nArrive at 10:15.\n')).toBe(true);expect(r.nodes().some(node=>node.props['aria-label']==='Text changes since this note')).toBe(false);
});

test('a renamed or reclassified source with identical text is not shown as a textual change',()=>{
 const current=task();current.sources[0].versions[1]={...current.sources[0].versions[1],content:current.sources[0].versions[0].content,role:'inspiration'};
 const r=createControlledRenderer(()=>createElement(TaskHistory,{task:current,busy:false,run:async()=>undefined}));r.render();disclosure(r);r.find(node=>node.type==='button'&&text(node)==='Compare with saved version 2').props.onClick();r.render();
 expect(contains(r,'Text is unchanged. The source name, role or saved version may have changed.')).toBe(true);expect(contains(r,'Version 2 · Inspiration')).toBe(true);expect(r.nodes().some(node=>node.props['aria-label']==='Text changes since this note')).toBe(false);
});

test('source review preserves exact artifact revision navigation and identifies an ungrounded note',()=>{
 const current=task(),openRevision=vi.fn();current.checkpoints[0].sourceRefs=[];current.checkpoints[0].artifacts=[{artifactId:'plan',revision:1}];current.artifacts=[{id:'plan',revisions:[{revision:1,digest:'old',title:'Earlier plan',content:'Old result',mimeType:'text/plain',sourceRefs:[],createdAt:'2026-10-29T10:00:00Z'},{revision:2,digest:'new',title:'Later plan',content:'New result',mimeType:'text/plain',sourceRefs:[],createdAt:'2026-10-29T12:00:00Z'}]}];
 const r=createControlledRenderer(()=>createElement(TaskHistory,{task:current,busy:false,run:async()=>undefined,onOpenRevision:openRevision}));r.render();disclosure(r);
 expect(contains(r,'No source snapshots were linked when this note was saved.')).toBe(true);expect(contains(r,'Later plan')).toBe(false);r.find(node=>node.type==='button'&&node.props['aria-label']==='Earlier plan · Revision 1').props.onClick();expect(openRevision).toHaveBeenCalledWith({artifactId:'plan',revision:1});
});

test('a real saved checkpoint retains its source basis after source refresh and core/store reopen',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'checkpoint-source-review-'));let core=await createCompanion({dataDir:directory});
 try{
  let current=await core.createTask({title:'Trip decision'});current=await core.putSource(current.id,{kind:'text',role:'fact',label:'Gate instructions',content:'Use the north entrance.\n'});current=await core.checkpoint(current.id,'North entrance agreed.');const savedReference=structuredClone(current.checkpoints[0].sourceRefs[0]);
  current=await core.putSource(current.id,{id:current.sources[0].id,kind:'text',role:'fact',label:'Gate instructions revised',content:'Use the east entrance.\n'});await core.close();core=await createCompanion({dataDir:directory});current=await core.getTask(current.id);
  expect(current.checkpoints[0].sourceRefs).toEqual([savedReference]);const before=structuredClone(current),r=createControlledRenderer(()=>createElement(TaskHistory,{task:current,busy:false,run:async()=>{throw Error('Read-only history transport');}}));r.render();disclosure(r);
  expect(r.nodes().some(node=>node.type==='pre'&&text(node)==='Use the north entrance.\n')).toBe(true);r.find(node=>node.type==='button'&&text(node)==='Compare with saved version 2').props.onClick();r.render();expect(r.nodes().some(node=>node.type==='pre'&&text(node)==='Use the east entrance.\n')).toBe(true);expect(await core.getTask(current.id)).toEqual(before);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
