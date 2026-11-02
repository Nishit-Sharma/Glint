export type ComposerFormat='bullet'|'numbered'|'indent'|'outdent'|'quote';
export interface ComposerSelection{text:string;start:number;end:number}
// Textarea offsets count UTF-16 units after the browser's CR/CRLF→LF mapping.
export function composerDomText(text:string){return text.replace(/\r\n|\r/g,'\n');}
function rawOffset(text:string,offset:number){let raw=0,dom=0;while(raw<text.length&&dom<offset){if(text[raw]==='\r'&&text[raw+1]==='\n')raw++;raw++;dom++;}return raw;}
function domOffset(text:string,raw:number){return composerDomText(text.slice(0,raw)).length;}
export function formatComposerSelection(text:string,start:number,end:number,action:ComposerFormat):ComposerSelection{
 const length=composerDomText(text).length;
 if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end>length)throw Error('Select text in the current composer before formatting.');
 const rawStart=rawOffset(text,start),rawEnd=rawOffset(text,end);
 const splitsPair=(offset:number)=>offset>0&&offset<text.length&&/[\uD800-\uDBFF]/.test(text[offset-1])&&/[\uDC00-\uDFFF]/.test(text[offset]);
 if(splitsPair(rawStart)||splitsPair(rawEnd))throw Error('Select the complete character before formatting.');
 if(action==='quote'){
  if(start===end)return{text,start,end};
  const selected=text.slice(rawStart,rawEnd),quoted='> '+selected.replace(/(\r\n|\r|\n)(?!$)/g,'$1> '),next=text.slice(0,rawStart)+quoted+text.slice(rawEnd);
  return{text:next,start:domOffset(next,rawStart),end:domOffset(next,rawStart+quoted.length)};
 }
 const parts=text.split(/(\r\n|\r|\n)/),lines:Array<{body:string;eol:string;start:number}>=[];let position=0;
 for(let index=0;index<parts.length;index+=2){const body=parts[index],eol=parts[index+1]??'';lines.push({body,eol,start:position});position+=body.length+eol.length;}
 const lineAt=(offset:number)=>{let index=0;while(index+1<lines.length&&lines[index+1].start<=offset)index++;return index;},first=lineAt(rawStart),last=lineAt(rawEnd>rawStart?rawEnd-1:rawStart);
 let ordinal=0;
 const changed=lines.map((line,index)=>{
  if(index<first||index>last)return line.body+line.eol;
  ordinal++;
  if(action==='indent')return'  '+line.body+line.eol;
  if(action==='outdent')return line.body.replace(/^(?: {1,2}|\t)/,'')+line.eol;
  const match=/^([\t ]*)(?:(?:[-+*]|\d+[.)]) )?(.*)$/s.exec(line.body)!;
  return match[1]+(action==='bullet'?'- ':ordinal+'. ')+match[2]+line.eol;
 });
 const next=changed.join(''),prefix=changed.slice(0,first).join('').length,selected=changed.slice(first,last+1).join(''),lastEol=lines[last].eol.length;
 return{text:next,start:domOffset(next,prefix),end:domOffset(next,prefix+selected.length-lastEol)};
}
