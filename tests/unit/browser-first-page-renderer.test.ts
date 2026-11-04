import {expect,it,vi} from 'vitest';
vi.mock('react',async original=>{const fixture=await import('../support/controlled-renderer.fixture');return {...await original<typeof import('react')>(),...fixture.hooks};});
vi.mock('lucide-react',()=>({ArrowUpRight:()=>null}));
import {createElement} from 'react';
import type {Task} from '../../src/core/types';
import {emptyTaskSession} from '../../src/core/task-session';
import {BrowserActivity} from '../../src/renderer/src/components/BrowserTask';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';

function fixture(text='Visible saved page text.'){
 const observation={id:'first',taskId:'task',browserId:'browser',documentId:'document',url:'https://owned.invalid/selected',title:'Owned page',text,digest:'digest',targets:[]};
 const task:Task={id:'task',title:'Owned',goal:'',status:'active',createdAt:'time',updatedAt:'time',sources:[],artifacts:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false},requests:[{id:'request',kind:'browser',prompt:'Read this page.',digest:'request',sourceRefs:[],startedAt:'time',status:'completed'}],session:{...emptyTaskSession(),runs:[{id:'request',endpointKey:'fixture',origin:'https://owned.invalid',browserId:'browser',initialObservation:observation,operations:[]}]}};
 const inspect=vi.fn(),stop=vi.fn(),renderer=createControlledRenderer(()=>createElement(BrowserActivity,{task,requestId:'request',onInspect:inspect,onStop:stop}));return {task,renderer,inspect,stop};
}
const allText=(f:ReturnType<typeof fixture>)=>f.renderer.nodes().filter(node=>node.type==='#text').map(node=>node.props.text).join(' ');

it('shows the first saved page for a browser read with no action, without new dispatch',()=>{
 const f=fixture(),before=structuredClone(f.task);f.renderer.render();const text=allText(f);expect(text).toContain('First page read');expect(text).toContain('Owned page');expect(text).toContain('https://owned.invalid/selected');expect(text).toContain('Visible saved page text.');expect(text).toContain('may be out of date');expect(text).toContain('does not establish what happened after this page was read');expect(f.renderer.nodes().filter(node=>['button','a','form','input'].includes(node.type))).toEqual([]);expect(f.inspect).not.toHaveBeenCalled();expect(f.stop).not.toHaveBeenCalled();expect(f.task).toEqual(before);
});

it('keeps long saved text complete, keyboard-scrollable, and plainly marks an empty page',()=>{
 const content='Start\n'+('long unbroken content '.repeat(500))+'END_MARKER',f=fixture(content);f.renderer.render();const region=f.renderer.find(node=>node.props.role==='region'&&node.props['aria-label']==='Saved page text');expect(region.props.tabIndex).toBe(0);expect(region.children.map(child=>child.props.text).join('')).toBe(content);const empty=fixture('');empty.renderer.render();expect(allText(empty)).toContain('No page text was saved.');expect(empty.renderer.nodes().filter(node=>node.props.role==='region')).toEqual([]);
});

it('keeps uncertain action controls and binds the saved page to its task, run, and origin',()=>{
 const f=fixture(),session=f.task.session!,run=session.runs[0];f.task.session={...session,runs:[{...run,operations:[...run.operations,{id:'action',intent:{kind:'click',snapshotId:'first',targetId:'save'},reason:'Save once',status:'uncertain'}]}]};f.renderer.render();expect(allText(f)).toContain('First page read');expect(allText(f)).toContain('An earlier action needs review');expect(allText(f)).toContain('Inspect outcome');expect(f.inspect).not.toHaveBeenCalled();expect(f.stop).not.toHaveBeenCalled();
 for(const mismatch of ['task','browser','origin'] as const){const g=fixture(),session=g.task.session!,run=session.runs[0],page=run.initialObservation;g.task.session={...session,runs:[{...run,initialObservation:{...page,...(mismatch==='task'?{taskId:'other'}:mismatch==='browser'?{browserId:'other'}:{url:'https://other.invalid/page'})}}]};g.renderer.render();expect(allText(g)).not.toContain('First page read');expect(allText(g)).not.toContain('Visible saved page text.');}
});
