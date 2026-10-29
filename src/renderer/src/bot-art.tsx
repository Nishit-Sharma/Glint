import {useLayoutEffect,useRef,useState} from 'react';
import type {CharacterProfile} from '../../shared/character-catalog';
import {mountOriginal} from './character-original/actor-runtime.js';
const images=import.meta.glob<string>('./bot-thumbnails/*.png',{eager:true,query:'?url',import:'default'});
export function appearanceKey(look:CharacterProfile['look']){return [look.shape,look.color,look.face].join(':');}
export function characterStill(look:CharacterProfile['look']){
 const path='./bot-thumbnails/'+[look.shape,look.color,look.face].join('-')+'.png',image=images[path];
 if(!image)throw Error('This saved appearance preview is unavailable.');return image;
}
export function BotImage({profile,className='',label=''}:{profile:CharacterProfile;className?:string;label?:string}){
 return <img className={className+' character-slot'} data-character-render="static" data-t-generate-skip data-bot-look={appearanceKey(profile.look)} src={characterStill(profile.look)} alt={label} draggable={false}/>;
}
export function BotActor({profile}:{profile:CharacterProfile}){
 const ref=useRef<HTMLSpanElement>(null),[failed,setFailed]=useState(false);
 useLayoutEffect(()=>{const element=ref.current;if(!element)return;setFailed(false);const canvas=document.createElement('canvas');element.replaceChildren(canvas);let actor:ReturnType<typeof mountOriginal>|undefined;try{actor=mountOriginal(canvas,profile.look,()=>setFailed(true));}catch{setFailed(true);}return()=>{actor?.destroy();element.replaceChildren();};},[profile.look.shape,profile.look.color,profile.look.face,profile.look.motion]);
 return <span className="bot-art character-slot" data-character-render={failed?'static':'live'} data-t-generate-skip aria-hidden="true"><BotImage profile={profile}/><span ref={ref} className="bot-live" hidden={failed}/></span>;
}
