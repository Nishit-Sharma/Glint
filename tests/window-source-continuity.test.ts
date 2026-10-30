import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('./controlled-renderer.fixture')).hooks}));
vi.mock('../src/renderer/src/components/GeneratedSurface',()=>({GeneratedSurface:({children}:any)=>children}));
vi.mock('../src/renderer/src/components/SourceSnapshotReview',()=>({FrozenSourcePreview:()=>null}));
vi.mock('../src/renderer/src/components/TaskMenu',()=>({TaskMenu:({children}:any)=>children}));
vi.mock('../src/renderer/src/components/ReadableText',()=>({ReadableText:({text}:any)=>text}));
vi.mock('lucide-react',()=>Object.fromEntries(['ArrowLeft','FileText','Image','AppWindow','Plus','RefreshCw','ArrowUpRight','ChevronDown','Layers','Minus','Square'].map(name=>[name,()=>null])));
import {createElement} from 'react';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import type {SourceRef,Task} from '../src/core/types';
import {WindowSourceContinuity} from '../src/renderer/src/components/WindowSourceContinuity';
import {CompactCompanion} from '../src/renderer/src/components/CompactCompanion';
import {ContextInspector} from '../src/renderer/src/components/ContextInspector';
import {createControlledRenderer} from './controlled-renderer.fixture';
import type {Run} from '../src/renderer/src/ui';
const stamp={method:'ax-document',evidence:'foreground-application-correlation',digest:'a'.repeat(64)} as const;
const ref:SourceRef={sourceId:'window-source',version:1,digest:'b'.repeat(64)};
const time='2026-10-30T12:00:00.000Z';
const task=():Task=>({id:'owner',title:'Window owner',goal:'',status:'active',createdAt:time,updatedAt:time,sources:[{id:ref.sourceId,currentVersion:1,freshness:'fresh',versions:[{id:ref.sourceId,version:1,digest:ref.digest,capturedAt:time,kind:'window',role:'fact',label:'Selected editor',content:'Synthetic saved metadata',windowId:'window:41',windowProcessId:88,documentToken:'document-a',documentStamp:stamp}]}],artifacts:[{id:'answer',revisions:[{revision:1,title:'Original result',content:'Original result stays saved',mimeType:'text/plain',sourceRefs:[ref],digest:'c'.repeat(64),createdAt:time}]}],procedures:[],requests:[],checkpoints:[],actions:[],memory:{enabled:false}});
beforeEach(()=>vi.stubGlobal('window',{companion:{invoke:vi.fn(async()=>task())}}));
afterEach(()=>vi.unstubAllGlobals());
type Node=ReturnType<ReturnType<typeof createControlledRenderer>['nodes']>[number];
const text=(node:Node):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
const includes=(renderer:ReturnType<typeof createControlledRenderer>,value:string)=>renderer.nodes().some(node=>text(node).includes(value));
function stale(owner:Task,kind:'changed'|'unavailable'='changed'){owner.sources[0].freshness='refresh-required';owner.sources[0].documentChange={kind,reason:'Saved test observation',observedAt:time,observedDigest:'d'.repeat(64)};return owner;}

it.each(['fresh','changed','unavailable','manual','uncompared'] as const)('keeps observed change distinct from unknown content: %s',async state=>{
 const owner=task();if(state!=='fresh')stale(owner,state==='unavailable'?'unavailable':'changed');if(state==='manual')delete owner.sources[0].documentChange;if(state==='uncompared')delete owner.sources[0].versions[0].documentStamp;
 const before=JSON.stringify(owner),opened:SourceRef[]=[],r=createControlledRenderer(()=>createElement(WindowSourceContinuity,{task:owner,sourceId:ref.sourceId,onReview:value=>opened.push(value)}));r.render();
 expect(includes(r,'Current live content is unknown')).toBe(true);expect(includes(r,'Edits at the same address may not be detected')).toBe(true);
 expect(includes(r,'Recorded window metadata change')).toBe(state==='changed');expect(includes(r,'Window observation unavailable')).toBe(state==='unavailable');expect(includes(r,'Window snapshot needs review')).toBe(state==='manual'||state==='uncompared');expect(includes(r,'Saved window snapshot · Version 1')).toBe(state==='fresh');expect(includes(r,'1 saved item needs source review')).toBe(state!=='fresh');
 r.find(node=>node.type==='button').props.onClick();await vi.waitFor(()=>expect(opened).toEqual([ref]));expect(window.companion.invoke).toHaveBeenCalledExactlyOnceWith({type:'tasks.get',taskId:owner.id});expect(JSON.stringify(owner)).toBe(before);
});

