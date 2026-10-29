import {timeline} from './vendor/transitions/ui-generation.js';
import {createLiveGenerationRegions} from './live-generation';

type Rect=Readonly<{left:number;top:number;right:number;bottom:number}>;
type ActorPartition=Readonly<{width:number;height:number;regions:readonly Rect[];valid:()=>boolean;close:()=>void}>;
type PartitionedScene=Readonly<{effectPlane:HTMLDivElement;ordinaryPlane:HTMLDivElement;release:()=>void}>;
const actorSelector='.character-slot[data-character-render]';
const visibleActors=(root:HTMLElement)=>[...root.querySelectorAll<HTMLElement>(actorSelector)].filter(node=>{const r=node.getBoundingClientRect();return r.width>0&&r.height>0&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight&&getComputedStyle(node).visibility!=='hidden';});
const maxPixels=4*1024*1024,maxDimension=8192,maxPngLength=32*1024*1024;

/** One native capture of this app. Actor patches stay outside the upstream sampler. */
export async function exitPresentation(exitId:string,signal:AbortSignal):Promise<(restore?:boolean)=>void>{
 const status=document.documentElement.dataset,media=matchMedia('(prefers-reduced-motion: reduce)');
 const root=document.getElementById('root'),visibility=root?.style.visibility,owner=root?.dataset.presentationOwner;
 const owns=()=>!signal.aborted&&(!root||root.dataset.presentationOwner===owner);
 const hideOriginal=()=>{if(!owns())return;if(root)root.style.visibility='hidden';window.dispatchEvent(new Event('companion:presentation-exit'));};
 const restoreOriginal=()=>{if(root&&root.dataset.presentationOwner===owner)root.style.visibility=visibility??'';};
 const layer=document.createElement('div');layer.setAttribute('aria-hidden','true');layer.dataset.presentationExitSnapshot='';
 Object.assign(layer.style,{position:'fixed',inset:'0',zIndex:'2147483647',pointerEvents:'none',overflow:'hidden'});
 let run:ReturnType<typeof timeline>|undefined,scene:PartitionedScene|undefined,lease:ActorPartition|undefined,frame=0,released=false;
 const cleanup=(restore=false)=>{if(!released){released=true;cancelAnimationFrame(frame);run?.destroy();scene?.release();lease?.close();layer.remove();}if(restore)restoreOriginal();};
 if(signal.aborted)return cleanup;
 try{
  if(media.matches){hideOriginal();status.presentationExit='reduced-motion';return cleanup;}
  lease=root?acquireActorPartition(root,signal):undefined;
  if(!lease)throw Error('Actor coverage is unsupported.');
  const dataUrl=await awaitOwnedSnapshot(exitId,signal);
  const size=pngSize(dataUrl),image=new Image();image.alt='';image.src=dataUrl;
  try{
   await decode(image,signal);
   if(!owns())return cleanup;
   if(!lease.valid()||image.naturalWidth!==size.width||image.naturalHeight!==size.height)throw Error('Capture coverage changed.');
   scene=await partitionScene(image,lease,signal);
  }finally{image.removeAttribute('src');}
  if(!owns())return cleanup;
  if(!lease.valid())throw Error('Capture coverage changed.');
  lease.close();
  // Prepare both planes before hiding. Entrance cancellation can restore opacity.
  layer.append(scene.effectPlane,scene.ordinaryPlane);document.body.append(layer);hideOriginal();
  run=timeline(scene.effectPlane,{variant:'image',duration:2000,parent:scene.effectPlane,particles:true});run.seek(run.end);
  status.presentationExit='running';
  const origin={x:screenX,y:screenY,width:innerWidth,height:innerHeight};
  await new Promise<void>(resolve=>{
   let start:number|undefined,done=false;
   const cancel=()=>finish('cancelled');
   const finish=(state:string)=>{if(done)return;done=true;signal.removeEventListener('abort',cancel);media.removeEventListener('change',cancel);document.removeEventListener('visibilitychange',cancel);window.removeEventListener('resize',cancel);status.presentationExit=state;cancelAnimationFrame(frame);resolve();};
   signal.addEventListener('abort',cancel,{once:true});media.addEventListener('change',cancel);document.addEventListener('visibilitychange',cancel);window.addEventListener('resize',cancel);
   const tick=(now:number)=>{start??=now;if(signal.aborted||media.matches||document.hidden||screenX!==origin.x||screenY!==origin.y||innerWidth!==origin.width||innerHeight!==origin.height){finish('cancelled');return;}const progress=Math.min(1,(now-start)/2000);scene!.ordinaryPlane.style.opacity=String(1-progress);run!.seek(run!.end*(1-progress));if(progress===1){run!.seek(-1);finish('finished');return;}frame=requestAnimationFrame(tick);};
   frame=requestAnimationFrame(tick);
  });
 }catch{if(!owns()){cleanup();return cleanup;}hideOriginal();status.presentationExit='skipped';scene?.release();layer.remove();}
 finally{lease?.close();}
 return cleanup;
}

