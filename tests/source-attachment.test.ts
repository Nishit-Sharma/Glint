import {describe,expect,it,vi} from 'vitest';
import {createSourceAttachmentGesture} from '../src/host/source-attachment';
import type {NativeWindow} from '../src/host/native';

const target:NativeWindow={id:'window:42',osId:42,title:'Synthetic document',owner:{name:'Synthetic',processId:123},bounds:{x:-800,y:50,width:600,height:500},displayId:'2',scaleFactor:2,documentToken:'metadata-42-v1',requiresExplicitCapture:true};
function fixture(){
 let key='task:a:requested:a:surface:1:context:1:privacy:1:ready:connection:1',anchor=true,time=100;
 const native={windowAtPoint:vi.fn(async():Promise<NativeWindow|undefined>=>target),inspect:vi.fn(async()=>target)};
 const bound:NativeWindow[]=[],checkTarget=vi.fn(async(_window:NativeWindow,guard:()=>void)=>{guard();});
 const attach=vi.fn(async(window:NativeWindow,guard:()=>void)=>{guard();bound.push(window);});
 const gesture=createSourceAttachmentGesture({native,own:()=>({processId:7,bundleId:'local.companion',executablePath:'/Companion'}),context:()=>({anchor,key}),now:()=>time,checkTarget,attach});
 return {native,gesture,bound,attach,checkTarget,change:()=>{key='task:b:requested:b:surface:2:context:2:privacy:2:changing:connection:2';},expand:()=>{anchor=false;},expire:()=>{time=15_100;}};
}
describe('exact source attachment, injected native metadata only',()=>{
 it('reviews the exact release hit before binding and never falls back to another window',async()=>{
  const f=fixture(),id=f.gesture.begin({x:20,y:20},['window:7']);
  expect(f.bound).toEqual([]);
  expect(await f.gesture.drop(id,{x:-400,y:100})).toEqual({kind:'attached',windowId:'window:42'});
  expect(f.bound).toEqual([target]);expect(f.checkTarget).toHaveBeenCalled();
  expect(await f.gesture.drop(id,{x:-400,y:100})).toEqual({kind:'cancelled'});
 });
 it.each(['missing','self','protected','recycled-owner','changed-document','occluder'] as const)('does not bind an unavailable release target: %s',async change=>{
  const f=fixture();
  if(change==='missing')f.native.windowAtPoint.mockResolvedValue(undefined);
  if(change==='self')f.native.windowAtPoint.mockResolvedValue({...target,owner:{name:'Companion',processId:7}});
  if(change==='protected')f.native.windowAtPoint.mockResolvedValue({...target,knownProtected:true});
  if(change==='recycled-owner')f.native.inspect.mockResolvedValue({...target,owner:{name:'Other',processId:999}});
  if(change==='changed-document')f.native.inspect.mockResolvedValue({...target,documentToken:'metadata-42-v2'});
  if(change==='occluder')f.native.windowAtPoint.mockResolvedValueOnce(target).mockResolvedValue({...target,id:'window:99',osId:99});
  expect(await f.gesture.drop(f.gesture.begin({x:20,y:20},['window:7']),{x:-400,y:100})).toEqual({kind:'no-target'});
  expect(f.bound).toEqual([]);
 });
 it('checks privacy before either title review or bind and fails closed without a predicate',async()=>{
  const f=fixture();f.checkTarget.mockRejectedValue(Error('This app is private. Its windows cannot be captured or sent.'));
  await expect(f.gesture.review({x:-400,y:100},()=>{},['window:7'])).rejects.toThrow('This app is private.');
  await expect(f.gesture.drop(f.gesture.begin({x:20,y:20},['window:7']),{x:-400,y:100})).rejects.toThrow('This app is private.');
  expect(f.bound).toEqual([]);
  const missing=createSourceAttachmentGesture({...{native:f.native,own:()=>({processId:7,bundleId:'local.companion',executablePath:'/Companion'}),context:()=>({anchor:true,key:'task:a'}),attach:f.attach},checkTarget:undefined!});
  await expect(missing.review({x:-400,y:100},()=>{},['window:7'])).rejects.toThrow('eligibility is unavailable');
 });
 it('retains ordinary clicks and makes cancellation perform no native lookup',async()=>{
  const f=fixture();expect(await f.gesture.drop(f.gesture.begin({x:20,y:20},['window:7']),{x:23,y:24})).toEqual({kind:'click'});
  const id=f.gesture.begin({x:20,y:20},['window:7']);f.gesture.cancel();expect(await f.gesture.drop(id,{x:-400,y:100})).toEqual({kind:'cancelled'});
  expect(f.native.windowAtPoint).not.toHaveBeenCalled();expect(f.bound).toEqual([]);
 });
 it.each(['changed-context','expanded','expired','cancelled'] as const)('discards a pending native result after %s',async change=>{
  const f=fixture();let resolve!:(window:NativeWindow)=>void;
  f.native.windowAtPoint.mockImplementationOnce(()=>new Promise(yes=>{resolve=yes;}));
  const pending=f.gesture.drop(f.gesture.begin({x:20,y:20},['window:7']),{x:-400,y:100});
  if(change==='changed-context')f.change();if(change==='expanded')f.expand();if(change==='expired')f.expire();if(change==='cancelled')f.gesture.cancel();
  resolve(target);expect(await pending).toEqual({kind:'cancelled'});expect(f.bound).toEqual([]);
 });
 it('does not duplicate a pending drop or let an old result retire a newer gesture',async()=>{
  const f=fixture();let resolve!:(window:NativeWindow)=>void;
  f.native.windowAtPoint.mockImplementationOnce(()=>new Promise(yes=>{resolve=yes;}));
  const old=f.gesture.begin({x:20,y:20},['window:7']),pending=f.gesture.drop(old,{x:-400,y:100});
  expect(await f.gesture.drop(old,{x:-400,y:100})).toEqual({kind:'cancelled'});
  const current=f.gesture.begin({x:20,y:20},['window:7']);resolve(target);expect(await pending).toEqual({kind:'cancelled'});
  expect(await f.gesture.drop(current,{x:-400,y:100})).toEqual({kind:'attached',windowId:'window:42'});expect(f.bound).toEqual([target]);
 });
 it('supplies an ownership guard to an awaiting metadata bind',async()=>{
  const f=fixture();let resolve!:()=>void;
  f.attach.mockImplementation(async(window,guard)=>{await new Promise<void>(yes=>{resolve=yes;});guard();f.bound.push(window);});
  const pending=f.gesture.drop(f.gesture.begin({x:20,y:20},['window:7']),{x:-400,y:100});
  await vi.waitFor(()=>expect(resolve).toBeTypeOf('function'));f.change();resolve();
  expect(await pending).toEqual({kind:'cancelled'});expect(f.bound).toEqual([]);
 });
 it('rechecks gesture ownership after an asynchronous privacy review',async()=>{
  const f=fixture();f.checkTarget.mockImplementation(async()=>{f.change();});
  expect(await f.gesture.drop(f.gesture.begin({x:20,y:20},['window:7']),{x:-400,y:100})).toEqual({kind:'cancelled'});expect(f.bound).toEqual([]);
 });
 it('allows an exact committed bind to expand its own anchor',async()=>{
  const f=fixture();f.attach.mockImplementation(async(window,guard)=>{guard();f.bound.push(window);f.expand();});
  expect(await f.gesture.drop(f.gesture.begin({x:20,y:20},['window:7']),{x:-400,y:100})).toEqual({kind:'attached',windowId:'window:42'});
 });
 it.each([NaN,Infinity,1_000_001])('rejects invalid desktop points before lookup: %s',async x=>{
  const f=fixture();expect(()=>f.gesture.begin({x,y:20},['window:7'])).toThrow();
  await expect(f.gesture.review({x,y:20},()=>{},['window:7'])).rejects.toThrow();expect(f.native.windowAtPoint).not.toHaveBeenCalled();
 });
});
