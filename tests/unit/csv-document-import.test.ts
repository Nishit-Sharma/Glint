import {expect,it} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createCompanion} from '../../src/core/companion';
import {DocumentImports,extractDocument} from '../../src/host/document-import';
import {DOCUMENT_IMPORT_FILE_LIMIT,readDocumentCsv,documentImportMessages as messages} from '../../src/shared/document-import';
import {CsvImportPreview} from '../../src/renderer/src/components/DocumentImport';

const csv='Name,Note,Formula\r\n"Zoë, 東京","First line\nSecond ""quoted"" line",=1+1\r\n';
async function withFile(run:(file:string,directory:string)=>Promise<void>){const directory=await mkdtemp(join(tmpdir(),'glint-csv-import-test-'));try{await run(join(directory,'selected.csv'),directory);}finally{await rm(directory,{recursive:true,force:true});}}

it('imports a UTF-8 BOM CSV as exact decoded text, preserving quotes, multiline cells, Unicode and inert formulas',async()=>withFile(async file=>{
 const bytes=Buffer.from('\ufeff'+csv);await writeFile(file,bytes);const result=await extractDocument(file,new AbortController().signal);
 expect(result).toMatchObject({format:'csv',fileName:'selected.csv',byteLength:bytes.length,text:csv,fileDigest:createHash('sha256').update(bytes).digest('hex')});
 expect(result.method).toContain('UTF-8');expect(result.warnings.join(' ')).toContain('BOM');expect(result.warnings.join(' ')).toContain('formulas');
}));

it('rejects malformed, empty, overlong and unsupported-encoding CSV without partial imports',async()=>withFile(async file=>{
 for(const value of ['', 'Name,Note\n"unfinished,cell', 'Name\n'+Array.from({length:10_001},()=> 'r').join('\n'), 'Name\n'+'x'.repeat(10_001), Array.from({length:101},(_,i)=>'H'+i).join(',')+'\n'+Array(101).fill('x').join(','), 'Name\n'+'x'.repeat(100_001), 'Name\n\u0000']){
  await writeFile(file,value);await expect(extractDocument(file,new AbortController().signal)).rejects.toThrow(messages.csv);
 }
 for(const bytes of [Buffer.from([0xff,0xfe,0x41,0,0x0a,0,0x42,0]),Buffer.from([0x4e,0x0a,0xc3,0x28])]){await writeFile(file,bytes);await expect(extractDocument(file,new AbortController().signal)).rejects.toThrow(messages.csvEncoding);}
 await writeFile(file,Buffer.alloc(DOCUMENT_IMPORT_FILE_LIMIT+1,0x61));await expect(extractDocument(file,new AbortController().signal)).rejects.toThrow(messages.size);
}));

it('previews all CSV headers and rows as inert text and reports invalid edits',()=>{
 const html=renderToStaticMarkup(createElement(CsvImportPreview,{content:'Name,Note\n"<script>alert(1)</script>","=HYPERLINK(""https://example.invalid"")"\n'}));
 expect(html).toContain('<th');expect(html).toContain('Name');expect(html).toContain('1 data row');expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');expect(html).toContain('=HYPERLINK');expect(html).not.toContain('<script>');expect(html).not.toContain('<a ');
 const bad=renderToStaticMarkup(createElement(CsvImportPreview,{content:'Name,Note\n"unfinished'}));expect(bad).toContain('role="alert"');expect(bad).toContain('quotes');expect(bad).not.toContain('<table');
});

