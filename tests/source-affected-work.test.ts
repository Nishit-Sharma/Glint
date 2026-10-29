import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion,type Companion} from '../src/core/companion';
import {sourceAffectedWork} from '../src/renderer/src/source-affected-work';

let core:Companion|undefined,directory:string;
afterEach(async()=>{await core?.close();if(directory)await rm(directory,{recursive:true,force:true});core=undefined;});
it('finds only latest saved revisions affected by the selected source through change and reopen',async()=>{
 directory=await mkdtemp(join(tmpdir(),'source-affected-'));core=await createCompanion({dataDir:directory});
 let task=await core.createTask({title:'Source continuity'});
 task=await core.putSource(task.id,{kind:'text',label:'A',content:'A1',role:'fact'});const a=task.sources[0],a1={sourceId:a.id,version:1,digest:a.versions[0].digest};
 task=await core.putSource(task.id,{kind:'text',label:'B',content:'B1',role:'fact'});const b=task.sources[1],b1={sourceId:b.id,version:1,digest:b.versions[0].digest};
 const old=await core.saveArtifact(task.id,{title:'A document',content:'Original A answer',sourceRefs:[a1]});
 await core.saveArtifact(task.id,{title:'Only B',content:'Unrelated B answer',sourceRefs:[b1]});
 task=await core.saveProcedure(task.id,{title:'A procedure',steps:[{intent:'Review',target:'A',preconditions:[],expectedResult:'Done'}],sourceRefs:[a1]});const procedureId=task.procedures[0].id;
 task=await core.getTask(task.id);expect(sourceAffectedWork(task,a.id)).toEqual([]);
 task=await core.invalidateSource(task.id,a.id,'Observed change');
 expect(sourceAffectedWork(task,a.id).map(x=>[x.kind,x.item.id,x.refs])).toEqual([['artifact',old.artifactId,[a1]],['procedure',procedureId,[a1]]]);
 expect(sourceAffectedWork(task,b.id)).toEqual([]);
 task=await core.putSource(task.id,{id:a.id,kind:'text',label:'A revised',content:'A2',role:'fact'});const a2={sourceId:a.id,version:2,digest:task.sources[0].versions[1].digest};
 await core.saveArtifact(task.id,{title:'Current A',content:'New answer',sourceRefs:[a2]});
 task=await core.getTask(task.id);expect(sourceAffectedWork(task,a.id).map(x=>x.item.id)).toEqual([old.artifactId,procedureId]);
 await core.saveArtifact(task.id,{artifactId:old.artifactId,expectedRevision:1,title:'A document updated',content:'Updated',sourceRefs:[a2]});
 task=await core.getTask(task.id);expect(sourceAffectedWork(task,a.id).map(x=>x.item.id)).toEqual([procedureId]);
 await core.close();core=await createCompanion({dataDir:directory});task=await core.getTask(task.id);
 expect(sourceAffectedWork(task,a.id).map(x=>[x.kind,x.item.id,x.refs])).toEqual([['procedure',procedureId,[a1]]]);expect(sourceAffectedWork(task,'missing')).toEqual([]);
});
it('treats an exact-version digest mismatch as affected and never attributes another source',()=>{
 const task={sources:[{id:'a',freshness:'fresh',currentVersion:1,versions:[{version:1,digest:'actual',label:'A'}]}],artifacts:[{id:'x',revisions:[{title:'X',sourceRefs:[{sourceId:'a',version:1,digest:'other'},{sourceId:'b',version:1,digest:'b'}]}]}],procedures:[]} as unknown as import('../src/core/types').Task;
 expect(sourceAffectedWork(task,'a')[0].refs).toEqual([{sourceId:'a',version:1,digest:'other'}]);expect(sourceAffectedWork(task,'b')).toEqual([]);
});

it('reopened window snapshots need review without inferring a live change',async()=>{
 directory=await mkdtemp(join(tmpdir(),'source-window-affected-'));core=await createCompanion({dataDir:directory});
 let task=await core.createTask({title:'Window'});task=await core.putSource(task.id,{kind:'window',label:'Selected window',content:'Synthetic snapshot metadata',role:'fact',windowId:'window:41',documentToken:'synthetic-document'});const source=task.sources[0],ref={sourceId:source.id,version:1,digest:source.versions[0].digest};
 const saved=await core.saveArtifact(task.id,{title:'Window answer',content:'Earlier answer',sourceRefs:[ref]});task=await core.getTask(task.id);expect(sourceAffectedWork(task,source.id)).toEqual([]);
 await core.close();core=await createCompanion({dataDir:directory});task=await core.getTask(task.id);expect(task.sources[0].freshness).toBe('refresh-required');expect(sourceAffectedWork(task,source.id).map(x=>[x.item.id,x.refs])).toEqual([[saved.artifactId,[ref]]]);
});
