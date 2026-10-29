import {describe,expect,it,vi} from 'vitest';
import {NativeSourceAdapter,type NativeDependencies} from '../src/host/native';
import type {WindowPointTarget} from '../src/host/mac-window-target';
import {publicErrorMessage} from '../src/shared/public-messages';

function fixture(){
 const windowAtPoint=vi.fn<WindowPointTarget>(async()=>({osId:42,processId:123,knownProtected:false}));
 const deps:NativeDependencies&{windowAtPoint:WindowPointTarget}={platform:'darwin',permissionStatus:()=>({screen:'denied',accessibility:'not-granted',captureSupported:true}),openWindows:vi.fn(async()=>[{id:42,title:'Synthetic source',owner:{name:'Synthetic',processId:123},bounds:{x:-800,y:50,width:600,height:500}}]),getSources:vi.fn(async()=>[]),getDisplayMatching:()=>({id:2,bounds:{x:-1000,y:0,width:1000,height:900},scaleFactor:2}),captureWindow:vi.fn(async()=>Buffer.alloc(0)),resizePng:vi.fn(buffer=>buffer),windowAtPoint};
 return {adapter:new NativeSourceAdapter(deps),deps,windowAtPoint};
}
describe('production native adapter point selection, OS metadata substitute',()=>{
 it('matches exact ID/PID without pixels or a permission request',async()=>{
  const f=fixture();expect(await f.adapter.windowAtPoint({x:-400,y:100},['window:7'])).toMatchObject({id:'window:42',owner:{processId:123},knownProtected:false});
  expect(f.windowAtPoint).toHaveBeenCalledExactlyOnceWith({x:-400,y:100},[{osId:7,processId:process.pid}]);expect(f.deps.openWindows).toHaveBeenCalledWith({accessibilityPermission:false,screenRecordingPermission:false});expect(f.deps.getSources).not.toHaveBeenCalled();expect(f.deps.captureWindow).not.toHaveBeenCalled();
 });
 it('does not select through an unknown occluder or recycled window ID',async()=>{
  const f=fixture();f.windowAtPoint.mockResolvedValue({osId:42,processId:999,knownProtected:false});await expect(f.adapter.windowAtPoint({x:0,y:0},['window:7'])).rejects.toMatchObject({code:'WINDOW_UNAVAILABLE'});
  f.windowAtPoint.mockResolvedValue({osId:99,processId:123,knownProtected:false});await expect(f.adapter.windowAtPoint({x:0,y:0},['window:7'])).rejects.toMatchObject({code:'WINDOW_UNAVAILABLE'});expect(f.deps.captureWindow).not.toHaveBeenCalled();
 });
 it('retains protection and rejects an owned returned hit',async()=>{
  const f=fixture();f.windowAtPoint.mockResolvedValue({osId:42,processId:123,knownProtected:true});expect((await f.adapter.windowAtPoint({x:0,y:0},['window:7']))?.knownProtected).toBe(true);
  f.windowAtPoint.mockResolvedValue({osId:7,processId:process.pid,knownProtected:false});await expect(f.adapter.windowAtPoint({x:0,y:0},['window:7'])).rejects.toMatchObject({code:'WINDOW_UNAVAILABLE'});
 });
 it('keeps exact targeting unsupported without its backend and rejects invalid input before lookup',async()=>{
  const f=fixture();await expect(f.adapter.windowAtPoint({x:NaN,y:0},['window:7'])).rejects.toMatchObject({code:'INVALID_ARGUMENT'});await expect(f.adapter.windowAtPoint({x:0,y:0},['forged'])).rejects.toMatchObject({code:'INVALID_ARGUMENT'});expect(f.windowAtPoint).not.toHaveBeenCalled();
  Reflect.deleteProperty(f.deps,'windowAtPoint');await expect(f.adapter.windowAtPoint({x:0,y:0},['window:7'])).rejects.toMatchObject({code:'TARGET_UNSUPPORTED'});expect(f.deps.openWindows).not.toHaveBeenCalled();
 });
 it.each(['missing','changed-owner','unknown-status','backend-failure'] as const)('fails closed when exact-window protection is %s',async reason=>{
  const f=fixture();Object.assign(f.deps,{windowProtection:async()=>{
   if(reason==='missing')return undefined;
   if(reason==='changed-owner')return {osId:42,processId:999,knownProtected:false};
   if(reason==='unknown-status')return {osId:42,processId:123,knownProtected:undefined};
   throw Error('synthetic native lookup failed');
  }});
  await expect(f.adapter.inspectProtection('window:42',123)).rejects.toThrow();expect(f.deps.captureWindow).not.toHaveBeenCalled();
 });
 it('keeps the explicit keyboard recovery readable across host and renderer error formatting',()=>{
  const message=publicErrorMessage(Error('Native source targeting is unavailable on this platform. Choose a source explicitly.'));
  expect(message).toBe('Drag attachment is unavailable on this device. Press Down Arrow to choose a window.');expect(publicErrorMessage(message)).toBe(message);
 });
});