function awaitOwnedSnapshot(exitId:string,signal:AbortSignal){return new Promise<string>((resolve,reject)=>{
 let done=false;
 const finish=(error?:unknown,dataUrl?:string)=>{if(done)return;done=true;unsubscribe();signal.removeEventListener('abort',abort);if(error)reject(error);else resolve(dataUrl??'');};
 const abort=()=>finish(new DOMException('Presentation cancelled','AbortError'));
 const unsubscribe=window.companion.subscribe(event=>{if(event.type==='presentation.exit'&&event.exitId===exitId)finish(undefined,event.dataUrl);});
 signal.addEventListener('abort',abort,{once:true});
 if(signal.aborted){abort();return;}
 void window.companion.invoke({type:'presentation.capture',exitId}).catch(finish);
});}

function decode(image:HTMLImageElement,signal:AbortSignal){return new Promise<void>((resolve,reject)=>{
 const abort=()=>{signal.removeEventListener('abort',abort);image.removeAttribute('src');reject(new DOMException('Presentation cancelled','AbortError'));};
 signal.addEventListener('abort',abort,{once:true});image.decode().then(()=>{signal.removeEventListener('abort',abort);resolve();},error=>{signal.removeEventListener('abort',abort);reject(error);});if(signal.aborted)abort();
});}

function pngSize(dataUrl:string){
 const prefix='data:image/png;base64,';
 if(!dataUrl.startsWith(prefix)||dataUrl.length>maxPngLength)throw Error('Invalid presentation PNG.');
 const header=atob(dataUrl.slice(prefix.length,prefix.length+32));
 if(header.length<24||header.slice(0,8)!=='\x89PNG\r\n\x1a\n'||header.slice(12,16)!=='IHDR')throw Error('Invalid presentation PNG.');
 const bytes=Uint8Array.from(header,c=>c.charCodeAt(0)),view=new DataView(bytes.buffer),width=view.getUint32(16),height=view.getUint32(20);
 if(!width||!height||width>maxDimension||height>maxDimension||width*height>maxPixels)throw Error('Presentation bitmap exceeds the allocation limit.');
 return {width,height};
}

