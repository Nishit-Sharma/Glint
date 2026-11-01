import {CODE_BLOCK_COPY_LIMIT} from './code-block-copy';

export const CSV_GRID_PAGE_ROWS=20;
export type CsvCell={row:number;column:number};
export function csvColumnName(column:number):string{
 if(!Number.isSafeInteger(column)||column<0||column>=100)throw Error('Choose an available CSV column.');
 let value=column+1,label='';while(value){label=String.fromCharCode(65+(value-1)%26)+label;value=Math.floor((value-1)/26);}return label;
}
export const csvCellAddress=(cell:CsvCell)=>csvColumnName(cell.column)+(cell.row+1);
export function csvCellRange(rows:readonly (readonly string[])[],anchor:CsvCell,focus:CsvCell){
 const columns=rows.reduce((width,row)=>Math.max(width,row.length),0);
 for(const cell of [anchor,focus])if(!Number.isSafeInteger(cell.row)||!Number.isSafeInteger(cell.column)||cell.row<0||cell.row>=rows.length||cell.column<0||cell.column>=columns)throw Error('Choose cells inside the current CSV.');
 return {top:Math.min(anchor.row,focus.row),bottom:Math.max(anchor.row,focus.row),left:Math.min(anchor.column,focus.column),right:Math.max(anchor.column,focus.column)};
}
export function csvSelectionTsv(rows:readonly (readonly string[])[],anchor:CsvCell,focus:CsvCell):string{
 const range=csvCellRange(rows,anchor,focus),lines:string[]=[];let length=0;
 const encode=(value:string)=>/[\t\r\n"]/.test(value)?'"'+value.replace(/"/g,'""')+'"':value;
 for(let row=range.top;row<=range.bottom;row++){
  const cells:string[]=[];for(let column=range.left;column<=range.right;column++)cells.push(encode(rows[row][column]??''));
  const line=cells.join('\t');length+=line.length+(lines.length?1:0);
  if(length>CODE_BLOCK_COPY_LIMIT)throw Error('This selection exceeds the 1,048,576-character clipboard limit. Choose a smaller range; nothing was copied.');
  lines.push(line);
 }
 return lines.join('\n');
}
export function moveCsvCell(cell:CsvCell,key:string,rows:number,columns:number,whole=false):CsvCell{
 let {row,column}=cell;
 if(key==='ArrowUp')row--;else if(key==='ArrowDown')row++;else if(key==='ArrowLeft')column--;else if(key==='ArrowRight')column++;else if(key==='PageUp')row-=CSV_GRID_PAGE_ROWS;else if(key==='PageDown')row+=CSV_GRID_PAGE_ROWS;else if(key==='Home'){column=0;if(whole)row=0;}else if(key==='End'){column=columns-1;if(whole)row=rows-1;}
 return {row:Math.max(0,Math.min(rows-1,row)),column:Math.max(0,Math.min(columns-1,column))};
}
