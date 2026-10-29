import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,readdir,rename,rm,stat,symlink,utimes,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,test,vi} from 'vitest';
import type {Task} from '../src/core/types';
import {exampleLesson} from '../src/learning/example';
import {workflowExample} from '../src/learning/workflow-example';
import {localGroundedJoin} from '../src/core/grounded-join-host';
import {LearningDraftStore} from '../src/host/learning-drafts';
import {LEARNING_DRAFT_LIMITS,parseLearningDraftEpoch,parseLearningDraftFile,parseLearningDraftJson,parseLearningDraftOwner,parseLearningDraftRecoveryToken,parseLearningDraftSlot,parseLearningDraftValue,type LearningDraftOwner,serializeLearningDraftJson} from '../src/shared/learning-drafts';

const diskFailure=vi.hoisted(()=>({rename:false,backupOpen:false,backupWrite:false,backupCollision:false,backupChange:null as string|null,streamWriteAfter:0,streamChange:false,activeRead:false}));
vi.mock('node:fs/promises',async original=>{
 const actual=await original<typeof import('node:fs/promises')>();
 return {...actual,
  open:async(...args:Parameters<typeof actual.open>)=>{
   if(String(args[0]).includes('learning-drafts-recovery-')){
    if(diskFailure.backupOpen)throw Error('Synthetic backup creation failure.');
    if(diskFailure.backupCollision)await actual.writeFile(args[0],'protected existing backup');
   }
   const file=await actual.open(...args);
   if(String(args[0]).includes('learning-drafts-recovery-')&&diskFailure.backupWrite)file.writeFile=async()=>{throw Error('Synthetic backup write failure.');};
   if(String(args[0]).includes('learning-drafts-recovery-')&&diskFailure.backupChange!==null){
    const write=file.writeFile.bind(file),changed=diskFailure.backupChange;
    file.writeFile=async(data,options)=>{await write(data,options);await actual.writeFile(String(args[0]).replace(/learning-drafts-recovery-[^/]+$/,'learning-drafts.json'),changed);};
   }
   if(String(args[0]).includes('learning-drafts-recovery-')&&diskFailure.streamWriteAfter>0){
    const write=file.writeFile.bind(file);let chunks=0;
    file.writeFile=async(data,options)=>{if(++chunks===diskFailure.streamWriteAfter)throw Error('Synthetic streamed backup failure.');return write(data,options);};
   }
   if(String(args[0]).includes('learning-drafts-recovery-')&&diskFailure.streamChange){
    const write=file.writeFile.bind(file);let changed=false;
    file.writeFile=async(data,options)=>{await write(data,options);if(!changed){changed=true;await actual.utimes(String(args[0]).replace(/learning-drafts-recovery-[^/]+$/,'learning-drafts.json'),new Date('2030-01-01'),new Date('2030-01-01'));}};
   }
   if(String(args[0]).endsWith('/learning-drafts.json')&&diskFailure.activeRead)file.read=async()=>{throw Error('Synthetic draft read failure.');};
   return file;
  },
  rename:async(...args:Parameters<typeof actual.rename>)=>{if(diskFailure.rename)throw Error('Synthetic atomic replacement failure.');return actual.rename(...args);},
 };
});

