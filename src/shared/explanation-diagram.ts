import {Either,ParseResult,Schema} from 'effect';

export const DIAGRAM_LIMITS={nodes:24,edges:40,groups:6,nodeLabel:60,edgeLabel:40,groupLabel:40,title:120} as const;
export const DIAGRAM_NODE_KINDS=['concept','process','input','output','example','question','note'] as const;
const DiagramId=Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{1,32}$/));
const label=(max:number)=>Schema.String.pipe(Schema.maxLength(max),Schema.filter(value=>value.trim().length>0&&!/[\u0000-\u001f\u007f]/u.test(value)||'Labels must be nonblank single-line text.'));
const DiagramNodeSchema=Schema.Struct({id:DiagramId,label:label(DIAGRAM_LIMITS.nodeLabel),kind:Schema.Literal(...DIAGRAM_NODE_KINDS),group:Schema.optional(DiagramId),citation:Schema.optional(Schema.Int.pipe(Schema.between(1,40)))});
const DiagramEdgeSchema=Schema.Struct({from:DiagramId,to:DiagramId,label:Schema.optional(label(DIAGRAM_LIMITS.edgeLabel))});
const DiagramGroupSchema=Schema.Struct({id:DiagramId,label:label(DIAGRAM_LIMITS.groupLabel)});
export const DiagramSpecSchema=Schema.Struct({
 title:Schema.optional(label(DIAGRAM_LIMITS.title)),
 direction:Schema.optional(Schema.Literal('down','right')),
 nodes:Schema.Array(DiagramNodeSchema).pipe(Schema.minItems(1),Schema.maxItems(DIAGRAM_LIMITS.nodes)),
 edges:Schema.Array(DiagramEdgeSchema).pipe(Schema.maxItems(DIAGRAM_LIMITS.edges)),
 groups:Schema.optional(Schema.Array(DiagramGroupSchema).pipe(Schema.maxItems(DIAGRAM_LIMITS.groups))),
}).pipe(Schema.filter(spec=>{
 const ids=new Set(spec.nodes.map(node=>node.id)),groups=new Set((spec.groups??[]).map(group=>group.id));
 if(ids.size!==spec.nodes.length)return 'Diagram node ids must be unique.';
 if(groups.size!==(spec.groups??[]).length)return 'Diagram group ids must be unique.';
 if(spec.nodes.some(node=>node.group!==undefined&&!groups.has(node.group)))return 'A node refers to an unknown group.';
 if(spec.edges.some(edge=>!ids.has(edge.from)||!ids.has(edge.to)))return 'An edge refers to an unknown node.';
 if(spec.edges.some(edge=>edge.from===edge.to))return 'Edges cannot connect a node to itself.';
 if(new Set(spec.edges.map(edge=>edge.from+'\u0000'+edge.to)).size!==spec.edges.length)return 'Each pair of nodes may be connected at most once.';
 return true;
}));
export type DiagramSpec=typeof DiagramSpecSchema.Type;
export type DiagramNodeKind=typeof DIAGRAM_NODE_KINDS[number];

export function validateDiagram(value:unknown,citationCount:number):{ok:true;spec:DiagramSpec}|{ok:false;reason:string}{
 const decoded=Schema.decodeUnknownEither(DiagramSpecSchema,{onExcessProperty:'error'})(value);
 if(Either.isLeft(decoded)){const reason=ParseResult.ArrayFormatter.formatErrorSync(decoded.left).map(issue=>(issue.path.length?issue.path.join('.')+': ':'')+issue.message).join('; ');return {ok:false,reason:reason.length>400?reason.slice(0,399)+'…':reason};}
 const missing=decoded.right.nodes.find(node=>node.citation!==undefined&&node.citation>citationCount);
 if(missing)return {ok:false,reason:`Node ${missing.id} cites [${missing.citation}], but only ${citationCount} citation${citationCount===1?' is':'s are'} listed.`};
 return {ok:true,spec:decoded.right};
}

