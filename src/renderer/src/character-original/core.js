import * as THREE from './vendor/three.module.min.js';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';
export function createOriginalView(canvas,look) {
 const resources=new Set();let rendererForDisposal;
 const own=resource=>{resources.add(resource);return resource;};
 const release=resource=>{if(resources.delete(resource))resource.dispose();};
 const dispose=()=>{for(const resource of [...resources].reverse()){try{release(resource);}catch{}}try{rendererForDisposal?.forceContextLoss();}catch{}};
 const palette={dough:'#d6b590',iris:'#8793d0',sage:'#81a993',apricot:'#d29b82',rose:'#c68d9e',sky:'#7aabca',butter:'#ccb66e'};
 const currentColor=palette[look.color],currentFace=look.face;
 const metrics={frames:0,models:{}};
 try {
function spow(x,n){return Math.sign(x)*Math.pow(Math.abs(x),n)}

// Original revolved pouch/capsule profiles; pleats are part of the surface, not decorative tubes.
function profileGeometry(kind){
 const profiles={
 soup:[[0,-.66],[.48,-.65],[.85,-.48],[.98,-.12],[.94,.22],[.86,.46],[.65,.66],[.32,.76],[.16,.81],[.17,.88],[0,.91]],
 sprout:[[0,-.70],[.58,-.67],[.86,-.34],[.81,.04],[.66,.35],[.42,.63],[.16,.88],[0,1.08]],
 mushroom:[[0,-.76],[.37,-.76],[.43,-.57],[.39,-.25],[.84,-.16],[1.03,-.08],[.98,.18],[.75,.58],[.39,.81],[0,.87]],
 bell:[[0,-.67],[.63,-.67],[.96,-.57],[.91,-.37],[.72,.03],[.62,.45],[.48,.72],[.24,.86],[0,.90]]
 };
 const curve=new THREE.CatmullRomCurve3(profiles[kind].map(([r,y])=>new THREE.Vector3(r,y,0)),false,'centripetal');
 const pts=curve.getPoints(80).map(v=>new THREE.Vector2(Math.max(0,v.x),v.y));
 const g=own(new THREE.LatheGeometry(pts,120)),p=g.attributes.position;
 for(let i=0;i<p.count;i++){let x=p.getX(i),y=p.getY(i),z=p.getZ(i),a=Math.atan2(z,x),r=Math.hypot(x,z);
  if(kind==='soup'){
   const envelope=THREE.MathUtils.smoothstep(y,.08,.48)*(1-THREE.MathUtils.smoothstep(y,.82,.92));
   const crease=Math.pow((1+Math.cos(12*a+(y-.3)*1.7))*.5,3);
   const delta=.095*envelope*crease;
   if(r>.00001){x*=1-delta/r;z*=1-delta/r;}z*=.90;
   // Pinched top stays compact and has a tiny soft dimple, not an open flower.
   if(y>.86)y-=.012*Math.pow(1-Math.min(1,r/.21),2);
  }else if(kind==='sprout'){
   const t=THREE.MathUtils.smoothstep(y,.30,1.08);x-=.48*t*t;z*=.78;
   y-=.18*t*t;
  }else {z*=kind==='mushroom'?.78:.72; x*=1+.025*Math.cos(a*2);}
  p.setXYZ(i,x,y,z);
 }g.computeVertexNormals();return g;
}

function riceOutline(a){
 // Smooth rounded triangular rice-pouch silhouette, kept free of painted food detail.
 const shape=new THREE.Shape();shape.moveTo(0,.96);shape.bezierCurveTo(.19,.96,.28,.80,.39,.61);shape.lineTo(.88,-.30);shape.bezierCurveTo(1.04,-.59,.95,-.74,.64,-.74);shape.lineTo(-.64,-.74);shape.bezierCurveTo(-.95,-.74,-1.04,-.59,-.88,-.30);shape.lineTo(-.39,.61);shape.bezierCurveTo(-.28,.80,-.19,.96,0,.96);
 const ps=shape.getPoints(80),dx=Math.cos(a),dy=Math.sin(a);let best=1;
 for(let j=0;j<ps.length-1;j++){const p=ps[j],q=ps[j+1],ex=q.x-p.x,ey=q.y-p.y,den=dx*ey-dy*ex;if(Math.abs(den)<1e-8)continue;const t=(p.x*ey-p.y*ex)/den,u=(p.x*dy-p.y*dx)/den;if(t>0&&u>=0&&u<=1){best=t;break}}return best;
}
const riceRadii=Array.from({length:721},(_,i)=>riceOutline(-Math.PI+i/720*Math.PI*2));
function bodyGeometry(kind){if(['soup','sprout','bell','mushroom'].includes(kind))return profileGeometry(kind);const g=own(new THREE.SphereGeometry(1,72,48)),p=g.attributes.position;
 for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),lat=Math.asin(Math.max(-1,Math.min(1,y))),lon=Math.atan2(z,x);let X,Y,Z;
 if(kind==='onigiri'){const a=Math.atan2(y,x),idx=(a+Math.PI)/(Math.PI*2)*720,k=Math.min(719,Math.floor(idx)),r=THREE.MathUtils.lerp(riceRadii[k],riceRadii[k+1],idx-k);X=x*r;Y=y*r;Z=.61*z;}
 else if(kind==='star'){const a=Math.atan2(y,x),rr=.67+.45*Math.pow((1+Math.cos(4*a))*.5,2.3);X=x*rr;Y=y*rr;Z=.62*z;}
 else if(kind==='pillow'){const e=.53;X=.92*spow(Math.cos(lat),e)*spow(Math.cos(lon),e);Y=.87*spow(Math.sin(lat),e);Z=.66*spow(Math.cos(lat),e)*spow(Math.sin(lon),e);}
 else if(kind==='bean'){X=.86*x*(1+.13*y);Y=.94*y;Z=.71*z;X+=.21*y*y-.07;X+=.27*Math.exp(-(((y+.18)/.35)**2))*(1-x)*.5;Z*=1+.09*y;}
 else if(kind==='drop'){const width=1-.30*y;X=.86*x*width;Y=1.02*y;Z=.70*z*width;X+=.10*y*y;}
 else if(kind==='bloom'){const a=Math.atan2(y,x),r=1+.13*Math.cos(4*a);X=.83*x*r;Y=.83*y*r;Z=.68*z*(1+.035*Math.cos(4*a)*(1-z*z));}
 else if(kind==='dumpling'){const r=Math.sqrt(Math.max(0,1-x*x)),q=r>.00001?y/r:0,top=.73*r,bottom=-.51*Math.pow(r,.27);X=1.1*x;Y=(top+bottom)*.5+(top-bottom)*.5*q;Z=.60*z*(1-.14*Math.max(0,q));const fold=Math.cos(x*5*Math.PI)*.021*Math.exp(-(((q-.76)/.26)**2));Z+=Math.sign(z)*fold*r;}
 else{const e=.78;X=1.03*spow(Math.cos(lat),e)*spow(Math.cos(lon),e);Y=.69*spow(Math.sin(lat),e);Z=.77*spow(Math.cos(lat),e)*spow(Math.sin(lon),e);X*=1-.11*y;Y+=.035*x;}
 p.setXYZ(i,X,Y,Z);
 }g.computeVertexNormals();return g;}
