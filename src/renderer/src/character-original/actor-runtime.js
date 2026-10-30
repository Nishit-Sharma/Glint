import {createOriginalView} from './core.js';

let serial=0;
const personalities={
 soup:{lift:.15,tilt:.045,squish:.03,ms:1080},
 onigiri:{lift:.085,tilt:.075,squish:.018,ms:1250},
 mushroom:{lift:.11,tilt:.025,squish:.033,ms:1160},
 star:{lift:.14,tilt:.10,squish:.02,ms:1320},
 sprout:{lift:.12,tilt:.08,squish:.024,ms:1420},
};

export function mountOriginal(canvas,look,onFailure=()=>{},options={}){
 const mq=matchMedia('(prefers-reduced-motion:reduce)'),v=createOriginalView(canvas,look);
 const playful=options.activity==='playful',personality=personalities[look.shape]??personalities.soup;
 let seed=(++serial*2654435761+(options.seed??0)*1013904223)>>>0;
 for(let i=0;i<look.shape.length;i++)seed=(seed*31+look.shape.charCodeAt(i))>>>0;
 function random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
 // Leave room for the hop and its floor shadow inside the same stable canvas.
 if(playful){v.camera.zoom=.86;v.camera.updateProjectionMatrix();}
 const yaw=Math.atan2(v.camera.position.x,v.camera.position.z),pitch=-Math.atan2(v.camera.position.y-v.m.baseline.y-v.m.eyes[0].position.y,Math.hypot(v.camera.position.x,v.camera.position.z));
 let frame=null,idle=null,release=null,hidden=false,paused=!look.motion,destroyed=false,last=0,gx=0,gy=0,bx=0,by=0,tx=0,ty=0,near=false,phase='ready',reaction=null,gesture=null,idleSide=-1,io,resize;
 let color=look.color,colorDirty=false,paintDirty=false,px=0,py=0,pbx=0,pby=0;
 let frames=0,firstIdle=true,lastAcknowledged=-Infinity,paintBlink=1,paintTilt=0,paintSquish=0,paintLift=0;
 function stop(){clearTimeout(idle);clearTimeout(release);cancelAnimationFrame(frame);frame=idle=release=null;last=0;reaction=gesture=null;near=false;}
 function destroy(){if(destroyed)return;destroyed=true;stop();io?.disconnect();resize?.disconnect();document.removeEventListener('pointermove',pointer);document.removeEventListener('pointerleave',leave);document.removeEventListener('visibilitychange',visibility);mq.removeEventListener('change',reduce);canvas.removeEventListener('webglcontextlost',lost);v.dispose();}
 function fail(error){if(destroyed)return;destroy();onFailure(error);}
 function paint(x,y,bodyX=x,bodyY=y,blink=1,tilt=0,squish=0,lift=0){
  if(destroyed)return;
  px=x;py=y;pbx=bodyX;pby=bodyY;paintBlink=blink;paintTilt=tilt;paintSquish=squish;paintLift=lift;
  if(document.hidden||hidden){paintDirty=true;return;}
  try{
   const m=v.m;v.held=false;v.lift=lift;
   m.group.position.set(bodyX*.055,m.baseline.y,0);
   m.group.rotation.set(pitch-bodyY*.09,yaw+bodyX*.19,-bodyX*.065+tilt);
   m.group.scale.set(1+squish,1-squish*1.3,1+squish*.4);
   m.gaze(x,y,blink);if(phase==='waiting')m.eyes[1].scale.y*=.83;
   v.render();frames++;colorDirty=paintDirty=false;
  }catch(error){fail(error);}
 }
 function repaintPending(){if((colorDirty||paintDirty)&&!destroyed&&!document.hidden&&!hidden)paint(px,py,pbx,pby,paintBlink,paintTilt,paintSquish,paintLift);}
 function canRun(){return !destroyed&&!document.hidden&&!hidden&&!paused&&!mq.matches;}
 function wake(){if(frame!==null||!canRun())return;frame=requestAnimationFrame(tick);}
 function restTarget(){tx=phase==='working'?-.24:0;ty=phase==='working'?-.12:0;}
 function tick(now){
  frame=null;if(!canRun())return;
  const dt=last?Math.min(.05,(now-last)/1000):1/30;last=now;
  const e=1-Math.exp(-11*dt),b=1-Math.exp(-6*dt);
  gx+=(tx-gx)*e;gy+=(ty-gy)*e;bx+=(tx-bx)*b;by+=(ty-by)*b;
  let blink=1,tilt=phase==='waiting'?.055:0,squish=Math.min(.018,Math.abs(tx-bx)*.022),lift=0;
  if(reaction){
   const q=Math.min(1,(now-reaction.start)/reaction.ms),a=Math.sin(q*Math.PI);
   blink=Math.max(.1,1-a*.9);if(reaction.kind==='ack')tilt-=a*.06;
   if(q===1)reaction=null;
  }
  if(gesture){
   const q=Math.min(1,(now-gesture.start)/gesture.ms),a=Math.sin(q*Math.PI);
   tilt+=Math.sin(q*Math.PI*2)*gesture.tilt*gesture.side;
   if(playful){
    if(q<.16)squish+=Math.sin(q/.16*Math.PI)*gesture.squish;
    else if(q<.72){const flight=Math.sin((q-.16)/.56*Math.PI);lift=flight*gesture.lift;squish-=flight*.012;}
    else if(q<.9)squish+=Math.sin((q-.72)/.18*Math.PI)*gesture.squish*.8;
   }else squish+=a*.007;
   if(q===1)gesture=null;
  }
  paint(gx,gy,bx,by,blink,tilt,squish,lift);
  if(reaction||gesture||Math.abs(tx-gx)+Math.abs(ty-gy)+Math.abs(tx-bx)+Math.abs(ty-by)>.002)wake();
  else{last=0;schedule();}
 }
 function startGesture(acknowledging=false){
  firstIdle=false;
  gesture={start:performance.now(),ms:playful?personality.ms:1250+random()*350,side:idleSide,tilt:playful?personality.tilt:acknowledging?.035:.02,lift:playful?personality.lift:0,squish:personality.squish};
  idleSide*=-1;
 }
 function schedule(){
  clearTimeout(idle);idle=null;if(!canRun())return;
  const delay=playful?(firstIdle?350+random()*1850:3200+random()*3400):5600+random()*4200;
  idle=setTimeout(()=>{
   idle=null;firstIdle=false;
   if(!near&&phase!=='working'){
    tx=idleSide*(playful?.14:.24);ty=.04;
    clearTimeout(release);release=setTimeout(()=>{release=null;restTarget();wake();},520);
    startGesture();
   }
   reaction={kind:'blink',start:performance.now(),ms:240};wake();
  },delay);
 }
 function acknowledge(){
  const now=performance.now();if(!canRun()||gesture||now-lastAcknowledged<900)return;
  lastAcknowledged=now;clearTimeout(idle);idle=null;startGesture(true);wake();
 }
 function pointer(e){
  if(e.pointerType!=='mouse'||!canRun())return;
  const r=canvas.getBoundingClientRect();if(!r.width||!r.height)return;
  const dx=e.clientX-r.left-r.width/2,dy=e.clientY-r.top-r.height/2,distance=Math.hypot(dx,dy),radius=Math.max(90,Math.min(150,Math.max(r.width,r.height)*.65)),falloff=Math.max(0,1-Math.max(0,distance-radius)/320)**2;
  near=distance<=radius;clearTimeout(idle);idle=null;clearTimeout(release);
  if(falloff){tx=dx/Math.max(radius*.75,distance)*.62*falloff;ty=-dy/Math.max(radius*.75,distance)*.44*falloff;release=setTimeout(()=>{release=null;near=false;restTarget();wake();},1100);}
  else{release=null;near=false;restTarget();}wake();
 }
 function leave(){clearTimeout(release);release=null;near=false;restTarget();wake();}
 function visibility(){if(document.hidden)stop();else{restTarget();repaintPending();wake();schedule();}}
 function neutral(){gx=bx=0;gy=by=0;paint(gx,gy,bx,by);}
 function reduce(){stop();neutral();schedule();}
 function lost(event){event.preventDefault();fail(new Error('Character WebGL context lost.'));}
 try{
  canvas.addEventListener('webglcontextlost',lost);
  document.addEventListener('pointermove',pointer,{passive:true});document.addEventListener('pointerleave',leave);document.addEventListener('visibilitychange',visibility);mq.addEventListener('change',reduce);
  resize=new ResizeObserver(()=>{if(destroyed||document.hidden)return;const w=canvas.clientWidth||320,h=canvas.clientHeight||320,dpr=Math.min(devicePixelRatio,2);if(w!==v.width||h!==v.height||dpr!==v.pixelRatio)paint(gx,gy,bx,by,paintBlink,paintTilt,paintSquish,paintLift);});resize.observe(canvas);
  io=new IntersectionObserver(([entry])=>{const wasHidden=hidden;hidden=!entry.isIntersecting;if(hidden)stop();else{if(wasHidden)restTarget();repaintPending();wake();schedule();}});io.observe(canvas);
  paint(gx,gy,bx,by);schedule();
 }catch(error){destroy();throw error;}
 return {
  setPhase(value){if(destroyed)return;phase=value;stop();restTarget();if(!canRun()){neutral();return;}reaction={kind:value==='ready'?'ack':'blink',start:performance.now(),ms:value==='ready'?450:240};wake();},
  acknowledge,
  setColor(value){if(destroyed)return;if(value!==color&&v.m.recolor(value)){color=value;colorDirty=true;}repaintPending();},
  pose(x,y,p={}){paused=true;stop();if(p.phase)phase=p.phase;paint(x,y,p.bx??x,p.by??y,p.blink??1,p.tilt??0,p.squish??0,p.lift??0);},
  pause(){if(destroyed)return;paused=true;stop();neutral();},
  resume(){if(destroyed)return;paused=false;restTarget();wake();schedule();},
  stats:()=>({frames,near,phase,eye:[gx,gy],body:[bx,by],active:frame!==null,idle:!!idle,destroyed,activity:playful?'playful':'quiet',lift:paintLift,gesture:!!gesture,color}),
  destroy,
 };
}
