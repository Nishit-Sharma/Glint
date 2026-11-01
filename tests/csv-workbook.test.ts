import {expect,test} from 'vitest';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createCompanion} from '../src/core/companion';
import {DocumentImports} from '../src/host/document-import';
import {CsvWorkbooks} from '../src/host/csv-workbook';

test('actual imported CSV creates a valid editable text-cell XLSX preserving exact values/provenance with cancel, no-overwrite and stale-source protection',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-workbook-')),core=await createCompanion({dataDir:join(directory,'store')});
 try{
  const csv='Name,Value,Literal\r\n"A & <one>",-4,0012\r\n"雪\r\nline",12,"_x000A_ =1+1"\r\nC,0,\r\n';const file=join(directory,'owned.csv');await writeFile(file,csv);const task=await core.createTask({title:'Owned workbook'}),imports=new DocumentImports(core,async()=>file),owner={taskId:task.id,attemptId:randomUUID()},review=await imports.pick(owner,()=>{});if(review.kind!=='review')throw Error('No file review');const imported=await imports.add({...owner,label:'Owned CSV',content:review.text,role:'fact'},()=>{}),before=await core.getTask(task.id),output=join(directory,'owned.xlsx');let destination:string|null=null;
  const workbooks=new CsvWorkbooks(id=>core.getTask(id),async()=>destination),preview=await workbooks.preview({type:'workbook.preview',taskId:task.id,source:imported.reference});expect(preview).toMatchObject({rows:4,columns:3,cells:12,csv});const command={type:'workbook.save' as const,taskId:task.id,source:imported.reference,dataDigest:preview.dataDigest};expect(await workbooks.save(command)).toEqual({kind:'cancelled'});destination=output;const saved=await workbooks.save(command);expect(saved.kind).toBe('saved');if(saved.kind==='cancelled')throw Error('No file');const bytes=await readFile(output);expect(createHash('sha256').update(bytes).digest('hex')).toBe(saved.workbookDigest);expect(bytes.length).toBe(saved.byteLength);
  const result=JSON.parse(execFileSync('python3',['-c',"import sys,json,zipfile,openpyxl; p=sys.argv[1]; z=zipfile.ZipFile(p); assert z.testzip() is None; w=openpyxl.load_workbook(p); s=w.active; print(json.dumps({'values':list(s.values),'types':[[c.data_type for c in r] for r in s],'parts':z.namelist(),'custom':z.read('docProps/custom.xml').decode()}))",output],{encoding:'utf8',timeout:10000}));expect(result.values).toEqual([['Name','Value','Literal'],['A & <one>','-4','0012'],['雪\r\nline','12','_x000A_ =1+1'],['C','0','']]);expect(result.types.flat().every((value:string)=>value==='s')).toBe(true);expect(result.parts).not.toContain('xl/vbaProject.bin');expect(result.parts.some((value:string)=>value.includes('externalLinks'))).toBe(false);expect(result.custom).toContain(imported.reference.digest);expect(result.custom).toContain(preview.dataDigest);
  await expect(workbooks.save(command)).rejects.toThrow(/exists/);expect(await readFile(output)).toEqual(bytes);expect(await core.getTask(task.id)).toEqual(before);
  const stale=new CsvWorkbooks(id=>core.getTask(id),async()=>{await core.putSource(task.id,{id:imported.reference.sourceId,kind:'text',role:'fact',label:'Changed',content:'Name,Value\nA,99\n'});return join(directory,'stale.xlsx');});await expect(stale.save(command)).rejects.toThrow(/source/);await expect(readFile(join(directory,'stale.xlsx'))).rejects.toThrow();expect(await readFile(file,'utf8')).toBe(csv);
 }
 finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
