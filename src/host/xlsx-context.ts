import {inflateRawSync} from 'node:zlib';
import {posix} from 'node:path';
import {DOMParser} from '@xmldom/xmldom';
import {DOCUMENT_IMPORT_TEXT_LIMIT} from '../shared/document-import';

const failure=()=>Error('This Excel workbook is unsupported, malformed or exceeds the XLSX limits. Choose an unencrypted .xlsx with up to 20 sheets, 10,000 rows, 100 columns, 100,000 extracted characters, 2,000 ZIP entries and 32 MiB expanded (4 MiB per XML part). Nothing was imported.');
const crcTable=Uint32Array.from({length:256},(_,i)=>{let x=i;for(let j=0;j<8;j++)x=x&1?0xedb88320^(x>>>1):x>>>1;return x>>>0;});
function crc(bytes:Buffer){let x=0xffffffff;for(const byte of bytes)x=crcTable[(x^byte)&255]^(x>>>8);return (x^0xffffffff)>>>0;}
/** Closed XLSX package reader: no extraction, filename authority, subprocess or remote I/O. */
export function packageParts(bytes:Buffer){
 if(bytes.length<22||bytes.length>20*1024*1024)throw failure();let end=-1;
 for(let at=bytes.length-22;at>=Math.max(0,bytes.length-65557);at--)if(bytes.readUInt32LE(at)===0x06054b50&&at+22+bytes.readUInt16LE(at+20)===bytes.length){end=at;break;}
 if(end<0||bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6))throw failure();const count=bytes.readUInt16LE(end+10),size=bytes.readUInt32LE(end+12),start=bytes.readUInt32LE(end+16);
 if(count<1||count>2000||count!==bytes.readUInt16LE(end+8)||start+size!==end)throw failure();
 const parts=new Map<string,{method:number;start:number;compressed:number;expanded:number;crc:number}>(),ranges:{start:number;end:number}[]=[];let at=start,total=0;
 for(let i=0;i<count;i++){
  if(at+46>end||bytes.readUInt32LE(at)!==0x02014b50)throw failure();const flags=bytes.readUInt16LE(at+8),method=bytes.readUInt16LE(at+10),compressed=bytes.readUInt32LE(at+20),expanded=bytes.readUInt32LE(at+24),length=bytes.readUInt16LE(at+28),extra=bytes.readUInt16LE(at+30),comment=bytes.readUInt16LE(at+32),offset=bytes.readUInt32LE(at+42),next=at+46+length+extra+comment;
  if(flags&1||flags&0x40||![0,8].includes(method)||next>end||bytes.readUInt16LE(at+34)||expanded>4*1024*1024||(total+=expanded)>32*1024*1024||offset+30>start)throw failure();
  const rawName=bytes.subarray(at+46,at+46+length),name=new TextDecoder('utf-8',{fatal:true}).decode(rawName);
  if(!name||name.includes('\\')||name.includes('\0')||name.startsWith('/')||name.split('/').some(part=>part==='.'||part==='..')||parts.has(name)||/vbaProject\.bin$/i.test(name))throw failure();
  if(bytes.readUInt32LE(offset)!==0x04034b50||bytes.readUInt16LE(offset+6)!==flags||bytes.readUInt16LE(offset+8)!==method||bytes.readUInt16LE(offset+26)!==length)throw failure();const data=offset+30+length+bytes.readUInt16LE(offset+28);
  if(data+compressed>start||!bytes.subarray(offset+30,offset+30+length).equals(rawName))throw failure();
  if(!(flags&8)&&(bytes.readUInt32LE(offset+14)!==bytes.readUInt32LE(at+16)||bytes.readUInt32LE(offset+18)!==compressed||bytes.readUInt32LE(offset+22)!==expanded))throw failure();
  parts.set(name,{method,start:data,compressed,expanded,crc:bytes.readUInt32LE(at+16)});ranges.push({start:offset,end:data+compressed});at=next;
 }
 if(at!==end)throw failure();ranges.sort((a,b)=>a.start-b.start);for(let i=1;i<ranges.length;i++)if(ranges[i].start<ranges[i-1].end)throw failure();
 return (name:string)=>{const part=parts.get(name);if(!part)throw failure();const packed=bytes.subarray(part.start,part.start+part.compressed),body=part.method===0?packed:inflateRawSync(packed,{maxOutputLength:Math.max(1,part.expanded)});if(body.length!==part.expanded||crc(body)!==part.crc)throw failure();return body;};
}
const mainNamespaces=new Set(['http://schemas.openxmlformats.org/spreadsheetml/2006/main','http://purl.oclc.org/ooxml/spreadsheetml/main']);
export function xml(bytes:Buffer,root:string,namespace?:string){
 const encoding=bytes[0]===0xff&&bytes[1]===0xfe?'utf-16le':bytes[0]===0xfe&&bytes[1]===0xff?'utf-16be':'utf-8',text=new TextDecoder(encoding,{fatal:true}).decode(bytes);
 if(/<!DOCTYPE|<!ENTITY/i.test(text)||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)||(text.match(/</g)?.length??0)>100000)throw failure();
 const reject=()=>{throw failure();},doc=new DOMParser({errorHandler:{warning:reject,error:reject,fatalError:reject}}).parseFromString(text,'application/xml'),element=doc.documentElement;
 if(!element||element.localName!==root||namespace&&element.namespaceURI!==namespace||doc.doctype)throw failure();
 const pending:[Node,number][]=[[doc,0]];let nodes=0;while(pending.length){const [node,depth]=pending.pop()!;if(depth>64||++nodes>150000)throw failure();for(let child=node.firstChild;child;child=child.nextSibling)pending.push([child,depth+1]);}
 return element;
}
export function children(element:Element,name:string){return Array.from(element.childNodes).filter((node):node is Element=>node.nodeType===1&&(node as Element).localName===name&&(node as Element).namespaceURI===element.namespaceURI);}
export function one(element:Element,name:string,required=true){const found=children(element,name);if(found.length>1||required&&found.length!==1)throw failure();return found[0];}
const decoded=(text:string)=>text.replace(/_x([a-fA-F0-9]{4})_/g,(_,hex:string)=>String.fromCharCode(parseInt(hex,16)));
function stringValue(element:Element){let result='';for(const child of Array.from(element.childNodes)){if(child.nodeType!==1)continue;const item=child as Element;if(item.namespaceURI!==element.namespaceURI)throw failure();if(item.localName==='t')result+=decoded(item.textContent??'');else if(item.localName==='r'){for(const text of children(item,'t'))result+=decoded(text.textContent??'');}else if(!['rPh','phoneticPr'].includes(item.localName))throw failure();}return result;}
const positive=(text:string,limit:number)=>{if(!/^[1-9]\d*$/.test(text)||Number(text)>limit)throw failure();return Number(text);};
const decimal=(text:string)=>/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(text)&&Number.isFinite(Number(text));

