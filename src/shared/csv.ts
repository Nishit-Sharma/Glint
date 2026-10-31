/** Comma-separated syntax only; callers retain their own header, record and authority policies. */
export function parseCsvRows(text:string,limits:{rows:number;columns:number;cellCharacters:number}):string[][]{
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false,closed=false;
 const addCell=()=>{if(cell.length>limits.cellCharacters)throw Error(`A CSV cell exceeds ${limits.cellCharacters.toLocaleString('en-US')} characters.`);row.push(cell);cell='';closed=false;if(row.length>limits.columns)throw Error(`Use at most ${limits.columns} CSV columns.`);};
 const addRow=()=>{addCell();rows.push(row);row=[];if(rows.length>limits.rows)throw Error(`Use at most ${limits.rows.toLocaleString('en-US')} CSV rows including the first row. No partial CSV was read.`);};
 for(let index=0;index<text.length;index++){
  const char=text[index];
  if(char==='\0')throw Error('NUL characters are unsupported in table text.');
  if(quoted){if(char==='"'){if(text[index+1]==='"'){cell+='"';index++;}else{quoted=false;closed=true;}}else cell+=char;}
  else if(char===',')addCell();
  else if(char==='\n'||char==='\r'){if(char==='\r'&&text[index+1]==='\n')index++;addRow();}
  else if(char==='"'){if(cell||closed)throw Error('A quote must begin a quoted cell.');quoted=true;}
  else{if(closed)throw Error('Only a separator or line ending may follow a closing quote.');cell+=char;}
  if(cell.length>limits.cellCharacters)throw Error(`A CSV cell exceeds ${limits.cellCharacters.toLocaleString('en-US')} characters.`);
 }
 if(quoted)throw Error('A quoted cell is unfinished.');
 if(row.length||cell.length||closed||!/[\r\n]$/.test(text))addRow();
 return rows;
}
