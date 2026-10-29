import {expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('./controlled-renderer.fixture')).hooks}));
vi.mock('lucide-react',()=>({ArrowLeft:()=>null,FileText:()=>null,Image:()=>null,AppWindow:()=>null,Plus:()=>null,RefreshCw:()=>null}));
vi.mock('../src/renderer/src/components/TaskMenu',()=>({TaskMenu:({children}:{children:unknown})=>children}));
import {createElement} from 'react';
import type {Task} from '../src/core/types';
import {ContextInspector} from '../src/renderer/src/components/ContextInspector';
import {createLearningDrafts} from '../src/renderer/src/learning-drafts';
import {createControlledRenderer} from './controlled-renderer.fixture';
type Node=ReturnType<ReturnType<typeof createControlledRenderer>['nodes']>[number];
const text=(node:Node):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
test('Context offers source history comparison with no outputs and no transport, capture or saved-source changes',()=>{
 const task:Task={id:'task-a',title:'Only a source',goal:'',status:'active',createdAt:'time',updatedAt:'time',sources:[{id:'source-a',currentVersion:2,freshness:'refresh-required',versions:[{id:'source-a',version:1,digest:'one',kind:'text',role:'fact',label:'Policy',content:'Earlier policy.',capturedAt:'time'},{id:'source-a',version:2,digest:'two',kind:'text',role:'fact',label:'Policy',content:'Later policy.',capturedAt:'time'}]}],artifacts:[],procedures:[],requests:[],checkpoints:[],actions:[],memory:{enabled:false}},saved=structuredClone(task),unexpected=vi.fn(async()=>{throw Error('Read-only history must not call transport');}),cache=createLearningDrafts({read:unexpected,save:unexpected}),r=createControlledRenderer(()=>createElement(ContextInspector,{task,busy:false,cache,run:unexpected,reference:{sourceId:'source-a',version:2,digest:'two'},onWindow:unexpected,onArtifact:unexpected,onProcedure:unexpected,renderImageEditor:()=>null}));
 r.render();expect(r.nodes().some(node=>node.props['aria-label']==='Saved work to review')).toBe(false);r.find(node=>node.type==='button'&&text(node)==='Compare saved versions').props.onClick();r.render();expect(r.nodes().some(node=>node.props['aria-label']==='Selected source version comparison')).toBe(true);expect(r.nodes().some(node=>node.type==='pre'&&text(node)==='Earlier policy.')).toBe(true);expect(r.nodes().some(node=>node.type==='pre'&&text(node)==='Later policy.')).toBe(true);expect(r.nodes().some(node=>text(node).includes('Current live content is unknown.'))).toBe(true);expect(unexpected).not.toHaveBeenCalled();expect(task).toEqual(saved);
});
