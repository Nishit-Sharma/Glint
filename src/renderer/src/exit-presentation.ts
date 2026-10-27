import {timeline} from './vendor/transitions/ui-generation.js';

/** Upstream supports backwards seek for its image timeline, not UI generate().
 * This is a transient snapshot of this app only. No source capture/network/storage. */
export async function exitPresentation(dataUrl:string,signal:AbortSignal):Promise<(restore?:boolean)=>void>{
 const status=document.documentElement.dataset;
 const media=matchMedia('(prefers-reduced-motion: reduce)');
 const root=document.getElementById('root'),visibility=root?.style.visibility,owner=root?.dataset.presentationOwner;
 const owns=()=>!signal.aborted&&(!root||root.dataset.presentationOwner===owner);
 const hideOriginal=()=>{if(!owns())return;if(root)root.style.visibility='hidden';window.dispatchEvent(new Event('companion:presentation-exit'));};
 const restoreOriginal=()=>{if(root&&root.dataset.presentationOwner===owner)root.style.visibility=visibility??'';};
 if(signal.aborted)return()=>{};
 if(media.matches){hideOriginal();status.presentationExit='reduced-motion';return(restore=false)=>{if(restore)restoreOriginal();};}
 if(!dataUrl.startsWith('data:image/png;base64,')||dataUrl.length>32*1024*1024){hideOriginal();status.presentationExit='skipped';return(restore=false)=>{if(restore)restoreOriginal();};}
 const layer=document.createElement('div'),image=new Image();
 Object.assign(layer.style,{position:'fixed',inset:'0',zIndex:'2147483647',pointerEvents:'none',overflow:'hidden'});
 layer.setAttribute('aria-hidden','true');layer.dataset.presentationExitSnapshot='';
 Object.assign(image.style,{display:'block',width:'100%',height:'100%',objectFit:'fill'});image.alt='';image.src=dataUrl;layer.append(image);
 let run:ReturnType<typeof timeline>|undefined,frame=0;
 try{
  await new Promise<void>((resolve,reject)=>{
   const abort=()=>{signal.removeEventListener('abort',abort);reject(new DOMException('Presentation cancelled','AbortError'));};
   signal.addEventListener('abort',abort,{once:true});
   image.decode().then(()=>{signal.removeEventListener('abort',abort);resolve();},error=>{signal.removeEventListener('abort',abort);reject(error);});
   if(signal.aborted)abort();
  });if(!owns())return()=>{};
  // Decode the captured visible phase first. Hide the real root before cancelling
  // an unfinished entrance: upstream cancel() restores its original opacity.
  // Doing that cancellation before decode paints the complete panel briefly.
  document.body.append(layer);hideOriginal();
  run=timeline(layer,{variant:'image',duration:2000,parent:layer,particles:true});run.seek(run.end);
  status.presentationExit='running';
  const origin={x:screenX,y:screenY,width:innerWidth,height:innerHeight};
  await new Promise<void>(resolve=>{
   let start:number|undefined,done=false;
   const cancel=()=>finish('cancelled');
   const finish=(state:string)=>{if(done)return;done=true;signal.removeEventListener('abort',cancel);media.removeEventListener('change',cancel);document.removeEventListener('visibilitychange',cancel);window.removeEventListener('resize',cancel);status.presentationExit=state;cancelAnimationFrame(frame);resolve();};
   signal.addEventListener('abort',cancel,{once:true});media.addEventListener('change',cancel);document.addEventListener('visibilitychange',cancel);window.addEventListener('resize',cancel);
   const tick=(now:number)=>{start??=now;if(signal.aborted||media.matches||document.hidden||screenX!==origin.x||screenY!==origin.y||innerWidth!==origin.width||innerHeight!==origin.height){finish('cancelled');return;}const elapsed=now-start;run!.seek(run!.end*(1-elapsed/2000));if(elapsed>=2000){run!.seek(-1);finish('finished');return;}frame=requestAnimationFrame(tick);};
   frame=requestAnimationFrame(tick);
  });
 }catch{if(!owns()){run?.destroy();layer.remove();return()=>{};}hideOriginal();status.presentationExit='skipped';}
 // Terminal quit never restores. Collapse may restore only after the host has
 // hidden/resized the native window and the anchor DOM has committed.
 return(restore=false)=>{cancelAnimationFrame(frame);run?.destroy();layer.remove();if(restore)restoreOriginal();};
}
