import {useMemo} from 'react';
import {Streamdown} from 'streamdown';
import {inertMarkdownComponents,markdownComponents,markdownPolicy} from './markdown-policy';

export function plainExcerpt(text:string):string{return text.replace(/^#{1,6}\s+/gm,'').replace(/\*\*([^*]+)\*\*/g,'$1').replace(/\*([^*\n]+)\*/g,'$1').replace(/`([^`]+)`/g,'$1').replace(/^[-*]\s+\[[ xX]\]\s*/gm,'').replace(/\[([^\]]+)\]\(([^)]+)\)/g,'$1').replace(/\s+/g,' ').trim();}

export function ReadableText({text,leadingTitle}:{text:string;leadingTitle?:string}){
 const components=useMemo(()=>{
  if(!leadingTitle)return inertMarkdownComponents;
  const lines=text.split('\n'),first=lines.findIndex(line=>line.trim()),heading=first>=0?/^#{1,6}\s+(.+?)\s*#*\s*$/.exec(lines[first]):null;
  return heading&&plainExcerpt(heading[1]).toLocaleLowerCase()===plainExcerpt(leadingTitle).toLocaleLowerCase()?markdownComponents(first+1):inertMarkdownComponents;
 },[text,leadingTitle]);
 return <Streamdown {...markdownPolicy} className="readable-text markdown-content" mode="static" animated={false} isAnimating={false} controls={false} components={components}>{text}</Streamdown>;
}