function acquireActorPartition(root:HTMLElement,signal:AbortSignal):ActorPartition|undefined{
 const width=innerWidth,height=innerHeight,x=screenX,y=screenY,slots=visibleActors(root);
 if(!width||!height||slots.length>256||visualViewport&&visualViewport.scale!==1||document.fonts.status==='loading')return;
 const rect=(node:Element):Rect=>{const r=node.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom};};
 const intersects=(r:Rect)=>r.right>r.left&&r.bottom>r.top&&r.right>0&&r.bottom>0&&r.left<width&&r.top<height;
 const regions=slots.map(rect).filter(intersects),ancestors=new Set<HTMLElement>([root]);
 for(const slot of slots){if(!intersects(rect(slot)))continue;if(!/\b(paint|strict|content)\b/.test(getComputedStyle(slot).contain))return;for(let node:HTMLElement|null=slot;node;node=node.parentElement)ancestors.add(node);}
 const contained=(node:Node)=>slots.some(slot=>node!==slot&&slot.contains(node));
 const live=createLiveGenerationRegions(root),actorFree=live.regions.filter(region=>!slots.some(slot=>region.contains(slot)));
 const hidden=[...root.querySelectorAll<HTMLElement>('.app[hidden]')].filter(surface=>getComputedStyle(surface).display==='none');
 const protectedNodes=new Set<Node>(ancestors);for(const slot of slots)for(let node:HTMLElement|null=slot;node;node=node.parentElement)protectedNodes.add(node);
 const hiddenStable=()=>hidden.every(surface=>surface.isConnected&&root.contains(surface)&&surface.hidden&&getComputedStyle(surface).display==='none');
 // Content in a fixed, paint-contained actor-free viewport cannot move the
 // actor. Hidden surface identities are latched; their own mutations stay external.
 const isolated=(node:Node)=>!protectedNodes.has(node)&&!hidden.includes(node as HTMLElement)&&(live.contains(node,false)&&actorFree.some(region=>region!==node&&region.contains(node))||hidden.some(surface=>surface!==node&&surface.contains(node)));
 const supported=()=>{
  if(!live.stable()||!hiddenStable())return false;
  for(const node of ancestors){const style=getComputedStyle(node);if(style.filter!=='none'||style.backdropFilter!=='none'||style.transform!=='none'||style.perspective!=='none'||style.translate!=='none'||style.rotate!=='none'||style.scale!=='none'||Number(style.zoom)!==1||style.mixBlendMode!=='normal')return false;}
  return !root.getAnimations({subtree:true}).some(animation=>{const target=animation.effect instanceof KeyframeEffect?animation.effect.target:null;return (animation.playState==='running'||animation.pending)&&(!(target instanceof Node)||!contained(target)&&!isolated(target));});
 };
 if(!supported())return;
 const measured=new Map<Element,Rect>([...ancestors,...live.regions].map(node=>[node,rect(node)]));let invalid=false,closed=false;
 const invalidate=()=>{invalid=true;};
 const membership=(record:MutationRecord)=>record.type==='attributes'?record.attributeName==='data-character-render'||record.attributeName==='class'&&record.target instanceof Element&&record.target.hasAttribute('data-character-render'):record.type==='childList'&&[...record.addedNodes,...record.removedNodes].some(node=>node instanceof Element&&(node.matches(actorSelector)||node.querySelector(actorSelector)));
 const internal=(record:MutationRecord)=>!membership(record)&&(contained(record.target)||isolated(record.target)&&(!live.contains(record.target)||live.isInternalMutation(record)));
 const mutations=(records:MutationRecord[])=>{if(!live.stable()||!hiddenStable()||!records.every(internal))invalidate();};
 const observer=new MutationObserver(mutations);observer.observe(document.documentElement,{subtree:true,attributes:true,childList:true,characterData:true});
 const resize=new ResizeObserver(entries=>{if(entries.some(entry=>{const before=measured.get(entry.target);return before&&JSON.stringify(before)!==JSON.stringify(rect(entry.target));}))invalidate();});
 for(const node of measured.keys())resize.observe(node);
 const animation=(event:Event)=>{if(event.target instanceof Node&&(!live.stable()||!hiddenStable()||!contained(event.target)&&!isolated(event.target)))invalidate();};
 document.addEventListener('scroll',invalidate,true);window.addEventListener('scroll',invalidate,true);window.addEventListener('resize',invalidate);document.fonts.addEventListener('loading',invalidate);document.addEventListener('transitionrun',animation,true);document.addEventListener('animationstart',animation,true);visualViewport?.addEventListener('resize',invalidate);visualViewport?.addEventListener('scroll',invalidate);signal.addEventListener('abort',invalidate,{once:true});
 const close=()=>{if(closed)return;closed=true;observer.disconnect();resize.disconnect();document.removeEventListener('scroll',invalidate,true);window.removeEventListener('scroll',invalidate,true);window.removeEventListener('resize',invalidate);document.fonts.removeEventListener('loading',invalidate);document.removeEventListener('transitionrun',animation,true);document.removeEventListener('animationstart',animation,true);visualViewport?.removeEventListener('resize',invalidate);visualViewport?.removeEventListener('scroll',invalidate);signal.removeEventListener('abort',invalidate);};
 return {width,height,regions,close,valid:()=>{
  mutations(observer.takeRecords());
  if(signal.aborted||!root.isConnected||width!==innerWidth||height!==innerHeight||x!==screenX||y!==screenY||!supported())invalidate();
  const current=visibleActors(root);if(current.length!==slots.length||current.some((node,index)=>node!==slots[index]))invalidate();
  for(const [node,before] of measured)if(!node.isConnected||JSON.stringify(before)!==JSON.stringify(rect(node)))invalidate();
  return !invalid;
 }};
}

