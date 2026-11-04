import {afterEach,beforeEach,expect,test} from 'vitest';
import {mkdtemp,rm,readFile,writeFile,symlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createCompanion,type Companion} from '../../src/core/companion';
import type {Task} from '../../src/core/types';
import {LearningDraftStore} from '../../src/host/learning-drafts';
import {isTaskLearningDraftOwner,learningDraftKey,parseLearningDraftOwner,serializeLearningDraftJson} from '../../src/shared/learning-drafts';
import {prepareWorkflowReview} from '../../src/core/workflow-review-host';
import {createLearningDrafts} from '../../src/renderer/src/learning-drafts';

let directory:string,core:Companion;
beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'literal-workflow-drafts-'));core=await createCompanion({dataDir:join(directory,'core')});});
afterEach(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});
async function fixture(){
 const task=await core.createTask({title:'Owned literal source review'}),sourced=await core.putSource(task.id,{kind:'text',role:'fact',label:'Owned rules',content:'Draft + Submit -> Ready\nReady + Edit -> Draft'}),source=sourced.sources[0],version=source.versions[0];
 const refs=[{sourceId:source.id,version:version.version,digest:version.digest}],saved=await core.saveArtifact(task.id,{title:'Owned linked document',content:'The source rules are linked separately.',mimeType:'text/markdown',sourceRefs:refs});
 const identity={kind:'workflow-source-review' as const,taskId:task.id,artifactId:saved.artifactId,artifactRevision:saved.revision.revision,artifactDigest:saved.revision.digest};
 let override:Task|undefined;const store=new LearningDraftStore({directory,lookupTask:async id=>override??(await core.listTasks()).find(task=>task.id===id)});
 return {task,refs,sourceId:source.id,identity,store,owner:()=>{const parsed=parseLearningDraftOwner(identity);if(!isTaskLearningDraftOwner(parsed)||!('kind' in parsed)||parsed.kind!=='workflow-source-review')throw Error('Expected workflow source review owner.');return parsed;},hideArtifact:async()=>{override={...await core.getTask(task.id),artifacts:[]};}};
}
const slot='workflow-source:review';
const initial={rules:[{included:true,from:'Draft',event:'Submit',to:'Ready',interpretation:'source-stated',reason:'Literal reviewed rule.'}],initialState:'',eventSequence:[''],assumptions:''};
const value=(note='  raw\n\n')=>({initial:serializeLearningDraftJson(initial),value:serializeLearningDraftJson({...initial,initialState:'',eventSequence:['','0'],assumptions:note}),basis:'literal-workflow-review-v1:exact-document-and-ordered-source-refs'});

