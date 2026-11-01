import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {open,link,unlink,realpath,lstat} from 'node:fs/promises';
import {basename,dirname,extname,isAbsolute,join,resolve} from 'node:path';
import type {Task} from '../core/types';
import {csvChartSource} from '../core/csv-chart-source';
import {readDocumentCsv} from '../shared/document-import';
import {readCsvWorkbookCommand,workbookView,defaultWorkbookView,type WorkbookView,type CsvWorkbookCommand,type CsvWorkbookPreview,type CsvWorkbookResult} from '../shared/csv-workbook';

const hash=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
const crcTable=Uint32Array.from({length:256},(_,index)=>{let value=index;for(let bit=0;bit<8;bit++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0;});
const crc32=(bytes:Buffer)=>{let value=0xffffffff;for(const byte of bytes)value=crcTable[(value^byte)&255]^(value>>>8);return (value^0xffffffff)>>>0;};
function xml(value:string){if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udfff]/u.test(value))throw Error('A CSV value contains characters that cannot be represented faithfully in XML. Nothing was saved.');return value.replace(/[&<>"'\r]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;','\r':'&#13;'}[char]!));}
function inline(value:string){
 // Separate literal escape-looking text at run boundaries: no text node can
 // be decoded by Excel as _xHHHH_. Readers concatenate the original text.
 const parts=value.split(/(_)(?=x[0-9a-fA-F]{4}_)/g),text=(part:string)=>`<t xml:space="preserve">${xml(part)}</t>`;
 return parts.length===1?text(value):parts.map(part=>`<r>${text(part)}</r>`).join('');
}
const column=(index:number)=>{let label='';for(let value=index+1;value;value=Math.floor((value-1)/26))label=String.fromCharCode(65+(value-1)%26)+label;return label;};
/** Private, fixed-entry stored ZIP for this workbook only; no archive reader/extractor. */
function workbookZip(parts:readonly {name:string;xml:string}[]):Buffer{
 const local:Buffer[]=[],central:Buffer[]=[];let offset=0;
 for(const part of parts){const name=Buffer.from(part.name,'utf8'),body=Buffer.from(part.xml,'utf8'),crc=crc32(body),head=Buffer.alloc(30);head.writeUInt32LE(0x04034b50);head.writeUInt16LE(20,4);head.writeUInt16LE(0x800,6);head.writeUInt16LE(0x21,12);head.writeUInt32LE(crc,14);head.writeUInt32LE(body.length,18);head.writeUInt32LE(body.length,22);head.writeUInt16LE(name.length,26);local.push(head,name,body);
  const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(0x800,8);entry.writeUInt16LE(0x21,14);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(body.length,20);entry.writeUInt32LE(body.length,24);entry.writeUInt16LE(name.length,28);entry.writeUInt32LE(offset,42);central.push(entry,name);offset+=head.length+name.length+body.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(parts.length,8);end.writeUInt16LE(parts.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,directory,end]);
}
export function csvWorkbook(data:ReturnType<typeof csvChartSource>,input:WorkbookView=defaultWorkbookView){
 const worksheet=workbookView(data.csv,input),rows=[worksheet.header,...worksheet.records.map(record=>record.values)],columns=worksheet.columns,cells=rows.reduce((sum,row)=>sum+row.length,0),ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main',relationships='http://schemas.openxmlformats.org/package/2006/relationships',declaration='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
 const sheet=`<worksheet xmlns="${ns}"><dimension ref="A1:${column(columns-1)}${rows.length}"/><sheetData>${rows.map((row,index)=>`<row r="${index+1}"${index>0&&worksheet.records[index-1].hidden?' hidden="1"':''}>${row.map((value,c)=>`<c r="${column(c)}${index+1}" s="0" t="inlineStr"><is>${inline(value)}</is></c>`).join('')}</row>`).join('')}</sheetData>${worksheet.view.filter||worksheet.view.sort?`<autoFilter ref="A1:${column(columns-1)}${rows.length}">${worksheet.view.filter?`<filterColumn colId="${worksheet.view.filter.column}"><filters${worksheet.view.filter.equals===''?' blank="1"':''}>${worksheet.view.filter.equals===''?'':`<filter val="${xml(worksheet.view.filter.equals)}"/>`}</filters></filterColumn>`:''}${worksheet.view.sort&&rows.length>1?`<sortState ref="A2:${column(columns-1)}${rows.length}"><sortCondition ref="${column(worksheet.view.sort.column)}2:${column(worksheet.view.sort.column)}${rows.length}" descending="${worksheet.view.sort.direction==='descending'?1:0}"/></sortState>`:''}</autoFilter>`:''}</worksheet>`;
 const properties=[['GlintSourceTask',data.taskId],['GlintSourceId',data.source.sourceId],['GlintSourceVersion',String(data.source.version)],['GlintSourceSHA256',data.source.digest],['GlintCsvSHA256',data.dataDigest],['GlintCellPolicy','All cells are editable text. No formulas, numeric/date inference, macros or external links.'],...(worksheet.view.sort||worksheet.view.filter?[['GlintWorksheetView',JSON.stringify(worksheet.view)],['GlintVisibleRecords',String(worksheet.visibleRecords)]]:[]),...(data.originalFile?[['OriginalFileName',data.originalFile.name],['OriginalFileSHA256',data.originalFile.digest]]:[])];
 const parts=[
  {name:'[Content_Types].xml',xml:'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/></Types>'},
  {name:'_rels/.rels',xml:`<Relationships xmlns="${relationships}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/></Relationships>`},
  {name:'xl/workbook.xml',xml:`<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="CSV data" sheetId="1" r:id="rId1"/></sheets></workbook>`},
  {name:'xl/_rels/workbook.xml.rels',xml:`<Relationships xmlns="${relationships}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`},
  {name:'xl/styles.xml',xml:`<styleSheet xmlns="${ns}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`},
  {name:'xl/worksheets/sheet1.xml',xml:sheet},
  {name:'docProps/custom.xml',xml:`<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">${properties.map(([name,value],index)=>`<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="${index+2}" name="${name}"><vt:lpwstr>${xml(value)}</vt:lpwstr></property>`).join('')}</Properties>`},
 ];
 const bytes=workbookZip(parts.map(part=>({...part,xml:declaration+part.xml})));return {bytes,rows:rows.length,columns,cells,workbookDigest:hash(bytes),view:worksheet.view,visibleRecords:worksheet.visibleRecords};
}
async function publish(path:string,bytes:Buffer,check:()=>Promise<void>):Promise<boolean>{
 if(!isAbsolute(path)||path!==resolve(path)||extname(path).toLowerCase()!=='.xlsx'||path.includes('\0'))throw Error('Choose an exact new .xlsx destination.');
 const parent=await realpath(dirname(path)),before=await lstat(parent),destination=join(parent,basename(path)),temporary=join(parent,`.glint-workbook-${randomUUID()}.tmp`);let published=false;let identity:{dev:number;ino:number}|undefined;
 try{
  const file=await open(temporary,'wx',0o600);try{await file.writeFile(bytes);await file.sync();const info=await file.stat();identity={dev:info.dev,ino:info.ino};}finally{await file.close();}
  await check();const after=await lstat(parent);if(before.dev!==after.dev||before.ino!==after.ino)throw Error('The workbook destination changed. No file was saved.');await link(temporary,destination);published=true;
  const directory=await open(parent,'r');try{await directory.sync();}finally{await directory.close();}
  const saved=await open(destination,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const info=await saved.stat();if(!info.isFile()||info.size!==bytes.length||info.dev!==identity?.dev||info.ino!==identity.ino)return false;const copy=Buffer.alloc(bytes.length+1);let count=0;while(count<copy.length){const result=await saved.read(copy,count,copy.length-count,count);if(!result.bytesRead)break;count+=result.bytesRead;}const after=await saved.stat();return count===bytes.length&&after.size===bytes.length&&copy.subarray(0,count).equals(bytes);}finally{await saved.close();}
 }catch(error){if(published)return false;if(error&&typeof error==='object'&&'code'in error&&error.code==='EEXIST')throw Error('A file already exists at this destination. Choose a new filename.');throw error;}
 finally{await unlink(temporary).catch(()=>{});}
}
export class CsvWorkbooks{
 private busy=false;
 constructor(private readonly readTask:(taskId:string)=>Promise<Task>,private readonly choose:(preview:CsvWorkbookPreview)=>Promise<string|null>){}
 async preview(input:CsvWorkbookCommand,assertCurrent:()=>void=()=>{}):Promise<CsvWorkbookPreview>{const command=readCsvWorkbookCommand(input);assertCurrent();const data=csvChartSource(await this.readTask(command.taskId),command.source,true);assertCurrent();const workbook=csvWorkbook(data,command.view);return {...data,rows:workbook.rows,columns:workbook.columns,cells:workbook.cells,byteLength:workbook.bytes.length,workbookDigest:workbook.workbookDigest,view:workbook.view,visibleRecords:workbook.visibleRecords};}
 async save(input:CsvWorkbookCommand,assertCurrent:()=>void=()=>{}):Promise<CsvWorkbookResult>{
  const command=readCsvWorkbookCommand(input);if(command.type!=='workbook.save')throw Error('Choose a workbook save action.');if(this.busy)throw Error('Finish the current workbook save first.');this.busy=true;
  try{const preview=await this.preview(command,assertCurrent);if(preview.dataDigest!==command.dataDigest)throw Error('The CSV data basis changed. Review the source again.');if(command.workbookDigest&&preview.workbookDigest!==command.workbookDigest)throw Error('The worksheet options or workbook bytes changed. Inspect this exact view before saving.');const path=await this.choose(preview);if(!path)return {kind:'cancelled'};
   const check=async()=>{assertCurrent();const current=csvChartSource(await this.readTask(command.taskId),command.source,true);assertCurrent();if(current.dataDigest!==command.dataDigest)throw Error('The CSV source data changed. No workbook was saved.');};await check();const workbook=csvWorkbook(preview,command.view),verified=await publish(path,workbook.bytes,check);return {kind:verified?'saved':'unconfirmed',path,source:{...command.source},dataDigest:preview.dataDigest,workbookDigest:workbook.workbookDigest,byteLength:workbook.bytes.length,rows:workbook.rows,columns:workbook.columns,cells:workbook.cells,view:workbook.view,visibleRecords:workbook.visibleRecords};
  }finally{this.busy=false;}
 }
}