export const DIAGRAM_GEOMETRY={nodeWidth:168,nodeHeight:60,layerGap:64,siblingGap:28,padding:24,backEdgeRoom:48,lineChars:22,maxLines:3} as const;
export type LaidNode={id:string;kind:DiagramNodeKind;x:number;y:number;width:number;height:number;lines:string[];citation?:number;group?:string;layer:number};
export type LaidEdge={from:string;to:string;path:string;back:boolean;label?:string;labelX:number;labelY:number};
export type LaidGroup={id:string;label:string;x:number;y:number;width:number;height:number};
export type DiagramLayout={width:number;height:number;direction:'down'|'right';nodes:LaidNode[];edges:LaidEdge[];groups:LaidGroup[]};

export function wrapLabel(text:string,width:number=DIAGRAM_GEOMETRY.lineChars,maxLines:number=DIAGRAM_GEOMETRY.maxLines):string[]{
 const words=text.trim().split(/\s+/u).flatMap(word=>word.length<=width?[word]:word.match(new RegExp(`.{1,${width}}`,'gu'))??[]),lines:string[]=[];
 let current='';
 for(const word of words){
  if(!current)current=word;else if(current.length+1+word.length<=width)current+=' '+word;else{lines.push(current);current=word;}
 }
 if(current)lines.push(current);
 if(lines.length<=maxLines)return lines;
 const kept=lines.slice(0,maxLines),last=kept[maxLines-1];
 kept[maxLines-1]=(last.length>=width?last.slice(0,width-1):last)+'…';
 return kept;
}

