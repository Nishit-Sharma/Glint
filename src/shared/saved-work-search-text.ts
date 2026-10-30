import {marked} from 'marked';
import {decodeHTMLAttribute,decodeHTMLStrict} from 'entities';
import type {Artifact,ArtifactRevision,Task} from '../core/types';
import {signalPracticeDisplay} from './signal-practice-display';
type Token={type:string;raw:string;text?:string;href?:string;tokens?:Token[];items?:Token[];header?:{tokens:Token[]}[];rows?:{tokens:Token[]}[][]};
const markdownReferences=/&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/gu;
function imageData(value:string|undefined,syntax:'markdown'|'html'|'html-list'='markdown'):boolean{
 if(!value)return false;
 // CommonMark bounds the reference syntax; the pinned parser owns the complete
 // entity table and HTML attribute context. Decode once, never recursively.
 const decoded=syntax==='markdown'?value.replace(markdownReferences,reference=>decodeHTMLStrict(reference)):decodeHTMLAttribute(value),normalized=decoded.replace(/[\u0000-\u0020\u007f]/gu,'');
 return (syntax==='html-list'?/(?:^|,)data:image\//iu:/^data:image\//iu).test(normalized);
}
const children=(token:Token)=>token.tokens??token.items??(token.type==='table'?[...(token.header??[]).flatMap(cell=>cell.tokens),...(token.rows??[]).flatMap(row=>row.flatMap(cell=>cell.tokens))]:[]);
const htmlTags=/<[A-Za-z][A-Za-z0-9:_-]*(?:[^"'<>]|"[^"]*"|'[^']*')*>/gu;
const htmlAttributes=/\s+([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;
function htmlImageDestinations(raw:string):Array<{start:number;value:string}>{
 const result:Array<{start:number;value:string}>=[];
 for(const tag of raw.matchAll(htmlTags))for(const attribute of tag[0].matchAll(htmlAttributes)){
  const value=attribute[2]??attribute[3]??attribute[4],name=attribute[1].toLowerCase().split(':').at(-1),list=name==='srcset'||name==='imagesrcset';
  if(value===undefined||(!list&&!['src','href','poster'].includes(name??''))||!imageData(value,list?'html-list':'html'))continue;
  result.push({start:tag.index!+attribute.index!+attribute[0].indexOf(value,attribute[0].indexOf('=')),value});
 }
 return result;
}
const opaque=(token:Token):boolean=>token.type==='code'||token.type==='codespan'?false:((['image','link','def'].includes(token.type)&&imageData(token.href))||(token.type==='html'&&htmlImageDestinations(token.raw).length>0)||children(token).some(opaque));
function afterLabel(token:Token):number{
 if(token.type!=='def'){
  const prefix=(token.type==='image'?'![':'[')+(token.text??'')+']';
  if(token.text===undefined||!token.raw.startsWith(prefix))throw Error('Unmapped parsed label');return prefix.length;
 }
 let depth=0;for(let index=0;index<token.raw.length;index++){if(token.raw[index]==='\\'){index++;continue;}if(token.raw[index]==='[')depth++;if(token.raw[index]===']'&&--depth===0)return index+1;}throw Error('Unmapped definition label');
}
/** Search only complete file text. Unknown source mappings fail closed; raw
 * ranges are projected without altering saved bytes or literal code. */
export function withoutEmbeddedImageData(content:string,truncated=false):string|null{
 if(truncated)return null;
 try{
  const tokens=marked.lexer(content) as Token[],ranges:Array<[number,number]>=[];
  function visit(token:Token,start:number){
   if(!opaque(token))return;
   if(['image','link','def'].includes(token.type)&&imageData(token.href)){
    let position=afterLabel(token);while(/\s/u.test(token.raw[position]??'')&&position<token.raw.length)position++;
    if(token.type==='def'){if(token.raw[position]!==':')throw Error('Unmapped definition');}else if(token.raw[position]!=='(')return; // A reference's URI belongs to its separate definition.
    position++;while(position<token.raw.length&&/\s/u.test(token.raw[position]))position++;if(token.raw[position]==='<')position++;
    if(!token.raw.startsWith(token.href!,position))throw Error('Unmapped destination bytes');ranges.push([start+position,start+position+token.href!.length]);return;
   }
   if(token.type==='html'){for(const destination of htmlImageDestinations(token.raw))ranges.push([start+destination.start,start+destination.start+destination.value.length]);return;}
   let cursor=0;for(const child of children(token)){const index=token.raw.indexOf(child.raw,cursor);if(index<0)throw Error('Unmapped nested text');visit(child,start+index);cursor=index+child.raw.length;}
  }
  let cursor=0;for(const token of tokens){if(content.slice(cursor,cursor+token.raw.length)!==token.raw)throw Error('Unmapped block');visit(token,cursor);cursor+=token.raw.length;}
  let result=content;for(const [start,end] of ranges.sort((a,b)=>b[0]-a[0]))result=result.slice(0,start)+result.slice(end);return result;
 }catch{return null;}
}
export function savedWorkSearchText(task:Task,artifact:Artifact,revision:ArtifactRevision,content:string):string|null{
 if(content!==revision.content)return null;
 const shown=signalPracticeDisplay(task,artifact,revision,content);
 return withoutEmbeddedImageData(shown??content);
}
