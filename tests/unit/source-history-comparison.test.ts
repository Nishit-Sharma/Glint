import {expect,test} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../../src/core/companion';
import type {Source,SourceRef} from '../../src/core/types';
import {sourceSnapshotDifference} from '../../src/renderer/src/source-snapshot-difference';

test('an explicit pair compares exact saved versions without jumping to the latest and survives reopen without saved work',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'source-history-'));let core=await createCompanion({dataDir:directory});
 try{
  let task=await core.createTask({title:'Source-only history'});
  task=await core.putSource(task.id,{kind:'text',role:'fact',label:'Policy',content:'Keep\nBefore approval.\n'});const sourceId=task.sources[0].id;
  task=await core.putSource(task.id,{id:sourceId,kind:'text',role:'fact',label:'Policy revised',content:'Keep\nAfter approval.\n'});
  task=await core.putSource(task.id,{id:sourceId,kind:'text',role:'fact',label:'Policy newest',content:'Keep\nAfter independent review.\n'});
  const source=task.sources[0],ref=(index:number):SourceRef=>({sourceId,version:source.versions[index].version,digest:source.versions[index].digest}),before=ref(0),after=ref(1),saved=structuredClone(task),store=await readFile(join(directory,'tasks.json'));
  const result=sourceSnapshotDifference(source,before,after);expect(result.kind).toBe('ready');
  if(result.kind!=='ready')throw Error('Expected exact text comparison');
  expect(result.before.content).toBe('Keep\nBefore approval.\n');expect(result.after.version).toBe(2);expect(result.after.content).toBe('Keep\nAfter approval.\n');
  expect(result.parts.some(part=>part.removed&&part.value==='Before approval.\n')).toBe(true);expect(result.parts.some(part=>part.added&&part.value==='After approval.\n')).toBe(true);
  expect(sourceSnapshotDifference(source,before).kind).toBe('ready');expect(sourceSnapshotDifference(source,before,{...after,digest:'wrong'}).kind).toBe('missing');expect(sourceSnapshotDifference(source,before,{...after,sourceId:'other'}).kind).toBe('missing');expect(sourceSnapshotDifference(source,after,before).kind).toBe('missing');expect(sourceSnapshotDifference(source,before,before).kind).toBe('no-newer');
  expect(task.artifacts).toEqual([]);expect(task.procedures).toEqual([]);expect(await core.getTask(task.id)).toEqual(saved);expect(await readFile(join(directory,'tasks.json'))).toEqual(store);
  await core.close();core=await createCompanion({dataDir:directory});const reopened=await core.getTask(task.id);expect(reopened.sources).toEqual(saved.sources);expect(reopened.artifacts).toEqual([]);expect(reopened.requests).toEqual([]);expect(sourceSnapshotDifference(reopened.sources[0],before,after)).toEqual(result);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

test('explicit endpoints keep the existing missing, non-text and bounded-large fallbacks',()=>{
 const ref=(version:number):SourceRef=>({sourceId:'a',version,digest:'digest-'+version});
 const source={id:'a',currentVersion:3,freshness:'refresh-required',versions:[{id:'a',version:1,digest:'digest-1',kind:'text',content:'a'.repeat(50_001)},{id:'a',version:2,digest:'digest-2',kind:'text',content:'b'.repeat(50_001)},{id:'a',version:3,digest:'digest-3',kind:'text',content:'latest'}]} as unknown as Source;
 const large=sourceSnapshotDifference(source,ref(1),ref(2));expect(large.kind).toBe('large');if(large.kind==='large'){expect(large.before.content).toHaveLength(50_001);expect(large.after.content).toHaveLength(50_001);}
 expect(sourceSnapshotDifference({...source,versions:source.versions.filter(version=>version.version!==2)},ref(1),ref(2)).kind).toBe('missing');
 expect(sourceSnapshotDifference({...source,versions:source.versions.map(version=>version.version===2?{...version,kind:'image'}:version)},ref(1),ref(2)).kind).toBe('unsupported');
});
