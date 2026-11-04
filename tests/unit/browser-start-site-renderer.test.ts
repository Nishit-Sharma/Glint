import {expect,it,vi} from 'vitest';
vi.mock('react',async original=>{const fixture=await import('../support/controlled-renderer.fixture');return {...await original<typeof import('react')>(),...fixture.hooks};});
vi.mock('lucide-react',()=>({ArrowUpRight:()=>null}));
import {createElement} from 'react';
import type {Task} from '../../src/core/types';
import {Conversation} from '../../src/renderer/src/components/Conversation';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';

function fixture(status:Task['requests'][number]['status']='failed'){
 const task:Task={id:'owned',title:'Owned recovery',goal:'',status:'active',createdAt:'time',updatedAt:'time',sources:[],artifacts:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false},requests:[{id:'request',kind:'browser',prompt:'Read the selected page.',digest:'request-digest',sourceRefs:[],startedAt:'time',status,error:'Companion could not open its browser. Your task is kept.',browserStart:{origin:'https://owned-start.invalid',recordedAt:'owned-time'}}]},onInspect=vi.fn(),onStop=vi.fn(),onArtifact=vi.fn(),onConnection=vi.fn();
 const renderer=createControlledRenderer(()=>createElement(Conversation,{task,active:true,renderBrief:()=>null,onArtifact,onConnection,onInspectBrowser:onInspect,onStopBrowserInspection:onStop}));return {task,renderer,onInspect,onStop,onArtifact,onConnection};
}
it.each(['failed','cancelled','interrupted'] as const)('%s browser request shows its historical selected website without any retry/navigation control',status=>{
 const f=fixture(status),before=structuredClone(f.task);f.renderer.render();const text=f.renderer.nodes().filter(node=>node.type==='#text').map(node=>node.props.text).join(' ');expect(text).toContain('Starting website');expect(text).toContain('https://owned-start.invalid');expect(text).toContain('No first page observation was saved');expect(text).toContain('does not establish whether the page loaded or the website changed');expect(text).toContain('Nothing is retried automatically');expect(f.renderer.nodes().filter(node=>['button','a','input','form'].includes(node.type))).toEqual([]);expect(f.onInspect).not.toHaveBeenCalled();expect(f.onStop).not.toHaveBeenCalled();expect(f.onArtifact).not.toHaveBeenCalled();expect(f.onConnection).not.toHaveBeenCalled();expect(f.task).toEqual(before);
});
it.each(['running','completed','no-receipt','ordinary','has-observation'] as const)('does not fabricate missing-site recovery for %s requests',kind=>{
 const f=fixture();if(kind==='running'||kind==='completed')f.task.requests[0].status=kind;if(kind==='no-receipt')delete f.task.requests[0].browserStart;if(kind==='ordinary')f.task.requests[0].kind='explain';if(kind==='has-observation')f.task.session={revision:0,draft:'',moduleStates:[],runs:[{id:'request',endpointKey:'owned',origin:'https://owned-start.invalid',browserId:'browser',initialObservation:{id:'observed',taskId:'owned',browserId:'browser',documentId:'document',url:'https://owned-start.invalid/page',title:'Owned observed page',text:'Observed page',digest:'digest',targets:[]},operations:[]}]};f.renderer.render();expect(f.renderer.nodes().filter(node=>node.type==='#text').map(node=>node.props.text).join(' ')).not.toContain('Starting website');expect(f.onInspect).not.toHaveBeenCalled();
});
