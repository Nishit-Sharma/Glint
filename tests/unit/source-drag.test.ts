import {afterEach,describe,expect,it,vi} from 'vitest';
import {createNativeSourceDrag} from '../../src/host/source-drag';
import type {NativeWindow,Rect} from '../../src/host/native';
import type {SourceDragState} from '../../src/shared/source-drag';

const target:NativeWindow={id:'window:42',osId:42,title:'Synthetic document',owner:{name:'Synthetic',processId:123},bounds:{x:300,y:100,width:500,height:400},displayId:'1',scaleFactor:2,documentToken:'metadata-v1',requiresExplicitCapture:true};
afterEach(()=>vi.useRealTimers());
function fixture(){
 let point={x:20,y:20},bounds:Rect={x:0,y:0,width:74,height:64},context={anchor:true,key:'task:a:requested:a:surface:1:context:1:privacy:1:ready:connection:1'};
 const native={windowAtPoint:vi.fn(async():Promise<NativeWindow|undefined>=>target),inspect:vi.fn(async()=>target)},bound:NativeWindow[]=[],states:Array<{state:SourceDragState;target?:NativeWindow}>=[];
 const checkTarget=vi.fn(async(_window:NativeWindow,guard:()=>void)=>{guard();});
 const drag=createNativeSourceDrag({native,own:()=>({processId:7,bundleId:'local.companion',executablePath:'/Companion'}),context:()=>context,cursor:()=>point,bounds:()=>bounds,move:value=>{bounds=value;},ignoredWindowIds:()=>['window:7'],checkTarget,attach:async(window,guard)=>{guard();bound.push(window);},preview:(state,window)=>{states.push({state,...(window?{target:window}:{})});}});
 return {drag,native,checkTarget,bound,states,point:(value:typeof point)=>{point=value;},bounds:()=>bounds,context:(value:typeof context)=>{context=value;}};
}
describe('native host anchor gesture',()=>{
 it('preserves an ordinary click and binds only after a six-DIP drag and left release',async()=>{
  const f=fixture();expect(f.drag.mouse({type:'mouseDown',button:'left'})).toBe(false);expect(f.drag.mouse({type:'mouseUp',button:'left'})).toBe(false);
  f.drag.mouse({type:'mouseDown',button:'left'});f.point({x:23,y:24});f.drag.mouse({type:'mouseMove'});expect(f.native.windowAtPoint).not.toHaveBeenCalled();
  f.point({x:340,y:150});f.drag.mouse({type:'mouseMove'});expect(f.bounds()).toEqual({x:320,y:130,width:74,height:64});expect(f.bound).toEqual([]);
  expect(f.drag.mouse({type:'mouseUp',button:'left'})).toBe(true);await f.drag.settled();expect(f.bound).toEqual([target]);expect(f.states.at(-1)?.state).toEqual({kind:'idle'});
  f.drag.cancel();
 });
 it('reviews privacy and current exact identity before disclosing a preview title',async()=>{
  vi.useFakeTimers();const f=fixture();f.checkTarget.mockRejectedValue(Error('This app is private. Its windows cannot be captured or sent.'));
  f.drag.mouse({type:'mouseDown',button:'left'});f.point({x:340,y:150});f.drag.mouse({type:'mouseMove'});await vi.advanceTimersByTimeAsync(50);await f.drag.settled();
  expect(f.states.some(({state})=>state.kind==='target')).toBe(false);expect(f.states.at(-1)?.state).toEqual({kind:'blocked',message:'This app is private. Its windows cannot be captured or sent.'});expect(f.bound).toEqual([]);f.drag.cancel();
 });
 it('never previews through an occluder introduced during the review',async()=>{
  vi.useFakeTimers();const f=fixture();f.native.windowAtPoint.mockResolvedValueOnce(target).mockResolvedValue({...target,id:'window:43',osId:43});
  f.drag.mouse({type:'mouseDown',button:'left'});f.point({x:340,y:150});f.drag.mouse({type:'mouseMove'});await vi.advanceTimersByTimeAsync(50);await f.drag.settled();
  expect(f.states.some(({state})=>state.kind==='target')).toBe(false);expect(f.bound).toEqual([]);f.drag.cancel();
 });
 it('shows eligible metadata only after the bounded hover review and binds only at release',async()=>{
  vi.useFakeTimers();const f=fixture();f.drag.mouse({type:'mouseDown',button:'left'});f.point({x:340,y:150});f.drag.mouse({type:'mouseMove'});
  await vi.advanceTimersByTimeAsync(49);expect(f.native.windowAtPoint).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);await f.drag.settled();expect(f.states.at(-1)).toEqual({state:{kind:'target',title:'Synthetic document',ownerName:'Synthetic'},target});expect(f.bound).toEqual([]);f.drag.cancel();
 });
 it('resolves the release point again instead of binding its older hovered target',async()=>{
  vi.useFakeTimers();const f=fixture(),released={...target,id:'window:43',osId:43,title:'Released window',documentToken:'metadata-43-v1'};
  f.native.windowAtPoint.mockResolvedValueOnce(target).mockResolvedValueOnce(target).mockResolvedValue(released);f.native.inspect.mockResolvedValueOnce(target).mockResolvedValue(released);
  f.drag.mouse({type:'mouseDown',button:'left'});f.point({x:340,y:150});f.drag.mouse({type:'mouseMove'});await vi.advanceTimersByTimeAsync(50);await f.drag.settled();expect(f.states.at(-1)?.state.kind).toBe('target');
  f.point({x:500,y:150});f.drag.mouse({type:'mouseUp',button:'left'});await f.drag.settled();expect(f.bound).toEqual([released]);f.drag.cancel();
 });
 it('expires a stationary gesture at 15 seconds and restores only its owned anchor',async()=>{
  vi.useFakeTimers();const f=fixture();f.drag.mouse({type:'mouseDown',button:'left'});f.point({x:340,y:150});f.drag.mouse({type:'mouseMove'});
  await vi.advanceTimersByTimeAsync(15_000);await f.drag.settled();expect(f.states.at(-1)?.state).toEqual({kind:'idle'});expect(f.bounds()).toEqual({x:0,y:0,width:74,height:64});expect(f.bound).toEqual([]);expect(f.drag.mouse({type:'mouseUp',button:'left'})).toBe(false);
 });
 it.each(['task','requested-task','surface','context','privacy','health','connection'] as const)('cancels delayed preview after %s changes without restoring over a newer surface',async change=>{
  vi.useFakeTimers();const f=fixture();let resolve!:(value:NativeWindow)=>void;f.native.windowAtPoint.mockImplementationOnce(()=>new Promise(yes=>{resolve=yes;}));
  f.drag.mouse({type:'mouseDown',button:'left'});f.point({x:340,y:150});f.drag.mouse({type:'mouseMove'});await vi.advanceTimersByTimeAsync(50);
  f.context({anchor:false,key:`changed:${change}`});f.drag.cancel();resolve(target);await f.drag.settled();
  expect(f.states.some(({state})=>state.kind==='target')).toBe(false);expect(f.bounds()).toEqual({x:320,y:130,width:74,height:64});expect(f.bound).toEqual([]);
 });
 it('deduplicates left release while the exact native hit is pending',async()=>{
  const f=fixture();let resolve!:(value:NativeWindow)=>void;f.native.windowAtPoint.mockImplementationOnce(()=>new Promise(yes=>{resolve=yes;}));
  f.drag.mouse({type:'mouseDown',button:'left'});f.point({x:340,y:150});f.drag.mouse({type:'mouseMove'});expect(f.drag.mouse({type:'mouseUp',button:'left'})).toBe(true);expect(f.drag.mouse({type:'mouseUp',button:'left'})).toBe(true);
  resolve(target);await f.drag.settled();expect(f.bound).toEqual([target]);f.drag.cancel();
 });
 it('cancel during a pending drop prevents later binding or surface restoration',async()=>{
  const f=fixture();let resolve!:(value:NativeWindow)=>void;f.native.windowAtPoint.mockImplementationOnce(()=>new Promise(yes=>{resolve=yes;}));
  f.drag.mouse({type:'mouseDown',button:'left'});f.point({x:340,y:150});f.drag.mouse({type:'mouseMove'});f.drag.mouse({type:'mouseUp',button:'left'});f.drag.cancel();resolve(target);await f.drag.settled();
  expect(f.bound).toEqual([]);expect(f.states.at(-1)?.state).toEqual({kind:'idle'});expect(f.bounds()).toEqual({x:0,y:0,width:74,height:64});
 });
 it('does not let an old failure timeout erase a new drag preview',async()=>{
  vi.useFakeTimers();const f=fixture();f.native.windowAtPoint.mockResolvedValueOnce(undefined);
  f.drag.mouse({type:'mouseDown',button:'left'});f.point({x:340,y:150});f.drag.mouse({type:'mouseMove'});f.drag.mouse({type:'mouseUp',button:'left'});await f.drag.settled();
  f.point({x:20,y:20});f.drag.mouse({type:'mouseDown',button:'left'});f.point({x:340,y:150});f.drag.mouse({type:'mouseMove'});await vi.advanceTimersByTimeAsync(1_250);await f.drag.settled();
  expect(f.states.at(-1)?.state.kind).toBe('target');f.drag.cancel();
 });
 it('ignores right-button input and non-anchor surfaces',()=>{
  const f=fixture();f.drag.mouse({type:'mouseDown',button:'right'});f.point({x:340,y:150});expect(f.drag.mouse({type:'mouseUp',button:'right'})).toBe(false);
  f.context({anchor:false,key:'workspace'});f.drag.mouse({type:'mouseDown',button:'left'});expect(f.native.windowAtPoint).not.toHaveBeenCalled();expect(f.bound).toEqual([]);f.drag.cancel();
 });
 it('rejects malformed native cursor metadata before moving the anchor',()=>{
  const f=fixture();f.drag.mouse({type:'mouseDown',button:'left'});f.point({x:NaN,y:150});
  try{expect(()=>f.drag.mouse({type:'mouseMove'})).toThrow('Invalid desktop drop point.');expect(f.bounds()).toEqual({x:0,y:0,width:74,height:64});expect(f.native.windowAtPoint).not.toHaveBeenCalled();}
  finally{f.drag.cancel();}
 });
});

it('offers keyboard recovery after an unavailable drop without attaching a source',async()=>{
 vi.useFakeTimers();const f=fixture();f.native.windowAtPoint.mockResolvedValue(undefined);
 try{
  f.drag.mouse({type:'mouseDown',button:'left'});f.point({x:340,y:150});f.drag.mouse({type:'mouseMove'});f.drag.mouse({type:'mouseUp',button:'left'});await f.drag.settled();
  expect(f.states.at(-1)?.state).toEqual({kind:'blocked',message:'No eligible window here. Press Down Arrow to choose one.'});expect(f.bound).toEqual([]);
  await vi.advanceTimersByTimeAsync(4_999);expect(f.states.at(-1)?.state.kind).toBe('blocked');
  await vi.advanceTimersByTimeAsync(1);expect(f.states.at(-1)?.state.kind).toBe('idle');
 }finally{f.drag.cancel();}
});