it('adds only reviewed CSV to its original task, persists exact provenance, retries once and keeps cancel inert',async()=>withFile(async(file,directory)=>{
 const core=await createCompanion({dataDir:join(directory,'store')});try{
  const task=await core.createTask({title:'CSV destination'}),other=await core.createTask({title:'Other destination'});await core.saveComposerDraft(task.id,0,{text:'Keep this question',kind:'explain'});await writeFile(file,csv);
  const before=await core.getTask(task.id),imports=new DocumentImports(core,async()=>file),owner={taskId:task.id,attemptId:randomUUID()},preview=await imports.pick(owner,()=>{});if(preview.kind!=='review')throw Error('Missing review');expect(await core.getTask(task.id)).toEqual(before);
  await expect(imports.add({...owner,taskId:other.id,label:'CSV',content:preview.text,role:'fact'},()=>{})).rejects.toThrow(messages.stale);
  await expect(imports.add({...owner,label:'CSV',content:'Name,Note\n"unfinished',role:'fact'},()=>{})).rejects.toThrow(/CSV/);
  await writeFile(file,'Name\nChanged on disk\n');const input={...owner,label:'CSV research',content:preview.text,role:'fact' as const},saved=await imports.add(input,()=>{}),again=await imports.add(input,()=>{});expect(again.reference).toEqual(saved.reference);
  const persisted=await core.getTask(task.id),source=persisted.sources[0].versions[0];expect(persisted.sources).toHaveLength(1);expect(source.content).toContain(csv);expect(source.content).toContain(preview.fileDigest);expect(source.content).toContain('CSV');expect(source.content).toContain('Original decoded CSV SHA-256');expect(source.content).toContain('formulas');expect(persisted.session?.draft).toBe(before.session?.draft);expect(persisted.requests).toEqual(before.requests);expect(persisted.actions).toEqual(before.actions);expect(await core.getTask(other.id)).toEqual(other);
  await expect(imports.add({...input,content:input.content+'\n'},()=>{})).rejects.toThrow(messages.changed);imports.cancel(owner);const next={taskId:task.id,attemptId:randomUUID()};await imports.pick(next,()=>{});imports.cancel(next);await expect(imports.add({...input,...next},()=>{})).rejects.toThrow(messages.stale);expect((await core.getTask(task.id)).sources).toHaveLength(1);
 }finally{await core.close();}
}));

it('accepts ordinary CSV independently of teaching-helper header and tiny-table policies without dropping retained data',async()=>withFile(async file=>{
 const headings=['',' Duplicate ',' Duplicate ','Long heading '+ 'x'.repeat(200),...Array.from({length:96},(_,i)=>'Column '+i)],row=headings.map((_,i)=>i===3?'x'.repeat(600):'value'),wide=[headings,row].map(cells=>cells.join(',')).join('\n');await writeFile(file,wide);expect((await extractDocument(file,new AbortController().signal)).text).toBe(wide);expect(readDocumentCsv(wide)[0]).toEqual(headings);
 const many='Name\n'+Array.from({length:10_000},(_,i)=>'R'+i).join('\n');await writeFile(file,many);expect((await extractDocument(file,new AbortController().signal)).text).toBe(many);expect(readDocumentCsv(many)).toHaveLength(10_001);
 const html=renderToStaticMarkup(createElement(CsvImportPreview,{content:many}));expect(html).toContain('10,000');expect(html).toContain('pages of 20');expect(html).toContain('R19');expect(html).not.toContain('R9999');expect(html).toContain('Go to CSV record');expect(readDocumentCsv('Header only\n')).toEqual([['Header only']]);
}));

it('keeps syntactically valid ragged records exact and marks missing preview cells without padding retained text',async()=>withFile(async file=>{
 const ragged='Name,Note\nalpha\nbeta,more,extra\n';await writeFile(file,ragged);expect((await extractDocument(file,new AbortController().signal)).text).toBe(ragged);expect(readDocumentCsv(ragged)).toEqual([['Name','Note'],['alpha'],['beta','more','extra']]);
 const html=renderToStaticMarkup(createElement(CsvImportPreview,{content:ragged}));expect(html).toContain('maximum');expect(html).toContain('Record widths vary from');expect(html).toContain('Missing cell');expect(html).toContain('(no heading)');expect(html).toContain('extra');expect(html).not.toContain('role="alert"');expect(readDocumentCsv(ragged)[1]).toEqual(['alpha']);
}));