/** Longest-path layers over a cycle-free edge subset; edges closing a cycle are drawn as back edges. */
export function layoutDiagram(spec:DiagramSpec):DiagramLayout{
 const direction=spec.direction??'down',labelWidth=Math.max(0,...spec.edges.map(edge=>(edge.label?.length??0)*7)),g={...DIAGRAM_GEOMETRY,layerGap:direction==='right'?Math.max(DIAGRAM_GEOMETRY.layerGap,labelWidth+24):DIAGRAM_GEOMETRY.layerGap,padding:Math.max(DIAGRAM_GEOMETRY.padding,Math.ceil((labelWidth-DIAGRAM_GEOMETRY.nodeWidth)/2)+16)},index=new Map(spec.nodes.map((node,i)=>[node.id,i]));
 const outgoing=spec.nodes.map(()=>[] as number[]);spec.edges.forEach((edge,i)=>outgoing[index.get(edge.from)!].push(i));
 const back=new Set<number>(),state=spec.nodes.map(()=>0);
 const visit=(node:number)=>{state[node]=1;for(const e of outgoing[node]){const to=index.get(spec.edges[e].to)!;if(state[to]===1)back.add(e);else if(state[to]===0)visit(to);}state[node]=2;};
 spec.nodes.forEach((_,i)=>{if(state[i]===0)visit(i);});
 const forward=spec.edges.map((edge,i)=>({from:index.get(edge.from)!,to:index.get(edge.to)!,i})).filter(edge=>!back.has(edge.i));
 const indegree=spec.nodes.map((_,i)=>forward.filter(edge=>edge.to===i).length),layer=spec.nodes.map(()=>0),ready=spec.nodes.map((_,i)=>i).filter(i=>indegree[i]===0);
 while(ready.length){ready.sort((a,b)=>a-b);const node=ready.shift()!;for(const edge of forward.filter(edge=>edge.from===node)){layer[edge.to]=Math.max(layer[edge.to],layer[node]+1);if(--indegree[edge.to]===0)ready.push(edge.to);}}
 const layerCount=Math.max(...layer)+1,groupOrder=new Map((spec.groups??[]).map((group,i)=>[group.id,i])),position=spec.nodes.map(()=>0),layers:number[][]=[];
 for(let l=0;l<layerCount;l++){
  const members=spec.nodes.map((_,i)=>i).filter(i=>layer[i]===l);
  const center=(i:number)=>{const preds=forward.filter(edge=>edge.to===i&&layer[edge.from]<l).map(edge=>position[edge.from]);return preds.length?preds.reduce((a,b)=>a+b,0)/preds.length:i;};
  const keyed=members.map(i=>({i,group:groupOrder.get(spec.nodes[i].group??'')??-1,center:l===0?i:center(i)}));
  keyed.sort((a,b)=>a.group-b.group||a.center-b.center||a.i-b.i);
  keyed.forEach((item,order)=>{position[item.i]=order;});layers.push(keyed.map(item=>item.i));
 }
 const widest=Math.max(...layers.map(members=>members.length)),major=direction==='down'?g.nodeHeight:g.nodeWidth,minor=direction==='down'?g.nodeWidth:g.nodeHeight;
 const minorSpan=widest*minor+(widest-1)*g.siblingGap,majorSpan=layerCount*major+(layerCount-1)*g.layerGap,room=back.size?g.backEdgeRoom:0;
 const nodes:LaidNode[]=spec.nodes.map((node,i)=>{
  const members=layers[layer[i]],span=members.length*minor+(members.length-1)*g.siblingGap,offset=(minorSpan-span)/2+position[i]*(minor+g.siblingGap);
  const along=layer[i]*(major+g.layerGap),x=g.padding+(direction==='down'?offset:along),y=g.padding+(direction==='down'?along:offset);
  return {id:node.id,kind:node.kind,x:Math.round(x),y:Math.round(y),width:g.nodeWidth,height:g.nodeHeight,lines:wrapLabel(node.label),layer:layer[i],...(node.citation!==undefined?{citation:node.citation}:{}),...(node.group!==undefined?{group:node.group}:{})};
 });
 const edges:LaidEdge[]=spec.edges.map((edge,i)=>{
  const a=nodes[index.get(edge.from)!],b=nodes[index.get(edge.to)!],isBack=back.has(i)||layer[index.get(edge.to)!]<=layer[index.get(edge.from)!];
  let p0:[number,number],p1:[number,number],p2:[number,number],p3:[number,number];
  if(direction==='down'){
   if(isBack){p0=[a.x+a.width,a.y+a.height/2];p3=[b.x+b.width,b.y+b.height/2];const bulge=Math.max(p0[0],p3[0])+room;p1=[bulge,p0[1]];p2=[bulge,p3[1]];}
   else{p0=[a.x+a.width/2,a.y+a.height];p3=[b.x+b.width/2,b.y];const mid=(p0[1]+p3[1])/2;p1=[p0[0],mid];p2=[p3[0],mid];}
  }else{
   if(isBack){p0=[a.x+a.width/2,a.y+a.height];p3=[b.x+b.width/2,b.y+b.height];const bulge=Math.max(p0[1],p3[1])+room;p1=[p0[0],bulge];p2=[p3[0],bulge];}
   else{p0=[a.x+a.width,a.y+a.height/2];p3=[b.x,b.y+b.height/2];const mid=(p0[0]+p3[0])/2;p1=[mid,p0[1]];p2=[mid,p3[1]];}
  }
  const r=(v:number)=>Math.round(v),labelX=r((p0[0]+3*p1[0]+3*p2[0]+p3[0])/8),labelY=r((p0[1]+3*p1[1]+3*p2[1]+p3[1])/8);
  return {from:edge.from,to:edge.to,path:`M${r(p0[0])} ${r(p0[1])} C${r(p1[0])} ${r(p1[1])} ${r(p2[0])} ${r(p2[1])} ${r(p3[0])} ${r(p3[1])}`,back:isBack,labelX,labelY,...(edge.label!==undefined?{label:edge.label}:{})};
 });
 const groups:LaidGroup[]=(spec.groups??[]).flatMap(group=>{
  const members=nodes.filter(node=>node.group===group.id);if(!members.length)return [];
  const left=Math.min(...members.map(n=>n.x))-12,top=Math.min(...members.map(n=>n.y))-22,right=Math.max(...members.map(n=>n.x+n.width))+12,bottom=Math.max(...members.map(n=>n.y+n.height))+12;
  return [{id:group.id,label:group.label,x:left,y:top,width:right-left,height:bottom-top}];
 });
 const width=Math.round(2*g.padding+(direction==='down'?minorSpan+room:majorSpan)),height=Math.round(2*g.padding+(direction==='down'?majorSpan:minorSpan+room));
 return {width,height,direction,nodes,edges,groups};
}

export function diagramText(spec:DiagramSpec):string{
 const name=new Map(spec.nodes.map(node=>[node.id,node.label]));
 return [spec.title?`Diagram: ${spec.title}`:'Diagram',...spec.nodes.map(node=>`- ${node.label} (${node.kind})${node.citation?` [${node.citation}]`:''}`),...spec.edges.map(edge=>`- ${name.get(edge.from)} → ${edge.label?edge.label+' → ':''}${name.get(edge.to)}`)].join('\n');
}
