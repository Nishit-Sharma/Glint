import {expect,it} from 'vitest';
import {mkdtemp,rm,readFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {join,resolve} from 'node:path';
import {createCompanion} from '../../src/core/companion';
import {LearningDraftStore} from '../../src/host/learning-drafts';
import {createLearningDrafts} from '../../src/renderer/src/learning-drafts';
import {SOURCE_TEXT_DRAFT_SLOT,emptySourceTextDraft,sourceTextDraftBasis,sourceTextDraftOwner} from '../../src/shared/source-text-draft';

it('fresh core and sidecar restore exact unapplied saved-source fields without an artifact owner or source mutation',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'saved-source-restore-'));let core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Ordinary saved source'}),saved=await core.putSource(task.id,{kind:'text',label:'Committed name',content:'Committed source text.',role:'fact'}),source=saved.sources[0],version=source.versions[0];
  expect(saved.artifacts).toEqual([]);
  const before=await core.getTask(task.id),owner=sourceTextDraftOwner(task.id,source.id),slot=SOURCE_TEXT_DRAFT_SLOT,basis=sourceTextDraftBasis({sourceId:source.id,version:version.version,digest:version.digest},source.freshness),raw={label:'Raw source name Ω',content:'Unsubmitted line one.\nUnsubmitted line two: keep exactly.',role:'inspiration' as const};
  const store=new LearningDraftStore({directory,lookupTask:async id=>(await core.listTasks()).find(task=>task.id===id)}),cache=createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)});
  await cache.load();expect(cache.edit(owner,slot,emptySourceTextDraft,basis,()=>({...emptySourceTextDraft,present:true,...raw}))).toBe(true);await cache.flushForm(owner,slot);
  cache.setFrozen(true);await cache.flushForQuit();expect(await core.getTask(task.id)).toEqual(before);
  await core.close();core=await createCompanion({dataDir:directory});
  const reopenedTask=await core.getTask(task.id);expect(reopenedTask.sources).toEqual(before.sources);
  const reopenedStore=new LearningDraftStore({directory,lookupTask:async id=>(await core.listTasks()).find(task=>task.id===id)}),reopened=createLearningDrafts({read:()=>reopenedStore.read(),save:(...args)=>reopenedStore.save(...args)});
  await reopened.load();expect(reopened.readForm(owner,slot,emptySourceTextDraft,basis)).toMatchObject({status:'ready',value:{present:true,...raw}});
  expect(await core.getTask(task.id)).toEqual(reopenedTask);
  const read=await reopenedStore.read();expect(read.kind).toBe('available');if(read.kind!=='available')throw Error('Actual sidecar did not reopen.');
  expect(read.records).toHaveLength(1);expect(read.records[0]).toMatchObject({owner:{kind:'source-text-edit',taskId:task.id,sourceId:source.id},slot:'source-text:edit',revision:1});
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

it('the exact845 old host and reader refuse source-edit sidecars through read save cleanup and purge without touching their bytes',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'saved-source-old845-')),core=await createCompanion({dataDir:directory});
 try{
 const task=await core.createTask({title:'Exact old-reader source owner'}),saved=await core.putSource(task.id,{kind:'text',label:'Committed',content:'Committed source text.',role:'fact'}),source=saved.sources[0],version=source.versions[0],owner=sourceTextDraftOwner(task.id,source.id),basis=sourceTextDraftBasis({sourceId:source.id,version:1,digest:version.digest},'fresh'),lookupTask=async(id:string)=>(await core.listTasks()).find(task=>task.id===id),store=new LearningDraftStore({directory,lookupTask}),cache=createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)});await cache.load();cache.edit(owner,SOURCE_TEXT_DRAFT_SLOT,emptySourceTextDraft,basis,()=>({...emptySourceTextDraft,present:true,label:'Literal older raw Ω',content:'Unapplied text for strict old reader.',role:'style' as const}));await cache.flush();
 const path=join(directory,'learning-drafts.json'),bytes=await readFile(path),host=await readFile(resolve('tests/fixtures/source-text-prior-host.ts.txt'),'utf8'),shared=await readFile(resolve('tests/fixtures/source-text-prior-shared.ts.txt'),'utf8');
 expect(createHash('sha256').update(host).digest('hex')).toBe('33bab0eb8bf6bb3c207fd6f25c665027f09fc4126a5749af7a3d24fad6810cea');expect(createHash('sha256').update(shared).digest('hex')).toBe('4307fd87ffc93b12360837b139945d5c5059c2cfa2e2a39e10f8595827fe958b');
 const output=join(directory,'old845-host.mjs');await symlink(resolve('node_modules'),join(directory,'node_modules'),'dir');await build({stdin:{contents:host,loader:'ts',sourcefile:'old845-host.ts',resolveDir:resolve('src/host')},outfile:output,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent',plugins:[{name:'exact845-shared',setup(api){api.onResolve({filter:/^\.\.\/shared\/learning-drafts$/},()=>({path:'old845-shared',namespace:'old845'}));api.onLoad({filter:/.*/,namespace:'old845'},()=>({contents:shared,loader:'ts',resolveDir:resolve('src/shared')}));}}]});
 const prior=await import(/* @vite-ignore */pathToFileURL(output).href),old=new prior.LearningDraftStore({directory,lookupTask});expect(await old.read()).toMatchObject({kind:'unavailable'});expect(await readFile(path)).toEqual(bytes);
 const artifact=await core.saveArtifact(task.id,{title:'Unrelated valid845 review owner',mimeType:'text/plain',content:'Ordinary saved review basis.'}),oldOwner={kind:'workflow-source-review',taskId:task.id,artifactId:artifact.artifactId,artifactRevision:1,artifactDigest:artifact.revision.digest};await expect(async()=>old.save(oldOwner,'workflow-source:review','initial',0,null)).rejects.toThrow();expect(await readFile(path)).toEqual(bytes);await expect(old.cleanup()).rejects.toThrow();expect(await readFile(path)).toEqual(bytes);await expect(old.purgeTask(task.id)).rejects.toThrow();expect(await readFile(path)).toEqual(bytes);const reopened=await store.read();expect(reopened.kind).toBe('available');if(reopened.kind!=='available')throw Error('Current reader must still restore the intact bytes.');expect(reopened.records[0].owner).toEqual(owner);expect(JSON.parse(reopened.records[0].value!.value)).toMatchObject({content:'Unapplied text for strict old reader.',label:'Literal older raw Ω',role:'style'});expect((await core.getTask(task.id)).sources).toEqual(saved.sources);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
