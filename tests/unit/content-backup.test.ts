import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createCompanion,type Companion} from '../../src/core/companion';
import {ContentBackups,ContentBackupGate,readContentBackup,recoverContentRestore} from '../../src/host/content-backup';
import {contentOnlyState} from '../../src/core/content-backup-state';
import {LearningDraftStore} from '../../src/host/learning-drafts';
import {serializeLearningDraftJson} from '../../src/shared/learning-drafts';
import {localTaskDraftOwner,localTaskDraftBasis,emptyLocalTaskDraft,LOCAL_TASK_DRAFT_SLOT} from '../../src/shared/local-task-draft';
import {CONTENT_BACKUP_FILES,type ContentBackupExported,type ContentBackupReview,type ContentBackupRestored} from '../../src/shared/content-backup';
const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'glint-content-backup-')),version='0.4.10-test',exportPath=join(directory,'owned.glint-backup.json');let core:Companion=await createCompanion({dataDir:directory});
 cleanup.push(()=>rm(directory,{recursive:true,force:true}),()=>core.close());
 const task=await core.createTask({title:'Owned backup task',goal:'Preserve literal Ω and source versions'}),sentinel=await core.createTask({title:'Unrelated local sentinel'});
 await core.putSource(task.id,{kind:'text',label:'Owned source',content:'café, 李\nQuoted "text".',role:'fact'});
 const saved=await core.saveArtifact(task.id,{title:'Owned document',content:'First immutable content Ω.',mimeType:'text/plain'});
 await core.saveArtifact(task.id,{artifactId:saved.artifactId,expectedRevision:1,title:'Owned document',content:'Second immutable content 李.',mimeType:'text/plain'});
 await core.saveComposerDraft(task.id,0,{text:'Exact unsent message Ω\nwith a second line.',kind:'create'});
 const drafts=new LearningDraftStore({directory,lookupTask:id=>core.getTask(id).catch(()=>undefined)}),raw={title:'Unapplied title',content:'Exact raw input 李\nNot applied.',intentId:'',binding:''};
 await drafts.save(localTaskDraftOwner('text'),LOCAL_TASK_DRAFT_SLOT,'initial',0,{initial:serializeLearningDraftJson(emptyLocalTaskDraft,'local-task-form'),value:serializeLearningDraftJson(raw,'local-task-form'),basis:localTaskDraftBasis('text')});
 await writeFile(join(directory,'response-preferences.json'),JSON.stringify({schemaVersion:1,revision:2,enabled:false,text:'Exact disabled preference Ω.'}));
 await writeFile(join(directory,'connection.bin'),'SECRET EXCLUDED SENTINEL');await writeFile(join(directory,'capture-settings.json'),'CURRENT SECURITY EXCLUSIONS');
 let chooseSave:string|undefined=exportPath,chooseOpen:string|undefined=exportPath,restarted=false,interruptClose=false,restoreObserver:((phase:'prepared'|'transaction')=>Promise<void>)|undefined;
 const service=new ContentBackups({directory,appVersion:version,snapshot:()=>core.contentSnapshot(),maintain:operation=>operation(),chooseSave:async()=>chooseSave,chooseOpen:async()=>chooseOpen,restoreUnderOwnership:async transaction=>{await restoreObserver?.('prepared');return core.closeForContentRestore(async()=>{await restoreObserver?.('transaction');if(interruptClose)throw Error('Owned interrupted close');return transaction();});},restart:()=>{restarted=true;}});
 return {directory,exportPath,version,task,sentinel,saved,raw,service,drafts,get core(){return core;},get restarted(){return restarted;},setSave(value:string|undefined){chooseSave=value;},setOpen(value:string|undefined){chooseOpen=value;},interrupt(){interruptClose=true;},observeRestore(observer:(phase:'prepared'|'transaction')=>Promise<void>){restoreObserver=observer;},async reopen(){await core.close();core=await createCompanion({dataDir:directory,beforeReadState:()=>recoverContentRestore(directory)});}};
}
function deferred(){let resolve:()=>void=()=>{};const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
async function contentFingerprints(directory:string){const result:Record<string,string|null>={};for(const name of [...CONTENT_BACKUP_FILES,'content-restore-journal.json','store.lock']){try{result[name]=createHash('sha256').update(await readFile(join(directory,name))).digest('hex');}catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code==='ENOENT')result[name]=null;else throw error;}}return result;}
describe('Local content backup and reviewed restore',()=>{
 it('exports inspectable complete content with independently checked file and payload hashes, excluding credentials and security settings',async()=>{
  const f=await fixture(),result=await f.service.command({type:'content-backup.export'}) as ContentBackupExported,text=await readFile(f.exportPath,'utf8'),backup=readContentBackup(text,f.version),tasks=JSON.parse(backup.payload.files[0].content!);
  expect(result.kind).toBe('exported');expect(result.summary.counts).toMatchObject({tasks:2,sources:1,sourceVersions:1,artifacts:1,artifactVersions:2,unsentMessages:1,unfinishedForms:1});
  expect(tasks.tasks.find((item:{id:string})=>item.id===f.task.id).artifacts[0].revisions.map((item:{content:string})=>item.content)).toEqual(['First immutable content Ω.','Second immutable content 李.']);
  expect(tasks.tasks.find((item:{id:string})=>item.id===f.task.id).session.draft).toBe('Exact unsent message Ω\nwith a second line.');
  expect(text).not.toContain('SECRET EXCLUDED SENTINEL');expect(text).not.toContain('CURRENT SECURITY EXCLUSIONS');
  for(const file of backup.payload.files)if(file.content!==null){expect(file.byteLength).toBe(Buffer.byteLength(file.content));expect(file.sha256).toBe(createHash('sha256').update(file.content).digest('hex'));}
  expect(backup.checksum).toBe(createHash('sha256').update(JSON.stringify(backup.payload)).digest('hex'));
 });
 it('replaces only declared content after review, keeps the prior copy, restores exact versions/drafts/config and requires explicit restart',async()=>{
  const f=await fixture();await f.service.command({type:'content-backup.export'});
  await f.core.saveArtifact(f.task.id,{artifactId:f.saved.artifactId,expectedRevision:2,title:'Mutated document',content:'Later owned mutation',mimeType:'text/plain'});
  const extra=await f.core.createTask({title:'Owned post-backup task, retained in prior copy'});
  await writeFile(join(f.directory,'response-preferences.json'),JSON.stringify({schemaVersion:1,revision:3,enabled:false,text:'Later owned preference'}));
  const preview=await f.service.command({type:'content-backup.choose'}) as ContentBackupReview;
  expect(preview.incoming.counts.tasks).toBe(2);expect(preview.current.counts.tasks).toBe(3);
  const restored=await f.service.command({type:'content-backup.restore',reviewId:preview.reviewId,checksum:preview.incoming.checksum,currentChecksum:preview.current.contentChecksum,confirmed:'replace-reviewed-local-content-and-restart'}) as ContentBackupRestored;
  expect(restored.kind).toBe('restored');const prior=readContentBackup(await readFile(restored.priorCopyPath,'utf8'));expect(JSON.parse(prior.payload.files[0].content!).tasks.some((item:{id:string})=>item.id===extra.id)).toBe(true);
  expect(f.restarted).toBe(false);await f.service.command({type:'content-backup.restart'});expect(f.restarted).toBe(true);
  await f.reopen();const task=await f.core.getTask(f.task.id);expect(task.artifacts[0].revisions.map(item=>item.content)).toEqual(['First immutable content Ω.','Second immutable content 李.']);expect(task.session?.draft).toBe('Exact unsent message Ω\nwith a second line.');expect((await f.core.getTask(f.sentinel.id)).title).toBe('Unrelated local sentinel');expect(await f.core.listTasks()).toHaveLength(2);
  const draft=await f.drafts.read();if(draft.kind!=='available')throw Error('Expected restored drafts');expect(JSON.parse(draft.records[0].value!.value)).toEqual(f.raw);
  expect(JSON.parse(await readFile(join(f.directory,'response-preferences.json'),'utf8')).text).toBe('Exact disabled preference Ω.');expect(await readFile(join(f.directory,'connection.bin'),'utf8')).toBe('SECRET EXCLUDED SENTINEL');expect(await readFile(join(f.directory,'capture-settings.json'),'utf8')).toBe('CURRENT SECURITY EXCLUSIONS');
 });
 it('cancels chooser operations and rejects corrupt/foreign-format backups without replacing content',async()=>{
  const f=await fixture(),before=await readFile(join(f.directory,'tasks.json'),'utf8');f.setSave(undefined);expect(await f.service.command({type:'content-backup.export'})).toEqual({kind:'cancelled'});f.setOpen(undefined);expect(await f.service.command({type:'content-backup.choose'})).toEqual({kind:'cancelled'});
  f.setSave(f.exportPath);await f.service.command({type:'content-backup.export'});const text=await readFile(f.exportPath,'utf8');await writeFile(f.exportPath,text.replace('Owned backup task','CORRUPT BACKUP'));f.setOpen(f.exportPath);await expect(f.service.command({type:'content-backup.choose'})).rejects.toThrow('checksum');expect(await readFile(join(f.directory,'tasks.json'),'utf8')).toBe(before);
  const foreign=JSON.parse(text);foreign.formatVersion=9;await writeFile(f.exportPath,JSON.stringify(foreign));await expect(f.service.command({type:'content-backup.choose'})).rejects.toThrow('invalid or incompatible');expect(await readFile(join(f.directory,'tasks.json'),'utf8')).toBe(before);
 });
 it('refuses a stale replacement review and never overwrites an existing backup destination',async()=>{
  const f=await fixture();await f.service.command({type:'content-backup.export'});const exported=await readFile(f.exportPath,'utf8');await expect(f.service.command({type:'content-backup.export'})).rejects.toThrow();expect(await readFile(f.exportPath,'utf8')).toBe(exported);
  const review=await f.service.command({type:'content-backup.choose'}) as ContentBackupReview;await f.core.createTask({title:'New content after review'});await expect(f.service.command({type:'content-backup.restore',reviewId:review.reviewId,checksum:review.incoming.checksum,currentChecksum:review.current.contentChecksum,confirmed:'replace-reviewed-local-content-and-restart'})).rejects.toThrow('changed');expect(await f.core.listTasks()).toHaveLength(3);
 });
 it('recovers the complete prior content before opening stores after an interrupted prepare, retaining every recovery copy',async()=>{
  const f=await fixture();await f.service.command({type:'content-backup.export'});await f.core.createTask({title:'Prior-copy sentinel before interruption'});const review=await f.service.command({type:'content-backup.choose'}) as ContentBackupReview;f.interrupt();await expect(f.service.command({type:'content-backup.restore',reviewId:review.reviewId,checksum:review.incoming.checksum,currentChecksum:review.current.contentChecksum,confirmed:'replace-reviewed-local-content-and-restart'})).rejects.toThrow();
  await expect(readFile(join(f.directory,'store.lock'))).rejects.toMatchObject({code:'ENOENT'});await writeFile(join(f.directory,'tasks.json'),'Owned interrupted partial write');await writeFile(join(f.directory,'response-preferences.json'),'Owned interrupted partial config');await f.reopen();expect(await f.core.listTasks()).toHaveLength(3);expect(JSON.parse(await readFile(join(f.directory,'response-preferences.json'),'utf8')).text).toBe('Exact disabled preference Ω.');expect((await readdir(join(f.directory,'content-recovery'))).length).toBe(1);expect(await readdir(f.directory)).not.toContain('store.lock.recovery');
 });
 it.each(['prepared','transaction'] as const)('rejects a second owner before its recovery callback can mutate a live %s restore',async phase=>{
  const f=await fixture();await f.service.command({type:'content-backup.export'});await f.core.createTask({title:'Current content retained by the live owner'});const review=await f.service.command({type:'content-backup.choose'}) as ContentBackupReview,entered=deferred(),proceed=deferred();
  f.observeRestore(async observed=>{if(observed===phase){entered.resolve();await proceed.promise;}});
  const restoring=f.service.command({type:'content-backup.restore',reviewId:review.reviewId,checksum:review.incoming.checksum,currentChecksum:review.current.contentChecksum,confirmed:'replace-reviewed-local-content-and-restart'});await entered.promise;
  const before=await contentFingerprints(f.directory);let recoveryCalls=0;
  try{await expect(createCompanion({dataDir:f.directory,beforeReadState:async()=>{recoveryCalls++;await recoverContentRestore(f.directory);}})).rejects.toThrow('Another companion owns the task store.');expect(recoveryCalls).toBe(0);expect(await contentFingerprints(f.directory)).toEqual(before);expect(await readdir(f.directory)).not.toContain('store.lock.recovery');}
  finally{proceed.resolve();}
  expect((await restoring).kind).toBe('restored');await f.reopen();expect(await f.core.listTasks()).toHaveLength(2);
 });
 it('holds queued input, retires approvals, and disables schedules without changing source or artifact bodies',async()=>{
  const f=await fixture(),state=await f.core.contentSnapshot(),task=state.tasks.find(item=>item.id===f.task.id)!;task.actions.push({proposal:{id:'action',taskId:task.id,artifactId:f.saved.artifactId,revision:2,path:'/tmp/owned',parentRealPath:'/tmp',parentDevice:'1',parentInode:'1',artifactDigest:f.saved.revision.digest,sourceRefs:[],byteLength:1,digest:'digest',createdAt:'2026-10-31T00:00:00.000Z'},status:'approved',approvalId:'DO NOT EXPORT GRANT'});
  state.recurringWork=[{id:'local',revision:1,title:'Owned schedule',instruction:'Do not run during restore',intervalHours:24,nextDueAt:'2026-11-01T00:00:00.000Z',enabled:true,createdAt:'2026-10-31T00:00:00.000Z',updatedAt:'2026-10-31T00:00:00.000Z',history:[]}];
  const restored=contentOnlyState(state);expect(restored.tasks.find(item=>item.id===task.id)!.artifacts).toEqual(task.artifacts);expect(restored.tasks.find(item=>item.id===task.id)!.sources).toEqual(task.sources);expect(restored.tasks.find(item=>item.id===task.id)!.actions[0]).toMatchObject({status:'retired'});expect(restored.tasks.find(item=>item.id===task.id)!.actions[0].approvalId).toBeUndefined();expect(restored.recurringWork![0].enabled).toBe(false);expect(contentOnlyState(restored)).toEqual(restored);
 });
 it('fences concurrent writes, permits only the existing draft drain and stays frozen after restore seal',async()=>{
  const gate=new ContentBackupGate();let release:()=>void=()=>{},started:()=>void=()=>{};const ready=new Promise<void>(resolve=>{started=resolve;}),inFlight=gate.run('artifact.save',()=>new Promise<void>(resolve=>{release=resolve;started();}));await ready;let entered=false;const maintenance=gate.maintain(async()=>{entered=true;await gate.run('draft.save',async()=>{});await expect(gate.run('artifact.save',async()=>{})).rejects.toThrow('frozen');gate.seal();return 'complete';},{before:async()=>{},freeze:async()=>'owned-freeze',resume:()=>{throw Error('A sealed restore must not resume old drafts');}});expect(entered).toBe(false);release();await inFlight;expect(await maintenance).toBe('complete');expect(gate.busy).toBe(true);await expect(gate.run('learning-drafts.save',async()=>{})).rejects.toThrow('Restart Glint');await expect(gate.run('draft.save',async()=>{})).rejects.toThrow('Restart Glint');
 });
});
