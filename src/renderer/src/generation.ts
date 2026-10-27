import {createLiveGenerationRegions} from './live-generation';
import {generate,type GenerationRun} from './vendor/transitions/ui-generation.js';

export type RevealOutcome={state:'settled'|'cancelled'|'skipped';reason:string};

/** Upstream measurement does not intersect ancestor scrollports. Exclude only
 * clipped drawing parts until its deferred measurement completes, then restore them.
 * The original runtime still wipes/fades the complete actual HTML surface.
 * No source DOM, upstream code, layout or scroll position is changed. */
function excludeClippedParts(root:HTMLElement){
 const skipped:Element[]=[],styles:{node:HTMLElement;css:string}[]=[];
 const geometry=[...root.querySelectorAll('*')].map(node=>({node,rect:node.getBoundingClientRect()})).filter(({rect})=>rect.width>0&&rect.height>0);
 const contains=(clip:{left:number;right:number;top:number;bottom:number},r:DOMRect)=>r.left>=clip.left-.5&&r.right<=clip.right+.5&&r.top>=clip.top-.5&&r.bottom<=clip.bottom+.5;
 for(const node of root.querySelectorAll('*')){
  if(node.closest('[data-t-generate-skip]'))continue;
  const clip={left:root.getBoundingClientRect().left,right:root.getBoundingClientRect().right,top:root.getBoundingClientRect().top,bottom:root.getBoundingClientRect().bottom};
  for(let parent=node.parentElement;parent&&parent!==root;parent=parent.parentElement){
   const style=getComputedStyle(parent),rect=parent.getBoundingClientRect();
   if(/auto|scroll|hidden|clip/.test(style.overflowX)){clip.left=Math.max(clip.left,rect.left+parent.clientLeft);clip.right=Math.min(clip.right,rect.left+parent.clientLeft+parent.clientWidth);}
   if(/auto|scroll|hidden|clip/.test(style.overflowY)){clip.top=Math.max(clip.top,rect.top+parent.clientTop);clip.bottom=Math.min(clip.bottom,rect.top+parent.clientTop+parent.clientHeight);}
  }
  const rect=node.getBoundingClientRect(),style=getComputedStyle(node);
  const outside=rect.bottom<=clip.top||rect.top>=clip.bottom||rect.right<=clip.left||rect.left>=clip.right;
  const paintedBox=/^(svg|IMG|CANVAS|VIDEO|INPUT|BUTTON|TEXTAREA|SELECT)$/.test(node.tagName)||parseFloat(style.borderTopWidth)>0||style.backgroundImage!=='none'||!['transparent','rgba(0, 0, 0, 0)'].includes(style.backgroundColor);
  const textRects=[...node.childNodes].filter(child=>child.nodeType===Node.TEXT_NODE&&child.textContent?.trim()).flatMap(child=>{const range=document.createRange();range.selectNodeContents(child);return [...range.getClientRects()];});
  if(outside||textRects.some(rect=>!contains(clip,rect))||(!contains(clip,rect)&&/^(svg|IMG|CANVAS|VIDEO|INPUT|BUTTON|TEXTAREA|SELECT)$/.test(node.tagName))){node.setAttribute('data-t-generate-skip','');skipped.push(node);}
  else if(!contains(clip,rect)&&paintedBox&&node instanceof HTMLElement){
   // The original runtime omits a filtered container's own box while still
   // measuring its children. A zero-radius blur uses that path without changing
   // border/legend geometry; it is removed before the runtime's first paint.
   styles.push({node,css:node.style.cssText});node.style.setProperty('filter',`${style.filter==='none'?'':style.filter+' '}blur(0px)`,'important');
  }
 }
 return {count:skipped.length,valid:()=>geometry.every(({node,rect})=>{const next=node.getBoundingClientRect();return Math.abs(next.x-rect.x)<.5&&Math.abs(next.y-rect.y)<.5&&Math.abs(next.width-rect.width)<.5&&Math.abs(next.height-rect.height)<.5;}),restore:()=>{skipped.forEach(node=>node.removeAttribute('data-t-generate-skip'));styles.forEach(({node,css})=>{node.style.cssText=css;});}};
}

