import {runSemanticProcedure,type SemanticProcedure,type SemanticRecord} from './semantic-procedure';
export const sourceTableLimits=Object.freeze({characters:32000,records:32,columns:12,cellCharacters:160,headerCharacters:80,reportCharacters:100000});
export type SourceColumnBinding={readonly field:string;readonly column:string};
export type SourceTable={readonly headers:readonly string[];readonly records:readonly (readonly string[])[]};
export type SourceTableOutcome=
 | {readonly status:'completed';readonly output:SemanticRecord}
 | {readonly status:'stopped';readonly output:SemanticRecord;readonly reason:string;readonly stepId:string}
 | {readonly status:'invalid';readonly reason:string};
export type SourceTableRow={readonly recordNumber:number;readonly sourceValues:Readonly<Record<string,string>>;readonly input:SemanticRecord|null;readonly outcome:SourceTableOutcome};
/** Bounded comma-separated text only. Quoted commas/newlines/escaped quotes are supported; nothing is silently dropped. */
export function parseSourceTable(text:string):SourceTable{
 if(typeof text!=='string'||!text.length||text.length>sourceTableLimits.characters)throw Error('Choose nonempty comma-separated text of at most 32,000 characters.');
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false,closed=false;
 const addCell=()=>{if(cell.length>sourceTableLimits.cellCharacters)throw Error('A table cell exceeds 160 characters.');row.push(cell);cell='';closed=false;if(row.length>sourceTableLimits.columns)throw Error('Use at most 12 columns.');};
 const addRow=()=>{addCell();rows.push(row);row=[];if(rows.length>sourceTableLimits.records+1)throw Error('Use at most 32 data records. No partial table was read.');};
 for(let index=0;index<text.length;index++){
  const char=text[index];
  if(char==='\0')throw Error('NUL characters are unsupported in table text.');
  if(quoted){if(char==='"'){if(text[index+1]==='"'){cell+='"';index++;}else{quoted=false;closed=true;}}else cell+=char;}
  else if(char===',')addCell();
  else if(char==='\n'||char==='\r'){if(char==='\r'&&text[index+1]==='\n')index++;addRow();}
  else if(char==='"'){if(cell||closed)throw Error('A quote must begin a quoted cell.');quoted=true;}
  else{if(closed)throw Error('Only a separator or line ending may follow a closing quote.');cell+=char;}
  if(cell.length>sourceTableLimits.cellCharacters)throw Error('A table cell exceeds 160 characters.');
 }
 if(quoted)throw Error('A quoted cell is unfinished.');
 if(row.length||cell.length||closed||!/[\r\n]$/.test(text))addRow();
 const headers=rows.shift();
 if(!headers?.length||headers.some(value=>!value.trim()||value!==value.trim()||value.length>sourceTableLimits.headerCharacters)||new Set(headers).size!==headers.length)throw Error('Use unique nonempty column headers of at most 80 characters, with no surrounding whitespace.');
 if(!rows.length)throw Error('Add at least one data record after the headers.');
 if(rows.some(value=>value.length!==headers.length))throw Error('Every record must have the same number of cells as the header. No partial table was read.');
 return {headers,records:rows};
}
export function runSourceTable(procedure:SemanticProcedure,table:SourceTable,bindings:readonly SourceColumnBinding[]):readonly SourceTableRow[]{
 if(procedure.target!=='local-record'||procedure.input.fields.length>6||procedure.output.fields.length>6)throw Error('This entry supports checked local record helpers with up to six inputs and six outputs.');
 const fields=procedure.input.fields;
 if(bindings.length!==fields.length||new Set(bindings.map(item=>item.field)).size!==fields.length||bindings.some(item=>!fields.some(field=>field.name===item.field)||!table.headers.includes(item.column)))throw Error('Map each helper input exactly once to a column in this source.');
 return table.records.map((values,index)=>{
  const sourceValues=Object.fromEntries(fields.map(field=>[field.name,values[table.headers.indexOf(bindings.find(item=>item.field===field.name)!.column)]]));
  let input:SemanticRecord;
  try{input=Object.fromEntries(fields.map(field=>{
   const text=sourceValues[field.name];if(field.kind==='string')return [field.name,text];
   if(field.kind==='boolean'){if(text==='true')return [field.name,true];if(text==='false')return [field.name,false];throw Error(`Input ${field.name} needs exactly true or false.`);}
   const trimmed=text.trim();if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)||!Number.isFinite(Number(trimmed)))throw Error(`Input ${field.name} needs a finite decimal number.`);return [field.name,Number(trimmed)];
  }));}catch(error){return {recordNumber:index+2,sourceValues,input:null,outcome:{status:'invalid' as const,reason:error instanceof Error?error.message:'The mapped input is invalid.'}};}
  const result=runSemanticProcedure(procedure,input),outcome:SourceTableOutcome=result.status==='completed'?{status:'completed',output:result.output}:result.status==='abstained'?{status:'stopped',output:result.output,reason:result.reason,stepId:result.haltedStepId}:{status:'invalid',reason:result.reason};
  return {recordNumber:index+2,sourceValues,input,outcome};
 });
}