/** Raw values and cached formula results only; formatting and recalculation are deliberately absent. */
export function readXlsxContext(bytes:Buffer):{text:string;warnings:string[]}{
 try{
  const part=packageParts(bytes),types=xml(part('[Content_Types].xml'),'Types','http://schemas.openxmlformats.org/package/2006/content-types');
  if(!children(types,'Override').some(node=>node.getAttribute('PartName')==='/xl/workbook.xml'&&node.getAttribute('ContentType')==='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'))throw failure();
  const workbook=xml(part('xl/workbook.xml'),'workbook');if(!mainNamespaces.has(workbook.namespaceURI??''))throw failure();const namespace=workbook.namespaceURI!,relationships=xml(part('xl/_rels/workbook.xml.rels'),'Relationships','http://schemas.openxmlformats.org/package/2006/relationships'),targets=new Map<string,{path:string;type:string}>();
  for(const relation of children(relationships,'Relationship')){const id=relation.getAttribute('Id')??'',target=relation.getAttribute('Target')??'',type=relation.getAttribute('Type')??'';if(!id||targets.has(id)||relation.getAttribute('TargetMode')==='External'||/^[a-z][a-z\d+.-]*:|[\\?#%]/i.test(target))throw failure();const path=target.startsWith('/')?target.slice(1):posix.normalize(posix.join('xl',target));if(!path.startsWith('xl/')||path.split('/').includes('..'))throw failure();targets.set(id,{path,type});}
  const sharedTarget=[...targets.values()].filter(value=>value.type.endsWith('/sharedStrings'));if(sharedTarget.length>1)throw failure();const shared=sharedTarget.length?children(xml(part(sharedTarget[0].path),'sst',namespace),'si').map(stringValue):[];
  const sheets=children(one(workbook,'sheets'),'sheet');if(!sheets.length||sheets.length>20)throw failure();let text='',rowCount=0,cellCount=0,formulas=0;const seen=new Set<string>();const add=(line:string)=>{if(text.length+line.length+1>DOCUMENT_IMPORT_TEXT_LIMIT)throw failure();text+=line+'\n';};
  add('# Excel workbook context (raw cell values; no formula execution)');
  for(const [index,sheet] of sheets.entries()){
   const name=decoded(sheet.getAttribute('name')??''),id=sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id')||sheet.getAttributeNS('http://purl.oclc.org/ooxml/officeDocument/relationships','id'),target=targets.get(id??'');if(!name||seen.has(name)||!target?.type.endsWith('/worksheet'))throw failure();seen.add(name);const state=sheet.getAttribute('state')||'visible';if(!['visible','hidden','veryHidden'].includes(state))throw failure();add(`\n## Sheet ${index+1}: ${JSON.stringify(name)} (${state})`);
   const data=one(xml(part(target.path),'worksheet',namespace),'sheetData');let previousRow=0;
   for(const row of children(data,'row')){const number=row.hasAttribute('r')?positive(row.getAttribute('r')!,10000):previousRow+1;if(number<=previousRow||number>10000||++rowCount>10000)throw failure();previousRow=number;let previousColumn=0;
    for(const cell of children(row,'c')){let column=previousColumn+1,address=cell.getAttribute('r');if(address){const match=/^([A-Z]{1,3})([1-9]\d*)$/.exec(address);if(!match||Number(match[2])!==number)throw failure();column=[...match[1]].reduce((value,char)=>value*26+char.charCodeAt(0)-64,0);}else{let label='',value=column;while(value){label=String.fromCharCode(65+(value-1)%26)+label;value=Math.floor((value-1)/26);}address=label+number;}if(column<=previousColumn||column>100||++cellCount>100000)throw failure();previousColumn=column;
     const formula=one(cell,'f',false),value=one(cell,'v',false),inline=one(cell,'is',false),type=cell.getAttribute('t')||'n';let kind='',content='';
     if(type==='s'){if(!value||!/^\d+$/.test(value.textContent??'')||Number(value.textContent)>=shared.length)throw failure();kind='text';content=JSON.stringify(shared[Number(value.textContent)]);}
     else if(type==='inlineStr'){kind='text';content=JSON.stringify(inline?stringValue(inline):'');}
     else if(type==='b'){if(!value||!['0','1'].includes(value.textContent??''))throw failure();kind='boolean';content=value.textContent==='1'?'true':'false';}
     else if(['n','str','e','d'].includes(type)){const raw=value?.textContent??'';if(type==='n'&&raw!==''&&!decimal(raw))throw failure();kind=type==='n'?'number':type==='e'?'error':type==='d'?'date text':'text';content=value?JSON.stringify(type==='str'?decoded(raw):raw):'unavailable';}
     else throw failure();
     if(formula){formulas++;kind='formula cached '+kind;}
     add(`${address}${row.getAttribute('hidden')==='1'?' (hidden row)':''} [${kind}] = ${content}${formula?`; formula ${JSON.stringify(formula.textContent??'')} (not executed)`:''}`);
    }
   }
  }
  if(!cellCount)throw failure();return {text,warnings:[`All ${sheets.length} worksheet(s), including hidden sheets and hidden/filtered rows, are included as addressed raw cells. Up to 10,000 rows and 100 columns are supported; oversized workbooks are rejected, never truncated.`,`Cell formatting, displayed date/number formats, charts, drawings, comments, merged layout and phonetic annotations are not reproduced. Blank gaps remain visible through cell addresses.`,`${formulas} formula cell(s): formulas are inert text; cached values may be absent or stale and are not recalculated. No macros, external links or workbook code are executed or fetched.`]};
 }catch{throw failure();}
}
