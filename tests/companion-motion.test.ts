import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {CharacterProfile} from '../src/shared/character-catalog';

type Sample={at:number;lift:number;tilt:number;scaleY:number;eyeX:number};
type View={camera:{position:{x:number;y:number;z:number};zoom:number;updateProjectionMatrix:()=>void};m:{baseline:{y:number};eyes:{position:{y:number};scale:{y:number}}[];group:{position:{set:(x:number,y:number,z:number)=>void};rotation:{set:(x:number,y:number,z:number)=>void};scale:{set:(x:number,y:number,z:number)=>void}};gaze:(x:number,y:number,blink:number)=>void;recolor:(color:string)=>boolean};lift:number;width:number;height:number;pixelRatio:number;render:()=>void;dispose:ReturnType<typeof vi.fn>;samples:Sample[]};
const fixture=vi.hoisted(()=>({views:[] as View[]}));
vi.mock('../src/renderer/src/character-original/core.js',()=>({createOriginalView:()=>{
 let tilt=0,scaleY=1,eyeX=0;
 const view:View={camera:{position:{x:1.2,y:1.5,z:4.8},zoom:1,updateProjectionMatrix:vi.fn()},m:{baseline:{y:.68},eyes:[{position:{y:.12},scale:{y:1}},{position:{y:.12},scale:{y:1}}],group:{position:{set:()=>{}},rotation:{set:(_x,_y,z)=>{tilt=z;}},scale:{set:(_x,y)=>{scaleY=y;}}},gaze:x=>{eyeX=x;},recolor:vi.fn(color=>['dough','iris','sage','apricot','rose','sky','butter'].includes(color))},lift:0,width:210,height:230,pixelRatio:1,samples:[],render:()=>{view.samples.push({at:performance.now(),lift:view.lift,tilt,scaleY,eyeX});},dispose:vi.fn()};
 fixture.views.push(view);return view;
}}));
import {queueActorMount} from '../src/renderer/src/actor-mount-queue';
import {fallbackMotion} from '../src/renderer/src/thumbnail-motion';
import {mountOriginal,type OriginalActor} from '../src/renderer/src/character-original/actor-runtime.js';

let doc:EventTarget&{hidden:boolean},media:EventTarget&{matches:boolean};
const intersections:{callback:IntersectionObserverCallback;disconnected:boolean}[]=[];
const actors:OriginalActor[]=[];
function mount(shape:CharacterProfile['look']['shape']='soup',activity:'quiet'|'playful'='quiet',motion=true,seed=0){
 const canvas=Object.assign(new EventTarget(),{clientWidth:210,clientHeight:230,getBoundingClientRect:()=>({left:0,top:0,width:210,height:230})}) as unknown as HTMLCanvasElement;
 const failed=vi.fn(),actor=mountOriginal(canvas,{shape,color:'dough',face:'curious',motion},failed,{activity,seed});actors.push(actor);
 return {actor,canvas,failed,view:fixture.views.at(-1)!};
}
function pointer(x:number,y:number){const event=Object.assign(new Event('pointermove'),{pointerType:'mouse',clientX:x,clientY:y});doc.dispatchEvent(event);}
function intersect(index:number,visible:boolean){intersections[index].callback([{isIntersecting:visible} as IntersectionObserverEntry],{} as IntersectionObserver);}
function advance(ms:number){vi.advanceTimersByTime(ms);}

beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(0);fixture.views.length=0;intersections.length=0;actors.length=0;
 doc=Object.assign(new EventTarget(),{hidden:false});media=Object.assign(new EventTarget(),{matches:false});
 vi.stubGlobal('document',doc);vi.stubGlobal('matchMedia',()=>media);vi.stubGlobal('devicePixelRatio',1);vi.stubGlobal('performance',{now:()=>Date.now()});
 vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>setTimeout(()=>callback(performance.now()),16));vi.stubGlobal('cancelAnimationFrame',(id:ReturnType<typeof setTimeout>)=>clearTimeout(id));
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
 vi.stubGlobal('IntersectionObserver',class{entry:{callback:IntersectionObserverCallback;disconnected:boolean};constructor(callback:IntersectionObserverCallback){this.entry={callback,disconnected:false};intersections.push(this.entry);}observe(){}unobserve(){}disconnect(){this.entry.disconnected=true;}});
});
afterEach(()=>{for(const actor of actors)actor.destroy();vi.useRealTimers();vi.unstubAllGlobals();});

