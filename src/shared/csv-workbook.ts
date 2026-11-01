import {Schema} from 'effect';
import {readDocumentCsv} from './document-import';
import type {SourceRef} from '../core/types';
import type {CsvChartData} from './csv-chart';
const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200));
const digest=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/));
const source=Schema.Struct({sourceId:id,version:Schema.Int.pipe(Schema.positive()),digest});
const column=Schema.Int.pipe(Schema.between(0,99));
export const WorkbookViewSchema=Schema.Struct({sort:Schema.NullOr(Schema.Struct({column,mode:Schema.Literal('text','number'),direction:Schema.Literal('ascending','descending')})),filter:Schema.NullOr(Schema.Struct({column,equals:Schema.String.pipe(Schema.maxLength(200),Schema.filter(value=>!/[\u0000-\u001f\u007f]/.test(value)))}))});
export type WorkbookView=typeof WorkbookViewSchema.Type;
export const defaultWorkbookView:WorkbookView=Object.freeze({sort:null,filter:null});
export const readWorkbookView=Schema.decodeUnknownSync(WorkbookViewSchema,{onExcessProperty:'error'});
const command=Schema.Union(Schema.Struct({type:Schema.Literal('workbook.preview'),taskId:id,source,view:Schema.optional(WorkbookViewSchema)}),Schema.Struct({type:Schema.Literal('workbook.save'),taskId:id,source,dataDigest:digest,view:Schema.optional(WorkbookViewSchema),workbookDigest:Schema.optional(digest)}).pipe(Schema.filter(value=>!value.view||!!value.workbookDigest)));
export type CsvWorkbookCommand=typeof command.Type;
export const readCsvWorkbookCommand=Schema.decodeUnknownSync(command,{onExcessProperty:'error'});
export type CsvWorkbookPreview=CsvChartData&{rows:number;columns:number;cells:number;byteLength:number;workbookDigest:string;view:WorkbookView;visibleRecords:number};
export type CsvWorkbookResult={kind:'cancelled'}|{kind:'saved'|'unconfirmed';path:string;source:SourceRef;dataDigest:string;workbookDigest:string;byteLength:number;rows:number;columns:number;cells:number;view:WorkbookView;visibleRecords:number};

/** Whole records are reordered; filtering only marks visibility, never drops data. */
export function workbookView(csv:string,input:WorkbookView=defaultWorkbookView){
 const view=readWorkbookView(input),rows=readDocumentCsv(csv),columns=Math.max(...rows.map(row=>row.length)),header=rows[0],records=rows.slice(1).map((values,index)=>({values,originalRecord:index+2,hidden:false}));
 if(view.sort&&view.sort.column>=columns||view.filter&&view.filter.column>=columns)throw Error('Choose an available worksheet column by position.');
 const sort=view.sort;
 if(sort){
  const numeric=new Map<number,number>();
  if(sort.mode==='number')for(const record of records){const raw=record.values[sort.column];if(raw===undefined||!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(raw))throw Error(`CSV record ${record.originalRecord}: numeric sorting requires a complete decimal number in every cell, without spaces or blanks.`);const value=Number(raw),digits=raw.split(/[eE]/)[0].replace(/[-+.]/g,'').replace(/^0+|0+$/g,'');if(!Number.isFinite(value)||Math.abs(value)>1e12||value!==0&&Math.abs(value)<1e-12||value===0&&/[1-9]/.test(digits)||digits.length>15)throw Error('Numeric sorting supports up to15 significant digits, zero or magnitudes from1e-12 to1e12. Cell text remains unchanged.');numeric.set(record.originalRecord,value);}
  records.sort((a,b)=>{const left=sort.mode==='number'?numeric.get(a.originalRecord)!:a.values[sort.column]??'',right=sort.mode==='number'?numeric.get(b.originalRecord)!:b.values[sort.column]??'',difference=left===right?0:left<right?-1:1;return difference*(sort.direction==='ascending'?1:-1)||a.originalRecord-b.originalRecord;});
 }
 if(view.filter){const filter=view.filter,criterion=filter.equals.toLowerCase();for(const record of records)record.hidden=(record.values[filter.column]??'').toLowerCase()!==criterion;}
 return {view,header,records,columns,totalRecords:records.length,visibleRecords:records.filter(record=>!record.hidden).length};
}
