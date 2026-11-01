import {Schema} from 'effect';
import type {ArtifactRef,Task} from '../core/types';
import {readDocumentCsv,DOCUMENT_IMPORT_TEXT_LIMIT} from './document-import';
import {safeCanvasSvg} from './design-canvas';

export const CSV_CHART_MIME='application/vnd.glint.csv-chart+json';
export const CSV_CHART_SVG_MIME='application/vnd.glint.csv-chart-svg+xml';
export const CSV_CHART_ROWS=200;
const Id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0')));
const Digest=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/));
const Revision=Schema.Int.pipe(Schema.positive(),Schema.filter(Number.isSafeInteger));
const Source=Schema.Struct({sourceId:Id,version:Revision,digest:Digest});
const Artifact=Schema.Struct({artifactId:Id,revision:Revision,digest:Digest});
const label=(limit:number)=>Schema.String.pipe(Schema.maxLength(limit),Schema.filter(value=>!/[\u0000-\u001f\u007f]/.test(value)));
const Column=Schema.Int.pipe(Schema.between(0,99));
export const CsvChartSettingsSchema=Schema.Struct({type:Schema.Literal('bar','line'),labelColumn:Column,valueColumn:Column,title:label(160).pipe(Schema.filter(value=>!!value.trim())),xLabel:label(120),yLabel:label(120),seriesLabel:label(120),zoom:Schema.Literal(0.5,1,1.5,2,3)});
export type CsvChartSettings=typeof CsvChartSettingsSchema.Type;
const Body=Schema.Struct({kind:Schema.Literal('csv-chart'),schemaVersion:Schema.Literal(1),creationId:Id,source:Source,dataDigest:Digest,settings:CsvChartSettingsSchema});
export type CsvChart=typeof Body.Type;
const Data=Schema.Struct({taskId:Id,source:Source,label:Schema.String.pipe(Schema.maxLength(500)),csv:Schema.String.pipe(Schema.maxLength(DOCUMENT_IMPORT_TEXT_LIMIT)),dataDigest:Digest,originalFile:Schema.optional(Schema.Struct({name:Schema.String.pipe(Schema.maxLength(200)),digest:Digest}))});
export type CsvChartData=typeof Data.Type;
const Command=Schema.Union(
 Schema.Struct({type:Schema.Literal('chart.data'),taskId:Id,source:Source}),
 Schema.Struct({type:Schema.Literal('chart.save'),taskId:Id,creationId:Id,source:Source,dataDigest:Digest,settings:CsvChartSettingsSchema,artifact:Schema.optional(Artifact)}),
 Schema.Struct({type:Schema.Literal('chart.svg'),taskId:Id,artifact:Artifact})
);
export type CsvChartCommand=typeof Command.Type;
export type CsvChartSave=Extract<CsvChartCommand,{type:'chart.save'}>;
export type CsvChartSaved={task:Task;artifactId:string;revision:number;digest:string};
export const readCsvChartCommand=Schema.decodeUnknownSync(Command,{onExcessProperty:'error'});
export const readCsvChart=Schema.decodeUnknownSync(Body,{onExcessProperty:'error'});
export const readCsvChartData=Schema.decodeUnknownSync(Data,{onExcessProperty:'error'});
export const readCsvChartSettings=Schema.decodeUnknownSync(CsvChartSettingsSchema,{onExcessProperty:'error'});
export const csvChartRef=(saved:CsvChartSaved):ArtifactRef=>({artifactId:saved.artifactId,revision:saved.revision,digest:saved.digest});

