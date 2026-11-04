// Browser-side helpers for scripts/render-character-icon.mjs: render Glint's own soup character (project core.js)
// and derive the app icon and menu-bar template glyph from it. Served by a Playwright route; no server.
import * as THREE from '/character/vendor/three.module.min.js';
import {createOriginalView} from '/character/core.js';

// One still of the live character. mode: 'beauty' (shipped look), 'mask' (body white, face features black).
// Camera faces the character the same way actor-runtime's neutral pose does.
export function renderCharacter({size=1024,color='dough',face='curious',cam=[1.2,1.5,4.8],zoom=1,lookY=.08,shiftX=0,mode='beauty',shadow=true,shadowOpacity=.22,hideMouth=false}={}){
 const canvas=document.createElement('canvas');canvas.style.cssText=`width:${size}px;height:${size}px;display:block`;document.body.append(canvas);
 const v=createOriginalView(canvas,{shape:'soup',color,face,motion:false});const extra=[];
 try{
  const m=v.m;v.camera.position.set(...cam);v.camera.zoom=zoom;v.camera.updateProjectionMatrix();
  const yaw=Math.atan2(cam[0],cam[2]),pitch=-Math.atan2(cam[1]-m.baseline.y-m.eyes[0].position.y,Math.hypot(cam[0],cam[2]));
  m.group.position.set(0,m.baseline.y,0);m.group.rotation.set(pitch,yaw,0);m.group.scale.set(1,1,1);m.gaze(0,0,1);
  v.camera.lookAt(shiftX,m.baseline.y+lookY,0);
  v.floor.visible=shadow&&mode==='beauty';v.floor.material.opacity=shadowOpacity;
  if(mode!=='beauty'){
   v.renderer.toneMapping=THREE.NoToneMapping;v.scene.environment=null;
   const dark=m.mouth.material,white=new THREE.MeshBasicMaterial({color:0xffffff}),black=new THREE.MeshBasicMaterial({color:0x000000});extra.push(white,black);
   m.group.traverse(o=>{if(!o.isMesh)return;if(o.material===dark){o.material=black;if(o===m.mouth&&hideMouth)o.visible=false;}else o.material=white;});
  }
  v.render();return canvas.toDataURL('image/png');
 }finally{for(const r of extra)r.dispose();v.dispose();canvas.remove();}
}

