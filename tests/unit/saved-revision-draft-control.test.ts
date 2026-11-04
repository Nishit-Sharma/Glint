import {expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('../support/controlled-renderer.fixture')).hooks}));
vi.mock('lucide-react',async original=>({...await original<typeof import('lucide-react')>(),ArrowLeft:()=>null}));
vi.mock('../../src/renderer/src/components/ReadableText',()=>({ReadableText:({text}:{text:string})=>text}));
import {createElement} from 'react';
import type {ArtifactRef,ArtifactRevision,Task} from '../../src/core/types';
import {RevisionReview} from '../../src/renderer/src/components/RevisionReview';
import type {SavedRevisionDraftResult} from '../../src/renderer/src/saved-revision-draft';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';
type Node=ReturnType<ReturnType<typeof createControlledRenderer>['nodes']>[number];
const text=(node:Node):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
function saved(){
 const revision:ArtifactRevision={revision:1,title:'Earlier plan',content:'Exact earlier body.',mimeType:'text/markdown',encoding:'utf8',sourceRefs:[],digest:'one',createdAt:'2026-10-24T10:00:00Z'},artifact={id:'plan',revisions:[revision,{...revision,revision:2,title:'Current plan',content:'Current body.',digest:'two'}]},task:Task={id:'task',title:'Visit',goal:'',status:'active',createdAt:revision.createdAt,updatedAt:revision.createdAt,sources:[],artifacts:[artifact],requests:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false}};
 return {task,artifact,revision};
}
test('the actual recovery control sends the exact revision once and makes preservation of an existing draft explicit',async()=>{
 const props=saved(),before=structuredClone(props.task),opened=vi.fn(),calls:ArtifactRef[]=[];let release!:(result:SavedRevisionDraftResult)=>void;
 const pending=new Promise<SavedRevisionDraftResult>(done=>{release=done;}),r=createControlledRenderer(()=>createElement(RevisionReview,{...props,back:()=>{},onLatest:opened,onDraft:reference=>{calls.push(reference);return pending;}}));
 r.render();const button=r.find(node=>node.type==='button'&&text(node)==='Use revision 1 as a draft');button.props.onClick();button.props.onClick();r.render();
 expect(calls).toEqual([{artifactId:'plan',revision:1,digest:'one'}]);expect(r.find(node=>node.type==='button'&&text(node)==='Preparing draft…').props.disabled).toBe(true);
 release({kind:'existing-draft',message:'Your existing input is kept. Save or explicitly discard it first.'});await vi.waitFor(()=>{r.render();expect(r.nodes().some(node=>node.props.role==='status'&&text(node).includes('explicitly discard'))).toBe(true);});
 r.find(node=>node.type==='button'&&text(node)==='Open existing draft').props.onClick();expect(opened).toHaveBeenCalledTimes(1);expect(props.task).toEqual(before);
});
test('a disabled restoration action cannot dispatch even through a retained handler',()=>{
 const onDraft=vi.fn(async()=>({kind:'ready' as const})),r=createControlledRenderer(()=>createElement(RevisionReview,{...saved(),disabled:true,back:()=>{},onLatest:()=>{},onDraft}));r.render();
 const button=r.find(node=>node.type==='button'&&text(node)==='Use revision 1 as a draft');expect(button.props.disabled).toBe(true);button.props.onClick();expect(onDraft).not.toHaveBeenCalled();
});
