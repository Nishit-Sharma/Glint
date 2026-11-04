import {afterEach,expect,it,vi} from 'vitest';
vi.mock('react',async original=>{const fixture=await import('../support/controlled-renderer.fixture');return {...await original<typeof import('react')>(),...fixture.hooks};});
vi.mock('lucide-react',()=>({ArrowUpRight:()=>null,FileText:()=>null,ListChecks:()=>null}));
import {createElement} from 'react';
import {ArtifactList} from '../../src/renderer/src/components/ArtifactList';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';
import {cycleArtifactRegion} from '../../src/renderer/src/artifact-keyboard';
import type {Task} from '../../src/core/types';
afterEach(()=>vi.unstubAllGlobals());
it('provides one saved-result tab stop, deliberate arrow entry and native Enter opening',()=>{
 const task={artifacts:['one','two','three'].map(id=>({id,revisions:[{title:id,mimeType:'text/markdown'}]})),procedures:[]} as unknown as Task,onArtifact=vi.fn(),r=createControlledRenderer(()=>createElement(ArtifactList,{task,onArtifact,onProcedure:()=>{}}));r.render();let buttons=r.nodes().filter(node=>node.props.className==='artifact-row');expect(buttons.map(node=>node.props.tabIndex)).toEqual([0,-1,-1]);
 const focused=vi.fn(),scrolled=vi.fn();buttons[2].props.ref({focus:focused,scrollIntoView:scrolled});const preventDefault=vi.fn();buttons[0].props.onKeyDown({key:'End',nativeEvent:{isComposing:false},preventDefault});r.render();buttons=r.nodes().filter(node=>node.props.className==='artifact-row');expect(buttons.map(node=>node.props.tabIndex)).toEqual([-1,-1,0]);expect(preventDefault).toHaveBeenCalledOnce();expect(focused).toHaveBeenCalledWith({preventScroll:true});expect(scrolled).toHaveBeenCalledWith({block:'nearest'});buttons[2].props.onClick();expect(onArtifact).toHaveBeenCalledWith(task.artifacts[2]);
});
it('cycles visible result regions both ways from the innermost active region and deliberately reveals the focused destination',()=>{
 let active:any;const region=(name:string,parent?:any)=>({dataset:{artifactRegion:name},closest:()=>null,getClientRects:()=>[{}],contains:(node:any)=>node===active&&node?.parent===name,scrollIntoView:vi.fn(),focus:vi.fn((options:any)=>{expect(options).toEqual({preventScroll:true});active=regions.find(item=>item.dataset.artifactRegion===name);})}),regions=[region('Controls'),region('Content'),region('Document'),region('Follow-up')];regions[1].contains=(node:any)=>node===regions[2]||node===regions[3];const hidden={...region('Hidden'),closest:()=>({})};const root={querySelectorAll:()=>[...regions,hidden]} as unknown as HTMLElement;vi.stubGlobal('document',{get activeElement(){return active;}});
 active=regions[2];expect(cycleArtifactRegion(root,false)).toBe('Follow-up');expect(cycleArtifactRegion(root,true)).toBe('Document');active=regions[0];expect(cycleArtifactRegion(root,true)).toBe('Follow-up');expect(hidden.focus).not.toHaveBeenCalled();expect(regions[3].scrollIntoView).toHaveBeenCalledWith({block:'nearest'});
});

it('focuses the visible Back button when an ordinary result header has collapsed',()=>{
 const back={focus:vi.fn(),scrollIntoView:vi.fn()},header={tagName:'HEADER',dataset:{artifactRegion:'Result controls'},closest:()=>null,getClientRects:()=>[{height:0}],contains:()=>false,querySelector:()=>back},root={querySelectorAll:()=>[header]} as unknown as HTMLElement;vi.stubGlobal('document',{activeElement:null});expect(cycleArtifactRegion(root,false)).toBe('Result controls');expect(back.focus).toHaveBeenCalledWith({preventScroll:true});expect(back.scrollIntoView).toHaveBeenCalledWith({block:'nearest'});
});
