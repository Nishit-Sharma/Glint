import {afterEach,expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...((await import('../support/controlled-renderer.fixture')).hooks)}));
const navigation=vi.hoisted(()=>({dirty:false,clear:vi.fn()}));
vi.mock('../../src/renderer/src/draft-navigation',()=>({useNavigationDraft:(dirty:boolean)=>{navigation.dirty=dirty;return navigation.clear;}}));
import {createElement} from 'react';
import type {HostStatus} from '../../src/shared/bridge';
import {FallbackShortcutSettings} from '../../src/renderer/src/FallbackShortcutSettings';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';
afterEach(()=>vi.unstubAllGlobals());
const initial:HostStatus={platform:'darwin',screenPermission:'denied',accessibilityPermission:'not-determined',shortcut:'Both Option keys',shortcutStatus:'unavailable',fallbackShortcut:'Control+Alt+F8',fallbackShortcutDefault:'Control+Shift+Space',fallbackShortcutStatus:'registered',captureMode:'explicit-frozen',memoryEnabled:false,dataDir:'/unused'};
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function renderer(host:()=>HostStatus|undefined,refresh=vi.fn()){
 const r=createControlledRenderer(()=>createElement(FallbackShortcutSettings,{host:host(),onRefresh:refresh})),text=(node:ReturnType<typeof r.find>):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
 return {r,refresh,button:(label:string)=>r.find(node=>node.type==='button'&&text(node)===label),input:()=>r.find(node=>node.type==='input'),content:()=>r.nodes().filter(node=>node.type==='#text').map(node=>node.props.text).join('')};
}
test('change/discard, save and host-default reset use actual reported bindings without capture or permission actions',async()=>{
 const commands:any[]=[];let host:HostStatus|undefined={...initial,fallbackShortcutDefault:undefined};
 vi.stubGlobal('window',{companion:{invoke:async(command:any)=>{commands.push(command);return {...initial,fallbackShortcut:command.type==='shortcut.reset'?'Control+Shift+Space':command.accelerator};}}});
 const {r,button,input,content}=renderer(()=>host);r.render();expect(button('Reset fallback to default').props.disabled).toBe(true);host=initial;r.render();button('Change fallback shortcut').props.onClick();r.render();input().props.onChange({target:{value:'Control+F11'}});r.render();expect(navigation.dirty).toBe(true);button('Discard shortcut changes').props.onClick();r.render();expect(commands).toEqual([]);button('Change fallback shortcut').props.onClick();r.render();expect(input().props.value).toBe(initial.fallbackShortcut);
 input().props.onChange({target:{value:'Control+Alt+Shift+F9'}});r.render();r.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await settle();r.render();expect(commands[0]).toEqual({type:'shortcut.set',accelerator:'Control+Alt+Shift+F9',expectedShortcut:'Control+Alt+F8'});expect(content()).toContain('Control+Alt+Shift+F9 · Registered');expect(navigation.dirty).toBe(false);
 button('Reset fallback to default').props.onClick();await settle();r.render();expect(commands[1]).toEqual({type:'shortcut.reset',expectedShortcut:'Control+Alt+Shift+F9'});expect(content()).toContain('Control+Shift+Space · Registered');expect(button('Reset fallback to default').props.disabled).toBe(true);expect(commands.every(command=>['shortcut.set','shortcut.reset'].includes(command.type))).toBe(true);
});
test('failed save retains the draft, blocks stale discard, and loads actual current registration only by explicit choice',async()=>{
 const commands:any[]=[];let reject!:(error:Error)=>void;
 vi.stubGlobal('window',{companion:{invoke:(command:any)=>{commands.push(command);return command.type==='shortcut.get'?Promise.resolve({...initial,fallbackShortcut:'Control+F12',fallbackShortcutStatus:'unavailable'}):new Promise((_resolve,fail)=>{reject=fail;});}}});
 const {r,button,input,content}=renderer(()=>initial);r.render();button('Change fallback shortcut').props.onClick();r.render();input().props.onChange({target:{value:'Control+F11'}});r.render();const submit=()=>r.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});submit();submit();expect(commands).toHaveLength(1);reject(Error('The fallback shortcut was published, but its durable save could not be confirmed. Load the current binding before changing it again.'));await settle();r.render();expect(input().props.value).toBe('Control+F11');expect(navigation.dirty).toBe(true);expect(button('Discard shortcut changes').props.disabled).toBe(true);
 button('Load current binding and replace these edits').props.onClick();await settle();r.render();expect(content()).toContain('Control+F12 · Unavailable');expect(commands.at(-1)).toEqual({type:'shortcut.get'});expect(navigation.dirty).toBe(false);button('Change fallback shortcut').props.onClick();r.render();expect(input().props.value).toBe('Control+F12');
});