function pixelUnion(lease:ActorPartition,width:number,height:number):Rect[]{
 const boxes=lease.regions.map(r=>({left:Math.max(0,Math.floor(r.left*width/lease.width)-1),top:Math.max(0,Math.floor(r.top*height/lease.height)-1),right:Math.min(width,Math.ceil(r.right*width/lease.width)+1),bottom:Math.min(height,Math.ceil(r.bottom*height/lease.height)+1)}));
 const rows=[...new Set(boxes.flatMap(r=>[r.top,r.bottom]))].sort((a,b)=>a-b),union:Rect[]=[];
 for(let index=0;index<rows.length-1;index++){
  const top=rows[index],bottom=rows[index+1],spans=boxes.filter(r=>r.top<=top&&r.bottom>=bottom).sort((a,b)=>a.left-b.left);let span:Rect|undefined;
  for(const box of spans){if(span&&box.left<=span.right)span={...span,right:Math.max(span.right,box.right)};else{if(span)union.push(span);span={left:box.left,right:box.right,top,bottom};}}
  if(span)union.push(span);
 }
 return union;
}

async function partitionScene(snapshot:HTMLImageElement,lease:ActorPartition,signal:AbortSignal):Promise<PartitionedScene>{
 const width=snapshot.naturalWidth,height=snapshot.naturalHeight,regions=pixelUnion(lease,width,height),canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
 const effectPlane=document.createElement('div'),ordinaryPlane=document.createElement('div'),effect=new Image(),ordinary=new Image();
 const release=()=>{effect.removeAttribute('src');ordinary.removeAttribute('src');effectPlane.remove();ordinaryPlane.remove();canvas.width=canvas.height=0;};
 try{
  const context=canvas.getContext('2d');if(!context)throw Error('Presentation bitmap unavailable.');context.drawImage(snapshot,0,0);
  for(const r of regions)context.clearRect(r.left,r.top,r.right-r.left,r.bottom-r.top);
  effect.alt=ordinary.alt='';effect.src=canvas.toDataURL('image/png');canvas.width=canvas.height=0;
  if(effect.src.length>maxPngLength)throw Error('Presentation PNG exceeds the input limit.');
  ordinary.src=snapshot.src;
  await Promise.all([decode(effect,signal),decode(ordinary,signal)]);
  if(!lease.valid())throw Error('Capture coverage changed.');
  for(const plane of [effectPlane,ordinaryPlane])Object.assign(plane.style,{position:'absolute',inset:'0',overflow:'hidden'});
  for(const image of [effect,ordinary])Object.assign(image.style,{display:'block',width:'100%',height:'100%',objectFit:'fill'});
  effectPlane.dataset.presentationExitEffect='';ordinaryPlane.dataset.presentationExitOrdinary='';
  const path=regions.map(r=>{const left=r.left*lease.width/width,top=r.top*lease.height/height,w=(r.right-r.left)*lease.width/width,h=(r.bottom-r.top)*lease.height/height;return `M${left} ${top}h${w}v${h}h${-w}Z`;}).join('');
  // The upstream halftone paints transparent input, so exclude actors from its output too.
  const effectClip=`path(evenodd, 'M0 0H${lease.width}V${lease.height}H0Z${path}')`;
  if(!CSS.supports('clip-path',effectClip))throw Error('Presentation output clipping is unsupported.');
  Object.assign(effectPlane.style,{zIndex:'0',clipPath:effectClip});
  Object.assign(ordinaryPlane.style,{zIndex:'1',clipPath:path?`path('${path}')`:'inset(100%)'});effectPlane.append(effect);ordinaryPlane.append(ordinary);
  return {effectPlane,ordinaryPlane,release};
 }catch(error){release();throw error;}
}