function grain(){const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d'),im=ctx.createImageData(128,128);let s=1329;for(let i=0;i<im.data.length;i+=4){s=(s*1664525+1013904223)>>>0;const n=120+(s%17);im.data[i]=im.data[i+1]=im.data[i+2]=n;im.data[i+3]=255}ctx.putImageData(im,0,0);const t=own(new THREE.CanvasTexture(c));t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(4,4);return t}
const noise=grain();
function model(kind){const group=new THREE.Group(),face=new THREE.Group();const mat=own(new THREE.MeshPhysicalMaterial({color:currentColor,roughness:['dumpling','soup'].includes(kind)?.55:.43,metalness:0,clearcoat:.16,clearcoatRoughness:.4,sheen:.22,sheenRoughness:.8,sheenColor:new THREE.Color('#d8d9ed'),bumpMap:noise,bumpScale:['dumpling','soup'].includes(kind)?.0005:.0015,envMapIntensity:.45}));
 const body=new THREE.Mesh(bodyGeometry(kind),mat);body.castShadow=true;body.receiveShadow=true;group.add(body,face);
 if(kind==='dumpling'){
  const foldMat=own(mat.clone());foldMat.color.lerp(new THREE.Color('#fff3dc'),.075);foldMat.roughness=.58;
  const seam=[];for(let j=0;j<=64;j++){const u=-.98+1.96*j/64,r=Math.sqrt(1-u*u);seam.push(new THREE.Vector3(1.1*u,.73*r+.007,.014*Math.sin(u*5*Math.PI)))}
  const ridge=new THREE.Mesh(own(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(seam),90,.032,8,false)),foldMat);ridge.castShadow=true;group.add(ridge);
  for(const u of [-.70,-.44,-.16,.16,.44,.70]){const r=Math.sqrt(1-u*u),pts=[];for(let j=0;j<=12;j++){const t=j/12,q=Math.cos(t*.80);pts.push(new THREE.Vector3(1.1*u+.043*Math.sin(t*Math.PI),.73*r-(.73*r+.51*Math.pow(r,.27))*.5*(1-q)+.008,.60*r*Math.sin(t*.80)*(1-.14*q)+.012));}
   const path=new THREE.CatmullRomCurve3(pts),geo=own(new THREE.TubeGeometry(path,18,.023,8,false)),pos=geo.attributes.position;
   // Taper the raised fold into the dough instead of leaving a blunt decorative tube.
   for(let j=0;j<=18;j++){const t=j/18,center=path.getPointAt(t),scale=Math.pow(Math.sin(Math.PI*(.1+.9*t)),.8);for(let k=0;k<=8;k++){const i=j*9+k;pos.setXYZ(i,center.x+(pos.getX(i)-center.x)*scale,center.y+(pos.getY(i)-center.y)*scale,center.z+(pos.getZ(i)-center.z)*scale)}}geo.computeVertexNormals();const fold=new THREE.Mesh(geo,foldMat);fold.castShadow=true;group.add(fold);
  }
 }
 
 const ray=new THREE.Raycaster();function surface(x,y){ray.set(new THREE.Vector3(x,y,4),new THREE.Vector3(0,0,-1));const hit=ray.intersectObject(body)[0];return hit?{p:hit.point,n:hit.face.normal.clone()}:{p:new THREE.Vector3(x,y,.65),n:new THREE.Vector3(0,0,1)}}
 const dark=own(new THREE.MeshPhysicalMaterial({color:'#171c2b',roughness:.2,metalness:0,clearcoat:.45,clearcoatRoughness:.22,envMapIntensity:.8}));const rim=own(new THREE.MeshStandardMaterial({color:currentColor,roughness:.4}));rim.color.multiplyScalar(.9);const eyes=[];
 const styles={curious:{sx:.98,sy:1,space:.28,mouth:.085,curve:.035},bright:{sx:1.23,sy:.79,space:.28,mouth:.115,curve:.055},mellow:{sx:1.16,sy:.64,space:.27,mouth:.075,curve:.018}};
 const style=styles[currentFace],eyeY=kind==='mushroom'?.34:.12,mouthY=kind==='mushroom'?.035:-.235;const up=new THREE.Vector3(0,0,1),normal=new THREE.Vector3();
 for(const x of [-style.space,style.space]){const point=surface(x,eyeY),eyeGroup=new THREE.Group();eyeGroup.position.copy(point.p);eyeGroup.quaternion.setFromUnitVectors(up,point.n);const socket=new THREE.Mesh(own(new THREE.CapsuleGeometry(.087,.13,8,20)),rim);socket.scale.set(.94*style.sx,style.sy,.35);socket.position.z=-.012;const eye=new THREE.Mesh(own(new THREE.CapsuleGeometry(.078,.135,8,24)),dark);eye.scale.set(style.sx,style.sy,.6);eye.position.z=.012;eyeGroup.add(socket,eye);face.add(eyeGroup);eyes.push(eyeGroup);
  // Bake a small curved surface patch once. Gaze interpolates this patch; no per-frame raycasts.
  eyeGroup.userData.patch=[];for(let j=0;j<5;j++)for(let i=0;i<5;i++)eyeGroup.userData.patch.push(surface(x+(i/4-.5)*.24,eyeY+(j/4-.5)*.18));
 }
 function gaze(x,y,blink=1){x=THREE.MathUtils.clamp(x,-1,1);y=THREE.MathUtils.clamp(y,-1,1);const gx=(x+1)*2,gy=(y+1)*2,ix=Math.min(3,Math.floor(gx)),iy=Math.min(3,Math.floor(gy)),u=gx-ix,v=gy-iy;
  for(const eye of eyes){const p=eye.userData.patch,a=p[iy*5+ix],b=p[iy*5+ix+1],c=p[(iy+1)*5+ix],d=p[(iy+1)*5+ix+1];eye.position.copy(a.p).multiplyScalar((1-u)*(1-v)).addScaledVector(b.p,u*(1-v)).addScaledVector(c.p,(1-u)*v).addScaledVector(d.p,u*v);normal.copy(a.n).multiplyScalar((1-u)*(1-v)).addScaledVector(b.n,u*(1-v)).addScaledVector(c.n,(1-u)*v).addScaledVector(d.n,u*v).normalize();eye.quaternion.setFromUnitVectors(up,normal);eye.scale.y=blink;}
 }
 const pts=[];for(let i=0;i<17;i++){const x=-style.mouth+2*style.mouth*i/16,y=mouthY+style.curve*((x/style.mouth)**2),s=surface(x,y);pts.push(s.p.addScaledVector(s.n,.012))}const mouth=new THREE.Mesh(own(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),24,.013,8,false)),dark);face.add(mouth);
 const zero=kind==='onigiri'?.76:kind==='mushroom'?.78:kind==='soup'?.68:kind==='star'?1.13:kind==='sprout'?.71:kind==='bell'?.69:kind==='pillow'?.88:kind==='bean'?.95:kind==='drop'?1.03:kind==='bloom'?.95:kind==='dumpling'?.53:.70;group.position.y=zero;group.rotation.set(-.08,.08,.02);
 const baseline={y:zero};metrics.models[kind]={bodyTriangles:body.geometry.index.count/3};return{group,body,face,eyes,mouth,mat,rim,baseline,kind,gaze};}
