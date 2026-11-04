import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../../src/core/companion';
import {LearningDraftStore} from '../../src/host/learning-drafts';
import {createLearningDrafts} from '../../src/renderer/src/learning-drafts';
import {createNewDocumentDraftController} from '../../src/renderer/src/new-document-draft-controller';
import {emptyNewDocumentDraft,newDocumentDraftBasis,parseNewDocumentDraft} from '../../src/shared/authored-document';
const cleanup:Array<()=>Promise<void>>=[];afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
function gate(){let enter!:()=>void,release!:()=>void;return {started:new Promise<void>(r=>enter=r),wait:new Promise<void>(r=>release=r),enter:()=>enter(),release:()=>release()};}
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'new-document-raw-'));let core=await createCompanion({dataDir:directory}),task=await core.createTask({title:'New document raw owner'}),scope='original',current=true,calls=0,opened=0,lose=false,failRaw=false,held:ReturnType<typeof gate>|undefined;
 const store=()=>new LearningDraftStore({directory,lookupTask:id=>core.getTask(id)}),makeCache=()=>{const storage=store();return createLearningDrafts({read:()=>storage.read(),save:(...args)=>{if(failRaw){failRaw=false;return Promise.reject(Error('Controlled raw failure'));}return storage.save(...args);}});};let cache=makeCache();await cache.load();
 const makeController=()=>createNewDocumentDraftController({cache,task:()=>task,isCurrent:()=>current,scope:()=>scope,notify:()=>{},onSaved:()=>{opened++;},send:async input=>{calls++;const original=scope;held?.enter();await held?.wait;const saved=await core.createAuthoredDocument(input,()=>{if(!current||scope!==original)throw Error('Retired owner');});task=saved.task;if(lose){lose=false;throw Error('Controlled lost save reply');}return saved;}});let controller=makeController();cleanup.push(async()=>{held?.release();await core.close();await rm(directory,{recursive:true,force:true});});
 return {get core(){return core},get cache(){return cache},get controller(){return controller},get task(){return task},get calls(){return calls},get opened(){return opened},lose(){lose=true;},failRaw(){failRaw=true;},hold(){held=gate();return held;},retarget(){scope='other';},freeze(){cache.setFrozen(true);},async reopen(){await cache.flush();await core.close();core=await createCompanion({dataDir:directory});task=await core.getTask(task.id);cache=makeCache();await cache.load();controller=makeController();}};
}
it('keeps exact unfinished new input including intentional blanks through cache/core recreation without creating an artifact',async()=>{
 const f=await fixture(),raw={title:'  My unsent Ω  ',content:'\n  Keep raw 👋.  \n',sourceRefs:[]};expect(f.controller.edit(raw).kind).toBe('accepted');await f.reopen();expect(f.controller.snapshot().fields).toEqual(raw);expect(f.task.artifacts).toEqual([]);expect(f.calls).toBe(0);
 f.controller.edit({title:'',content:''});await f.reopen();expect(f.controller.snapshot().raw).toMatchObject({present:true,title:'',content:''});expect(f.controller.snapshot().canSave).toBe(false);expect(await f.controller.save()).toBe(false);expect(f.calls).toBe(0);
});
it('persists a stable exact intent before dispatch and reconciles a lost committed reply after recreation without duplication',async()=>{
 const f=await fixture();f.controller.edit({title:'Exact new document',content:'Entered new input.'});f.lose();expect(await f.controller.save()).toBe(false);const original=f.controller.snapshot().raw;expect(original.intentId).not.toBe('');expect(f.task.artifacts).toHaveLength(1);expect(f.opened).toBe(0);expect(f.controller.edit({content:'Attempted later body'}).kind).toBe('held');expect(f.controller.edit({content:original.content}).kind).toBe('held');expect(f.controller.snapshot().raw).toEqual(original);await f.reopen();expect(f.controller.snapshot().raw).toEqual(original);expect(await f.controller.save()).toBe(true);expect(f.task.artifacts).toHaveLength(1);expect(f.opened).toBe(1);expect(f.controller.snapshot().raw.present).toBe(false);
});
it('late acknowledgement cannot clear newer raw or navigate a retired owner',async()=>{
 const f=await fixture();f.controller.edit({title:'Original input',content:'Original body.'});const hold=f.hold(),saving=f.controller.save();await hold.started;
 expect(f.controller.snapshot().raw.intentId).not.toBe('');f.retarget();const owner=f.controller.owner,slot=f.controller.slot;expect(f.cache.edit(owner,slot,emptyNewDocumentDraft,newDocumentDraftBasis(owner.taskId),()=>parseNewDocumentDraft({present:true,title:'Newer current input',content:'Keep newer body.',sourceRefs:[],intentId:'',binding:''}))).toBe(true);hold.release();expect(await saving).toBe(false);expect(f.controller.snapshot().fields.content).toBe('Keep newer body.');expect(f.controller.snapshot().message).toBe('');expect(f.opened).toBe(0);expect(f.task.artifacts).toHaveLength(0);
});
it('an accepted save reply cannot acknowledge a newer local generation after dispatch',async()=>{
 const f=await fixture();f.controller.edit({title:'Original input',content:'Original body.'});const hold=f.hold(),saving=f.controller.save();await hold.started;const owner=f.controller.owner,slot=f.controller.slot;f.cache.edit(owner,slot,emptyNewDocumentDraft,newDocumentDraftBasis(owner.taskId),()=>({present:true,title:'Later input',content:'Keep later text.',sourceRefs:[],intentId:'',binding:''}));hold.release();expect(await saving).toBe(true);expect(f.task.artifacts).toHaveLength(1);expect(f.controller.snapshot().fields.content).toBe('Keep later text.');expect(f.opened).toBe(0);
});
it('raw storage failure or quit freeze blocks creation while preserving recoverable input',async()=>{
 const f=await fixture();f.failRaw();f.controller.edit({title:'Keep local text',content:'Do not send before raw durability.'});await expect(f.cache.flush()).rejects.toThrow();expect(await f.controller.save()).toBe(false);expect(f.calls).toBe(0);expect(f.controller.snapshot().fields.content).toBe('Do not send before raw durability.');await f.controller.check();f.freeze();expect(await f.controller.save()).toBe(false);expect(f.calls).toBe(0);
});
it('retired render callbacks cannot edit, save or discard the current new-document input',async()=>{
 const f=await fixture();f.controller.edit({title:'Keep current input',content:'Current body.'});const old=f.controller.snapshot().scope;f.retarget();expect(f.controller.edit({content:'Old callback'},old).kind).toBe('held');expect(await f.controller.save(old)).toBe(false);expect(await f.controller.discard(old)).toBe(false);expect(f.controller.snapshot().fields.content).toBe('Current body.');expect(f.calls).toBe(0);
});
