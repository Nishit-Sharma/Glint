import {createOriginalView} from './core.js';

export function mountOriginal(canvas,look,onFailure=()=>{}){
 const mq=matchMedia('(prefers-reduced-motion:reduce)');
 const v=createOriginalView(canvas,look);
 const yaw=Math.atan2(v.camera.position.x,v.camera.position.z),pitch=-Math.atan2(v.camera.position.y-v.m.baseline.y-v.m.eyes[0].position.y,Math.hypot(v.camera.position.x,v.camera.position.z));
 let frame=null,idle=null,release=null,hidden=false,paused=!look.motion,destroyed=false,last=0,gx=0,gy=0,bx=0,by=0,tx=0,ty=0,near=false,phase='ready',reaction=null,idleSide=-1,io,resize;
 let frames=0;
 function stop(){clearTimeout(idle);clearTimeout(release);cancelAnimationFrame(frame);frame=idle=release=null;last=0;reaction=null;near=false;}
 function destroy(){if(destroyed)return;destroyed=true;stop();io?.disconnect();resize?.disconnect();document.removeEventListener('pointermove',pointer);document.removeEventListener('pointerleave',leave);document.removeEventListener('visibilitychange',visibility);mq.removeEventListener('change',reduce);canvas.removeEventListener('webglcontextlost',lost);v.dispose();}
 function fail(error){if(destroyed)return;destroy();onFailure(error);}
 function paint(x,y,bodyX=x,bodyY=y,{blink=1,tilt=0,squish=0}={}){if(destroyed)return;try{const m=v.m;v.held=false;m.group.position.set(bodyX*.055,m.baseline.y,0);m.group.rotation.set(pitch-bodyY*.09,yaw+bodyX*.19,-bodyX*.065+tilt);m.group.scale.set(1+squish,1-squish*1.3,1+squish*.4);m.gaze(x,y,blink);if(phase==='waiting')m.eyes[1].scale.y*=.83;v.render();frames++;}catch(error){fail(error);}}
 function canRun(){return !destroyed&&!document.hidden&&!hidden&&!paused&&!mq.matches;}
 function wake(){if(frame!==null||!canRun())return;frame=requestAnimationFrame(tick);}
 function restTarget(){tx=phase==='working'?-.24:0;ty=phase==='working'?-.12:0;}
 function tick(now){frame=null;if(!canRun())return;const dt=last?Math.min(.05,(now-last)/1000):1/30;last=now;const e=1-Math.exp(-11*dt),b=1-Math.exp(-6*dt);gx+=(tx-gx)*e;gy+=(ty-gy)*e;bx+=(tx-bx)*b;by+=(ty-by)*b;let blink=1,tilt=phase==='waiting'?.055:0,squish=Math.min(.018,Math.abs(tx-bx)*.022);if(reaction){const q=Math.min(1,(now-reaction.start)/reaction.ms),a=Math.sin(q*Math.PI);blink=Math.max(.1,1-a*.9);if(reaction.kind==='ack')tilt-=a*.06;if(q===1)reaction=null;}paint(gx,gy,bx,by,{blink,tilt,squish});if(reaction||Math.abs(tx-gx)+Math.abs(ty-gy)+Math.abs(tx-bx)+Math.abs(ty-by)>.002)wake();else{last=0;schedule();}}
 function schedule(){clearTimeout(idle);idle=null;if(canRun())idle=setTimeout(()=>{idle=null;if(!near&&phase!=='working'){tx=idleSide*.24;ty=.04;idleSide*=-1;clearTimeout(release);release=setTimeout(()=>{release=null;restTarget();wake();},520);}reaction={kind:'blink',start:performance.now(),ms:240};wake();},8500+Math.random()*5500);}
 function pointer(e){if(e.pointerType!=='mouse'||!canRun())return;const r=canvas.getBoundingClientRect();if(!r.width||!r.height)return;const dx=e.clientX-r.left-r.width/2,dy=e.clientY-r.top-r.height/2,distance=Math.hypot(dx,dy),radius=Math.max(90,Math.min(150,Math.max(r.width,r.height)*.65)),falloff=Math.max(0,1-Math.max(0,distance-radius)/320)**2;near=distance<=radius;clearTimeout(idle);idle=null;clearTimeout(release);if(falloff){tx=dx/Math.max(radius*.75,distance)*.62*falloff;ty=-dy/Math.max(radius*.75,distance)*.44*falloff;release=setTimeout(()=>{release=null;near=false;restTarget();wake();},1100);}else{release=null;near=false;restTarget();}wake();}
 function leave(){clearTimeout(release);release=null;near=false;restTarget();wake();}
 function visibility(){if(document.hidden)stop();else{restTarget();wake();schedule();}}
 function neutral(){gx=bx=0;gy=by=0;paint(gx,gy,bx,by);}
 function reduce(){stop();neutral();schedule();}
 function lost(event){event.preventDefault();fail(new Error('Character WebGL context lost.'));}
 try{
  canvas.addEventListener('webglcontextlost',lost);
  document.addEventListener('pointermove',pointer,{passive:true});document.addEventListener('pointerleave',leave);document.addEventListener('visibilitychange',visibility);mq.addEventListener('change',reduce);
  resize=new ResizeObserver(()=>{if(destroyed||document.hidden)return;const w=canvas.clientWidth||320,h=canvas.clientHeight||320,dpr=Math.min(devicePixelRatio,2);if(w!==v.width||h!==v.height||dpr!==v.pixelRatio)paint(gx,gy,bx,by);});resize.observe(canvas);
  io=new IntersectionObserver(([entry])=>{const wasHidden=hidden;hidden=!entry.isIntersecting;if(hidden)stop();else{if(wasHidden)restTarget();wake();schedule();}});io.observe(canvas);paint(gx,gy,bx,by);schedule();
 }catch(error){destroy();throw error;}
 return {setPhase(value){if(destroyed)return;phase=value;stop();restTarget();if(!canRun()){neutral();return;}reaction={kind:value==='ready'?'ack':'blink',start:performance.now(),ms:value==='ready'?450:240};wake();},pose(x,y,p={}){paused=true;stop();if(p.phase)phase=p.phase;paint(x,y,p.bx??x,p.by??y,p);},pause(){if(destroyed)return;paused=true;stop();neutral();},resume(){if(destroyed)return;paused=false;restTarget();wake();schedule();},stats:()=>({frames,near,phase,eye:[gx,gy],body:[bx,by],active:frame!==null,idle:!!idle,destroyed}),destroy};
}