function createView(canvas,kind,{dark=false,transparent=false,mini=false}={}){const renderer=own(new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power',preserveDrawingBuffer:true}));rendererForDisposal=renderer;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.92;renderer.shadowMap.enabled=!mini;renderer.shadowMap.type=THREE.VSMShadowMap;
 const scene=new THREE.Scene();const camera=new THREE.PerspectiveCamera(29,1,.1,50);camera.position.set(1.5,1.65,5.5);camera.lookAt(0,.88,0);const pmrem=own(new THREE.PMREMGenerator(renderer)),room=own(new RoomEnvironment());const environment=own(pmrem.fromScene(room,.06)),env=environment.texture;scene.environment=env;release(room);release(pmrem);
 scene.add(new THREE.HemisphereLight('#e8edff','#7c6d70',.7));const key=new THREE.DirectionalLight('#fff7ee',1.9);key.position.set(-3,8,4);key.castShadow=!mini;key.shadow.mapSize.set(512,512);key.shadow.camera.left=key.shadow.camera.bottom=-3;key.shadow.camera.right=key.shadow.camera.top=3;own(key.shadow);key.shadow.normalBias=.025;key.shadow.bias=-.0003;key.shadow.radius=10;key.shadow.blurSamples=10;scene.add(key);const rimLight=new THREE.DirectionalLight('#d1ddff',1.2);rimLight.position.set(2,3,-3);scene.add(rimLight);
 const m=model(kind);scene.add(m.group);const floor=new THREE.Mesh(own(new THREE.PlaneGeometry(200,200)),own(new THREE.ShadowMaterial({color:'#282737',opacity:dark?.25:.12})));floor.rotation.x=-Math.PI/2;floor.position.y=-.01;floor.receiveShadow=true;scene.add(floor);
 const v={renderer,scene,camera,m,canvas,dark,mini,floor,run:null,lastPose:null,renderCount:0};
 v.render=()=>{const w=canvas.clientWidth||320,h=canvas.clientHeight||320,dpr=Math.min(devicePixelRatio,2);if(w!==v.width||h!==v.height||dpr!==v.pixelRatio){if(dpr!==v.pixelRatio)renderer.setPixelRatio(dpr);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();v.width=w;v.height=h;v.pixelRatio=dpr;}renderer.setClearColor(dark?'#20232b':'#f3f2ef',transparent?0:1);const grp=v.m.group;grp.updateMatrix();const pos=v.m.body.geometry.attributes.position,ele=grp.matrix.elements;let low=Infinity;for(let i=0;i<pos.count;i++)low=Math.min(low,pos.getX(i)*ele[1]+pos.getY(i)*ele[5]+pos.getZ(i)*ele[9]+ele[13]);if(!v.held)grp.position.y+=.015-low;renderer.render(scene,camera);metrics.frames++;v.renderCount++;metrics.models[v.m.kind].drawCalls=renderer.info.render.calls;metrics.models[v.m.kind].triangles=renderer.info.render.triangles;};
 v.render();return v;}
 const view=createView(canvas,look.shape,{transparent:true,dark:true});
 view.camera.position.set(1.2,1.5,4.8);view.camera.lookAt(0,view.m.baseline.y+.08,0);view.floor.material.opacity=.22;
 view.dispose=dispose;return view;
 } catch(error){dispose();throw error;}
}