describe('companion motion runtime contracts',()=>{
 it('all five playful companions leave the floor, have distinct gestures and rest on separate schedules',()=>{
  const shapes=['soup','onigiri','mushroom','star','sprout'] as const;
  const mounted=shapes.map((shape,index)=>mount(shape,'playful',true,index));advance(16000);
  const firstHops:number[]=[],peaks:number[]=[];
  for(const {actor,view} of mounted){
   const airborne=view.samples.filter(sample=>sample.lift>.02);expect(airborne.length).toBeGreaterThan(5);
   firstHops.push(airborne[0].at);peaks.push(Math.max(...airborne.map(sample=>sample.lift)));
   expect(Math.max(...airborne.map(sample=>sample.lift))).toBeLessThanOrEqual(.151);
   expect(view.samples.length).toBeLessThan(16_000/16*.65);
   expect(view.camera.zoom).toBe(.86);expect(actor.stats().destroyed).toBe(false);
  }
  expect(Math.max(...firstHops)-Math.min(...firstHops)).toBeGreaterThan(300);
  expect(new Set(peaks.map(peak=>peak.toFixed(2))).size).toBe(5);
 });
 it('reading, compact, preview and edge actors keep their feet down and sleep between subtle gestures',()=>{
  const {actor,view}=mount();actor.acknowledge();advance(2000);
  expect(actor.stats()).toMatchObject({active:false,idle:true,gesture:false,lift:0,activity:'quiet'});
  const count=view.samples.length;advance(250);expect(view.samples.length).toBe(count);
  advance(20000);expect(view.samples.every(sample=>sample.lift===0)).toBe(true);
  expect(Math.max(...view.samples.map(sample=>Math.abs(sample.scaleY-1)))).toBeLessThan(.02);
  expect(view.camera.zoom).toBe(1);
 });
 it('preserves nearby gaze and returns forward before sleeping after distant pointer input',()=>{
  const {actor}=mount();pointer(185,55);advance(180);expect(actor.stats().near).toBe(true);expect(actor.stats().eye[0]).toBeGreaterThan(.3);
  pointer(800,600);advance(1800);expect(actor.stats().active).toBe(false);expect(Math.abs(actor.stats().eye[0])).toBeLessThan(.02);
  const frames=actor.stats().frames;advance(250);expect(actor.stats().frames).toBe(frames);
 });
 it('motion-off and OS reduced motion prohibit automatic gestures and acknowledgments',()=>{
  const off=mount('star','playful',false);off.actor.acknowledge();advance(20000);expect(off.actor.stats()).toMatchObject({frames:1,active:false,idle:false,lift:0});
  media.matches=true;const reduced=mount('sprout','playful');reduced.actor.acknowledge();advance(20000);expect(reduced.actor.stats()).toMatchObject({frames:1,active:false,idle:false,lift:0});
  media.matches=false;media.dispatchEvent(new Event('change'));advance(3500);expect(reduced.view.samples.some(sample=>sample.lift>.02)).toBe(true);expect(off.actor.stats().active).toBe(false);
  media.matches=true;media.dispatchEvent(new Event('change'));const settled=reduced.actor.stats();expect(settled).toMatchObject({active:false,idle:false,lift:0});advance(10000);expect(reduced.actor.stats().frames).toBe(settled.frames);
 });
 it('hidden and offscreen surfaces cancel work, then return grounded and responsive',()=>{
  const {actor,view}=mount('soup','playful');actor.acknowledge();advance(400);expect(actor.stats().lift).toBeGreaterThan(.02);
  doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));const hidden=actor.stats().frames;advance(9000);expect(actor.stats().frames).toBe(hidden);
  doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));advance(16);expect(actor.stats().lift).toBe(0);
  intersect(0,false);const offscreen=view.samples.length;advance(9000);expect(view.samples.length).toBe(offscreen);
  intersect(0,true);advance(16);expect(actor.stats()).toMatchObject({lift:0,destroyed:false});pointer(30,90);advance(300);expect(actor.stats().eye[0]).toBeLessThan(-.25);
 });
 it('rapid hover/focus/selection acknowledgments finish one gesture instead of restarting it',()=>{
  const {actor,view}=mount('soup','playful');actor.acknowledge();actor.acknowledge();advance(400);actor.acknowledge();advance(1200);
  expect(actor.stats()).toMatchObject({active:false,idle:true,gesture:false,lift:0});expect(view.samples.some(sample=>sample.lift>.12)).toBe(true);
 });
 it('context loss releases work and reports a single fallback; later input cannot restart it',()=>{
  const {actor,canvas,failed,view}=mount('star','playful');actor.acknowledge();advance(300);
  canvas.dispatchEvent(new Event('webglcontextlost',{cancelable:true}));actor.destroy();actor.destroy();
  expect(failed).toHaveBeenCalledTimes(1);expect(view.dispose).toHaveBeenCalledTimes(1);expect(actor.stats()).toMatchObject({destroyed:true,active:false,idle:false});
  const frames=actor.stats().frames;pointer(40,50);actor.acknowledge();advance(30000);expect(actor.stats().frames).toBe(frames);expect(vi.getTimerCount()).toBe(0);expect(intersections[0].disconnected).toBe(true);
 });
});


