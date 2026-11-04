import {afterEach,expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...((await import('../support/controlled-renderer.fixture')).hooks)}));
const navigation=vi.hoisted(()=>({dirty:false,clear:vi.fn()}));
vi.mock('../../src/renderer/src/draft-navigation',()=>({useNavigationDraft:(dirty:boolean)=>{navigation.dirty=dirty;return navigation.clear;}}));
import {createElement} from 'react';
import {SystemSettings} from '../../src/renderer/src/SystemSettings';
import type {CompanionEvent} from '../../src/shared/bridge';
import type {SystemSettingsView} from '../../src/shared/system-settings';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';
afterEach(()=>vi.unstubAllGlobals());
const initial=():SystemSettingsView=>({saved:{kind:'available',source:'default',current:{revision:0,hardwareAcceleration:true}},launch:{kind:'requested',enabled:true,source:'default'},runtime:{kind:'pending',sequence:0},restartRequired:false});
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};

test('saves a next-launch choice without claiming runtime changed, and discards unsaved changes',async()=>{
 const view=initial(),commands:any[]=[];let event:(event:CompanionEvent)=>void=()=>{};
 vi.stubGlobal('window',{companion:{invoke:async(command:any)=>{commands.push(command);if(command.type==='system.settings.get')return view;if(command.type==='system.settings.update')return {kind:'saved',view:{...view,saved:{kind:'available',source:'file',current:{revision:1,hardwareAcceleration:false}},runtime:{kind:'observed',sequence:1,enabled:true},restartRequired:true}};throw Error('Unexpected command');},subscribe:(listener:typeof event)=>{event=listener;return()=>{};}}});
 const r=createControlledRenderer(()=>createElement(SystemSettings)),content=()=>r.nodes().filter(node=>node.type==='#text').map(node=>node.props.text).join(''),nodeText=(node:ReturnType<typeof r.find>):string=>node.type==='#text'?node.props.text:node.children.map(nodeText).join(''),button=(label:string)=>r.find(node=>node.type==='button'&&nodeText(node)===label),checkbox=()=>r.find(node=>node.type==='input');
 r.render();await settle();r.render();expect(content()).toContain('Pending · waiting');expect(checkbox().props.checked).toBe(true);expect(button('Save system setting').props.disabled).toBe(true);
 checkbox().props.onChange({target:{checked:false}});r.render();expect(navigation.dirty).toBe(true);button('Discard changes').props.onClick();r.render();expect(checkbox().props.checked).toBe(true);expect(commands).toHaveLength(1);
 checkbox().props.onChange({target:{checked:false}});r.render();event({type:'system.gpu-info',runtime:{kind:'observed',sequence:1,enabled:true}});r.render();expect(checkbox().props.checked).toBe(false);expect(navigation.dirty).toBe(true);
 r.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await settle();r.render();expect(commands.at(-1)).toEqual({type:'system.settings.update',expectedRevision:0,hardwareAcceleration:false});expect(content()).toContain('Restart required');expect(content()).toContain('Requested for this sessionOn');expect(content()).toContain('Current Electron runtimeOn');expect(checkbox().props.checked).toBe(false);expect(button('Save system setting').props.disabled).toBe(true);expect(navigation.dirty).toBe(false);
});

test('keeps newer GPU observations, preserves a conflicted draft, and discloses requested/runtime mismatch without restart promises',async()=>{
 let resolve!:(view:SystemSettingsView)=>void,event:(event:CompanionEvent)=>void=()=>{};
 vi.stubGlobal('window',{companion:{invoke:(command:any)=>command.type==='system.settings.get'?new Promise<SystemSettingsView>(done=>{resolve=done;}):Promise.resolve({kind:'conflict',view:{...initial(),saved:{kind:'available',source:'file',current:{revision:2,hardwareAcceleration:true}},runtime:{kind:'pending',sequence:0}}}),subscribe:(listener:typeof event)=>{event=listener;return()=>{};}}});
 const r=createControlledRenderer(()=>createElement(SystemSettings)),content=()=>r.nodes().filter(node=>node.type==='#text').map(node=>node.props.text).join('');
 r.render();event({type:'system.gpu-info',runtime:{kind:'observed',sequence:2,enabled:false}});resolve(initial());await settle();r.render();expect(content()).toContain('Current Electron runtimeOff');expect(content()).toContain('Hardware or driver support');expect(content()).not.toContain('Restart required');
 r.find(node=>node.type==='input').props.onChange({target:{checked:false}});r.render();r.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await settle();r.render();expect(content()).toContain('changed elsewhere');expect(r.find(node=>node.type==='input').props.checked).toBe(false);expect(navigation.dirty).toBe(true);expect(content()).toContain('Current Electron runtimeOff');
});

test('blocked conflict requires explicit reload before Discard can replace its old baseline',async()=>{
 const changed:SystemSettingsView={...initial(),saved:{kind:'available',source:'file',current:{revision:2,hardwareAcceleration:false}},restartRequired:true};let gets=0;
 vi.stubGlobal('window',{companion:{invoke:async(command:any)=>command.type==='system.settings.get'?(++gets===1?initial():changed):{kind:'conflict',view:changed},subscribe:()=>()=>{}}});
 const r=createControlledRenderer(()=>createElement(SystemSettings)),nodeText=(node:ReturnType<typeof r.find>):string=>node.type==='#text'?node.props.text:node.children.map(nodeText).join(''),button=(label:string)=>r.find(node=>node.type==='button'&&nodeText(node)===label);
 r.render();await settle();r.render();r.find(node=>node.type==='input').props.onChange({target:{checked:false}});r.render();r.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await settle();r.render();
 expect(r.find(node=>node.type==='input').props.checked).toBe(false);expect(navigation.dirty).toBe(true);expect(button('Discard changes').props.disabled).toBe(true);
 button('Load saved setting and replace these edits').props.onClick();await settle();r.render();expect(r.find(node=>node.type==='input').props.checked).toBe(false);expect(navigation.dirty).toBe(false);expect(button('Save system setting').props.disabled).toBe(true);
});
