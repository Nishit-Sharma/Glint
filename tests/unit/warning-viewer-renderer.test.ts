import {afterEach,expect,test,vi} from 'vitest';
const lifecycle=vi.hoisted(()=>({cleanups:[] as Array<()=>void>}));
vi.mock('react',async original=>{const {hooks}=await import('../support/controlled-renderer.fixture');return {...await original<typeof import('react')>(),...hooks,useEffect:(effect:()=>void|(()=>void),deps?:readonly unknown[])=>hooks.useEffect(()=>{const dispose=effect();if(dispose){lifecycle.cleanups.push(dispose);return dispose;}},deps)};});
import {createElement} from 'react';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';
import {WarningViewer} from '../../src/renderer/src/WarningViewer';
import {WARNING_STORAGE_KEY,readWarningSnapshot,collectWarnings,hostWarningDiagnostics,type WarningStorage} from '../../src/renderer/src/warning-retention';
import type {HostStatus} from '../../src/shared/bridge';
const base:HostStatus={platform:'darwin',screenPermission:'unknown',accessibilityPermission:'unknown',shortcut:'Both Option keys',captureMode:'explicit-frozen',memoryEnabled:false,dataDir:'/test',modifierShortcutStatus:'permission-required',fallbackShortcut:'Control+Alt+G',fallbackShortcutStatus:'unavailable'};
const text=(node:{children:any[];props:Record<string,any>}):string=>node.props.text??node.children.map(text).join('');
afterEach(()=>vi.unstubAllGlobals());
function mount(initial:HostStatus=base,storage?:WarningStorage){
 const cleanupStart=lifecycle.cleanups.length;
 let requests=0,host=initial,raw:string|null=null,denied=false,gate:Promise<void>|undefined,release:(()=>void)|undefined;
 const listeners=new Set<(event:{key:string|null})=>void>(),inside={},outside={},document={activeElement:outside,visibilityState:'visible',hasFocus:()=>true};
 const data=storage??{getItem:()=>raw,setItem:(_key:string,value:string)=>{if(denied)throw Error('Storage denied');raw=value;}};
 vi.stubGlobal('localStorage',data);vi.stubGlobal('document',document);vi.stubGlobal('navigator',{locks:{request:async(_name:string,work:()=>unknown)=>{requests++;const waiting=gate;gate=undefined;if(waiting)await waiting;return work();}}});
 vi.stubGlobal('window',{addEventListener:(name:string,listener:(event:{key:string|null})=>void)=>{if(name==='storage')listeners.add(listener);},removeEventListener:(_name:string,listener:(event:{key:string|null})=>void)=>listeners.delete(listener)});
 const r=createControlledRenderer(()=>createElement(WarningViewer,{host}));r.render();const cleanup=lifecycle.cleanups.slice(cleanupStart);
 const native={open:false,showModal(){this.open=true;document.activeElement=inside;},close(){this.open=false;},contains:(element:unknown)=>element===inside};
 const dialog=()=>r.find(n=>n.type==='dialog');dialog().props.ref.current=native;
 r.find(n=>n.type==='button'&&n.props.ref).props.ref.current={focus:()=>{document.activeElement=outside;}};
 const button=(label:string)=>r.find(n=>n.type==='button'&&text(n)===label);
 async function settled(){await vi.waitFor(()=>{r.render();expect(r.find(n=>n.type==='button'&&['Close','Close without dismissing'].includes(text(n))).props.disabled).toBe(false);});r.render();}
 async function open(){await settled();r.find(n=>n.type==='button'&&text(n).startsWith('Warnings')).props.onClick();r.render();}
 const select=(index:number)=>{const nav=r.find(n=>n.type==='nav'&&n.props['aria-label']==='Warnings');nav.children[index].props.onClick();r.render();};
 const key=(extra:Record<string,unknown>={},editable=false)=>{const event={key:'k',altKey:false,ctrlKey:false,metaKey:false,shiftKey:false,repeat:false,nativeEvent:{isComposing:false},target:{closest:()=>editable?{}:null},preventDefault:vi.fn(),...extra};dialog().props.onKeyDown(event);r.render();return event;};
 return {r,button,native,document,inside,outside,select,key,open,settled,data,requests:()=>requests,unmount(){for(const dispose of cleanup)dispose();native.open=false;document.activeElement=outside;},read:()=>readWarningSnapshot(data.getItem(WARNING_STORAGE_KEY)),setHost(value:HostStatus){host=value;r.render();},deny(value:boolean){denied=value;},holdNext(){gate=new Promise<void>(resolve=>release=resolve);},release(){release?.();},storageChanged(){for(const listener of listeners)listener({key:WARNING_STORAGE_KEY});r.render();}};
}
test('mounted selected A remains reviewed through host arrival while B is selected; unseen C survives close',async()=>{
 const f=mount();await f.open();const [a,b]=f.read().warnings;f.select(1);
 f.setHost({...base,fallbackShortcut:'Control+Shift+G'});await f.settled();expect(f.read().warnings).toHaveLength(3);
 f.button('Close').props.onClick();await f.settled();expect(f.read().warnings.find(w=>w.id===a.id)?.state).toBe('dismissed');expect(f.read().warnings.find(w=>w.id===b.id)?.state).toBe('dismissed');expect(f.read().warnings[2].state).toBe('pending');expect(f.native.open).toBe(false);
});
test('mounted host arrivals queue behind a held Keep write, preserving each observed new warning',async()=>{
 const f=mount();await f.open();const first=f.read().warnings[0];f.holdNext();f.button('Keep for later').props.onClick();f.r.render();
 f.setHost({...base,fallbackShortcut:'Control+Shift+G'});f.setHost({...base,fallbackShortcut:'Control+Alt+H'});expect(f.read().warnings).toHaveLength(2);
 f.release();await f.settled();const saved=f.read();expect(saved.warnings.find(w=>w.id===first.id)?.state).toBe('kept');expect(saved.warnings).toHaveLength(4);expect(saved.warnings.slice(2).map(w=>w.state)).toEqual(['pending','pending']);
});
test('mounted k keeps idempotently and survives close/remount; explicit Stop keeping still works',async()=>{
 const f=mount();await f.open();const exact=f.read().warnings[0];expect(f.key().preventDefault).toHaveBeenCalledOnce();await f.settled();expect(f.read().warnings[0]).toEqual({...exact,state:'kept'});
 expect(f.key().preventDefault).toHaveBeenCalledOnce();await f.settled();expect(f.read().warnings[0].state).toBe('kept');f.button('Close').props.onClick();await f.settled();
 const reopened=mount(base,f.data);await reopened.open();expect(reopened.read().warnings[0]).toEqual({...exact,state:'kept'});reopened.button('Stop keeping').props.onClick();await reopened.settled();expect(reopened.read().warnings[0].state).toBe('pending');
});
test('mounted key ignores typing, modifiers, composition, repeat, background, hidden and closed viewer',async()=>{
 const f=mount();await f.open();
 for(const extra of [{altKey:true},{ctrlKey:true},{metaKey:true},{shiftKey:true},{repeat:true},{nativeEvent:{isComposing:true}},{key:'K'}])expect(f.key(extra).preventDefault).not.toHaveBeenCalled();
 expect(f.key({},true).preventDefault).not.toHaveBeenCalled();f.document.activeElement=f.outside;expect(f.key().preventDefault).not.toHaveBeenCalled();f.document.activeElement=f.inside;f.document.visibilityState='hidden';expect(f.key().preventDefault).not.toHaveBeenCalled();f.document.visibilityState='visible';
 f.button('Close').props.onClick();await f.settled();expect(f.key().preventDefault).not.toHaveBeenCalled();expect(f.read().warnings.some(w=>w.state==='kept')).toBe(false);
});
test('mounted write denial shows no false kept state, reload recovers, and conflict does not overwrite another window',async()=>{
 const f=mount();await f.open();const before=f.read();f.deny(true);f.button('Keep for later').props.onClick();await f.settled();expect(f.read()).toEqual(before);expect(f.r.nodes().some(n=>n.props.role==='alert')).toBe(true);expect(f.button('Keep for later').props.disabled).toBe(true);
 f.deny(false);f.button('Reload warning list').props.onClick();await f.settled();expect(f.r.nodes().some(n=>n.props.role==='alert')).toBe(false);
 const external={...f.read(),revision:'external-window',warnings:f.read().warnings.map((warning,index)=>index===1?{...warning,state:'kept' as const}:warning)};f.data.setItem(WARNING_STORAGE_KEY,JSON.stringify(external));f.button('Keep for later').props.onClick();await f.settled();expect(f.read()).toEqual(external);expect(f.r.nodes().some(n=>n.props.role==='alert')).toBe(true);
 f.button('Close without dismissing').props.onClick();f.r.render();expect(f.read()).toEqual(external);expect(f.native.open).toBe(false);
});
test('stale selected-warning click cannot keep a different selection and storage event requires reload',async()=>{
 const f=mount();await f.open();const old=f.button('Keep for later').props.onClick;f.select(1);old();await f.settled();expect(f.read().warnings.every(w=>w.state==='pending')).toBe(true);
 f.storageChanged();expect(f.r.nodes().some(n=>n.props.role==='alert')).toBe(true);expect(f.key().preventDefault).not.toHaveBeenCalled();
});