describe('contained fallback artwork motion',()=>{
 function image(){return {dataset:{} as Record<string,string>,style:{setProperty:vi.fn()}} as unknown as HTMLImageElement;}
 it('keeps the artwork identified as a fallback while its image leaf breathes only when visible',()=>{
  const leaf=image(),release=fallbackMotion(leaf,true,59);
  expect(leaf.dataset.companionMotion).toBe('quiet');
  intersections[0].callback([{target:leaf,isIntersecting:true} as unknown as IntersectionObserverEntry],{} as IntersectionObserver);
  expect(leaf.dataset.motionVisible).toBe('true');doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));expect(leaf.dataset.motionVisible).toBe('false');
  doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));expect(leaf.dataset.motionVisible).toBe('true');
  release();expect(leaf.dataset.companionMotion).toBeUndefined();expect(leaf.dataset.motionVisible).toBeUndefined();expect(intersections[0].disconnected).toBe(true);
 });
 it('saved movement-off has no observer or animation; a later enabled fallback can move',()=>{
  const leaf=image(),release=fallbackMotion(leaf,false);expect(leaf.dataset.companionMotion).toBe('off');expect(intersections).toHaveLength(0);release();
  const enabled=fallbackMotion(leaf,true);expect(intersections).toHaveLength(1);enabled();
 });
 it('shares one observer, releases the last image and ignores a queued entry after unmount',()=>{
  const first=image(),second=image(),a=fallbackMotion(first,true),b=fallbackMotion(second,true);
  expect(intersections).toHaveLength(1);a();expect(intersections[0].disconnected).toBe(false);b();expect(intersections[0].disconnected).toBe(true);
  intersections[0].callback([{target:first,isIntersecting:true} as unknown as IntersectionObserverEntry],{} as IntersectionObserver);expect(first.dataset.motionVisible).toBeUndefined();
 });
});


describe('material updates keep actor ownership and pose',()=>{
 it('recolors the same live actor once without resetting gaze or a running gesture',()=>{
  const {actor,view}=mount('star','playful');actor.acknowledge();advance(400);const before=actor.stats();
  actor.setColor('iris');expect(fixture.views).toHaveLength(1);expect(view.m.recolor).toHaveBeenCalledTimes(1);expect(actor.stats()).toMatchObject({color:'iris',gesture:true,lift:before.lift,eye:before.eye,body:before.body});
  actor.setColor('iris');expect(view.m.recolor).toHaveBeenCalledTimes(1);expect(view.dispose).not.toHaveBeenCalled();
 });
 it('hidden updates retain the new color without drawing, while destroyed actors release ownership permanently',()=>{
  const {actor,view}=mount();doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));const before=actor.stats().frames;actor.setColor('sage');expect(actor.stats()).toMatchObject({color:'sage',frames:before});
  doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));advance(16);expect(actor.stats().frames).toBeGreaterThan(before);actor.destroy();const ended=actor.stats().frames;actor.setColor('rose');expect(actor.stats()).toMatchObject({color:'sage',frames:ended,destroyed:true});expect(view.dispose).toHaveBeenCalledTimes(1);
 });
});

describe('picker setup queue',()=>{
 it('does no synchronous setup and yields a frame between every original actor constructor',()=>{
  const started:number[]=[];for(let i=0;i<5;i++)queueActorMount(()=>started.push(i));expect(started).toEqual([]);advance(16);expect(started).toEqual([0]);advance(16);expect(started).toEqual([0,1]);advance(48);expect(started).toEqual([0,1,2,3,4]);
 });
 it('cancels StrictMode-style throwaway mounts before allocating a context',()=>{
  const discarded=vi.fn(),started=vi.fn(),cancel=[];for(let i=0;i<5;i++)cancel.push(queueActorMount(discarded));for(const stop of cancel)stop();for(let i=0;i<5;i++)queueActorMount(started);advance(80);expect(discarded).not.toHaveBeenCalled();expect(started).toHaveBeenCalledTimes(5);
 });
 it('never starts a hidden or unmounted queued slot and releases an empty queue',()=>{
  const first=vi.fn(),hidden=vi.fn();queueActorMount(first);const cancel=queueActorMount(hidden);cancel();advance(64);expect(first).toHaveBeenCalledOnce();expect(hidden).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
 });
});


