import {expect,test} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {CsvImportPreview} from '../../src/renderer/src/components/DocumentImport';
import {csvSelectionTsv,csvCellRange,csvColumnName,moveCsvCell} from '../../src/shared/csv-selection';
import {readDocumentCsv} from '../../src/shared/document-import';

test('the actual CSV import preview exposes a selectable full-cell grid and an explicit copy action',()=>{
 const html=renderToStaticMarkup(createElement(CsvImportPreview,{content:'Name,Note\nZoë,"A complete cell, with comma"\n'}));
 expect(html).toContain('role="grid"');expect(html).toContain('Copy selected cells');expect(html).toContain('A complete cell, with comma');
});

test('rectangular TSV preserves Unicode, tabs, quotes, CRLF cells, empty and missing fields without formula evaluation',()=>{
 const rows=readDocumentCsv('Name,Note,Formula\r\n"Zoë, 東京","First\r\nSecond ""quoted"" line",=1+1\r\n"\tTab",\r\n');
 expect(csvSelectionTsv(rows,{row:1,column:0},{row:2,column:2})).toBe('Zoë, 東京\t"First\r\nSecond ""quoted"" line"\t=1+1\n"\tTab"\t\t');
 expect(csvSelectionTsv(rows,{row:2,column:2},{row:1,column:0})).toBe(csvSelectionTsv(rows,{row:1,column:0},{row:2,column:2}));
 expect(csvCellRange(rows,{row:2,column:2},{row:0,column:0})).toEqual({top:0,bottom:2,left:0,right:2});expect(csvColumnName(99)).toBe('CV');
 expect(moveCsvCell({row:20,column:1},'ArrowDown',10001,100)).toEqual({row:21,column:1});expect(moveCsvCell({row:20,column:1},'End',10001,100,true)).toEqual({row:10000,column:99});
 expect(()=>csvSelectionTsv(rows,{row:3,column:0},{row:0,column:0})).toThrow();
});

test('every admitted CSV can be viewed, while a ragged rectangular copy beyond the existing clipboard cap fails rather than truncates',()=>{
 const csv=','.repeat(99)+'\n'+'abcdefghi\n'.repeat(9990);expect(csv.length).toBe(100000);const rows=readDocumentCsv(csv);expect(rows).toHaveLength(9991);
 expect(()=>csvSelectionTsv(rows,{row:0,column:0},{row:9990,column:99})).toThrow(/1,048,576/);
 expect(csvSelectionTsv(rows,{row:9989,column:0},{row:9990,column:1})).toBe('abcdefghi\t\nabcdefghi\t');
});
