import {afterEach,expect,it,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('./controlled-renderer.fixture')).hooks}));
import {createElement} from 'react';
import {DocumentImport} from '../src/renderer/src/components/DocumentImport';
import {createControlledRenderer} from './controlled-renderer.fixture';
import type {Run} from '../src/renderer/src/ui';
afterEach(()=>vi.unstubAllGlobals());

it('keeps reviewed document text visible when the required selection save fails and dispatches no import',async()=>{
 const task={id:'owner',title:'Owned source-selection task',status:'active'} as any,run=vi.fn(async(command:any)=>command.type==='source.import.choose'?{kind:'review',attemptId:command.attemptId,format:'txt',byteLength:30,fileDigest:'a'.repeat(64),method:'plain-text',extractedAt:'2026-11-03T06:00:00.000Z',fileName:'Owned notes.txt',text:'Keep reviewed synthetic text',warnings:[]}:undefined),added=vi.fn();
 vi.stubGlobal('window',{companion:{invoke:vi.fn(async()=>undefined)}});
 const r=createControlledRenderer(()=>createElement(DocumentImport,{task,busy:false,run:run as unknown as Run,isCurrent:()=>true,beforeAdd:async()=>{throw Error('Owned synthetic selection failure');},onAdded:added,onCancel:()=>{}}));
 const text=(node:ReturnType<typeof r.find>):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
 r.render();r.find(node=>node.type==='button'&&text(node)==='Choose document…').props.onClick();for(let tick=0;tick<8;tick++)await Promise.resolve();r.render();
 r.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});for(let tick=0;tick<8;tick++)await Promise.resolve();r.render();
 expect(run.mock.calls.map(([command])=>command.type)).toEqual(['source.import.choose']);expect(added).not.toHaveBeenCalled();expect(r.find(node=>node.type==='textarea').props.value).toBe('Keep reviewed synthetic text');expect(r.nodes().map(text).join(' ')).toContain('selection or import could not be confirmed');
});