export function csvChartPoints(csv:string,input:CsvChartSettings){
 const settings=readCsvChartSettings(input),rows=readDocumentCsv(csv),headers=rows[0],records=rows.slice(1);
 if(!records.length||records.length>CSV_CHART_ROWS)throw Error(`Choose CSV with 1 to ${CSV_CHART_ROWS} data records. Nothing is aggregated or omitted.`);
 if(settings.labelColumn>=headers.length||settings.valueColumn>=headers.length)throw Error('Choose available label and numeric columns by their column positions.');
 const points=records.map((row,index)=>{
  const name=row[settings.labelColumn],raw=row[settings.valueColumn];
  if(name===undefined||name.length>40||/[\r\n\t]/.test(name))throw Error(`CSV record ${index+2}: chart labels must be present, single-line text up to 40 characters.`);
  if(raw===undefined||!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(raw))throw Error(`CSV record ${index+2}: the numeric column must contain a complete decimal number, without spaces, blanks, formulas or units.`);
  const value=Number(raw);if(!Number.isFinite(value)||Math.abs(value)>1e12||value===0&&/[1-9]/.test(raw.split(/[eE]/)[0]))throw Error(`CSV record ${index+2}: use finite numbers between -1,000,000,000,000 and 1,000,000,000,000 without numeric underflow.`);
  return {label:name,raw,value,record:index+2};
 });
 return {settings,headers,points};
}
const xml=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]!));
const number=(value:number)=>String(Number(value.toFixed(4)));
export function csvChartSvg(csv:string,input:CsvChartSettings,sourceLabel:string,version:number):string{
 const {settings,points}=csvChartPoints(csv,input),width=1000,height=640,left=110,plotWidth=820,min=Math.min(0,...points.map(point=>point.value)),maximum=Math.max(0,...points.map(point=>point.value)),max=maximum===min?min+1:maximum;
 const lines=(value:string,length:number)=>value.match(new RegExp(`.{1,${length}}`,'gu'))??[''],titleLines=lines(settings.title,70),seriesLines=settings.seriesLabel?lines(settings.seriesLabel,90):[],axisLines=settings.yLabel?lines(settings.yLabel,90):[],top=Math.max(110,24+titleLines.length*26+(seriesLines.length+axisLines.length)*18+12),plotHeight=460-top;
 const y=(value:number)=>top+(max-value)/(max-min)*plotHeight,step=plotWidth/points.length,x=(index:number)=>left+(index+0.5)*step,baseline=y(0),parts:string[]=[];
 const text=(value:string,px:number,py:number,size=14)=>`<text x="${number(px)}" y="${number(py)}" font-family="sans-serif" font-size="${size}" fill="#18251f">${xml(value)}</text>`;
 parts.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);let headingY=28;for(const line of titleLines){parts.push(text(line,left,headingY,20));headingY+=26;}for(const line of [...seriesLines,...axisLines]){parts.push(text(line,left,headingY));headingY+=18;}
 for(let index=0;index<=4;index++){const value=min+(max-min)*index/4,py=y(value);parts.push(`<polyline points="${left},${number(py)} ${left+plotWidth},${number(py)}" fill="none" stroke="#e2e8e4" stroke-width="1"/>`,text(String(Number(value.toPrecision(6))),10,py+5,12));}
 parts.push(`<polyline points="${left},${number(baseline)} ${left+plotWidth},${number(baseline)}" fill="none" stroke="#18251f" stroke-width="2"/>`);
 if(settings.type==='line')parts.push(`<polyline points="${points.map((point,index)=>number(x(index))+','+number(y(point.value))).join(' ')}" fill="none" stroke="#24745a" stroke-width="3"/>`);
 points.forEach((point,index)=>{
  const px=x(index),py=y(point.value),tip=xml(point.label+': '+point.raw);
  parts.push(settings.type==='bar'?`<rect x="${number(px-step*0.32)}" y="${number(Math.min(py,baseline))}" width="${number(step*0.64)}" height="${number(Math.abs(py-baseline))}" fill="#24745a"><title>${tip}</title></rect>`:`<ellipse cx="${number(px)}" cy="${number(py)}" rx="3" ry="3" fill="#24745a"><title>${tip}</title></ellipse>`);
  if(index%Math.ceil(points.length/8)===0||index===points.length-1){const lines=point.label.match(/.{1,10}/gu)??[''];lines.forEach((line,lineIndex)=>parts.push(text(line,Math.max(left,px-24),490+lineIndex*16,12)));}
 });
 lines(settings.xLabel,90).forEach((line,index)=>parts.push(text(line,left,570+index*18)));parts.push(text(`Exact saved CSV · source version ${version}`,left,622,12));
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>${xml(settings.title)} · ${xml(sourceLabel)} · source version ${version}</title>${parts.join('')}</svg>`;
 if(!safeCanvasSvg(svg))throw Error('The chart exceeds the safe SVG output limits. Keep labels shorter.');return svg;
}