function acknowledgeVisiblePieces(root:HTMLElement,excluded?:(target:HTMLElement)=>boolean){
 const bounds=root.getBoundingClientRect();
 for(const piece of root.querySelectorAll<HTMLElement>('[data-artifact-motion]')){
  if(excluded?.(piece))continue;
  const r=piece.getBoundingClientRect();let visible=r.width>0&&r.height>0&&r.left>=bounds.left-.5&&r.right<=bounds.right+.5&&r.top>=bounds.top-.5&&r.bottom<=bounds.bottom+.5;
  for(let parent=piece.parentElement;visible&&parent&&parent!==root;parent=parent.parentElement){const style=getComputedStyle(parent),rect=parent.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(style.overflowX)&&(r.left<rect.left+parent.clientLeft-.5||r.right>rect.left+parent.clientLeft+parent.clientWidth+.5))visible=false;if(/auto|scroll|hidden|clip/.test(style.overflowY)&&(r.top<rect.top+parent.clientTop-.5||r.bottom>rect.top+parent.clientTop+parent.clientHeight+.5))visible=false;}
  if(visible)piece.dispatchEvent(new Event('companion:artifact-covered'));
 }
}

/** Cosmetic lifecycle only. Neither runtime.finished nor onDone establishes model success. */
export function revealSection(element:HTMLElement,onState:(outcome:RevealOutcome|{state:'running';reason:string})=>void=()=>{},options:{scope?:'section'|'surface'|'artifact';variant?:'ui'|'image';live?:boolean|(()=>boolean)}={}){
 let run:GenerationRun|undefined,frame=0,initialLayerFrame=0,closed=false,base:DOMRect|undefined;
 const wholeSurface=options.scope==='surface',artifact=options.scope==='artifact',imageVariant=options.variant==='image',hold=wholeSurface||artifact,preparedOpacity=element.style.opacity;
 // Hold before first paint; the unmodified runtime then owns the real surface.
 if(hold)element.style.opacity='0';
 const media=matchMedia('(prefers-reduced-motion: reduce)');let origin={x:window.screenX,y:window.screenY},resetPreparation=()=>{};
 // Registered fixed slots may change after an initially idle measurement.
 // The original dotted anatomy remains a snapshot; the same ancestor wipe
 // reveals current content without restoring opacity or restarting the run.
 let live=wholeSurface?createLiveGenerationRegions(element):undefined;
 const liveNow=()=>typeof options.live==='function'?options.live():!!options.live;
 let excludedLiveAtMeasurement=false;
 const internal=(record:MutationRecord)=>!!live?.isInternalMutation(record);
 const sceneObserver=new MutationObserver(records=>{if(records.every(internal)&&live?.stable())return;element.dataset.surfaceSceneChange='DOM or text';cancel('scene changed');});
 let restoreMeasurement=()=>{},disconnectStyles=()=>{},disconnectLayer=()=>{},cancelPreparation=()=>{},cancelGesture=()=>{};
 let resolve!:(value:RevealOutcome)=>void;
 const finished=new Promise<RevealOutcome>(done=>{resolve=done;});
 const cleanup=(keepGesture=false)=>{window.removeEventListener('companion:presentation-exit',exit);cancelPreparation();if(!keepGesture)cancelGesture();cancelAnimationFrame(frame);cancelAnimationFrame(initialLayerFrame);sceneObserver.disconnect();disconnectStyles();disconnectLayer();restoreMeasurement();live?.restore();window.removeEventListener('resize',resize);window.removeEventListener('scroll',scroll,true);document.removeEventListener('visibilitychange',visibility);media.removeEventListener('change',motion);window.removeEventListener('pointerdown',pointer,true);window.removeEventListener('wheel',wheel,true);element.removeEventListener('focusin',interaction);element.removeEventListener('keydown',interaction,true);element.removeEventListener('click',interaction,true);};
 const end=(state:RevealOutcome['state'],reason:string)=>{if(closed)return;closed=true;cleanup(state==='settled');if(state!=='settled')run?.cancel();if(hold&&!run)element.style.opacity=preparedOpacity;const outcome={state,reason};onState(outcome);resolve(outcome);};
 const cancel=(reason='cancelled')=>{if(closed){cancelGesture();return;}end('cancelled',reason);};
 const exit=()=>cancel('application exit');window.addEventListener('companion:presentation-exit',exit);
 const resize=()=>{if(run)cancel('resize');else resetPreparation();},scroll=(event:Event)=>{if(live?.contains(event.target)&&live.stable())return;cancel('scroll');},motion=()=>cancel('motion preference changed');
 const visibility=()=>{if(document.hidden)cancel('document hidden');};
 const isExitControl=(target:EventTarget|null)=>wholeSurface&&target instanceof Element&&!!target.closest('[data-presentation-exit-control]');
 // Task/view restoration focuses the main reading region programmatically.
 // It is not a user interaction; pointer/key input still cancels immediately.
 const interaction=(event:Event)=>{const restoredReadingFocus=event.type==='focusin'&&event.target instanceof HTMLElement&&event.target.tagName==='MAIN'&&event.target.tabIndex<0;if(isExitControl(event.target)||event.type==='focusin'&&!run||restoredReadingFocus)return;cancel('interaction');};
 const wheel=(event:WheelEvent)=>{const rect=element.getBoundingClientRect();if(event.target instanceof Node&&element.contains(event.target)||event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom)cancel('interaction');};
 const pointer=(event:PointerEvent)=>{
  const rect=element.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)return;
  // A collapse gesture owns the presentation transition, not an ordinary
  // interaction cancellation. Keep the actual drawing alive for the host's
  // visible snapshot, even when clip-path excludes the underlying control.
  const exitControl=wholeSurface&&event.button===0&&event.isTrusted?[...element.querySelectorAll<HTMLElement>('[data-presentation-exit-control]')].find(control=>{const r=control.getBoundingClientRect();return !control.matches(':disabled')&&event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top&&event.clientY<=r.bottom;}):undefined;
  if(exitControl){
   cancelGesture();event.preventDefault();event.stopImmediatePropagation();let timer:ReturnType<typeof setTimeout>;
   const clear=()=>{clearTimeout(timer);window.removeEventListener('pointerup',up,true);window.removeEventListener('pointercancel',clear,true);window.removeEventListener('click',click,true);cancelGesture=()=>{};};
   const click=(next:MouseEvent)=>{if(!next.isTrusted)return;if(next.button===0&&Math.abs(next.clientX-event.clientX)<=5&&Math.abs(next.clientY-event.clientY)<=5){next.preventDefault();next.stopImmediatePropagation();}clear();};
   const up=(next:PointerEvent)=>{window.removeEventListener('pointerup',up,true);if(next.isTrusted&&next.button===0&&Math.abs(next.clientX-event.clientX)<=5&&Math.abs(next.clientY-event.clientY)<=5&&exitControl.isConnected&&!exitControl.matches(':disabled'))exitControl.click();setTimeout(clear,0);};
   window.addEventListener('pointerup',up,true);window.addEventListener('pointercancel',clear,true);window.addEventListener('click',click,true);cancelGesture=clear;timer=setTimeout(clear,10000);return;
  }
  // The runtime's clipPath can put the real control outside hit-testing. Observe
  // the physical gesture above the panel, restore it, then preserve this click.
  const wasInside=event.target instanceof Node&&element.contains(event.target);
  cancel('interaction');if(wasInside||event.button!==0||!event.isTrusted)return;
  const target=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('button,input,textarea,select,a[href],[tabindex]');
  if(!target||!element.contains(target)||target.matches(':disabled'))return;
  event.preventDefault();target.focus({preventScroll:true});
  let timer:ReturnType<typeof setTimeout>;
  const clear=()=>{clearTimeout(timer);window.removeEventListener('click',click,true);window.removeEventListener('pointercancel',clear,true);window.removeEventListener('pointerup',up,true);};
  const click=(next:MouseEvent)=>{clear();if(!next.isTrusted||next.button!==0||Math.abs(next.clientX-event.clientX)>5||Math.abs(next.clientY-event.clientY)>5)return;if(next.target instanceof Node&&element.contains(next.target))return;if(!target.isConnected||target.matches(':disabled')||document.elementFromPoint(next.clientX,next.clientY)?.closest('button,input,textarea,select,a[href],[tabindex]')!==target)return;next.preventDefault();next.stopImmediatePropagation();target.click();};
  const up=()=>{setTimeout(clear,0);};
  window.addEventListener('click',click,true);window.addEventListener('pointercancel',clear,true);window.addEventListener('pointerup',up,true);timer=setTimeout(clear,10000);
 };
 window.addEventListener('resize',resize);window.addEventListener('scroll',scroll,true);document.addEventListener('visibilitychange',visibility);media.addEventListener('change',motion);window.addEventListener('pointerdown',pointer,true);window.addEventListener('wheel',wheel,{capture:true,passive:true});element.addEventListener('focusin',interaction);element.addEventListener('keydown',interaction,true);element.addEventListener('click',interaction,true);
 const nextFrame=()=>new Promise<void>(done=>{requestAnimationFrame(()=>done());});
 const positionChanged=(rect:DOMRect)=>!base||Math.abs(rect.x-base.x)>.5||Math.abs(rect.y-base.y)>.5||Math.abs(rect.width-base.width)>.5||Math.abs(rect.height-base.height)>.5;
 const monitor=()=>{if(closed)return;const rect=element.getBoundingClientRect();if(!element.isConnected||positionChanged(rect)||live&&!live.stable()||window.screenX!==origin.x||window.screenY!==origin.y){cancel('geometry changed');return;}frame=requestAnimationFrame(monitor);};
 void(async()=>{
  try{
   await document.fonts.ready;
   const images=[...element.querySelectorAll('img')].filter(image=>!liveNow()||!live?.contains(image));
   try{await Promise.all(images.map(image=>image.decode().catch(error=>{if(imageVariant)throw error;})));}catch{end('skipped','image did not decode');return;}
   if(imageVariant&&(!images.length||images.some(image=>!image.naturalWidth))){end('skipped','image pixels unavailable');return;}
   // Motion's real composer has finite icon/layout work. Measure only after it
   // becomes quiet; do not repeatedly snapshot a changing inner layout.
   const stable=await new Promise<boolean>(done=>{let quiet:ReturnType<typeof setTimeout>;const observer=new MutationObserver(records=>{if(liveNow()&&records.every(internal)&&live?.stable())return;clearTimeout(quiet);quiet=setTimeout(check,80);});const finish=(value:boolean)=>{observer.disconnect();clearTimeout(quiet);clearTimeout(limit);cancelPreparation=()=>{};resetPreparation=()=>{};done(value);};const check=()=>{if(element.getAnimations({subtree:true}).some(animation=>!(liveNow()&&live?.contains((animation.effect as KeyframeEffect|null)?.target??null,false))&&animation.playState==='running'&&Number.isFinite(animation.effect?.getComputedTiming().endTime))){quiet=setTimeout(check,80);}else finish(true);};cancelPreparation=()=>finish(false);resetPreparation=()=>{clearTimeout(quiet);quiet=setTimeout(check,80);};const limit=setTimeout(()=>finish(false),2000);observer.observe(element,{childList:true,characterData:true,attributes:true,subtree:true,attributeFilter:['class','style','hidden','src','width','height']});quiet=setTimeout(check,80);});
   await nextFrame();await nextFrame();if(closed)return;if(!stable){end('skipped','layout did not settle');return;}
   // Placement may settle while fonts/images are pending. Establish boundary
   // geometry at measurement, then keep it immutable for this drawing.
   if(wholeSurface)live=createLiveGenerationRegions(element);
   origin={x:window.screenX,y:window.screenY};base=element.getBoundingClientRect();
   if(!element.isConnected||document.hidden||base.width<(wholeSurface||artifact?1:120)||base.height<(wholeSurface||artifact?1:40)||(!wholeSurface&&!artifact&&(base.width>620||base.height>240))||base.top<-.5||base.left<-.5||base.bottom>innerHeight+.5||base.right>innerWidth+.5){end('skipped','element outside visible area');return;}
   if(hold)element.style.opacity=preparedOpacity;
   excludedLiveAtMeasurement=!!live&&liveNow();
   if(excludedLiveAtMeasurement&&!live!.applySkip()){end('skipped','live viewport did not settle');return;}
   const clipped=wholeSurface&&!media.matches?excludeClippedParts(element):undefined;
   restoreMeasurement=()=>{clipped?.restore();live?.restore();restoreMeasurement=()=>{};};
   if(clipped&&!clipped.valid()){end('skipped','clipping changed layout');return;}
   const watchStyles=()=>{const observer=new MutationObserver(records=>{const changed=records.find(record=>record.target!==element&&!internal(record)&&!(imageVariant&&record.attributeName==='style'&&record.target instanceof HTMLImageElement));if(changed){element.dataset.surfaceSceneChange=`${(changed.target as Element).tagName}:${changed.attributeName}`;cancel('scene changed');}});observer.observe(element,{attributes:true,subtree:true,attributeFilter:['class','style','hidden','src','width','height']});disconnectStyles=()=>observer.disconnect();};
   if((wholeSurface||artifact)&&!media.matches){
    const observer=new MutationObserver(()=>{
     const owned=element as HTMLElement&{__tGenLayer?:HTMLElement;__tTigLayer?:HTMLElement};const layer=imageVariant?owned.__tTigLayer:owned.__tGenLayer;
     if(closed||!layer?.isConnected)return;
     observer.disconnect();
     // Upstream appends fully formed paths before its first tick. Hold only
     // that uninitialized overlay until its own already-queued tick runs.
     const initialOpacity=layer.style.opacity;layer.style.opacity='0';initialLayerFrame=requestAnimationFrame(()=>{if(!closed&&layer.isConnected)layer.style.opacity=initialOpacity;});
     layer.style.overflow='hidden';layer.dataset.clippedParts=String(clipped?.count??0);restoreMeasurement();watchStyles();
     if(wholeSurface)acknowledgeVisiblePieces(element,target=>excludedLiveAtMeasurement&&!!live?.contains(target));
    });
    observer.observe(document.body,{childList:true});disconnectLayer=()=>observer.disconnect();
   }
   run=generate(element,{variant:imageVariant?'image':'ui',mode:'skeleton',duration:3200,maxParts:wholeSurface?60:24,keys:wholeSurface?5:2});
   if((!wholeSurface&&!artifact)||media.matches){restoreMeasurement();watchStyles();}
   if(wholeSurface&&media.matches)acknowledgeVisiblePieces(element,target=>excludedLiveAtMeasurement&&!!live?.contains(target));
   sceneObserver.observe(element,{childList:true,characterData:true,subtree:true});
   onState({state:'running',reason:'started'});
   frame=requestAnimationFrame(monitor);
   await run.finished;if(!closed)end('settled','runtime ended');
  }catch{end('skipped','runtime unavailable');}
 })();
 return {finished,cancel};
}