it.each(['removed','task','source','version','digest','kind','missing-current'] as const)('refuses a retained review callback after its exact target changed: %s',variant=>{
 let owner=task(),sourceId=ref.sourceId;const opened:SourceRef[]=[],r=createControlledRenderer(()=>createElement(WindowSourceContinuity,{task:owner,sourceId,onReview:value=>opened.push(value)}));r.render();const old=r.find(node=>node.type==='button').props.onClick;owner=structuredClone(owner);
 if(variant==='removed')owner.sources=[];if(variant==='task')owner.id='different-owner';if(variant==='source')sourceId='different-source';if(variant==='version'){owner.sources[0].currentVersion=2;owner.sources[0].versions.push({...owner.sources[0].versions[0],version:2});}if(variant==='digest')owner.sources[0].versions[0].digest='e'.repeat(64);if(variant==='kind')owner.sources[0].versions[0].kind='text';if(variant==='missing-current')owner.sources[0].currentVersion=99;
 r.render();old();expect(opened).toEqual([]);
});

it.each([false,true])('compact notice remains beside a saved result including rich brief: %s',async rich=>{
 const owner=stale(task()),before=JSON.stringify(owner),opened:SourceRef[]=[],r=createControlledRenderer(()=>createElement(CompactCompanion,{task:owner,active:false,loaded:true,busy:false,running:false,anyRunning:false,error:'',notice:'',character:null,composer:null,onWorkspace:()=>{},onReviewSource:value=>opened.push(value),onArtifact:()=>{},onRefresh:()=>{throw Error('No implicit refresh');},onCaptureAttached:()=>{throw Error('No implicit capture');},onCollapse:()=>{},onStop:()=>{},onDismissError:()=>{},onStartContext:()=>{throw Error('No context activation');},onSourceSelection:()=>{},...(rich?{renderBrief:()=>createElement('p',{},'Saved rich brief stays visible')}:{})}));r.render();
 expect(includes(r,'Recorded window metadata change')).toBe(true);expect(includes(r,rich?'Saved rich brief stays visible':'Original result stays saved')).toBe(true);r.find(node=>node.type==='button'&&text(node)==='Review saved window snapshot').props.onClick();await vi.waitFor(()=>expect(opened).toEqual([ref]));expect(JSON.stringify(owner)).toBe(before);
});

it.each(['removed','superseded','wrong-owner','failure'] as const)('the explicit read-only lookup holds a changed or unavailable durable target: %s',async variant=>{
 const owner=task(),checked=task(),opened:SourceRef[]=[];if(variant==='removed')checked.sources=[];if(variant==='superseded'){checked.sources[0].currentVersion=2;checked.sources[0].versions.push({...checked.sources[0].versions[0],version:2});}if(variant==='wrong-owner')checked.id='wrong-owner';vi.mocked(window.companion.invoke).mockImplementation(async()=>{if(variant==='failure')throw Error('Private store diagnostic');return checked as any;});
 const r=createControlledRenderer(()=>createElement(WindowSourceContinuity,{task:owner,sourceId:ref.sourceId,onReview:value=>opened.push(value)}));r.render();r.find(node=>node.type==='button').props.onClick();await vi.waitFor(()=>{r.render();expect(r.nodes().some(node=>node.props.role==='alert')).toBe(true);});expect(opened).toEqual([]);expect(includes(r,'Private store diagnostic')).toBe(false);expect(window.companion.invoke).toHaveBeenCalledExactlyOnceWith({type:'tasks.get',taskId:owner.id});
});