test('observed C persists in order across actual effect cleanup while Keep waits and D arrives on remount',async()=>{
 const f=mount();await f.open();f.holdNext();f.button('Keep for later').props.onClick();f.r.render();await vi.waitFor(()=>expect(f.requests()).toBe(2));
 f.setHost({...base,fallbackShortcut:'Control+Shift+C'});f.unmount();
 const reopened=mount({...base,fallbackShortcut:'Control+Shift+D'},f.data);f.release();await reopened.settled();
 const saved=reopened.read();expect(saved.warnings[0].state).toBe('kept');expect(saved.warnings.some(w=>w.message.includes('Control+Shift+C'))).toBe(true);expect(saved.warnings.some(w=>w.message.includes('Control+Shift+D'))).toBe(true);
 const active=Object.keys(saved.active);expect(active.some(key=>key.includes('Control+Shift+D'))).toBe(true);expect(active.some(key=>key.includes('Control+Shift+C'))).toBe(false);
});
test('a full valid list permits reviewed Close dismissal and then collects the pending new diagnostic',async()=>{
 let state=readWarningSnapshot(null),sequence=0;
 const ready={...base,modifierShortcutStatus:'ready' as const,shortcutStatus:'registered' as const};
 for(let i=0;i<64;i++)state=collectWarnings(state,hostWarningDiagnostics({...ready,fallbackShortcut:'old-'+i}),()=>String(++sequence),'2026-11-02T00:00:00Z');
 let raw=JSON.stringify(state);const data={getItem:()=>raw,setItem:(_key:string,value:string)=>{raw=value;}};
 const f=mount({...ready,fallbackShortcut:'new-arrival'},data);await f.open();expect(f.r.nodes().some(n=>n.props.role==='alert')).toBe(true);expect(f.read().warnings).toHaveLength(64);
 const first=f.read().warnings[0];f.button('Close').props.onClick();await f.settled();expect(f.read().warnings).toHaveLength(64);expect(f.read().warnings.some(w=>w.id===first.id)).toBe(false);expect(f.read().warnings.some(w=>w.message.includes('new-arrival')&&w.state==='pending')).toBe(true);expect(f.r.nodes().some(n=>n.props.role==='alert')).toBe(false);
});

