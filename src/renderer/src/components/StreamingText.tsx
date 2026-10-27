import {useSyncExternalStore} from 'react';
import {Streamdown} from 'streamdown';
import {inertMarkdownComponents,markdownPolicy} from './markdown-policy';

const preference=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const subscribe=(changed:()=>void)=>{const media=window.matchMedia('(prefers-reduced-motion: reduce)');media.addEventListener('change',changed);return()=>media.removeEventListener('change',changed);};
export function StreamingText({text,streaming}:{text:string;streaming:boolean}){
 const reduced=useSyncExternalStore(subscribe,preference,()=>true);
 return <Streamdown {...markdownPolicy} className="streaming-text readable-text markdown-content" mode="streaming" animated={reduced?false:{animation:'fadeIn',duration:150}} isAnimating={streaming} controls={false} components={inertMarkdownComponents}>{text}</Streamdown>;
}