it('a late verified lookup cannot navigate a replacement task',async()=>{
 let owner=task(),release!:(value:Task)=>void;const opened:SourceRef[]=[],checked=structuredClone(owner);vi.mocked(window.companion.invoke).mockImplementation(()=>new Promise<any>(done=>{release=done;}));const r=createControlledRenderer(()=>createElement(WindowSourceContinuity,{task:owner,sourceId:ref.sourceId,onReview:value=>opened.push(value)}));r.render();r.find(node=>node.type==='button').props.onClick();r.render();expect(r.find(node=>node.type==='button').props.disabled).toBe(true);owner={...task(),id:'replacement'};r.render();release(checked);await Promise.resolve();expect(opened).toEqual([]);expect(r.nodes().some(node=>node.props.role==='alert')).toBe(false);
});

it('does not attribute a selected snapshot to a different attached window or a multiple-source scope',()=>{
 const owner=stale(task()),props={task:owner,active:false,loaded:true,busy:false,running:false,anyRunning:false,error:'',notice:'',character:null,composer:null,onWorkspace:()=>{},onReviewSource:()=>{},onArtifact:()=>{},onRefresh:()=>{},onCaptureAttached:()=>{},onCollapse:()=>{},onStop:()=>{},onDismissError:()=>{},onStartContext:()=>{},onSourceSelection:()=>{}};
 let r=createControlledRenderer(()=>createElement(CompactCompanion,{...props,attachedWindow:{id:'other-window',title:'Other selected window',ownerName:'Other app'}}));r.render();expect(includes(r,'Recorded window metadata change')).toBe(false);
 r=createControlledRenderer(()=>createElement(CompactCompanion,{...props,selectedSourceIds:[ref.sourceId,'other-source']}));r.render();expect(includes(r,'Recorded window metadata change')).toBe(false);
});

it('a saved attached B cannot make selected A appear to describe B',()=>{
 const owner=stale(task()),b={...structuredClone(owner.sources[0]),id:'source-b',versions:[{...owner.sources[0].versions[0],id:'source-b',windowId:'window:42',label:'Saved B'}]};owner.sources.push(b);
 const r=createControlledRenderer(()=>createElement(CompactCompanion,{task:owner,selectedSourceIds:[ref.sourceId],attachedWindow:{id:'window:42',title:'Attached B',ownerName:'Other editor'},active:false,loaded:true,busy:false,running:false,anyRunning:false,error:'',notice:'',character:null,composer:null,onWorkspace:()=>{},onReviewSource:()=>{},onArtifact:()=>{},onRefresh:()=>{},onCaptureAttached:()=>{},onCollapse:()=>{},onStop:()=>{},onDismissError:()=>{},onStartContext:()=>{},onSourceSelection:()=>{}}));r.render();
 expect(r.nodes().some(node=>node.props['aria-label']==='Selected window source review')).toBe(false);expect(includes(r,'The attached window differs from the selected source')).toBe(true);expect(owner.sources[0].id).toBe(ref.sourceId);
});

it('a newer navigation request retires a held saved-source lookup even when task and source props have not committed',async()=>{
 let current=true,release!:(value:Task)=>void;const owner=task(),opened:SourceRef[]=[];vi.mocked(window.companion.invoke).mockImplementation(()=>new Promise<any>(done=>{release=done;}));
 const r=createControlledRenderer(()=>createElement(WindowSourceContinuity,{task:owner,sourceId:ref.sourceId,onReview:(value:SourceRef)=>opened.push(value),isCurrent:()=>current} as any));r.render();r.find(node=>node.type==='button').props.onClick();current=false;release(owner);await Promise.resolve();r.render();expect(opened).toEqual([]);expect(r.find(node=>node.type==='button').props.disabled).toBe(false);
});

