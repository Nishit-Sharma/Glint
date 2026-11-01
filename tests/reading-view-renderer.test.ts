import {expect,it,vi} from 'vitest';
vi.mock('react',async original=>{const fixture=await import('./controlled-renderer.fixture');return {...await original<typeof import('react')>(),...fixture.hooks};});
vi.mock('../src/renderer/src/components/DocumentSpeech',()=>({DocumentSpeech:()=>null}));
import {createElement} from 'react';
import {ReadingView} from '../src/renderer/src/components/ReadingView';
import {createControlledRenderer} from './controlled-renderer.fixture';
import {defaultReadingPreferences} from '../src/shared/reading-view';
import type {Task} from '../src/core/types';
const task={id:'reading-owner',artifacts:[{id:'reading-text',revisions:[{revision:1,digest:'a'.repeat(64),title:'Synthetic reading text',content:'First line.\nSecond line.',mimeType:'text/plain',sourceRefs:[],createdAt:'2026-11-01T00:00:00Z'}]}],sources:[]} as unknown as Task;
const text=(node:any):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
async function settle(){for(let i=0;i<12;i++)await Promise.resolve();}
it('opens exactly the selected saved passage with presentation aids and exits without changing saved work',async()=>{
 const before=structuredClone(task),commands:any[]=[],onBack=vi.fn(),invoke=async(command:any)=>{commands.push(command);return defaultReadingPreferences() as any;};
 const r=createControlledRenderer(()=>createElement(ReadingView,{task,active:true,disabled:false,isCurrent:()=>true,invoke,onBack}));r.render();await settle();r.render();
 const input=r.find(node=>node.type==='textarea'&&node.props['aria-label']==='Select saved text');expect(input.props.readOnly).toBe(true);expect(input.props.value).toBe('First line.\nSecond line.');input.props.onSelect({currentTarget:{selectionStart:12,selectionEnd:24}});r.render();r.find(node=>node.type==='button'&&text(node)==='Read selected text').props.onClick();r.render();
 expect(text(r.find(node=>node.props['aria-label']==='Reading passage'))).toBe('Second line.');
 r.find(node=>node.type==='select'&&node.props['aria-label']==='Text size').props.onChange({target:{value:'30'}});r.render();expect(r.find(node=>node.props['aria-label']==='Reading passage').props.style.fontSize).toBe(30);
 r.find(node=>node.type==='button'&&text(node)==='Back to task').props.onClick();expect(onBack).toHaveBeenCalledOnce();expect(task).toEqual(before);expect(commands.map(command=>command.type)).toEqual(['reading.preferences.get']);
});
it('retains the selected saved version when a newer revision arrives and persists only explicit presentation choices',async()=>{
 let owner=structuredClone(task),preferences=defaultReadingPreferences();const commands:any[]=[],invoke=async(command:any)=>{commands.push(command);if(command.type==='reading.preferences.set'){preferences={...command.preferences,revision:preferences.revision+1};return {kind:'saved',current:preferences} as any;}return preferences as any;};
 const r=createControlledRenderer(()=>createElement(ReadingView,{task:owner,active:true,disabled:false,isCurrent:()=>true,invoke,onBack:()=>{}}));r.render();await settle();r.render();r.find(node=>node.type==='button'&&text(node)==='Read all saved text').props.onClick();r.render();
 owner={...owner,artifacts:[{...owner.artifacts[0],revisions:[...owner.artifacts[0].revisions,{...owner.artifacts[0].revisions[0],revision:2,digest:'b'.repeat(64),content:'New saved body must not replace selected old text.'}]}]};r.render();expect(text(r.find(node=>node.props['aria-label']==='Reading passage'))).toBe('First line.\nSecond line.');expect(commands.map(command=>command.type)).toEqual(['reading.preferences.get']);
 r.find(node=>node.type==='select'&&node.props['aria-label']==='Reading theme').props.onChange({target:{value:'contrast'}});r.render();r.find(node=>node.type==='select'&&node.props['aria-label']==='Passage focus').props.onChange({target:{value:'passage'}});r.render();const preventDefault=vi.fn();r.find(node=>node.props['aria-label']==='Reading passage').props.onKeyDown({key:'ArrowDown',preventDefault,currentTarget:{querySelector:()=>null}});r.render();expect(preventDefault).toHaveBeenCalledOnce();const reveal=vi.fn(),query=vi.fn(()=>({scrollIntoView:reveal}));r.find(node=>node.props['aria-label']==='Reading passage').props.ref.current={querySelector:query};r.find(node=>node.type==='button'&&text(node)==='Previous line').props.onClick();r.render();expect(query).toHaveBeenLastCalledWith('[data-reading-line="0"]');expect(reveal).toHaveBeenCalledWith({block:'nearest'});r.find(node=>node.type==='button'&&text(node)==='Next line').props.onClick();r.render();expect(query).toHaveBeenLastCalledWith('[data-reading-line="1"]');expect(r.nodes().filter(node=>node.props['data-reading-line']!==undefined).map(node=>node.props['data-focused'])).toEqual([false,true]);
 r.find(node=>node.type==='button'&&text(node)==='Save reading preferences').props.onClick();await settle();r.render();expect(preferences).toMatchObject({revision:1,theme:'contrast',focus:'passage'});expect(commands.at(-1)).toEqual({type:'reading.preferences.set',taskId:task.id,expectedRevision:0,preferences:{textSize:22,lineSpacing:1.8,theme:'contrast',focus:'passage'}});
});
