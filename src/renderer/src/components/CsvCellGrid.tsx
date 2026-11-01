import {useId,useLayoutEffect,useRef,useState,type KeyboardEvent} from 'react';
import {csvCellAddress,csvCellRange,csvColumnName,csvSelectionTsv,moveCsvCell,CSV_GRID_PAGE_ROWS,type CsvCell} from '../../../shared/csv-selection';
import {publicErrorMessage} from '../../../shared/public-messages';
import {Button,Field} from '../ui';

/** Read-only imported/reviewed CSV values. Mount per exact content so a changed
 * review retires old selection and acknowledgement, without modifying the draft. */
export function CsvCellGrid({rows,disabled=false}:{rows:readonly (readonly string[])[];disabled?:boolean}){
 const [anchor,setAnchor]=useState<CsvCell>({row:0,column:0}),[focus,setFocus]=useState<CsvCell>({row:0,column:0}),[page,setPage]=useState(0),[goRow,setGoRow]=useState('1'),[copying,setCopying]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const cells=useRef(new Map<string,HTMLElement>()),requestFocus=useRef(false),alive=useRef(true),copyLock=useRef(false),generation=useRef(0),hint=useId();
 useLayoutEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;};},[]);
 useLayoutEffect(()=>{if(requestFocus.current){requestFocus.current=false;const cell=cells.current.get(csvCellAddress(focus));cell?.focus({preventScroll:true});cell?.scrollIntoView({block:'nearest',inline:'nearest'});}},[focus.row,focus.column,page]);
 const columns=rows.reduce((width,row)=>Math.max(width,row.length),0),range=csvCellRange(rows,anchor,focus),lastPage=Math.max(0,Math.ceil((rows.length-1)/CSV_GRID_PAGE_ROWS)-1),first=page*CSV_GRID_PAGE_ROWS+1,last=Math.min(rows.length-1,first+CSV_GRID_PAGE_ROWS-1),columnIndexes=Array.from({length:columns},(_,index)=>index),selectedAddress=csvCellAddress({row:range.top,column:range.left})+(range.top===range.bottom&&range.left===range.right?'':':'+csvCellAddress({row:range.bottom,column:range.right}));
 function choose(cell:CsvCell,extend=false){if(disabled)return;generation.current++;setMessage('');setError('');if(!extend)setAnchor(cell);setFocus(cell);setGoRow(String(cell.row+1));if(cell.row>0)setPage(Math.floor((cell.row-1)/CSV_GRID_PAGE_ROWS));else setPage(0);requestFocus.current=true;}
 async function copy(){
  if(disabled||copyLock.current)return;setMessage('');setError('');let text:string;try{text=csvSelectionTsv(rows,anchor,focus);}catch(reason){setError(publicErrorMessage(reason));return;}
  copyLock.current=true;setCopying(true);const token=++generation.current,selection=selectedAddress;
  try{await window.companion.invoke({type:'code-block.copy',text});if(alive.current&&generation.current===token)setMessage(`Copied ${selection} as tab-separated text.`);}
  catch{if(alive.current&&generation.current===token)setError('The selected cells could not be copied. Your CSV and selection are unchanged.');}
  finally{copyLock.current=false;if(alive.current)setCopying(false);}
 }
 function key(event:KeyboardEvent<HTMLElement>){
  if(disabled||event.nativeEvent?.isComposing)return;
  if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='c'){event.preventDefault();void copy();return;}
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','PageUp','PageDown','Home','End'].includes(event.key)){event.preventDefault();choose(moveCsvCell(focus,event.key,rows.length,columns,event.ctrlKey||event.metaKey),event.shiftKey);}
 }
 function cell(row:number,column:number,heading=false){
  const selected=row>=range.top&&row<=range.bottom&&column>=range.left&&column<=range.right,value=rows[row][column],address=csvCellAddress({row,column}),props={ref:(node:HTMLElement|null)=>{if(node)cells.current.set(address,node);else cells.current.delete(address);},role:'gridcell',tabIndex:!disabled&&focus.row===row&&focus.column===column?0:-1,'aria-colindex':column+1,'aria-selected':selected,'aria-label':address+(value===undefined?' · Missing cell':value===''?' · Empty cell':': '+value),'data-csv-cell':address,onClick:(event:{shiftKey:boolean})=>choose({row,column},event.shiftKey),onKeyDown:key};
  const content=value===undefined?<span className="muted">{heading?`Column ${column+1} (no heading)`:'Missing cell'}</span>:value===''?<span className="muted">{heading?'Empty heading':'Empty cell'}</span>:value;
  return heading?<th key={column} {...props} scope="col">{content}</th>:<td key={column} {...props}>{content}</td>;
 }
 function go(){const value=Number(goRow);if(!Number.isSafeInteger(value)||value<1||value>rows.length){setError(`Choose a CSV record from 1 to ${rows.length.toLocaleString()}.`);return;}choose({row:value-1,column:focus.column});}
 return <section aria-label="Selectable CSV cells">
  <p id={hint} className="tiny">All admitted cells are available: the first CSV row supplies headings, followed by pages of {CSV_GRID_PAGE_ROWS} data rows. Click a cell; Shift-click extends a rectangular range. Arrow keys move; Shift-arrows extend. Home/End move across a row, Command/Control-Home/End go to the first/last cell. Command/Control-C copies the selection. Formulas remain text.</p>
  <div className="csv-grid-toolbar"><Button disabled={disabled||page===0} onClick={()=>choose({row:Math.max(1,first-CSV_GRID_PAGE_ROWS),column:focus.column})}>Previous rows</Button><span>Data rows {rows.length>1?`${first.toLocaleString()}–${last.toLocaleString()}`:'0'} of {(rows.length-1).toLocaleString()}</span><Button disabled={disabled||page===lastPage} onClick={()=>choose({row:first+CSV_GRID_PAGE_ROWS,column:focus.column})}>Next rows</Button><Field label="Go to CSV record"><input type="number" min={1} max={rows.length} value={goRow} disabled={disabled} onChange={event=>setGoRow(event.currentTarget.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();go();}}}/></Field><Button disabled={disabled} onClick={go}>Go to record</Button></div>
  <div className="csv-import-scroll csv-cell-grid"><table role="grid" aria-label="CSV cell grid" aria-rowcount={rows.length} aria-colcount={columns} aria-describedby={hint}><caption>First CSV row shown as column headings · {columns} columns</caption><thead><tr aria-hidden="true"><th>CSV record</th>{columnIndexes.map(column=><th key={column}>{csvColumnName(column)}</th>)}</tr><tr aria-rowindex={1}><th aria-hidden="true">1</th>{columnIndexes.map(column=>cell(0,column,true))}</tr></thead><tbody>{rows.slice(first,last+1).map((_,offset)=>{const row=first+offset;return <tr key={row} aria-rowindex={row+1}><th aria-hidden="true">{row+1}</th>{columnIndexes.map(column=>cell(row,column))}</tr>;})}</tbody></table></div>
  <div className="csv-grid-toolbar"><strong>Selection {selectedAddress}</strong><Button disabled={disabled||copying} onClick={()=>void copy()}>{copying?'Copying cells…':'Copy selected cells'}</Button></div>
  <p className="tiny">Copy is exact quoted tab-separated text, including empty or missing cells as blank fields. Cells containing tabs, line breaks or quotes are quoted; quotes are doubled. The existing clipboard limit is 1,048,576 characters per selection; oversized selections are kept and are never truncated.</p>
  <section className="csv-grid-value" aria-label="Full active cell value"><h4>{csvCellAddress(focus)} · Full cell value</h4>{rows[focus.row][focus.column]===undefined?<p>Missing cell in this CSV record.</p>:<pre>{rows[focus.row][focus.column]||'Empty cell'}</pre>}</section>
  {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
 </section>;
}
