import {Schema} from 'effect';
import type {ArtifactRef,Task} from '../core/types';
import {readDocumentCsv} from './document-import';
import {readCsvChartData,type CsvChartData} from './csv-chart';

export const CSV_STATISTICS_MIME='application/vnd.glint.csv-statistics+json';
const Id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0')));
const Digest=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/));
const Revision=Schema.Int.pipe(Schema.positive(),Schema.filter(Number.isSafeInteger));
const Column=Schema.Int.pipe(Schema.between(0,99));
const Source=Schema.Struct({sourceId:Id,version:Revision,digest:Digest});
const Artifact=Schema.Struct({artifactId:Id,revision:Revision,digest:Digest});
const Settings=Schema.Struct({title:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(160),Schema.filter(value=>!!value.trim()&&!/[\u0000-\u001f\u007f]/.test(value))),columns:Schema.Array(Column).pipe(Schema.minItems(1),Schema.maxItems(100),Schema.filter(values=>new Set(values).size===values.length)),missing:Schema.Literal('reject','omit-empty')});
export type CsvStatisticsSettings=typeof Settings.Type;
const Finite=Schema.Number.pipe(Schema.filter(Number.isFinite));
const Count=Schema.Int.pipe(Schema.between(0,10000));
const Result=Schema.Struct({column:Column,heading:Schema.String.pipe(Schema.maxLength(10000)),count:Count,missing:Count,sum:Finite,mean:Finite,median:Finite,min:Finite,max:Finite,populationVariance:Finite,populationStdDev:Finite,sampleVariance:Schema.NullOr(Finite),sampleStdDev:Schema.NullOr(Finite)});
const Body=Schema.Struct({kind:Schema.Literal('csv-statistics'),schemaVersion:Schema.Literal(1),method:Schema.Literal('compensated-centered-v1'),creationId:Id,source:Source,dataDigest:Digest,settings:Settings,results:Schema.Array(Result).pipe(Schema.minItems(1),Schema.maxItems(100))});
export type CsvStatistics=typeof Body.Type;
const Command=Schema.Union(Schema.Struct({type:Schema.Literal('statistics.data'),taskId:Id,source:Source}),Schema.Struct({type:Schema.Literal('statistics.save'),taskId:Id,creationId:Id,source:Source,dataDigest:Digest,settings:Settings,artifact:Schema.optional(Artifact)}));
export type CsvStatisticsCommand=typeof Command.Type;
export type CsvStatisticsSave=Extract<CsvStatisticsCommand,{type:'statistics.save'}>;
export type CsvStatisticsSaved={task:Task;artifactId:string;revision:number;digest:string};
export type CsvStatisticsData=CsvChartData;
export const readCsvStatisticsData=readCsvChartData;
export const readCsvStatisticsCommand=Schema.decodeUnknownSync(Command,{onExcessProperty:'error'});
export const readCsvStatistics=Schema.decodeUnknownSync(Body,{onExcessProperty:'error'});
export const readCsvStatisticsSettings=Schema.decodeUnknownSync(Settings,{onExcessProperty:'error'});
export const csvStatisticsRef=(saved:CsvStatisticsSaved):ArtifactRef=>({artifactId:saved.artifactId,revision:saved.revision,digest:saved.digest});
export function csvStatisticsHeaders(csv:string):string[]{const rows=readDocumentCsv(csv);return Array.from({length:Math.max(...rows.map(row=>row.length))},(_,index)=>rows[0][index]??'');}
const finite=(value:number)=>{if(!Number.isFinite(value))throw Error('The selected numbers exceed the finite arithmetic range. No statistics were saved.');return value;};
function compensated(values:readonly number[]):number{
 let sum=0,correction=0;
 for(const value of values){const next=finite(sum+value);correction=finite(correction+(Math.abs(sum)>=Math.abs(value)?(sum-next)+value:(value-next)+sum));sum=next;}
 return finite(sum+correction);
}
/** Full decimal parsing, compensated sum and shifted, scaled two-pass variance.
 * Raw cells remain in the exact immutable CSV source, never rounded on save. */
export function csvStatistics(csv:string,input:CsvStatisticsSettings){
 const settings=readCsvStatisticsSettings(input),rows=readDocumentCsv(csv),headers=csvStatisticsHeaders(csv),records=rows.slice(1);
 if(!records.length)throw Error('Choose CSV with at least one data record after its header.');
 return settings.columns.map(column=>{
  if(column>=headers.length)throw Error('Choose available numeric columns by their positions.');
  const values:number[]=[];let missing=0;
  records.forEach((row,index)=>{
   const raw=row[column];
   if(raw===undefined||raw===''){if(settings.missing==='omit-empty'){missing++;return;}throw Error(`CSV record ${index+2}, column ${column+1}: an empty or absent cell requires the explicit omit-empty policy.`);}
   if(!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(raw))throw Error(`CSV record ${index+2}, column ${column+1}: enter a complete decimal number without spaces, formulas or units.`);
   const value=Number(raw);if(!Number.isFinite(value)||value===0&&/[1-9]/.test(raw.split(/[eE]/)[0]))throw Error(`CSV record ${index+2}, column ${column+1}: the number overflows or underflows finite numeric precision.`);values.push(value);
  });
  const count=values.length;if(!count)throw Error(`Column ${column+1} has no numeric values. No statistics were saved.`);
  const sum=compensated(values),mean=finite(sum/count),origin=values[0],shifted=values.map(value=>finite(value-origin)),center=finite(compensated(shifted)/count),deviations=shifted.map(value=>finite(value-center)),scale=Math.max(...deviations.map(Math.abs)),squares=scale===0?0:compensated(deviations.map(value=>(value/scale)**2));
  const variance=(divisor:number)=>{const result=scale===0?0:finite(scale*(scale*(squares/divisor)));if(scale>0&&result===0)throw Error('Variance underflows numeric precision. No statistics were saved.');return result;};
  const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(count/2),a=sorted[middle-1],b=sorted[middle],median=count%2?b:finite(Number.isFinite(b-a)?a+(b-a)/2:a/2+b/2),populationVariance=variance(count),sampleVariance=count>1?variance(count-1):null;
  return {column,heading:headers[column],count,missing,sum,mean,median,min:sorted[0],max:sorted[count-1],populationVariance,populationStdDev:Math.sqrt(populationVariance),sampleVariance,sampleStdDev:sampleVariance===null?null:Math.sqrt(sampleVariance)};
 });
}
