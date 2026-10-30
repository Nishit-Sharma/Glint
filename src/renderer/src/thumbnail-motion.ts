const thumbnails=new Map<HTMLElement,boolean>();
let observer:IntersectionObserver|undefined;
function updateVisibility(){for(const [node,visible] of thumbnails)node.dataset.motionVisible=String(visible&&!document.hidden);}

/** Animate only an image leaf inside a stable, paint-contained character slot. */
export function observeThumbnail(node:HTMLElement){
 if(!observer){
  observer=new IntersectionObserver(entries=>{for(const entry of entries){const image=entry.target as HTMLElement;if(!thumbnails.has(image))continue;thumbnails.set(image,entry.isIntersecting);image.dataset.motionVisible=String(entry.isIntersecting&&!document.hidden);}});
  document.addEventListener('visibilitychange',updateVisibility);
 }
 thumbnails.set(node,false);observer.observe(node);
 return()=>{observer?.unobserve(node);thumbnails.delete(node);delete node.dataset.motionVisible;if(!thumbnails.size){observer?.disconnect();observer=undefined;document.removeEventListener('visibilitychange',updateVisibility);}};
}

export function fallbackMotion(image:HTMLImageElement,enabled:boolean,seed=0){
 image.dataset.companionMotion=enabled?'quiet':'off';
 image.style.setProperty('--companion-duration',`${7200+seed%3100}ms`);
 image.style.setProperty('--companion-delay',`${-(seed%10300)}ms`);
 const release=enabled?observeThumbnail(image):()=>{};
 return()=>{release();delete image.dataset.companionMotion;};
}
