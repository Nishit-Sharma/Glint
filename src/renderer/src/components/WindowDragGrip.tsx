import {useLayoutEffect,useRef} from 'react';

/** Keep native movement available outside the cosmetic whole-surface hold.
 * During reveal the outside grip occupies exactly the header's reserved slot;
 * after handoff the header draws it. Neither copy implements a JS drag gesture. */
export function WindowDragGrip(){
 const ref=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
  const grip=ref.current,root=grip?.parentElement;if(!grip||!root)return;
  let header:HTMLElement|null=null;
  const resize=new ResizeObserver(()=>update());
  const hidden=(value:boolean)=>{if(grip.hidden!==value)grip.hidden=value;};
  function update(){
   if(!grip||!root)return;
   const next=root.querySelector<HTMLElement>('.workspace:not([hidden]) .chrome,.compact-companion:not([hidden]) .chrome');
   if(next!==header){if(header)resize.unobserve(header);header=next;if(header)resize.observe(header);}
   if(root.querySelector('.anchor-wrap:not([hidden])')){hidden(true);return;}
   if(!header){grip.dataset.nativeChrome='startup';grip.style.cssText='';hidden(false);return;}
   const surface=header.closest<HTMLElement>('[data-runtime-scope="whole-surface"]'),stage=surface?.dataset.surfaceReveal;
   if(stage==='settled'||stage==='skipped'||stage==='cancelled'){hidden(true);return;}
   const bounds=header.getBoundingClientRect(),style=getComputedStyle(header),slot=getComputedStyle(header,'::before'),width=parseFloat(slot.width),height=parseFloat(slot.height);
   if(!bounds.width||!bounds.height||!width||!height){hidden(true);return;}
   Object.assign(grip.style,{left:bounds.left+parseFloat(style.borderLeftWidth)+parseFloat(style.paddingLeft)+'px',top:bounds.top+(bounds.height-height)/2+'px',width:width+'px',height:height+'px'});
   grip.dataset.nativeChrome='bridged';hidden(false);
  }
  const changes=new MutationObserver(records=>{
   if(records.some(record=>record.target!==grip&&(record.type==='attributes'||record.target===root||[...record.addedNodes,...record.removedNodes].some(node=>node instanceof Element&&(node.matches('.workspace,.compact-companion,.anchor-wrap,.chrome')||!!node.querySelector('.chrome'))))))update();
  });
  changes.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','data-surface-reveal']});window.addEventListener('resize',update);update();
  return()=>{changes.disconnect();resize.disconnect();window.removeEventListener('resize',update);};
 },[]);
 return <div ref={ref} className="window-startup-drag" title="Drag to move the window" aria-hidden="true" hidden/>;
}
