import {afterAll,beforeAll,expect,it} from 'vitest';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,symlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createCompanion} from '../src/core/companion';
import {LearningDraftStore} from '../src/host/learning-drafts';
import {emptyLocalTaskDraft,localTaskDraftBasis,localTaskDraftOwner,LOCAL_TASK_DRAFT_SLOT} from '../src/shared/local-task-draft';
import {serializeLearningDraftJson} from '../src/shared/learning-drafts';
import {exampleLesson} from '../src/learning/example';

let readerDirectory:string;
let OldStore:typeof LearningDraftStore,oldParse:typeof import('../src/shared/learning-drafts').parseLearningDraftOwner;
beforeAll(async()=>{
 const shared=await readFile(resolve('tests/fixtures/local-task-prechange-806/shared.ts.txt'),'utf8'),host=await readFile(resolve('tests/fixtures/local-task-prechange-806/host.ts.txt'),'utf8');
 const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
 expect(sha(shared)).toBe('4474507ab780bf07d0b73d9f3e2b698b25d1d314384688e439538340afdb7b76');
 expect(sha(host)).toBe('f08082343bab0fd0edc766d1f2a95d7eaf9fdd54239dc38a81d99f053bd8b0ea');
 readerDirectory=await mkdtemp(join(tmpdir(),'local-prechange-806-reader-'));await symlink(resolve('node_modules'),join(readerDirectory,'node_modules'),'dir');
 const output=join(readerDirectory,'reader.mjs');
 await build({stdin:{contents:host+'\nexport {parseLearningDraftOwner};',loader:'ts',resolveDir:resolve('src/host'),sourcefile:'exact-806-learning-drafts-host.ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile:output,logLevel:'silent',plugins:[{name:'exact-prechange-806-shared',setup(b){
  b.onResolve({filter:/shared\/learning-drafts$/},()=>({path:'prechange-shared',namespace:'prechange'}));
  b.onLoad({filter:/.*/,namespace:'prechange'},()=>({contents:shared,loader:'ts',resolveDir:resolve('src/shared')}));
 }}]});
 const module=await import(pathToFileURL(output).href);OldStore=module.LearningDraftStore;oldParse=module.parseLearningDraftOwner;
});
afterAll(async()=>{if(readerDirectory)await rm(readerDirectory,{recursive:true,force:true});});
it('actual strict806 parser/store refuse a mixed future file and preserve all bytes through refused mutations',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'local-future-file-')),core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Real task owner'}),artifact=await core.saveArtifact(task.id,{title:'Lesson',mimeType:'application/vnd.window-companion.modules+json',sourceRefs:[],content:JSON.stringify({schemaVersion:1,markdown:'Owned.',modules:[{id:'join',version:1,data:exampleLesson,provenance:[]}]})});
  const owner={taskId:task.id,artifactId:artifact.artifactId,artifactRevision:1,artifactDigest:artifact.revision.digest,moduleId:'join',moduleVersion:1};
  const lookupTask=async(id:string)=>(await core.listTasks()).find(task=>task.id===id),store=new LearningDraftStore({directory,lookupTask}),prior={initial:'""',value:'"Keep existing practice"',basis:'actual-v1'};
  await store.save(owner,'prediction','initial',0,prior);
  const raw={...emptyLocalTaskDraft,title:'  Exact title  ',content:'Uncreated local body.'};
  await store.save(localTaskDraftOwner('text'),LOCAL_TASK_DRAFT_SLOT,'initial',0,{initial:serializeLearningDraftJson(emptyLocalTaskDraft),value:serializeLearningDraftJson(raw),basis:localTaskDraftBasis('text')});
  const original=await readFile(join(directory,'learning-drafts.json')),before=await core.getTask(task.id),old=new OldStore({directory,lookupTask});
  expect(()=>oldParse(localTaskDraftOwner('text'))).toThrow();
  expect(await old.read()).toMatchObject({kind:'unavailable'});expect(await readFile(join(directory,'learning-drafts.json'))).toEqual(original);
  await expect(old.save(owner,'prediction','initial',1,prior)).rejects.toThrow();expect(await readFile(join(directory,'learning-drafts.json'))).toEqual(original);
  await expect(old.cleanup()).rejects.toThrow();expect(await readFile(join(directory,'learning-drafts.json'))).toEqual(original);
  await expect(old.purgeTask(task.id)).rejects.toThrow();expect(await readFile(join(directory,'learning-drafts.json'))).toEqual(original);
  const reopened=new LearningDraftStore({directory,lookupTask}),read=await reopened.read();expect(read).toMatchObject({kind:'available',records:[{owner,value:prior},{owner:localTaskDraftOwner('text')}]});
  expect(await readFile(join(directory,'learning-drafts.json'))).toEqual(original);expect(await core.getTask(task.id)).toEqual(before);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
