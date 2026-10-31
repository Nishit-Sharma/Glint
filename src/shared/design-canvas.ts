import {Schema} from 'effect';
import type {ArtifactRef,ArtifactRevision,Task} from '../core/types';

export const DESIGN_CANVAS_MIME='application/vnd.glint.design-canvas+json';
export const DESIGN_SVG_MIME='application/vnd.glint.design-svg+xml';
export const DESIGN_CANVAS_SLOT='design-canvas:edit';
export const CANVAS_PROMPT_SLOT='design-canvas:prompt';
const text=(max:number)=>Schema.String.pipe(Schema.maxLength(max),Schema.filter(value=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)));
const id=Schema.String.pipe(Schema.pattern(/^[a-zA-Z0-9_-]{1,80}$/));
const coordinate=Schema.Number.pipe(Schema.finite(),Schema.between(0,2400));
const color=Schema.String.pipe(Schema.pattern(/^#[0-9a-fA-F]{6}$/));
const shape=Schema.Struct({id,kind:Schema.Literal('rectangle','ellipse','text','connector','freehand'),points:Schema.Array(Schema.Struct({x:Schema.Number.pipe(Schema.finite(),Schema.between(0,1)),y:Schema.Number.pipe(Schema.finite(),Schema.between(0,1))})).pipe(Schema.maxItems(64),Schema.mutable),label:text(80),text:text(512),x:coordinate,y:coordinate,width:coordinate,height:coordinate,fill:color,stroke:color,strokeWidth:Schema.Number.pipe(Schema.finite(),Schema.between(0,12)),fontSize:Schema.Number.pipe(Schema.finite(),Schema.between(8,96))});
const canvas=Schema.Struct({schemaVersion:Schema.Literal(1),kind:Schema.Literal('design-canvas'),title:text(160),summary:text(1000),width:Schema.Number.pipe(Schema.finite(),Schema.between(240,2400)),height:Schema.Number.pipe(Schema.finite(),Schema.between(160,2400)),background:color,shapes:Schema.Array(shape).pipe(Schema.maxItems(32),Schema.mutable)});
export type DesignCanvas=typeof canvas.Type;
export type CanvasShape=typeof shape.Type;
const numericText=Schema.String.pipe(Schema.maxLength(32));
const rawShape=Schema.Struct({...shape.fields,x:numericText,y:numericText,width:numericText,height:numericText,strokeWidth:numericText,fontSize:numericText});
const rawCanvas=Schema.Struct({...canvas.fields,width:numericText,height:numericText,shapes:Schema.Array(rawShape).pipe(Schema.maxItems(32),Schema.mutable)});
export type CanvasRaw=typeof rawCanvas.Type;
export const CanvasDraftOwnerSchema=Schema.Struct({kind:Schema.Literal('design-canvas-edit'),taskId:id,artifactId:id,artifactRevision:Schema.Int.pipe(Schema.positive()),artifactDigest:Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/))});
export type CanvasDraftOwner=typeof CanvasDraftOwnerSchema.Type;
const promptDraft=Schema.Struct({text:text(2000),sourceIds:Schema.Array(id).pipe(Schema.maxItems(3),Schema.mutable)});
export type CanvasPrompt=typeof promptDraft.Type;
export const emptyCanvasPrompt:CanvasPrompt={text:'',sourceIds:[]};
export function readCanvasPrompt(value:unknown):CanvasPrompt{return Schema.decodeUnknownSync(promptDraft,{onExcessProperty:'error'})(value);}
const ref=Schema.Struct({artifactId:id,revision:Schema.Int.pipe(Schema.positive()),digest:Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/))});
const sketchContext=Schema.Struct({basis:ref,selectedIds:Schema.Array(id).pipe(Schema.maxItems(8),Schema.filter(values=>new Set(values).size===values.length),Schema.mutable)});
export type CanvasSketchContext=typeof sketchContext.Type;
export const readCanvasSketchContext=(value:unknown):CanvasSketchContext=>Schema.decodeUnknownSync(sketchContext,{onExcessProperty:'error'})(value);
const saveInput=Schema.Struct({taskId:id,requestId:id,canvas,artifact:Schema.optional(ref)});
const svgInput=Schema.Struct({taskId:id,requestId:id,artifact:ref});
export type CanvasSave=typeof saveInput.Type;
export type CanvasSvg=typeof svgInput.Type;
export type CanvasSaved={task:Task;artifactId:string;revision:number};
const decode=<A,I>(schema:Schema.Schema<A,I>,value:unknown):A=>Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(value);
export function readDesignCanvas(value:unknown):DesignCanvas{
 const parsed=decode(canvas,value);
 if(!parsed.title.trim()||new Set(parsed.shapes.map(item=>item.id)).size!==parsed.shapes.length)throw Error('Give the canvas a title and each shape a distinct identity.');
 for(const item of parsed.shapes){if(item.kind==='freehand'?item.points.length<2:item.points.length!==0)throw Error('Only freehand shapes use two to 64 normalized stroke points.');if(!item.label.trim()||item.width<8||item.height<8||item.x+item.width>parsed.width||item.y+item.height>parsed.height)throw Error('Keep every labelled shape inside the canvas with a width and height of at least 8.');}
 return parsed;
}
export function readCanvasRaw(value:unknown):CanvasRaw{return decode(rawCanvas,value);}
export function canvasRaw(value:DesignCanvas):CanvasRaw{return {...value,width:String(value.width),height:String(value.height),shapes:value.shapes.map(item=>({...item,x:String(item.x),y:String(item.y),width:String(item.width),height:String(item.height),strokeWidth:String(item.strokeWidth),fontSize:String(item.fontSize)}))};}
export function canvasFromRaw(value:CanvasRaw):DesignCanvas{
 const number=(value:string)=>{if(!/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(value))throw Error('Enter nonnegative numbers for positions, size and appearance.');return Number(value);};
 return readDesignCanvas({...value,width:number(value.width),height:number(value.height),shapes:value.shapes.map(item=>({...item,...Object.fromEntries((['x','y','width','height','strokeWidth','fontSize'] as const).map(key=>[key,number(item[key])]))}))});
}
export const blankCanvas:DesignCanvas={schemaVersion:1,kind:'design-canvas',title:'Untitled canvas',summary:'',width:960,height:640,background:'#ffffff',shapes:[]};
export function newCanvasShape(kind:CanvasShape['kind'],index:number):CanvasShape{return {id:crypto.randomUUID(),kind,points:[],label:kind.charAt(0).toUpperCase()+kind.slice(1)+' '+(index+1),text:kind==='text'?'Your text':'',x:32+(index%6)*24,y:32+(index%6)*24,width:kind==='text'?240:160,height:kind==='text'?80:100,fill:kind==='text'?'#263b32':'#e5eee9',stroke:'#476a58',strokeWidth:kind==='text'?0:2,fontSize:24};}
export function canvasDraftOwner(taskId:string,artifactId:string,revision:ArtifactRevision):CanvasDraftOwner{return {kind:'design-canvas-edit',taskId,artifactId,artifactRevision:revision.revision,artifactDigest:revision.digest};}
export function canvasDraftBasis(owner:CanvasDraftOwner):string{return JSON.stringify(['design-canvas',1,owner.taskId,owner.artifactId,owner.artifactRevision,owner.artifactDigest]);}
export function readCanvasSave(value:unknown):CanvasSave{const input=decode(saveInput,value);return {...input,canvas:readDesignCanvas(input.canvas)};}
export const readCanvasSvg=(value:unknown):CanvasSvg=>decode(svgInput,value);
export function canvasRevision(revision:ArtifactRevision):DesignCanvas{if(revision.mimeType!==DESIGN_CANVAS_MIME||revision.encoding==='base64')throw Error('This file is not an editable canvas.');return readDesignCanvas(JSON.parse(revision.content));}
export function currentCanvas(task:Task,basis:ArtifactRef):DesignCanvas{const revision=task.artifacts.find(item=>item.id===basis.artifactId)?.revisions.at(-1);if(!revision||revision.revision!==basis.revision||revision.digest!==basis.digest)throw Error('The canvas changed. Reopen its current version before saving.');return canvasRevision(revision);}
const xml=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]!));
export function canvasSvg(value:DesignCanvas):string{
 const doc=readDesignCanvas(value),parts=doc.shapes.map(item=>{const style=`fill="${item.fill}" stroke="${item.stroke}" stroke-width="${item.strokeWidth}"`;
  if(item.kind==='freehand')return `<polyline points="${item.points.map(point=>`${item.x+point.x*item.width},${item.y+point.y*item.height}`).join(' ')}" fill="none" stroke="${item.stroke}" stroke-width="${item.strokeWidth}"/>`;
  if(item.kind==='rectangle')return `<rect x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}" ${style}/>`;
  if(item.kind==='ellipse')return `<ellipse cx="${item.x+item.width/2}" cy="${item.y+item.height/2}" rx="${item.width/2}" ry="${item.height/2}" ${style}/>`;
  if(item.kind==='connector')return `<line x1="${item.x}" y1="${item.y}" x2="${item.x+item.width}" y2="${item.y+item.height}" stroke="${item.stroke}" stroke-width="${item.strokeWidth}"/>`;
  return `<svg x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}" overflow="hidden"><text x="0" y="${item.fontSize}" font-family="sans-serif" font-size="${item.fontSize}" ${style}>${item.text.split('\n').map((line,index)=>`<tspan x="0" dy="${index?item.fontSize*1.25:0}">${xml(line)}</tspan>`).join('')}</text></svg>`;
 });
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}"><title>${xml(doc.title)}</title><rect width="${doc.width}" height="${doc.height}" fill="${doc.background}"/>${parts.join('')}</svg>`;
}
export function safeCanvasSvg(content:string):boolean{
 if(content.length>100000||!content.startsWith('<svg xmlns="http://www.w3.org/2000/svg" ')||!content.endsWith('</svg>'))return false;
 const attributes=new Set(['xmlns','width','height','viewBox','x','y','cx','cy','rx','ry','fill','stroke','stroke-width','x1','x2','y1','y2','font-family','font-size','overflow','dy','points']);
 const tags=content.match(/<[^>]*>/g)??[];
 for(const tag of tags){if(!/^<\/?(?:svg|title|rect|ellipse|line|polyline|text|tspan)(?:\s|\/?>)/u.test(tag))return false;const fields=tag.replace(/^<\/?[a-z]+/u,'').replace(/\/?>$/u,'');let consumed='';for(const match of fields.matchAll(/\s+([A-Za-z-]+)="([^"]*)"/g)){if(!attributes.has(match[1])||! /^(?:http:\/\/www\.w3\.org\/2000\/svg|sans-serif|hidden|none|#[a-fA-F0-9]{6}|[\d., ]+)$/u.test(match[2]))return false;consumed+=match[0];}if(consumed!==fields)return false;}
 return !content.replace(/<[^>]*>/g,'').replace(/&(?:amp|lt|gt|quot|apos);/g,'').includes('&');
}
