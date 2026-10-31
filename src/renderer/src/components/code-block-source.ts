import type {} from 'hast';

declare module 'hast'{
 interface ElementData{glintCodeCopy?:string;}
}

type MarkdownNode={type:string;tagName?:string;value?:string;children?:MarkdownNode[];data?:Record<string,unknown>;position?:{start:{offset?:number;column:number};end:{offset?:number}}};

// Read from the parser's source after sanitizing. The private node data never
// becomes an HTML attribute, and no DOM/UI text is included in the copy.
export function codeBlockSourcePlugin(){
 return (tree:MarkdownNode,file:{value?:unknown})=>{
  const source=String(file.value??'');
  const visit=(node:MarkdownNode)=>{
   if(node.tagName==='pre'){
    const code=node.children?.find(child=>child.tagName==='code'),position=node.position;
    if(code&&position&&typeof position.start.offset==='number'&&typeof position.end.offset==='number'){
     const start=position.start.offset,end=position.end.offset,raw=source.slice(start,end),opening=/^(`{3,}|~{3,})[^\r\n]*(\r\n|\r|\n|$)/.exec(raw);
     let body:string;
     if(opening){
      const lastBreak=Math.max(raw.lastIndexOf('\n'),raw.lastIndexOf('\r')),lastLine=raw.slice(lastBreak+1),closing=/^[ >\t]*(`{3,}|~{3,})[ \t]*$/.exec(lastLine);
      const closed=lastBreak>=0&&closing&&closing[1][0]===opening[1][0]&&closing[1].length>=opening[1].length;
      body=raw.slice(opening[0].length,closed?lastBreak+1:undefined);
      if(position.start.column===1){node.data={...node.data,glintCodeCopy:body};return;}
     }else{
      body=raw+(source.slice(end).match(/^(\r\n|\r|\n)/)?.[0]??'');
     }
     // For nested/indented blocks the parser has removed Markdown container
     // prefixes. Match those logical lines back to the source for its exact EOLs.
     const displayed=code.children?.map(child=>child.type==='text'?child.value??'':'').join('')??'',logical=displayed.replace(/\n$/,'').split(/\r\n|\r|\n/);
     const lines=[...body.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g)].filter(match=>match[0].length>0);
     if(lines.length===logical.length&&lines.every((line,index)=>line[1].endsWith(logical[index])))node.data={...node.data,glintCodeCopy:lines.map((line,index)=>logical[index]+line[2]).join('')};
     else if(body==='')node.data={...node.data,glintCodeCopy:''};
    }
    return;
   }
   node.children?.forEach(visit);
  };
  visit(tree);
 };
}
