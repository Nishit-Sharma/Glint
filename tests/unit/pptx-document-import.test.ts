import {expect,test} from 'vitest';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {createCompanion} from '../../src/core/companion';
import {DocumentImports,extractDocument} from '../../src/host/document-import';

function ownedPresentation(path:string,variant='normal'){
 execFileSync('python3',['-c',String.raw`import sys,zipfile
path,variant=sys.argv[1:]
p='http://schemas.openxmlformats.org/presentationml/2006/main'; a='http://schemas.openxmlformats.org/drawingml/2006/main';r='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
parts={'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>',
'ppt/presentation.xml':f'<p:presentation xmlns:p="{p}" xmlns:r="{r}"><p:sldIdLst><p:sldId id="258" r:id="second"/><p:sldId id="257" r:id="first"/></p:sldIdLst></p:presentation>',
'ppt/_rels/presentation.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="first" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="second" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="/ppt/slides/slide2.xml"/></Relationships>',
'ppt/slides/slide1.xml':f'<p:sld xmlns:p="{p}" xmlns:a="{a}"><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/><p:sp><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Visible original first</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
'ppt/slides/slide2.xml':f'<p:sld xmlns:p="{p}" xmlns:a="{a}" show="0"><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/><p:sp><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t xml:space="preserve">Hidden </a:t></a:r><a:r><a:t>雪 &amp; &lt;two&gt;</a:t></a:r><a:br/><a:r><a:t>second line</a:t></a:r></a:p><a:p><a:fld id="owned"><a:t>Cached field</a:t></a:fld></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'}
if variant=='entity':parts['ppt/slides/slide1.xml']='<!DOCTYPE sld [<!ENTITY bad "EXPAND">]>'+parts['ppt/slides/slide1.xml']
if variant=='oversize':parts['ppt/slides/slide1.xml']='x'*(4*1024*1024+1)
if variant=='malformed':parts['ppt/slides/slide1.xml']='<p:sld><p:cSld></wrong>'
if variant=='external':parts['ppt/_rels/presentation.xml.rels']=parts['ppt/_rels/presentation.xml.rels'].replace('Target="slides/slide1.xml"','TargetMode="External" Target="https://owned.invalid/remote"')
if variant=='slides':parts['ppt/presentation.xml']=parts['ppt/presentation.xml'].replace('<p:sldId id="258" r:id="second"/>','<p:sldId id="258" r:id="second"/>'*201)
with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED) as z:
 for name,body in parts.items():z.writestr(name,body)
`,path,variant],{timeout:10000});
}

test('real deflated PPTX respects declared slide order, hidden/rich/paragraph text and immutable import provenance with bounded whole-file rejection',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-pptx-import-')),core=await createCompanion({dataDir:join(directory,'store')});
 try{
  const file=join(directory,'owned.pptx');ownedPresentation(file);const bytes=await readFile(file),task=await core.createTask({title:'Owned PPTX context'});await core.saveComposerDraft(task.id,0,{text:'Keep this draft',kind:'explain'});const before=await core.getTask(task.id),imports=new DocumentImports(core,async()=>file),owner={taskId:task.id,attemptId:randomUUID()},preview=await imports.pick(owner,()=>{});if(preview.kind!=='review')throw Error('Missing review');expect(preview.format).toBe('pptx');expect(preview.text).toContain('## Slide 1 (hidden)');expect(preview.text).toContain('ppt/slides/slide2.xml');expect(preview.text).toContain('S1/P1 = "Hidden 雪 & <two>\\nsecond line"');expect(preview.text).toContain('S1/P2 = "Cached field"');expect(preview.text.indexOf('Hidden 雪')).toBeLessThan(preview.text.indexOf('Visible original first'));expect(preview.warnings.join(' ')).toContain('notes');expect(preview.fileDigest).toBe(createHash('sha256').update(bytes).digest('hex'));expect(await core.getTask(task.id)).toEqual(before);
  await writeFile(file,'Changed after picker');const input={...owner,label:'Owned presentation context',content:preview.text,role:'fact' as const},saved=await imports.add(input,()=>{});expect((await imports.add(input,()=>{})).reference).toEqual(saved.reference);expect(saved.task.sources[0].versions[0].content).toContain(preview.text);expect(saved.task.sources[0].versions[0].content).toContain(preview.fileDigest);expect(saved.task.session?.draft).toBe(before.session?.draft);expect(saved.task.requests).toEqual(before.requests);imports.cancel(owner);
  for(const variant of ['entity','oversize','malformed','external','slides']){ownedPresentation(file,variant);await expect(extractDocument(file,new AbortController().signal)).rejects.toThrow(/PowerPoint|PPTX|presentation/);}
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