describe('deferred color repaint under stillness preferences',()=>{
 it('repaints once on document return when saved movement is disabled',()=>{
  const {actor}=mount('soup','quiet',false);doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));const before=actor.stats().frames;actor.setColor('iris');expect(actor.stats().frames).toBe(before);
  doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));expect(actor.stats()).toMatchObject({color:'iris',frames:before+1,active:false,idle:false});advance(1000);expect(actor.stats().frames).toBe(before+1);
 });
 it('repaints once on intersection return when OS reduced motion is enabled',()=>{
  media.matches=true;const {actor}=mount();intersect(0,false);const before=actor.stats().frames;actor.setColor('sage');expect(actor.stats().frames).toBe(before);intersect(0,true);expect(actor.stats()).toMatchObject({color:'sage',frames:before+1,active:false,idle:false});advance(1000);expect(actor.stats().frames).toBe(before+1);
 });
 it('waits for both document and intersection visibility, then consumes the dirty repaint only once',()=>{
  const {actor}=mount('soup','quiet',false);doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));intersect(0,false);const before=actor.stats().frames;actor.setColor('rose');doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));expect(actor.stats().frames).toBe(before);intersect(0,true);expect(actor.stats().frames).toBe(before+1);intersect(0,true);expect(actor.stats().frames).toBe(before+1);
 });
});

describe('picker setup document visibility',()=>{
 it('defers a hidden enqueue until visibility returns and cancels it without leaking work',()=>{
  doc.hidden=true;const start=vi.fn(),cancel=queueActorMount(start);
  try{expect(vi.getTimerCount()).toBe(0);advance(64);expect(start).not.toHaveBeenCalled();doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));advance(16);expect(start).toHaveBeenCalledOnce();}finally{cancel();}
 });
 it('guards the queued-start race even if no visibility event arrived before its animation frame',()=>{
  const start=vi.fn(),cancel=queueActorMount(start);doc.hidden=true;
  try{advance(16);expect(start).not.toHaveBeenCalled();doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));advance(16);expect(start).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);}finally{cancel();}
 });
});


describe('late neutral requests never draw a hidden actor',()=>{
 it('defers a queued no-preference media notification delivered after the document hides',()=>{
  media.matches=true;const {actor}=mount();doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));const before=actor.stats().frames;media.matches=false;media.dispatchEvent(new Event('change'));advance(1000);expect(actor.stats()).toMatchObject({frames:before,active:false,idle:false});doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));expect(actor.stats().frames).toBe(before+1);
 });
 it('defers a reduced-motion neutral draw while hidden and repaints once on return without animation',()=>{
  const {actor}=mount();actor.acknowledge();advance(200);doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));const before=actor.stats().frames;media.matches=true;media.dispatchEvent(new Event('change'));advance(1000);expect(actor.stats().frames).toBe(before);doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));expect(actor.stats()).toMatchObject({frames:before+1,active:false,idle:false,lift:0});advance(1000);expect(actor.stats().frames).toBe(before+1);
 });
 it('also defers late neutral media work while intersection-hidden',()=>{
  const {actor}=mount();intersect(0,false);const before=actor.stats().frames;media.matches=true;media.dispatchEvent(new Event('change'));advance(1000);expect(actor.stats()).toMatchObject({frames:before,active:false,idle:false});intersect(0,true);expect(actor.stats()).toMatchObject({frames:before+1,active:false,idle:false});advance(1000);expect(actor.stats().frames).toBe(before+1);
 });
 it('coalesces hidden pause/phase/explicit pose and color into one latest visible still pose',()=>{
  const {actor,view}=mount();doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));const before=actor.stats().frames;actor.pause();actor.setPhase('waiting');actor.pose(.3,-.2,{squish:.02});actor.setColor('iris');advance(1000);expect(actor.stats().frames).toBe(before);doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));expect(actor.stats()).toMatchObject({frames:before+1,active:false,idle:false,color:'iris'});expect(view.samples.at(-1)!.eyeX).toBe(.3);advance(1000);expect(actor.stats().frames).toBe(before+1);
 });
});