const directories:string[]=[];
afterEach(async()=>{await Promise.all(directories.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
function fixture():Task{
 return {id:'task-a',title:'Join practice',goal:'',status:'active',createdAt:'2026-10-27T00:00:00Z',updatedAt:'2026-10-27T00:00:00Z',sources:[],requests:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false},artifacts:[{id:'answer-a',revisions:[{revision:1,title:'Join lesson',mimeType:'application/vnd.window-companion.modules+json',content:JSON.stringify({schemaVersion:1,markdown:'Practice on synthetic tables.',modules:[{id:'join',version:1,data:exampleLesson,provenance:[]}]}),sourceRefs:[],digest:'artifact-digest-a',createdAt:'2026-10-27T00:00:00Z'}]}]};
}
const epoch='initial';
const owner:LearningDraftOwner={taskId:'task-a',artifactId:'answer-a',artifactRevision:1,artifactDigest:'artifact-digest-a',moduleId:'join',moduleVersion:1};
async function setup(){
 const directory=await mkdtemp(join(tmpdir(),'learning-drafts-'));directories.push(directory);
 let task:Task|undefined=fixture();
 const lookupTask=async(id:string)=>id===task?.id?task:undefined;
 return {directory,store:new LearningDraftStore({directory,lookupTask}),lookupTask,getTask:()=>task,setTask:(next:Task|undefined)=>{task=next;}};
}

test('the initial namespace is stable across read-only reopen and first write',async()=>{
 const context=await setup(),before=structuredClone(context.getTask());
 expect(await context.store.read()).toEqual({kind:'available',epoch,records:[]});
 expect(await context.store.read()).toEqual({kind:'available',epoch,records:[]});
 expect(await readdir(context.directory)).toEqual([]);
 const reopened=new LearningDraftStore({directory:context.directory,lookupTask:context.lookupTask});
 expect(await reopened.read()).toEqual({kind:'available',epoch,records:[]});
 await reopened.save(owner,'prediction',epoch,0,{initial:'""',value:'"0"',basis:'v0'});
 expect(parseLearningDraftFile(JSON.parse(await readFile(join(context.directory,'learning-drafts.json'),'utf8'))).epoch).toBe(epoch);
 expect(context.getTask()).toEqual(before);
});

test('unfinished zero and whitespace survive reopening without touching task data',async()=>{
 const context=await setup(),before=structuredClone(context.getTask());
 const value={initial:serializeLearningDraftJson({count:'',reason:''}),value:serializeLearningDraftJson({reason:'  raw reasoning\n',count:'0'}),basis:'form-state-fingerprint'};
 expect(await context.store.save(owner,'practice-prediction',epoch,0,value)).toEqual({kind:'saved',epoch,record:{owner,slot:'practice-prediction',revision:1,value}});
 const reopened=new LearningDraftStore({directory:context.directory,lookupTask:context.lookupTask});
 expect(await reopened.read()).toEqual({kind:'available',epoch,records:[{owner,slot:'practice-prediction',revision:1,value}]});
 expect(context.getTask()).toEqual(before);
 expect((await stat(join(context.directory,'learning-drafts.json'))).mode&0o777).toBe(0o600);
 expect(await readFile(join(context.directory,'learning-drafts.json'),'utf8')).not.toContain('Practice on synthetic tables.');
});

test('CAS serializes concurrent writers and a discard tombstone rejects late resurrection',async()=>{
 const {store}=await setup(),value={initial:'""',value:'"0"',basis:'prediction-v0'};
 const [first,stale]=await Promise.all([store.save(owner,'prediction',epoch,0,value),store.save(owner,'prediction',epoch,0,{...value,value:'"late"'})]);
 expect(first).toEqual({kind:'saved',epoch,record:{owner,slot:'prediction',revision:1,value}});
 expect(stale).toEqual({kind:'conflict',epoch,current:{owner,slot:'prediction',revision:1,value}});
 expect(await store.save(owner,'prediction',epoch,1,null)).toEqual({kind:'saved',epoch,record:{owner,slot:'prediction',revision:2,value:null}});
 expect(await store.save(owner,'prediction',epoch,1,value)).toEqual({kind:'conflict',epoch,current:{owner,slot:'prediction',revision:2,value:null}});
 expect(await store.read()).toEqual({kind:'available',epoch,records:[{owner,slot:'prediction',revision:2,value:null}]});
});

test('revision exhaustion fails without writing an unreadable successor',async()=>{
 const context=await setup(),value={initial:'""',value:'"0"',basis:'v0'};
 const path=join(context.directory,'learning-drafts.json');
 const bytes=JSON.stringify({schemaVersion:2,epoch,records:[{owner,slot:'prediction',revision:Number.MAX_SAFE_INTEGER,value}]});
 await writeFile(path,bytes);
 await expect(context.store.save(owner,'prediction',epoch,Number.MAX_SAFE_INTEGER,null)).rejects.toThrow(/revision/i);
 expect(await readFile(path,'utf8')).toBe(bytes);
});

test('JSON accepts bounded escaped raw text and rejects executable, prototype and oversized values',async()=>{
 const {store}=await setup(),raw='\\'.repeat(LEARNING_DRAFT_LIMITS.stringLength);
 const value={initial:'""',value:serializeLearningDraftJson(raw),basis:'v0'};
 expect(await store.save(owner,'raw-text',epoch,0,value)).toMatchObject({kind:'saved',epoch,record:{value}});
 expect(parseLearningDraftJson(value.value)).toBe(raw);
 for(const bad of [()=>0,new Date(),{constructor:'unsafe'},JSON.parse('{"__proto__":{"polluted":true}}'),[undefined],Number.NaN,'x'.repeat(LEARNING_DRAFT_LIMITS.stringLength+1)])expect(()=>serializeLearningDraftJson(bad)).toThrow();
 let nested:unknown='leaf';for(let i=0;i<LEARNING_DRAFT_LIMITS.depth+1;i++)nested=[nested];
 expect(()=>serializeLearningDraftJson(nested)).toThrow();
 expect(()=>serializeLearningDraftJson(Array(LEARNING_DRAFT_LIMITS.arrayItems+1).fill(0))).toThrow();
 const array:unknown[]=[0];Object.setPrototypeOf(array,{...Array.prototype});
 expect(()=>serializeLearningDraftJson(array)).toThrow();
 let arrayAccessorInvoked=false;const accessorArray=[0];Object.defineProperty(accessorArray,'0',{enumerable:true,get:()=>{arrayAccessorInvoked=true;return 0;}});
 expect(()=>serializeLearningDraftJson(accessorArray)).toThrow();expect(arrayAccessorInvoked).toBe(false);
 expect(()=>parseLearningDraftJson('{"b":0,"a":1}')).toThrow(/canonical/);
});

test('only exact historical owners can save while obsolete drafts stay available for recovery',async()=>{
 const context=await setup(),value={initial:'""',value:'"0"',basis:'v0'};
 for(const changed of [{taskId:'foreign-task'},{artifactId:'foreign-artifact'},{artifactRevision:2},{artifactDigest:'foreign-digest'},{moduleId:'foreign-module'},{moduleVersion:2}])await expect(context.store.save({...owner,...changed},'prediction',epoch,0,value)).rejects.toThrow(/no longer available/);
 await context.store.save(owner,'prediction',epoch,0,value);
 const task=context.getTask();if(!task)throw Error('Fixture task is missing.');
 const first=task.artifacts[0].revisions[0];
 task.artifacts[0].revisions.push({...first,revision:2,digest:'new-revision',content:JSON.stringify({schemaVersion:1,markdown:'Plan answer.',modules:[{id:'join',version:1,provenance:[],data:{kind:'plan',schemaVersion:1,title:'Read',purpose:'Study',items:[{id:'read',title:'Read',detail:''}]}}]})});
 expect(await context.store.read()).toMatchObject({kind:'available',epoch,records:[{owner}]});
 await expect(context.store.save({...owner,artifactRevision:2,artifactDigest:'new-revision'},'prediction',epoch,0,value)).rejects.toThrow(/no longer available/);
 first.content=JSON.stringify({schemaVersion:1,markdown:'Changed saved module identity.',modules:[{id:'join',version:2,data:exampleLesson,provenance:[]}]});
 expect(await context.store.read()).toMatchObject({kind:'available',epoch,records:[{owner,value}]});
 await expect(context.store.save(owner,'prediction',epoch,1,value)).rejects.toThrow(/no longer available/);
 expect(await context.store.save(owner,'prediction',epoch,0,null)).toMatchObject({kind:'conflict',epoch,current:{revision:1,value}});
 expect(await context.store.save(owner,'prediction',epoch,1,null)).toMatchObject({kind:'saved',epoch,record:{revision:2,value:null}});
 context.setTask(undefined);expect(await context.store.read()).toEqual({kind:'available',epoch,records:[],cleanup:'needed'});
});

test('removed artifact recovery can discard only an existing exact record for a surviving task',async()=>{
 const context=await setup(),value={initial:'""',value:'" 0 "',basis:'v0'};
 await context.store.save(owner,'prediction',epoch,0,value);
 const task=context.getTask();if(!task)throw Error('Fixture task is missing.');task.artifacts=[];
 expect(await context.store.read()).toMatchObject({kind:'available',epoch,records:[{owner,value}]});
 await expect(context.store.save(owner,'prediction',epoch,1,value)).rejects.toThrow(/no longer available/);
 for(const changed of [{artifactId:'foreign-artifact'},{moduleId:'foreign-module'},{taskId:'foreign-task'}])await expect(context.store.save({...owner,...changed},'prediction',epoch,0,null)).rejects.toThrow(/no longer available/);
 await expect(context.store.save(owner,'nonexistent',epoch,0,null)).rejects.toThrow(/no longer available/);
 expect(await context.store.save(owner,'prediction',epoch,1,null)).toMatchObject({kind:'saved',epoch,record:{owner,revision:2,value:null}});
 const mismatched=new LearningDraftStore({directory:context.directory,lookupTask:async()=>({...task,id:'foreign-task'})});
 expect(await mismatched.read()).toMatchObject({kind:'unavailable'});
 await expect(mismatched.save(owner,'prediction',epoch,2,null)).rejects.toThrow(/no longer available/);
});

test('an atomic replacement failure preserves the previous draft and cleans temporary bytes',async()=>{
 const context=await setup(),value={initial:'""',value:'"0"',basis:'v0'},path=join(context.directory,'learning-drafts.json');
 await context.store.save(owner,'prediction',epoch,0,value);const before=await readFile(path,'utf8');
 diskFailure.rename=true;
 try{await expect(context.store.save(owner,'prediction',epoch,1,{...value,value:'"new"'})).rejects.toThrow(/replacement failure/);}finally{diskFailure.rename=false;}
 expect(await readFile(path,'utf8')).toBe(before);
 expect(await readdir(context.directory)).toEqual(['learning-drafts.json']);
 expect(await new LearningDraftStore({directory:context.directory,lookupTask:context.lookupTask}).read()).toMatchObject({kind:'available',epoch,records:[{revision:1,value}]});
 expect(await context.store.save(owner,'prediction',epoch,1,null)).toMatchObject({kind:'saved',epoch,record:{revision:2,value:null}});
});

test('the public parsers reject unsafe or excess fields without invoking accessors',()=>{
 expect(parseLearningDraftEpoch(epoch)).toBe(epoch);
 expect(parseLearningDraftEpoch('12345678-1234-4234-8234-123456789abc')).toBe('12345678-1234-4234-8234-123456789abc');
 for(const invalid of ['',null,1,'initial\0','not-an-epoch','12345678-1234-4234-8234-123456789ABC'])expect(()=>parseLearningDraftEpoch(invalid)).toThrow();
 expect(()=>parseLearningDraftOwner({...owner,taskId:'bad\0id'})).toThrow();
 expect(()=>parseLearningDraftOwner({...owner,sourceRefs:[]})).toThrow();
 expect(()=>parseLearningDraftOwner(Object.assign(Object.create({foreign:true}),owner))).toThrow();
 expect(()=>parseLearningDraftSlot('x'.repeat(513))).toThrow();
 expect(()=>parseLearningDraftSlot('bad\0slot')).toThrow();
 expect(()=>parseLearningDraftValue({initial:'""',value:'"x"',basis:'x'.repeat(LEARNING_DRAFT_LIMITS.basisLength+1)})).toThrow();
 let invoked=false;const file={schemaVersion:1,get records(){invoked=true;return [];}};
 expect(()=>parseLearningDraftFile(file)).toThrow();expect(invoked).toBe(false);
});

test('malformed, unknown, duplicate and oversized sidecars are preserved and reject writes',async()=>{
 const context=await setup(),path=join(context.directory,'learning-drafts.json'),value={initial:'""',value:'"0"',basis:'v0'};
 const record={owner,slot:'prediction',revision:1,value};
 const cases=['{broken',JSON.stringify({schemaVersion:1,records:[record]}),JSON.stringify({schemaVersion:3,epoch,records:[]}),JSON.stringify({schemaVersion:2,epoch:'invalid',records:[]}),JSON.stringify({schemaVersion:2,epoch,records:[],sourceAuthority:'invented'}),JSON.stringify({schemaVersion:2,epoch,records:[record,record]}),JSON.stringify({schemaVersion:2,epoch,records:[{...record,value:{...value,value:'{"__proto__":0}'}}]}),' '.repeat(LEARNING_DRAFT_LIMITS.fileBytes+1)];
 for(const bytes of cases){
  await writeFile(path,bytes);
  expect(await context.store.read()).toMatchObject({kind:'unavailable'});
  await expect(context.store.save(owner,'prediction',epoch,0,value)).rejects.toThrow(/preserved/);
  await expect(context.store.purgeTask(owner.taskId)).rejects.toThrow(/preserved/);
  expect(await readFile(path,'utf8')).toBe(bytes);
 }
});

test('explicit corrupt and unsupported store recovery backs up exact bytes before resetting to a fresh epoch',async()=>{
 const context=await setup(),path=join(context.directory,'learning-drafts.json'),before=structuredClone(context.getTask());
 const cases=[Buffer.from('{broken'),Buffer.from(JSON.stringify({schemaVersion:99,records:[{raw:' 0 '}]})),Buffer.from([0xff,0x00,0xfe])];
 const backups:string[]=[];
 for(const bytes of cases){
  await writeFile(path,bytes);
  const result=await context.store.read();if(result.kind!=='unavailable')throw Error('Expected unreadable fixture.');
  const token=createHash('sha256').update(bytes).digest('hex');
  expect(result).toEqual({kind:'unavailable',message:expect.stringMatching(/preserved/),recoveryToken:token});
  expect(await readFile(path)).toEqual(bytes);
  const recovered=await context.store.recover(token);
  expect(recovered.kind).toBe('recovered');expect(recovered.epoch).not.toBe(epoch);parseLearningDraftEpoch(recovered.epoch);
  expect(recovered.backupBasename).toMatch(/^learning-drafts-recovery-[0-9a-f-]{36}\.json$/);backups.push(recovered.backupBasename);
  expect(await readFile(join(context.directory,recovered.backupBasename))).toEqual(bytes);
  expect((await stat(join(context.directory,recovered.backupBasename))).mode&0o777).toBe(0o600);
  expect(await context.store.read()).toEqual({kind:'available',epoch:recovered.epoch,records:[]});
  expect(await context.store.save(owner,'prediction',epoch,0,{initial:'""',value:'"late"',basis:'v0'})).toEqual({kind:'stale-epoch',epoch:recovered.epoch});
  await expect(context.store.recover(token)).rejects.toThrow(/changed|readable/i);
 }
 expect(new Set(backups).size).toBe(cases.length);
 for(let index=0;index<backups.length;index++)expect(await readFile(join(context.directory,backups[index]))).toEqual(cases[index]);
 expect(context.getTask()).toEqual(before);
});

test('recovery rejects stale tokens and currently valid bytes without making a backup',async()=>{
 const context=await setup(),path=join(context.directory,'learning-drafts.json');
 await writeFile(path,'{old');const result=await context.store.read();if(result.kind!=='unavailable'||!result.recoveryToken)throw Error('Missing recovery token.');
 await writeFile(path,'{new');await expect(context.store.recover(result.recoveryToken)).rejects.toThrow(/changed/);
 expect(await readFile(path,'utf8')).toBe('{new');expect(await readdir(context.directory)).toEqual(['learning-drafts.json']);
 const valid=JSON.stringify({schemaVersion:2,epoch,records:[]});await writeFile(path,valid);
 await expect(context.store.recover(createHash('sha256').update(valid).digest('hex'))).rejects.toThrow(/changed|readable/i);
 expect(await readFile(path,'utf8')).toBe(valid);expect(await readdir(context.directory)).toEqual(['learning-drafts.json']);
 for(const invalid of ['',null,1,'A'.repeat(64),'a'.repeat(63),'../'+'a'.repeat(64)])expect(()=>parseLearningDraftRecoveryToken(invalid)).toThrow();
 expect(parseLearningDraftRecoveryToken('a'.repeat(64))).toBe('a'.repeat(64));
 expect(()=>context.store.recover('../'+'a'.repeat(64))).toThrow();
});

test('oversized reads offer a stat token without reading content and non-files offer no reset',async()=>{
 const context=await setup(),path=join(context.directory,'learning-drafts.json');
 await writeFile(path,'x'.repeat(LEARNING_DRAFT_LIMITS.fileBytes+1));
 diskFailure.activeRead=true;
 try{expect(await context.store.read()).toEqual({kind:'unavailable',message:expect.any(String),recoveryToken:expect.stringMatching(/^[0-9a-f]{64}$/)});}finally{diskFailure.activeRead=false;}
 await expect(context.store.recover('a'.repeat(64))).rejects.toThrow();
 expect((await readdir(context.directory))).toEqual(['learning-drafts.json']);
 await rm(path);await mkdir(path);
 expect(await context.store.read()).toEqual({kind:'unavailable',message:expect.any(String)});
 await expect(context.store.recover('a'.repeat(64))).rejects.toThrow();
 expect((await readdir(context.directory))).toEqual(['learning-drafts.json']);
});

test('explicit oversized recovery streams every byte into a private backup before a fresh-epoch reset',async()=>{
 const context=await setup(),path=join(context.directory,'learning-drafts.json');
 const bytes=Buffer.from(JSON.stringify({raw:'z'.repeat(LEARNING_DRAFT_LIMITS.fileBytes+113_777),tail:' 0 \n'}));await writeFile(path,bytes);
 const result=await context.store.read();if(result.kind!=='unavailable'||!result.recoveryToken)throw Error('Missing oversized recovery token.');
 expect(result.recoveryToken).not.toBe(createHash('sha256').update(bytes).digest('hex'));
 expect(await context.store.read()).toEqual(result);
 const recovered=await context.store.recover(result.recoveryToken),backup=await readFile(join(context.directory,recovered.backupBasename));
 expect(backup.length).toBe(bytes.length);expect(createHash('sha256').update(backup).digest('hex')).toBe(createHash('sha256').update(bytes).digest('hex'));
 expect((await stat(join(context.directory,recovered.backupBasename))).mode&0o777).toBe(0o600);
 expect(await context.store.read()).toEqual({kind:'available',epoch:recovered.epoch,records:[]});
 expect(recovered.epoch).not.toBe(epoch);
});

test('oversized recovery rejects changed metadata and replaced inode without creating a backup',async()=>{
 const context=await setup(),path=join(context.directory,'learning-drafts.json'),bytes='x'.repeat(LEARNING_DRAFT_LIMITS.fileBytes+1);await writeFile(path,bytes);
 const first=await context.store.read();if(first.kind!=='unavailable'||!first.recoveryToken)throw Error('Missing oversized token.');
 await utimes(path,new Date('2030-01-01'),new Date('2030-01-01'));
 await expect(context.store.recover(first.recoveryToken)).rejects.toThrow(/changed/);expect(await readdir(context.directory)).toEqual(['learning-drafts.json']);
 const second=await context.store.read();if(second.kind!=='unavailable'||!second.recoveryToken)throw Error('Missing updated token.');expect(second.recoveryToken).not.toBe(first.recoveryToken);
 const replacement=join(context.directory,'replacement');await writeFile(replacement,bytes);await rename(replacement,path);
 await expect(context.store.recover(second.recoveryToken)).rejects.toThrow(/changed/);expect(await readdir(context.directory)).toEqual(['learning-drafts.json']);
 expect(await readFile(path,'utf8')).toBe(bytes);
});

test('oversized streamed write failure retains the original and only an incomplete failed backup',async()=>{
 const context=await setup(),path=join(context.directory,'learning-drafts.json'),bytes=Buffer.alloc(LEARNING_DRAFT_LIMITS.fileBytes+100_000,0x5a);await writeFile(path,bytes);
 const result=await context.store.read();if(result.kind!=='unavailable'||!result.recoveryToken)throw Error('Missing oversized token.');
 diskFailure.streamWriteAfter=2;
 try{await expect(context.store.recover(result.recoveryToken)).rejects.toThrow(/streamed backup failure/);}finally{diskFailure.streamWriteAfter=0;}
 expect(await readFile(path)).toEqual(bytes);
 const files=await readdir(context.directory),backup=files.find(name=>name.startsWith('learning-drafts-recovery-'));if(!backup)throw Error('Missing failed backup artifact.');
 expect((await stat(join(context.directory,backup))).size).toBe(64*1024);
 expect(await readFile(join(context.directory,backup))).toEqual(bytes.subarray(0,64*1024));expect(files).toHaveLength(2);
 expect(await context.store.read()).toEqual(result);
});

test('oversized recovery rejects metadata changes during the streamed copy',async()=>{
 const context=await setup(),path=join(context.directory,'learning-drafts.json'),bytes=Buffer.alloc(LEARNING_DRAFT_LIMITS.fileBytes+100_000,0x5a);await writeFile(path,bytes);
 const result=await context.store.read();if(result.kind!=='unavailable'||!result.recoveryToken)throw Error('Missing oversized token.');
 diskFailure.streamChange=true;
 try{await expect(context.store.recover(result.recoveryToken)).rejects.toThrow(/changed/);}finally{diskFailure.streamChange=false;}
 expect(await readFile(path)).toEqual(bytes);expect((await readdir(context.directory)).some(name=>name.startsWith('.learning-drafts-'))).toBe(false);
 const current=await context.store.read();expect(current).toMatchObject({kind:'unavailable',recoveryToken:expect.any(String)});
 if(current.kind!=='unavailable')throw Error('Expected preserved oversized original.');expect(current.recoveryToken).not.toBe(result.recoveryToken);
});

test('read failures and symlink targets offer no recovery token and preserve external bytes',async()=>{
 const context=await setup(),path=join(context.directory,'learning-drafts.json'),bytes='{broken';await writeFile(path,bytes);
 const token=createHash('sha256').update(bytes).digest('hex');diskFailure.activeRead=true;
 try{
  expect(await context.store.read()).toEqual({kind:'unavailable',message:expect.any(String)});
  await expect(context.store.recover(token)).rejects.toThrow(/read failure/);
 }finally{diskFailure.activeRead=false;}
 expect(await readFile(path,'utf8')).toBe(bytes);expect(await readdir(context.directory)).toEqual(['learning-drafts.json']);
 const target=join(context.directory,'external.json');await rm(path);await writeFile(target,bytes);await symlink(target,path);
 expect(await context.store.read()).toEqual({kind:'unavailable',message:expect.any(String)});
 await expect(context.store.recover(token)).rejects.toThrow();expect(await readFile(target,'utf8')).toBe(bytes);
 expect((await readdir(context.directory)).sort()).toEqual(['external.json','learning-drafts.json']);
});

test('failed recovery backup creation or exclusive-name collision leaves original bytes intact',async()=>{
 const context=await setup(),path=join(context.directory,'learning-drafts.json'),bytes='{broken';
 await writeFile(path,bytes);const result=await context.store.read();if(result.kind!=='unavailable'||!result.recoveryToken)throw Error('Missing recovery token.');
 diskFailure.backupOpen=true;
 try{await expect(context.store.recover(result.recoveryToken)).rejects.toThrow(/backup creation/);}finally{diskFailure.backupOpen=false;}
 expect(await readFile(path,'utf8')).toBe(bytes);expect(await readdir(context.directory)).toEqual(['learning-drafts.json']);
 diskFailure.backupWrite=true;
 try{await expect(context.store.recover(result.recoveryToken)).rejects.toThrow(/backup write/);}finally{diskFailure.backupWrite=false;}
 expect(await readFile(path,'utf8')).toBe(bytes);
 diskFailure.backupCollision=true;
 try{await expect(context.store.recover(result.recoveryToken)).rejects.toMatchObject({code:'EEXIST'});}finally{diskFailure.backupCollision=false;}
 expect(await readFile(path,'utf8')).toBe(bytes);
 const backups=(await readdir(context.directory)).filter(name=>name.startsWith('learning-drafts-recovery-'));
 expect(backups).toHaveLength(2);expect(await Promise.all(backups.map(name=>readFile(join(context.directory,name),'utf8')))).toContain('protected existing backup');
});

test('failed active replacement retains both the unreadable original and its exact backup for retry',async()=>{
 const context=await setup(),path=join(context.directory,'learning-drafts.json'),bytes=Buffer.from('{broken');
 await writeFile(path,bytes);const result=await context.store.read();if(result.kind!=='unavailable'||!result.recoveryToken)throw Error('Missing recovery token.');
 diskFailure.rename=true;
 try{await expect(context.store.recover(result.recoveryToken)).rejects.toThrow(/replacement failure/);}finally{diskFailure.rename=false;}
 expect(await readFile(path)).toEqual(bytes);
 const firstBackup=(await readdir(context.directory)).find(name=>name.startsWith('learning-drafts-recovery-'));if(!firstBackup)throw Error('Missing exact backup.');
 expect(await readFile(join(context.directory,firstBackup))).toEqual(bytes);
 const recovered=await context.store.recover(result.recoveryToken);
 expect(recovered.backupBasename).not.toBe(firstBackup);expect(await readFile(join(context.directory,firstBackup))).toEqual(bytes);
 expect(await context.store.read()).toEqual({kind:'available',epoch:recovered.epoch,records:[]});
});

test('recovery rechecks active bytes after backing up and preserves a subsequently changed file',async()=>{
 const context=await setup(),path=join(context.directory,'learning-drafts.json'),bytes='{original';await writeFile(path,bytes);
 const result=await context.store.read();if(result.kind!=='unavailable'||!result.recoveryToken)throw Error('Missing recovery token.');
 diskFailure.backupChange='{new bytes';
 try{await expect(context.store.recover(result.recoveryToken)).rejects.toThrow(/changed/);}finally{diskFailure.backupChange=null;}
 expect(await readFile(path,'utf8')).toBe('{new bytes');
 const files=await readdir(context.directory),backup=files.find(name=>name.startsWith('learning-drafts-recovery-'));
 if(!backup)throw Error('Missing preserved backup.');expect(await readFile(join(context.directory,backup),'utf8')).toBe(bytes);
 expect(files).toHaveLength(2);
});

test('deleting a task during a pending save prevents it from recreating purged drafts',async()=>{
 const context=await setup();let task=context.getTask(),release:()=>void=()=>{},entered:()=>void=()=>{};
 const held=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{entered=resolve;});let calls=0;
 const store=new LearningDraftStore({directory:context.directory,lookupTask:async()=>{const captured=task;if(++calls===1){entered();await held;}return captured;}});
 const pending=store.save(owner,'prediction',epoch,0,{initial:'""',value:'"0"',basis:'v0'});
 const rejected=expect(pending).rejects.toThrow(/no longer available/);
 await ready;task=undefined;const purge=store.purgeTask(owner.taskId);release();await rejected;await purge;
 expect(await store.read()).toEqual({kind:'available',epoch,records:[]});
 await expect(readFile(join(context.directory,'learning-drafts.json'))).rejects.toMatchObject({code:'ENOENT'});
 await expect(store.save(owner,'prediction',epoch,0,{initial:'""',value:'"late"',basis:'v0'})).rejects.toThrow(/no longer available/);
});

test('workflow and grounded join drafts retain their exact installed answer identity',async()=>{
 const context=await setup(),task=context.getTask();if(!task)throw Error('Fixture task is missing.');
 const revision=task.artifacts[0].revisions[0];
 revision.content=JSON.stringify({schemaVersion:1,markdown:'Installed learning modules.',modules:[{id:'workflow',version:3,data:workflowExample,provenance:[]},{id:'grounded',version:2,data:localGroundedJoin(exampleLesson),provenance:[]}]});
 const workflowOwner={...owner,moduleId:'workflow',moduleVersion:3},groundedOwner={...owner,moduleId:'grounded',moduleVersion:2};
 await context.store.save(workflowOwner,'rule-destination',epoch,0,{initial:'"draft"',value:'"review"',basis:'workflow-rule-a'});
 await context.store.save(groundedOwner,'cell-correction',epoch,0,{initial:'""',value:'" 0 "',basis:'left:row-a:key'});
 const result=await new LearningDraftStore({directory:context.directory,lookupTask:context.lookupTask}).read();
 expect(result).toMatchObject({kind:'available',epoch,records:[{owner:workflowOwner,value:{value:'"review"'}},{owner:groundedOwner,value:{value:'" 0 "'}}]});
});

test('entry and aggregate byte bounds refuse additions while preserving existing drafts',async()=>{
 const context=await setup(),path=join(context.directory,'learning-drafts.json'),value={initial:'""',value:'"0"',basis:'v0'};
 const records=Array.from({length:LEARNING_DRAFT_LIMITS.entries},(_,index)=>({owner,slot:'slot-'+index,revision:1,value}));
 await writeFile(path,JSON.stringify({schemaVersion:2,epoch,records}));const full=await readFile(path,'utf8');
 await expect(context.store.save(owner,'one-too-many',epoch,0,value)).rejects.toThrow(/storage is full/);
 expect(await readFile(path,'utf8')).toBe(full);
 expect(await context.store.save(owner,'slot-0',epoch,1,null)).toMatchObject({kind:'saved',epoch,record:{revision:2,value:null}});
 const large=serializeLearningDraftJson('\0'.repeat(20_000)),largeValue={initial:large,value:large,basis:'v0'};
 const largeRecords=Array.from({length:29},(_,index)=>({owner,slot:'large-'+index,revision:1,value:largeValue}));
 await writeFile(path,JSON.stringify({schemaVersion:2,epoch,records:largeRecords}));const before=await readFile(path,'utf8');
 expect(Buffer.byteLength(before)).toBeLessThan(LEARNING_DRAFT_LIMITS.fileBytes);
 await expect(context.store.save(owner,'one-too-large',epoch,0,largeValue)).rejects.toThrow(/storage is full/);
 expect(await readFile(path,'utf8')).toBe(before);
});

test('bounded tombstone compaction rotates the epoch and requires explicit retry after reopen',async()=>{
 const context=await setup(),path=join(context.directory,'learning-drafts.json'),value={initial:'""',value:'" 0 "',basis:'v0'};
 const live={owner,slot:'live',revision:7,value};
 const records=[live,...Array.from({length:LEARNING_DRAFT_LIMITS.entries-1},(_,index)=>({owner,slot:'discarded-'+index,revision:2,value:null}))];
 await writeFile(path,JSON.stringify({schemaVersion:2,epoch,records}));
 const compacted=await context.store.save(owner,'next',epoch,0,value);
 expect(compacted).toMatchObject({kind:'stale-epoch'});expect(compacted.epoch).not.toBe(epoch);
 const nextEpoch=parseLearningDraftEpoch(compacted.epoch),before=await readFile(path,'utf8');
 expect(JSON.parse(before)).toEqual({schemaVersion:2,epoch:nextEpoch,records:[live]});
 const reopened=new LearningDraftStore({directory:context.directory,lookupTask:context.lookupTask});
 expect(await reopened.read()).toEqual({kind:'available',epoch:nextEpoch,records:[live]});
 expect(await reopened.save(owner,'discarded-0',epoch,0,value)).toEqual({kind:'stale-epoch',epoch:nextEpoch});
 expect(await reopened.save(owner,'next',epoch,0,value)).toEqual({kind:'stale-epoch',epoch:nextEpoch});
 expect(await readFile(path,'utf8')).toBe(before);
 expect(await reopened.save(owner,'next',nextEpoch,0,value)).toMatchObject({kind:'saved',epoch:nextEpoch,record:{slot:'next',revision:1,value}});
 expect(await reopened.save(owner,'live',nextEpoch,6,value)).toMatchObject({kind:'conflict',epoch:nextEpoch,current:live});
});

test('compaction failure preserves tombstones and their epoch without applying the triggering draft',async()=>{
 const context=await setup(),path=join(context.directory,'learning-drafts.json'),value={initial:'""',value:'"0"',basis:'v0'};
 const records=Array.from({length:LEARNING_DRAFT_LIMITS.entries},(_,index)=>({owner,slot:'discarded-'+index,revision:2,value:null}));
 const before=JSON.stringify({schemaVersion:2,epoch,records});await writeFile(path,before);
 diskFailure.rename=true;
 try{await expect(context.store.save(owner,'next',epoch,0,value)).rejects.toThrow(/replacement failure/);}finally{diskFailure.rename=false;}
 expect(await readFile(path,'utf8')).toBe(before);expect(await readdir(context.directory)).toEqual(['learning-drafts.json']);
 const result=await context.store.save(owner,'next',epoch,0,value);
 expect(result).toMatchObject({kind:'stale-epoch'});
 expect(await context.store.read()).toEqual({kind:'available',epoch:result.epoch,records:[]});
});

test('aggregate byte compaction retains every live value and reports exhaustion after explicit retry',async()=>{
 const context=await setup(),path=join(context.directory,'learning-drafts.json');
 const raw=serializeLearningDraftJson('\0'.repeat(20_000)),value={initial:raw,value:raw,basis:'v0'};
 const live=Array.from({length:29},(_,index)=>({owner,slot:'large-'+index,revision:1,value}));
 await writeFile(path,JSON.stringify({schemaVersion:2,epoch,records:[...live,{owner,slot:'discarded',revision:2,value:null}]}));
 const result=await context.store.save(owner,'next-large',epoch,0,value);
 expect(result).toMatchObject({kind:'stale-epoch'});
 const nextEpoch=result.epoch,before=await readFile(path,'utf8');
 expect(JSON.parse(before)).toEqual({schemaVersion:2,epoch:nextEpoch,records:live});
 await expect(context.store.save(owner,'next-large',nextEpoch,0,value)).rejects.toThrow(/storage is full/);
 expect(await readFile(path,'utf8')).toBe(before);
});

test('task lookup failures return an unavailable read result without discarding bytes',async()=>{
 const context=await setup();await context.store.save(owner,'prediction',epoch,0,{initial:'""',value:'"0"',basis:'v0'});
 const bytes=await readFile(join(context.directory,'learning-drafts.json'),'utf8');
 const store=new LearningDraftStore({directory:context.directory,lookupTask:async()=>{throw Error('Synthetic task lookup failure.');}});
 expect(await store.read()).toMatchObject({kind:'unavailable'});
 expect(await readFile(join(context.directory,'learning-drafts.json'),'utf8')).toBe(bytes);
});

test('a failed task purge preserves saved drafts and never changes task data',async()=>{
 const context=await setup(),path=join(context.directory,'learning-drafts.json'),value={initial:'""',value:'"0"',basis:'v0'};
 await context.store.save(owner,'prediction',epoch,0,value);
 const before=await readFile(path,'utf8'),taskBefore=structuredClone(context.getTask());
 diskFailure.rename=true;
 try{await expect(context.store.purgeTask(owner.taskId)).rejects.toThrow(/replacement failure/);}finally{diskFailure.rename=false;}
 expect(await readFile(path,'utf8')).toBe(before);expect(context.getTask()).toEqual(taskBefore);
 expect(await readdir(context.directory)).toEqual(['learning-drafts.json']);
});

test('explicit cleanup removes absent-task bytes after a failed purge and rejects stale epoch writes',async()=>{
 const context=await setup(),tasks=new Map<string,Task>([['task-a',fixture()],['task-b',{...fixture(),id:'task-b'}]]);
 const store=new LearningDraftStore({directory:context.directory,lookupTask:async id=>tasks.get(id)}),value={initial:'""',value:'" 0 "',basis:'v0'},otherOwner={...owner,taskId:'task-b'};
 await store.save(owner,'prediction',epoch,0,value);await store.save(otherOwner,'prediction',epoch,0,value);
 const path=join(context.directory,'learning-drafts.json'),before=await readFile(path,'utf8');tasks.delete('task-a');
 diskFailure.rename=true;
 try{await expect(store.purgeTask('task-a')).rejects.toThrow(/replacement failure/);}finally{diskFailure.rename=false;}
 expect(await readFile(path,'utf8')).toBe(before);
 expect(await store.read()).toEqual({kind:'available',epoch,records:[{owner:otherOwner,slot:'prediction',revision:1,value}],cleanup:'needed'});
 const cleaned=await store.cleanup();expect(cleaned).toEqual({kind:'cleaned',epoch:expect.any(String),removed:1});expect(cleaned.epoch).not.toBe(epoch);
 expect(await store.read()).toEqual({kind:'available',epoch:cleaned.epoch,records:[{owner:otherOwner,slot:'prediction',revision:1,value}]});
 expect(JSON.parse(await readFile(path,'utf8')).records).toEqual([{owner:otherOwner,slot:'prediction',revision:1,value}]);
 expect(await store.save(otherOwner,'next',epoch,0,value)).toEqual({kind:'stale-epoch',epoch:cleaned.epoch});
 expect(await store.cleanup()).toEqual({kind:'cleaned',epoch:cleaned.epoch,removed:0});
});

test('cleanup preserves malformed files and all bytes on lookup or replacement failure',async()=>{
 const context=await setup(),path=join(context.directory,'learning-drafts.json'),value={initial:'""',value:'"0"',basis:'v0'};
 await writeFile(path,'{broken');await expect(context.store.cleanup()).rejects.toThrow(/preserved/);expect(await readFile(path,'utf8')).toBe('{broken');
 await rm(path);await context.store.save(owner,'prediction',epoch,0,value);const before=await readFile(path,'utf8');
 for(const lookupTask of [async()=>{throw Error('Transient task lookup failure.');},async()=>({...fixture(),id:'another-task'})]){
  const store=new LearningDraftStore({directory:context.directory,lookupTask});
  expect(await store.read()).toEqual({kind:'unavailable',message:expect.any(String)});
  await expect(store.cleanup()).rejects.toThrow();expect(await readFile(path,'utf8')).toBe(before);
 }
 context.setTask(undefined);diskFailure.rename=true;
 try{await expect(context.store.cleanup()).rejects.toThrow(/replacement failure/);}finally{diskFailure.rename=false;}
 expect(await readFile(path,'utf8')).toBe(before);expect(await context.store.read()).toMatchObject({kind:'available',cleanup:'needed'});
 expect(await context.store.cleanup()).toMatchObject({kind:'cleaned',removed:1});
});

test('cleanup rechecks task absence before removing drafts and leaves valid obsolete modules alone',async()=>{
 const context=await setup(),path=join(context.directory,'learning-drafts.json'),value={initial:'""',value:'"0"',basis:'v0'};
 await context.store.save(owner,'prediction',epoch,0,value);const before=await readFile(path,'utf8');let calls=0;
 const restored=new LearningDraftStore({directory:context.directory,lookupTask:async()=>++calls===1?undefined:fixture()});
 await expect(restored.cleanup()).rejects.toThrow(/changed|available/i);expect(await readFile(path,'utf8')).toBe(before);
 const task=context.getTask();if(!task)throw Error('Missing fixture task.');task.artifacts=[];
 expect(await context.store.cleanup()).toEqual({kind:'cleaned',epoch,removed:0});
 expect(await readFile(path,'utf8')).toBe(before);
 expect(await context.store.read()).toMatchObject({kind:'available',records:[{owner,value}]});
});

test('purging a deleted task preserves another task drafts and prevents later stale writes',async()=>{
 const context=await setup(),tasks=new Map<string,Task>([['task-a',fixture()],['task-b',{...fixture(),id:'task-b'}]]);
 const store=new LearningDraftStore({directory:context.directory,lookupTask:async id=>tasks.get(id)}),value={initial:'""',value:'"0"',basis:'v0'};
 const otherOwner={...owner,taskId:'task-b'};
 await store.save(owner,'prediction',epoch,0,value);await store.save(otherOwner,'prediction',epoch,0,value);
 tasks.delete('task-a');await store.purgeTask('task-a');
 expect(await store.read()).toEqual({kind:'available',epoch,records:[{owner:otherOwner,slot:'prediction',revision:1,value}]});
 await expect(store.save(owner,'prediction',epoch,1,value)).rejects.toThrow(/no longer available/);
 expect(await new LearningDraftStore({directory:context.directory,lookupTask:async id=>tasks.get(id)}).read()).toEqual({kind:'available',epoch,records:[{owner:otherOwner,slot:'prediction',revision:1,value}]});
});