it('full source review keeps explicit refresh and historical selection separate',async()=>{
 let owner=stale(task());const commands:unknown[]=[],run=(async(command:import('../src/shared/bridge').Command)=>{commands.push(command);owner=structuredClone(owner);owner.sources[0].currentVersion=2;owner.sources[0].freshness='fresh';delete owner.sources[0].documentChange;owner.sources[0].versions.push({...owner.sources[0].versions[0],version:2,digest:'e'.repeat(64)});return owner;}) as Run;
 const r=createControlledRenderer(()=>createElement(ContextInspector,{task:owner,reference:ref,busy:false,run,cache:{} as any,onWindow:()=>{},onArtifact:()=>{},onProcedure:()=>{},renderImageEditor:()=>null}));r.render();expect(includes(r,'Recorded window metadata change')).toBe(true);expect(commands).toEqual([]);
 await r.find(node=>node.type==='button'&&text(node)==='Refresh capture').props.onClick();r.render();expect(commands).toEqual([{type:'windows.capture',taskId:'owner',windowId:'window:41',sourceId:ref.sourceId}]);expect(includes(r,'Saved window snapshot · Version 2')).toBe(true);expect(owner.artifacts[0].revisions[0].sourceRefs).toEqual([ref]);
 r.find(node=>node.type==='button'&&text(node).startsWith('Version 1 ·')).props.onClick();r.render();expect(includes(r,'Earlier snapshot · Version 1')).toBe(true);expect(r.nodes().some(node=>node.props['aria-label']==='Selected window source review')).toBe(false);expect(r.nodes().some(node=>node.type==='button'&&text(node)==='Refresh capture')).toBe(false);
});

it('real source reconciliation and core reopen keep result and draft bytes while reporting unknown observations honestly',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'window-review-'));let core=await createCompanion({dataDir:directory});try{
 let owner=await core.createTask({title:'Source awareness'});owner=await core.putSource(owner.id,{kind:'window',role:'fact',label:'Selected editor',content:'Synthetic metadata only',windowId:'window:41',windowProcessId:88,documentToken:'synthetic-document',documentStamp:stamp});const saved=owner.sources[0].versions[0],exact={sourceId:saved.id,version:1,digest:saved.digest},binding={taskId:owner.id,ref:exact,windowId:'window:41',processId:88};await core.saveArtifact(owner.id,{title:'Saved result',content:'Keep exact authored result',sourceRefs:[exact]});await core.saveComposerDraft(owner.id,0,{text:'Keep exact unsent correction',kind:'explain'});
 owner=(await core.reconcileDocumentSource(binding,{kind:'document',stamp:{...stamp,digest:'f'.repeat(64)}})).task;const artifacts=structuredClone(owner.artifacts),session=structuredClone(owner.session);let r=createControlledRenderer(()=>createElement(WindowSourceContinuity,{task:owner,sourceId:saved.id}));r.render();expect(includes(r,'Recorded window metadata change')).toBe(true);
 owner=(await core.reconcileDocumentSource(binding,{kind:'frozen',reason:'permission'})).task;r.render();expect(includes(r,'Window observation unavailable')).toBe(true);expect(includes(r,'This does not establish that its content changed')).toBe(true);
 await core.close();core=await createCompanion({dataDir:directory});owner=await core.getTask(owner.id);r.render();expect(includes(r,'Window observation unavailable')).toBe(true);expect(owner.artifacts).toEqual(artifacts);expect(owner.session).toMatchObject({draft:session?.draft,draftKind:session?.draftKind,draftRevision:session?.draftRevision,moduleStates:session?.moduleStates,runs:session?.runs});
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
