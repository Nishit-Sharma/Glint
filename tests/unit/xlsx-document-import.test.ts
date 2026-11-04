import {expect,test} from 'vitest';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {createCompanion} from '../../src/core/companion';
import {DocumentImports,extractDocument} from '../../src/host/document-import';

export function ownedWorkbook(path:string,variant='normal'){
 execFileSync('python3',['-c',String.raw`import sys,zipfile
p,variant=sys.argv[1:]
ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
parts={'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
'xl/workbook.xml':f'<workbook xmlns="{ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Owned &amp; 雪" sheetId="1" r:id="rId1"/><sheet name="Hidden" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>',
'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="s" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>',
'xl/sharedStrings.xml':f'<sst xmlns="{ns}" count="1" uniqueCount="1"><si><r><t xml:space="preserve"> Leading </t></r><r><t>雪</t></r></si></sst>',
'xl/worksheets/sheet1.xml':f'<worksheet xmlns="{ns}"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>_</t><r><t>x000A_</t></r></is></c></row><row r="2"><c r="A2"><v>-4</v></c><c r="B2" t="b"><v>1</v></c><c r="C2"><f>A2+12</f><v>8</v></c></row></sheetData></worksheet>',
'xl/worksheets/sheet2.xml':f'<worksheet xmlns="{ns}"><sheetData><row r="1" hidden="1"><c r="C1" t="inlineStr"><is><t>Hidden note&#13;line</t></is></c></row></sheetData></worksheet>'}
if variant=='entity':parts['xl/sharedStrings.xml']='<!DOCTYPE sst [<!ENTITY bad "EXPAND">]>'+parts['xl/sharedStrings.xml']
if variant=='oversize':parts['xl/sharedStrings.xml']='x'*(4*1024*1024+1)
if variant=='malformed':parts['xl/worksheets/sheet1.xml']='<worksheet><sheetData><row></worksheet>'
if variant=='external':parts['xl/_rels/workbook.xml.rels']=parts['xl/_rels/workbook.xml.rels'].replace('Target="worksheets/sheet1.xml"','TargetMode="External" Target="https://owned.invalid/remote.xml"')
if variant=='rows':parts['xl/worksheets/sheet1.xml']=parts['xl/worksheets/sheet1.xml'].replace('r="2"','r="10001"').replace('r="A2"','r="A10001"').replace('r="B2"','r="B10001"').replace('r="C2"','r="C10001"')
with zipfile.ZipFile(p,'w',zipfile.ZIP_DEFLATED) as z:
 for name,body in parts.items():z.writestr(name,body)
`,path,variant],{timeout:10000});
}

test('imports actual deflated XLSX sheets and cell types with immutable provenance, bounded rejection and existing atomic review',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-xlsx-import-')),core=await createCompanion({dataDir:join(directory,'store')});
 try{
  const file=join(directory,'owned.xlsx');ownedWorkbook(file);const bytes=await readFile(file),task=await core.createTask({title:'Owned XLSX import'});await core.saveComposerDraft(task.id,0,{text:'Keep exact draft',kind:'explain'});const before=await core.getTask(task.id),imports=new DocumentImports(core,async()=>file),owner={taskId:task.id,attemptId:randomUUID()},preview=await imports.pick(owner,()=>{});if(preview.kind!=='review')throw Error('Missing review');expect(preview.format).toBe('xlsx');expect(preview.text).toContain('Owned & 雪');expect(preview.text).toContain('A1 [text] = " Leading 雪"');expect(preview.text).toContain('B1 [text] = "_x000A_"');expect(preview.text).toContain('A2 [number] = "-4"');expect(preview.text).toContain('B2 [boolean] = true');expect(preview.text).toContain('C2 [formula cached number] = "8"');expect(preview.text).toContain('Hidden note\\rline');expect(preview.warnings.join(' ')).toContain('not recalculated');expect(preview.fileDigest).toBe(createHash('sha256').update(bytes).digest('hex'));expect(await core.getTask(task.id)).toEqual(before);
  await writeFile(file,'Changed after picker');const input={...owner,label:'Owned workbook context',content:preview.text,role:'fact' as const},saved=await imports.add(input,()=>{});expect((await imports.add(input,()=>{})).reference).toEqual(saved.reference);expect(saved.task.sources[0].versions[0].content).toContain(preview.text);expect(saved.task.sources[0].versions[0].content).toContain(preview.fileDigest);expect(saved.task.session?.draft).toBe(before.session?.draft);expect(saved.task.requests).toEqual(before.requests);imports.cancel(owner);
  for(const variant of ['entity','oversize','malformed','external','rows']){ownedWorkbook(file,variant);await expect(extractDocument(file,new AbortController().signal)).rejects.toThrow(/Excel|XLSX|workbook/);}
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
