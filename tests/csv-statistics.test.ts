import {expect,test} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createCompanion} from '../src/core/companion';
import {DocumentImports} from '../src/host/document-import';
import {csvStatistics} from '../src/shared/csv-statistics';

test('real imported CSV statistics use all rows, strict indexed values and stable methods; saves are exact, versioned, retryable and source-bound',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-csv-statistics-'));let core=await createCompanion({dataDir:join(directory,'store')});
 try{
  const file=join(directory,'owned.csv'),csv='Label,Value,Value\nA,-4,1000000000001\nB,12,1000000000002\nC,0,1000000000003\n';await writeFile(file,csv);
  const created=await core.createTask({title:'Owned CSV statistics'});await core.saveComposerDraft(created.id,0,{text:'  KEEP_STATS_DRAFT\n',kind:'explain'});
  const imports=new DocumentImports(core,async()=>file),owner={taskId:created.id,attemptId:randomUUID()},review=await imports.pick(owner,()=>{});if(review.kind!=='review')throw Error('No actual CSV picker review');
  const imported=await imports.add({...owner,label:'Owned statistics CSV',content:review.text,role:'fact'},()=>{}),before=await core.getTask(created.id),data=await core.previewCsvStatistics(created.id,imported.reference);
  expect(data.csv).toBe(csv);
  const command={type:'statistics.save' as const,taskId:created.id,creationId:'owned-statistics-create',source:imported.reference,dataDigest:data.dataDigest,settings:{title:'Owned statistics',columns:[1,2],missing:'reject' as const}},saved=await core.saveCsvStatistics(command),artifact=saved.task.artifacts.find(item=>item.id===saved.artifactId)!;
  const body=JSON.parse(artifact.revisions[0].content);expect(body.results[0]).toMatchObject({column:1,heading:'Value',count:3,missing:0,sum:8,mean:8/3,median:0,min:-4,max:12});expect(body.results[0].populationVariance).toBeCloseTo(416/9);expect(body.results[0].sampleVariance).toBeCloseTo(208/3);expect(body.results[1]).toMatchObject({column:2,count:3,mean:1000000000002,populationVariance:2/3,sampleVariance:1});
  const settings={title:'Boundary statistics',columns:[0],missing:'reject' as const};expect(csvStatistics('V\n'+Array(10000).fill('1').join('\n'),settings)[0]).toMatchObject({count:10000,sum:10000,populationVariance:0,sampleVariance:0});
  expect(()=>csvStatistics('V,W\n2,x\n,y\n',settings)).toThrow(/empty/);expect(csvStatistics('V,W\n2,x\n,y\n',{...settings,missing:'omit-empty'})[0]).toMatchObject({count:1,missing:1,sum:2,sampleVariance:null,sampleStdDev:null});
  expect(()=>csvStatistics('V\n2 apples\n',settings)).toThrow(/complete/);expect(()=>csvStatistics('V\n1e308\n1e308\n',settings)).toThrow(/range/);expect(()=>csvStatistics('V\n1e-999\n',settings)).toThrow(/underflows/);
  expect(body.source).toEqual(imported.reference);expect(body.dataDigest).toBe(data.dataDigest);expect(await core.saveCsvStatistics(command)).toEqual(saved);expect(saved.task.sources).toEqual(before.sources);expect(saved.task.requests).toEqual([]);expect(saved.task.session?.draft).toBe(before.session?.draft);
  const reference={artifactId:saved.artifactId,revision:saved.revision,digest:saved.digest},updated=await core.saveCsvStatistics({...command,artifact:reference,settings:{...command.settings,title:'Edited statistics',columns:[1]}});expect(updated.revision).toBe(2);await expect(core.saveCsvStatistics({...command,artifact:reference,settings:{...command.settings,title:'Stale edit'}})).rejects.toThrow();
  await core.close();core=await createCompanion({dataDir:join(directory,'store')});expect((await core.getTask(created.id)).artifacts).toEqual(updated.task.artifacts);expect((await core.getTask(created.id)).sources).toEqual(before.sources);expect((await core.getTask(created.id)).session?.draft).toBe(before.session?.draft);
  await core.putSource(created.id,{id:imported.reference.sourceId,kind:'text',role:'fact',label:'Changed CSV',content:'Label,Value\nA,99\n'});expect((await core.previewCsvStatistics(created.id,imported.reference)).csv).toBe(csv);await expect(core.saveCsvStatistics(command)).rejects.toThrow(/source/);
 }
 finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