test('literal draft owner is distinct and strict without inventing module or execution fields',async()=>{
 const f=await fixture();expect(f.owner()).toEqual(f.identity);
 for(const extra of [{moduleId:'fake'},{moduleVersion:1},{sourceRefs:[]},{permissions:['capture']},{confirmed:true}])expect(()=>parseLearningDraftOwner({...f.identity,...extra})).toThrow();
});
test('public sidecar preserves exact literal raw input across reopen without changing the real task',async()=>{
 const f=await fixture(),owner=f.owner(),before=await core.getTask(f.task.id),raw=value('  0\t\n理由\n\n');
 const saved=await f.store.save(owner,slot,'initial',0,raw);expect(saved.kind).toBe('saved');
 const reopened=new LearningDraftStore({directory,lookupTask:async id=>(await core.listTasks()).find(task=>task.id===id)}),read=await reopened.read();expect(read).toMatchObject({kind:'available',records:[{owner,slot,value:raw}]});expect(await core.getTask(f.task.id)).toEqual(before);
});
test('a changed source/document cannot prevent later raw preservation for the exact historical text owner',async()=>{
 const f=await fixture(),owner=f.owner();await f.store.save(owner,slot,'initial',0,value());
 const changed=await core.putSource(f.task.id,{id:f.sourceId,kind:'text',role:'fact',label:'Changed owned rules',content:'Draft + Submit -> Changed'}),source=changed.sources[0],version=source.versions.at(-1)!,ref={sourceId:source.id,version:version.version,digest:version.digest};
 await core.saveArtifact(f.task.id,{artifactId:f.identity.artifactId,expectedRevision:1,title:'New document version',content:'New version and links.',sourceRefs:[ref]});
 await expect(prepareWorkflowReview(core,{taskId:f.task.id,basis:{artifactId:owner.artifactId,revision:owner.artifactRevision,digest:owner.artifactDigest}})).rejects.toThrow();
 expect((await f.store.save(owner,slot,'initial',1,value('stale raw still kept'))).kind).toBe('saved');expect((await f.store.read())).toMatchObject({kind:'available',records:[{owner,value:value('stale raw still kept')}]});expect((await core.getTask(f.task.id)).requests).toEqual([]);
});
test('missing history remains read/copy/discard only and exact existing tombstones still use CAS',async()=>{
 const f=await fixture(),owner=f.owner();await f.store.save(owner,slot,'initial',0,value());await f.hideArtifact();
 expect((await f.store.read())).toMatchObject({kind:'available',records:[{owner,value:value()}]});await expect(f.store.save(owner,slot,'initial',1,value('cannot write nonexistent history'))).rejects.toThrow();
 expect(await f.store.save(owner,slot,'initial',0,null)).toMatchObject({kind:'conflict'});expect(await f.store.save(owner,slot,'initial',1,null)).toMatchObject({kind:'saved',record:{revision:2,value:null}});
});
test('foreign task/non-text owner and unrelated slots cannot admit literal raw records',async()=>{
 const f=await fixture(),other=await core.createTask({title:'Foreign task'}),json=await core.saveArtifact(f.task.id,{title:'Not a saved text document',mimeType:'application/json',content:'{}',sourceRefs:f.refs});
 for(const owner of [{...f.identity,taskId:other.id},{...f.identity,artifactId:json.artifactId,artifactRevision:json.revision.revision,artifactDigest:json.revision.digest}])await expect(Promise.resolve().then(()=>f.store.save(parseLearningDraftOwner(owner),slot,'initial',0,value()))).rejects.toThrow();
 await expect(Promise.resolve().then(()=>f.store.save(f.owner(),'helper:semantic:steps','initial',0,value()))).rejects.toThrow();expect(await f.store.read()).toMatchObject({kind:'available',records:[]});
});
test('real task deletion hides/purges raw records and a late old-owner write cannot resurrect them',async()=>{
 const f=await fixture(),owner=f.owner();await f.store.save(owner,slot,'initial',0,value('deleted raw'));await core.deleteTask(f.task.id);
 expect(await f.store.read()).toMatchObject({kind:'available',records:[],cleanup:'needed'});await f.store.cleanup();expect(await f.store.save(owner,slot,'initial',1,value('late reply'))).toMatchObject({kind:'stale-epoch'});expect(await readFile(join(directory,'learning-drafts.json'),'utf8')).not.toContain('deleted raw');
});
test('the existing public cache shares functional raw edits and old acknowledgements cannot clear a newer literal generation',async()=>{
 const f=await fixture(),owner=f.owner(),cache=createLearningDrafts({read:()=>f.store.read(),save:(...args)=>f.store.save(...args)});await cache.load();
 cache.edit(owner,slot,initial,'exact literal basis',raw=>({...raw,assumptions:'  earlier  '}));await cache.flushForm(owner,slot);const token=cache.capture(owner,slot)!;
 cache.edit(owner,slot,initial,'exact literal basis',raw=>({...raw,initialState:'0',assumptions:raw.assumptions+'newer'}));await cache.flushForm(owner,slot);expect(cache.acknowledge(token)).toBe(false);
 const record=(await f.store.read());expect(record.kind).toBe('available');if(record.kind==='available')expect(record.records.find(record=>learningDraftKey(record.owner,record.slot)===learningDraftKey(owner,slot))?.value?.value).toContain('  earlier  newer');
 expect(cache.readForm(owner,slot,{...initial,assumptions:'changed baseline'},'exact literal basis').status).toBe('recovery');
});
test('the actual pinned earlier strict sidecar reader refuses a new owner without rewriting shared draft bytes',async()=>{
 const f=await fixture();await f.store.save(f.owner(),slot,'initial',0,value());const path=join(directory,'learning-drafts.json'),before=await readFile(path),source=await readFile(resolve('tests/fixtures/literal-review-prior-sidecar.ts.txt'),'utf8');expect(createHash('sha256').update(source).digest('hex')).toBe('50dfe6364fb098f792cda6e506aef9667dd60d82561fe30874a7256b5d139257');
 const output=join(directory,'prior-sidecar.mjs');await symlink(resolve('node_modules'),join(directory,'node_modules'),'dir');await build({stdin:{contents:source,loader:'ts',sourcefile:'prior-sidecar.ts',resolveDir:resolve('src/shared')},outfile:output,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'});const prior=await import(/* @vite-ignore */pathToFileURL(output).href);
 expect(()=>prior.parseLearningDraftFile(JSON.parse(before.toString('utf8')))).toThrow();expect(await readFile(path)).toEqual(before);expect(await f.store.read()).toMatchObject({kind:'available',records:[{owner:f.owner()}]});
});
test.each(['malformed','unsupported'] as const)('a %s shared sidecar remains unavailable and byte-preserved with the new owner admitted',async kind=>{
 const f=await fixture(),before=await core.getTask(f.task.id),bytes=Buffer.from(kind==='malformed'?'{broken literal review':'{"schemaVersion":999,"records":[]}'),path=join(directory,'learning-drafts.json');await writeFile(path,bytes);expect(await f.store.read()).toMatchObject({kind:'unavailable',recoveryToken:expect.any(String)});expect(await readFile(path)).toEqual(bytes);await expect(f.store.save(f.owner(),slot,'initial',0,value())).rejects.toThrow();expect(await readFile(path)).toEqual(bytes);expect(await core.getTask(f.task.id)).toEqual(before);
});
