import {expect,test} from 'vitest';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createCompanion} from '../src/core/companion';
import {DocumentImports} from '../src/host/document-import';
import {csvChartPoints,csvChartSvg,csvChartRef,readCsvChart,CSV_CHART_MIME,CSV_CHART_SVG_MIME,type CsvChartSettings} from '../src/shared/csv-chart';
import {safeCanvasSvg} from '../src/shared/design-canvas';

const settings:CsvChartSettings={type:'bar',labelColumn:0,valueColumn:1,title:'Owned & <CSV> chart',xLabel:'Category',yLabel:'Value',seriesLabel:'Owned values',zoom:1};

test('a real imported CSV source supplies exact hash-bound chart data without changing source or task',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-csv-chart-')),core=await createCompanion({dataDir:join(directory,'store')});
 try{
  const file=join(directory,'owned.csv'),csv='Year,Sales\r\n2024,12\r\n2025,-4\r\n2026,18\r\n';await writeFile(file,csv);
  const task=await core.createTask({title:'Owned CSV chart'}),imports=new DocumentImports(core,async()=>file),owner={taskId:task.id,attemptId:randomUUID()},preview=await imports.pick(owner,()=>{});if(preview.kind!=='review')throw Error('Missing actual file review');
  const saved=await imports.add({...owner,label:'Owned chart data',content:preview.text,role:'fact'},()=>{}),before=await core.getTask(task.id);
  const data=await core.previewCsvChart(task.id,saved.reference);expect(data.csv).toBe(csv);expect(data.source).toEqual(saved.reference);expect(await core.getTask(task.id)).toEqual(before);
 }
 finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

test('real CSV charts retain exact source, save edited type/labels/zoom and reopen; distinct SVG copies use the ordinary exact-byte export',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-csv-chart-save-'));let core=await createCompanion({dataDir:join(directory,'store')});
 try{
  const file=join(directory,'owned.csv'),csv='Category,Value\n"A & <one>",-4\nB,12\nC,0\n';await writeFile(file,csv);
  const task=await core.createTask({title:'Owned chart persistence'});await core.saveComposerDraft(task.id,0,{text:'  UNSENT_CHART_QA\n',kind:'explain'});
  const imports=new DocumentImports(core,async()=>file),owner={taskId:task.id,attemptId:randomUUID()},preview=await imports.pick(owner,()=>{});if(preview.kind!=='review')throw Error('Missing file preview');const source=await imports.add({...owner,label:'Owned chart source',content:preview.text,role:'fact'},()=>{}),data=await core.previewCsvChart(task.id,source.reference),before=await core.getTask(task.id);
  const command={type:'chart.save' as const,taskId:task.id,creationId:'owned-chart-create',source:source.reference,dataDigest:data.dataDigest,settings};
  const saved=await core.saveCsvChart(command);expect(await core.saveCsvChart(command)).toEqual(saved);expect(saved.task.artifacts).toHaveLength(1);expect(saved.task.sources).toEqual(before.sources);expect(saved.task.session?.draft).toBe(before.session?.draft);expect(saved.task.requests).toEqual([]);
  const revised=await core.saveCsvChart({...command,artifact:csvChartRef(saved),settings:{...settings,type:'line',title:'Edited chart',xLabel:'Edited category',zoom:2}});expect(revised.revision).toBe(2);expect(readCsvChart(JSON.parse(revised.task.artifacts[0].revisions[1].content)).settings).toMatchObject({type:'line',title:'Edited chart',xLabel:'Edited category',zoom:2});
  await expect(core.saveCsvChart({...command,artifact:csvChartRef(saved),settings:{...settings,title:'Stale changed title'}})).rejects.toThrow();
  const svg=await core.saveCsvChartSvg(task.id,csvChartRef(revised)),svgRevision=svg.task.artifacts.find(item=>item.id===svg.artifactId)!.revisions[0];expect(svgRevision.mimeType).toBe(CSV_CHART_SVG_MIME);expect(svgRevision.mimeType).not.toContain('design');expect(svgRevision.content).toContain('<polyline');expect(svgRevision.content).toContain('A &amp; &lt;one&gt;');expect(safeCanvasSvg(svgRevision.content)).toBe(true);expect(svgRevision.sourceRefs).toEqual([source.reference]);expect((await core.saveCsvChartSvg(task.id,csvChartRef(revised))).artifactId).toBe(svg.artifactId);
  const destination=join(directory,'owned-chart.svg'),proposal=await core.proposeExport(task.id,{artifactId:svg.artifactId,revision:1,path:destination}),approved=await core.approveExport(task.id,proposal.proposal.id,proposal.proposal.digest);if(!approved.approvalId)throw Error('Missing normal export approval');expect((await core.executeExport(task.id,{actionId:proposal.proposal.id,approvalId:approved.approvalId,requestId:'owned-local-svg-export'})).status).toBe('verified');expect(await readFile(destination,'utf8')).toBe(svgRevision.content);
  await core.close();core=await createCompanion({dataDir:join(directory,'store')});const reopened=await core.getTask(task.id);expect(reopened.artifacts[0].revisions).toEqual(revised.task.artifacts[0].revisions);expect(reopened.artifacts[0].revisions[0].mimeType).toBe(CSV_CHART_MIME);expect(reopened.sources).toEqual(before.sources);expect(reopened.session?.draft).toBe(before.session?.draft);expect(await readFile(file,'utf8')).toBe(csv);
  const changed=await core.putSource(task.id,{id:source.reference.sourceId,kind:'text',role:'fact',label:'New values',content:'Category,Value\nA,99\n'});expect(changed.sources[0].versions).toHaveLength(2);expect((await core.previewCsvChart(task.id,source.reference)).csv).toBe(csv);await expect(core.saveCsvChart({...command,artifact:csvChartRef(revised),settings:{...settings,type:'line'}})).rejects.toThrow(/source/);expect((await core.getTask(task.id)).artifacts[0].revisions).toEqual(reopened.artifacts[0].revisions);
 }
 finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

test('hash-bound imported original/reviewed envelopes preserve marker-like cell text and reject corrupted provenance',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-csv-chart-basis-')),core=await createCompanion({dataDir:join(directory,'store')});
 try{
  const file=join(directory,'owned.csv'),original='Name,Value\n"A\n\n## Reviewed CSV text\n\nB",1\n',reviewed='Name,Value\n"A & <one>",-2\nB,4\n';await writeFile(file,original);
  const task=await core.createTask({title:'Owned exact CSV basis'}),imports=new DocumentImports(core,async()=>file),owner={taskId:task.id,attemptId:randomUUID()},preview=await imports.pick(owner,()=>{});if(preview.kind!=='review')throw Error('Missing actual review');const saved=await imports.add({...owner,label:'Corrected CSV',content:reviewed,role:'fact'},()=>{});expect((await core.previewCsvChart(task.id,saved.reference)).csv).toBe(reviewed);
  const version=saved.task.sources[0].versions[0],broken=await core.putSource(task.id,{id:saved.reference.sourceId,kind:'text',role:'fact',label:version.label,content:version.content.replace(/Original decoded CSV SHA-256: [a-f0-9]{64}/,'Original decoded CSV SHA-256: '+'0'.repeat(64))}),current=broken.sources[0].versions.at(-1)!;await expect(core.previewCsvChart(task.id,{sourceId:saved.reference.sourceId,version:current.version,digest:current.digest})).rejects.toThrow(/ambiguous|hash/);expect((await core.previewCsvChart(task.id,saved.reference)).csv).toBe(reviewed);
 }
 finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

test('index-based columns plot every record with strict numbers and escaped SVG; unsupported data is rejected, never coerced or truncated',()=>{
 const csv='Name,V,V\n"A & <one>",7,-2\nB,9,4\n',selected={...settings,valueColumn:2};expect(csvChartPoints(csv,selected).points.map(point=>point.value)).toEqual([-2,4]);const svg=csvChartSvg(csv,selected,'Owned source',1);expect(svg).toContain('A &amp; &lt;one&gt;');expect(svg).not.toContain('<one>');expect(safeCanvasSvg(svg)).toBe(true);
 for(const value of ['', ' 1','1 apples','=1+1','1e999','1e-999'])expect(()=>csvChartPoints('Name,V\nA,'+value+'\n',settings)).toThrow();
 expect(()=>csvChartPoints('Name,V\n'+Array.from({length:201},(_,index)=>'A,'+index).join('\n'),settings)).toThrow(/200/);
});