export async function loadImage(url){const i=new Image();i.src=url;await i.decode();return i;}
function surface(w,h=w){const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');x.imageSmoothingEnabled=true;x.imageSmoothingQuality='high';return [c,x];}
// Apple-style continuous-corner tile approximated by a superellipse (n=5) on the 824/1024 macOS icon grid.
export function squircle(ctx,cx,cy,half,n=5){ctx.beginPath();for(let i=0;i<=1440;i++){const t=i/1440*2*Math.PI,c=Math.cos(t),s=Math.sin(t);const x=cx+half*Math.sign(c)*Math.abs(c)**(2/n),y=cy+half*Math.sign(s)*Math.abs(s)**(2/n);i?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.closePath();}
// Compose a 1024 app-icon master: tile + baked drop shadow (macOS 11+ icons carry their own), then the character render.
export async function composeTile(charUrl,{top,bottom,glow=null,edge='rgba(255,255,255,.22)'}){
 const [c,x]=surface(1024),img=await loadImage(charUrl);const g=x.createLinearGradient(0,100,0,924);g.addColorStop(0,top);g.addColorStop(1,bottom);
 x.save();x.shadowColor='rgba(0,0,0,.30)';x.shadowBlur=28;x.shadowOffsetY=12;squircle(x,512,512,412);x.fillStyle=g;x.fill();x.restore();
 x.save();squircle(x,512,512,412);x.clip();x.fillStyle=g;x.fill();
 if(glow){const r=x.createRadialGradient(512,470,0,512,470,420);r.addColorStop(0,glow);r.addColorStop(1,'rgba(0,0,0,0)');x.fillStyle=r;x.fillRect(0,0,1024,1024);}
 x.drawImage(img,0,0,1024,1024);
 if(edge){squircle(x,512,512,411);x.strokeStyle=edge;x.lineWidth=2;x.stroke();}
 x.restore();return c.toDataURL('image/png');
}
// Box-quality downscale by repeated halving, then one final step.
export async function downscale(url,target){
 let src=await loadImage(url),w=src.naturalWidth,cur=src;
 while(w/2>=target){const [c,x]=surface(w/2);x.drawImage(cur,0,0,w/2,w/2);cur=c;w/=2;}
 if(w!==target){const [c,x]=surface(target);x.drawImage(cur,0,0,target,target);cur=c;}
 return cur.toDataURL('image/png');
}

// ---- Menu-bar template glyphs: black + alpha only; macOS tints them. Work at 8 px per pt, box-filter down.
const SS=8;
function bbox(d,w,h){let x0=w,y0=h,x1=-1,y1=-1;for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(d[(y*w+x)*4+3]>8){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}return {x0,y0,w:x1-x0+1,h:y1-y0+1};}
// Fit the mask's opaque bounds into a pt box (with `pad` pt margin), return {sil,feat} alpha planes at SS px/pt.
async function fit(maskUrl,pt,pad){
 const img=await loadImage(maskUrl),[c0,x0]=surface(img.naturalWidth,img.naturalHeight);x0.drawImage(img,0,0);
 const b=bbox(x0.getImageData(0,0,c0.width,c0.height).data,c0.width,c0.height);
 const W=pt*SS,inner=(pt-2*pad)*SS,s=Math.min(inner/b.w,inner/b.h),dw=b.w*s,dh=b.h*s;
 // stepwise shrink of the crop to avoid aliasing
 let cur=document.createElement('canvas');cur.width=b.w;cur.height=b.h;cur.getContext('2d').drawImage(c0,b.x0,b.y0,b.w,b.h,0,0,b.w,b.h);let cw=b.w,ch=b.h;
 while(cw/2>=dw){const [c,x]=surface(Math.round(cw/2),Math.round(ch/2));x.drawImage(cur,0,0,c.width,c.height);cur=c;cw=c.width;ch=c.height;}
 const [c,x]=surface(W);x.drawImage(cur,(W-dw)/2,(W-dh)/2,dw,dh);const d=x.getImageData(0,0,W,W).data,n=W*W,sil=new Float32Array(n),feat=new Float32Array(n);
 for(let i=0;i<n;i++){const a=d[i*4+3]/255,l=(d[i*4]+d[i*4+1]+d[i*4+2])/765;sil[i]=a;feat[i]=a*(1-l);}return {W,sil,feat};
}
function dilate(a,W,r,ry=r){if(r<=0)return a.slice();const o=new Float32Array(a.length),R=Math.ceil(r),RY=Math.ceil(ry),off=[];for(let dy=-RY;dy<=RY;dy++)for(let dx=-R;dx<=R;dx++)if((dx/r)**2+(dy/ry)**2<=1)off.push([dx,dy]);
 for(let y=0;y<W;y++)for(let x=0;x<W;x++){let m=0;for(const [dx,dy] of off){const X=x+dx,Y=y+dy;if(X<0||Y<0||X>=W||Y>=W)continue;const v=a[Y*W+X];if(v>m)m=v;}o[y*W+x]=m;}return o;}
function toPng(alpha,W,factor){const w=W/factor,[c,x]=surface(w),im=x.createImageData(w,w);
 for(let y=0;y<w;y++)for(let X=0;X<w;X++){let s=0;for(let j=0;j<factor;j++)for(let i=0;i<factor;i++)s+=alpha[(y*factor+j)*W+X*factor+i];let a=s/(factor*factor);a=Math.min(1,Math.max(0,(a-.1)/.8));const k=(y*w+X)*4;im.data[k]=im.data[k+1]=im.data[k+2]=0;im.data[k+3]=Math.round(a*255);}
 x.putImageData(im,0,0);return c.toDataURL('image/png');}
const clamp=v=>Math.min(1,Math.max(0,v));
// Solid body silhouette with the eyes knocked out as pills (enlarged by eyeGrow pt so they survive 16 pt @1x).
// holes1x: [x,y,w,h] px rects; @1x then uses the solid body with these exact clear holes (hinted eyes) instead of the derived ones.
export async function templateGlyph({pt,masks,eyeGrow=.35,pad=1,holes1x=null}){
 const {W,sil,feat}=await fit(masks.noMouth,pt,pad),e=dilate(feat,W,eyeGrow*SS*.55,eyeGrow*SS),out=sil.map((v,i)=>clamp(v-e[i]));
 if(!holes1x)return {x1:toPng(out,W,SS),x2:toPng(out,W,SS/2)};
 const solid=sil.slice();for(const [x,y,w,h] of holes1x)for(let Y=y*SS;Y<(y+h)*SS;Y++)for(let X=x*SS;X<(x+w)*SS;X++)solid[Y*W+X]=0;
 return {x1:toPng(solid,W,SS),x2:toPng(out,W,SS/2)};
}