test('all kept capacity requires explicit Stop keeping before Close frees space for a new warning',async()=>{
 let state=readWarningSnapshot(null),sequence=0;
 const ready={...base,modifierShortcutStatus:'ready' as const,shortcutStatus:'registered' as const};
 for(let i=0;i<64;i++)state=collectWarnings(state,hostWarningDiagnostics({...ready,fallbackShortcut:'kept-'+i}),()=>String(++sequence),'2026-11-02T00:00:00Z');
 state={...state,warnings:state.warnings.map(warning=>({...warning,state:'kept' as const}))};
 let raw=JSON.stringify(state);const data={getItem:()=>raw,setItem:(_key:string,value:string)=>{raw=value;}};
 const f=mount({...ready,fallbackShortcut:'new-after-release'},data);await f.open();const original=f.read().warnings[0];expect(f.button('Stop keeping').props.disabled).toBe(false);expect(f.key().preventDefault).not.toHaveBeenCalled();
 f.button('Stop keeping').props.onClick();await f.settled();expect(f.read().warnings.find(w=>w.id===original.id)?.state).toBe('pending');expect(f.r.nodes().some(n=>n.props.role==='alert')).toBe(true);expect(f.button('Keep for later').props.disabled).toBe(true);
 f.button('Close').props.onClick();await f.settled();expect(f.read().warnings).toHaveLength(64);expect(f.read().warnings.some(w=>w.id===original.id)).toBe(false);expect(f.read().warnings.filter(w=>w.state==='kept')).toHaveLength(63);expect(f.read().warnings.some(w=>w.message.includes('new-after-release')&&w.state==='pending')).toBe(true);expect(f.r.nodes().some(n=>n.props.role==='alert')).toBe(false);
});
