import {useId,useLayoutEffect,useRef,useState,type CSSProperties} from 'react';
import type {CharacterProfile} from '../../shared/character-catalog';
import {mountOriginal} from './character-original/actor-runtime.js';
import {observeThumbnail} from './thumbnail-motion';
import {queueActorMount} from './actor-mount-queue';
import './companion-motion.css';
const images=import.meta.glob<string>('./bot-thumbnails/*.png',{eager:true,query:'?url',import:'default'});
function phaseSeed(value:string){let result=0;for(let i=0;i<value.length;i++)result=(Math.imul(result,31)+value.charCodeAt(i))>>>0;return result;}
export function appearanceKey(look:CharacterProfile['look']){return [look.shape,look.color,look.face].join(':');}
export function characterStill(look:CharacterProfile['look']){
 const path='./bot-thumbnails/'+[look.shape,look.color,look.face].join('-')+'.png',image=images[path];
 if(!image)throw Error('This saved appearance preview is unavailable.');return image;
}
export function BotImage({profile,className='',label='',animate=true}:{profile:CharacterProfile;className?:string;label?:string;animate?:boolean}){
 const ref=useRef<HTMLImageElement>(null),id=useId(),seed=phaseSeed(id+profile.look.shape),moving=animate&&profile.look.motion;
 useLayoutEffect(()=>{if(moving&&ref.current)return observeThumbnail(ref.current);},[moving]);
 const timing={'--companion-duration':`${6800+seed%4300}ms`,'--companion-delay':`${-(seed%11000)}ms`} as CSSProperties;
 return <span className={className+' bot-image character-slot'} data-character-render="static" data-t-generate-skip data-bot-look={appearanceKey(profile.look)}><img ref={ref} data-companion-motion={moving?'quiet':'off'} style={timing} src={characterStill(profile.look)} alt={label} draggable={false}/><CharacterAdornment look={profile.look}/></span>;
}
export function BotActor({profile,selected=false,seed=0}:{profile:CharacterProfile;selected?:boolean;seed?:number}){
 const frameRef=useRef<HTMLSpanElement>(null),ref=useRef<HTMLSpanElement>(null),actor=useRef<ReturnType<typeof mountOriginal>|undefined>(undefined),latest=useRef(profile.look),wasSelected=useRef(selected),[status,setStatus]=useState<'loading'|'live'|'fallback'>('loading');latest.current=profile.look;
 useLayoutEffect(()=>{
  const element=ref.current,slot=frameRef.current;if(!element||!slot)return;setStatus('loading');
  const canvas=document.createElement('canvas');canvas.setAttribute('aria-hidden','true');element.replaceChildren(canvas);
  const owner=element.closest('button'),acknowledge=()=>actor.current?.acknowledge();
  let disposed=false,cancelMount:(()=>void)|undefined;
  const visibility=new IntersectionObserver(entries=>{
   if(disposed||actor.current)return;
   if(entries[0]?.isIntersecting){
    if(!cancelMount)cancelMount=queueActorMount(()=>{
     cancelMount=undefined;if(disposed)return;let failed=false;
     try{actor.current=mountOriginal(canvas,latest.current,()=>{failed=true;if(!disposed)setStatus('fallback');},{activity:'playful',seed});if(!failed&&!actor.current.stats().destroyed)setStatus('live');}
     catch{if(!disposed)setStatus('fallback');}
     visibility.disconnect();
    });
   }else{cancelMount?.();cancelMount=undefined;}
  });visibility.observe(slot);
  owner?.addEventListener('pointerenter',acknowledge);owner?.addEventListener('focus',acknowledge);
  return()=>{disposed=true;visibility.disconnect();cancelMount?.();owner?.removeEventListener('pointerenter',acknowledge);owner?.removeEventListener('focus',acknowledge);actor.current?.destroy();actor.current=undefined;element.replaceChildren();};
 },[profile.look.shape,profile.look.face,seed]);
 useLayoutEffect(()=>{actor.current?.setColor(profile.look.color);},[profile.look.shape,profile.look.face,profile.look.color,seed]);
 useLayoutEffect(()=>{if(profile.look.motion)actor.current?.resume();else actor.current?.pause();},[profile.look.shape,profile.look.face,profile.look.motion,seed]);
 useLayoutEffect(()=>{if(selected&&!wasSelected.current)actor.current?.acknowledge();wasSelected.current=selected;},[selected]);
 return <span ref={frameRef} className="bot-art character-slot" data-character-render={status==='live'?'live':'static'} data-character-state={status} data-t-generate-skip aria-hidden="true"><BotImage profile={profile} animate={status!=='live'}/><span ref={ref} className="bot-live" hidden={status==='fallback'}/><CharacterAdornment look={profile.look}/></span>;
}

export function CharacterAdornment({look}:{look:CharacterProfile['look']}){
 if((look.glasses??'none')==='none'&&(look.accessory??'none')==='none')return null;
 return <svg className="character-adornment" viewBox="0 0 100 100" aria-hidden="true" data-glasses={look.glasses??'none'} data-accessory={look.accessory??'none'}>{look.glasses==='round'&&<g fill="none" stroke="#302d29" strokeWidth="2.2"><circle cx="40" cy="46" r="8"/><circle cx="61" cy="46" r="8"/><path d="M48 45Q50.5 42 53 45M32 44L27 42M69 44L74 42"/></g>}{look.accessory==='scarf'&&<g fill="#96536a" stroke="#673749" strokeWidth="1"><path d="M29 67Q50 76 72 67L69 74Q50 82 32 74Z"/><path d="M57 75L68 77L65 92L56 87Z"/></g>}</svg>;
}
