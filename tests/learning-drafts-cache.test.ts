import {describe,expect,it} from 'vitest';
import {createLearningDrafts} from '../src/renderer/src/learning-drafts';
import {learningDraftKey,type LearningDraftCleanupResult,type LearningDraftOwner,type LearningDraftReadResult,type LearningDraftRecord,type LearningDraftRecoverResult,type LearningDraftSaveResult,type LearningDraftValue} from '../src/shared/learning-drafts';

const owner:LearningDraftOwner={taskId:'task-a',artifactId:'answer-a',artifactRevision:1,artifactDigest:'digest-a',moduleId:'join',moduleVersion:1};
const slot='prediction';
const initial={count:'',reason:''};
const nextEpoch='11111111-1111-4111-8111-111111111111';
const recoveryToken='a'.repeat(64),backupBasename=`learning-drafts-recovery-${nextEpoch}.json`;
const saved:LearningDraftValue={initial:'{"count":"","reason":""}',value:String.raw`{"count":"0","reason":"  raw reason\n"}`,basis:'state-1'};
function deferred<T>(){
 let resolve:((value:T)=>void)|undefined,reject:((reason:unknown)=>void)|undefined;
 const promise=new Promise<T>((accept,fail)=>{resolve=accept;reject=fail;});
 return {promise,resolve(value:T){if(!resolve)throw Error('Missing transport.');resolve(value);},reject(reason:unknown){if(!reject)throw Error('Missing transport.');reject(reason);}};
}
function boundary(records:LearningDraftRecord[]=[]){
 const calls:{owner:LearningDraftOwner;slot:string;expectedEpoch:string;expectedRevision:number;value:LearningDraftValue|null;result:ReturnType<typeof deferred<LearningDraftSaveResult>>}[]=[];
 let reads=0,epoch='initial';
 return {
  calls,get reads(){return reads;},get epoch(){return epoch;},set epoch(value:string){epoch=value;},records,
  async read():Promise<LearningDraftReadResult>{reads+=1;return {kind:'available',epoch,records:[...records]};},
  save(owner:LearningDraftOwner,slot:string,expectedEpoch:string,expectedRevision:number,value:LearningDraftValue|null){const result=deferred<LearningDraftSaveResult>();calls.push({owner,slot,expectedEpoch,expectedRevision,value,result});return result.promise;},
  accept(index:number){const call=calls[index],record={owner:call.owner,slot:call.slot,revision:call.expectedRevision+1,value:call.value};const key=learningDraftKey(record.owner,record.slot),existing=records.findIndex(item=>learningDraftKey(item.owner,item.slot)===key);if(existing<0)records.push(record);else records[existing]=record;call.result.resolve({kind:'saved',epoch:call.expectedEpoch,record});return record;},
 };
}
const settle=async()=>{for(let i=0;i<8;i+=1)await Promise.resolve();};

describe('durable learning form cache',()=>{
 it('loads once before forms become ready and restores exact raw values with stable snapshots',async()=>{
  const record:LearningDraftRecord={owner,slot,revision:3,value:saved},remote=boundary([record]),drafts=createLearningDrafts(remote);
  const before=drafts.getSnapshot();
  expect(drafts.getSnapshot()).toBe(before);
  expect(drafts.readForm(owner,slot,initial,'state-1').status).toBe('loading');
  await Promise.all([drafts.load(),drafts.load()]);
  expect(remote.reads).toBe(1);
  expect(drafts.readForm(owner,slot,initial,'state-1')).toMatchObject({status:'ready',value:{count:'0',reason:'  raw reason\n'}});
  const loaded=drafts.getSnapshot();
  expect(loaded.ready).toBe(true);
  await drafts.load();
  expect(drafts.getSnapshot()).toBe(loaded);
  expect(remote.reads).toBe(1);
 });
 it('combines simultaneous full and compact functional edits and persists a newer edit after a delayed save',async()=>{
  const remote=boundary(),drafts=createLearningDrafts(remote);await drafts.load();
  drafts.edit(owner,slot,initial,'state-1',latest=>({...latest,count:'0'}));
  drafts.edit({...owner},slot,initial,'state-1',latest=>({...latest,reason:'  compact reason\n'}));
  await settle();
  expect(drafts.readForm(owner,slot,initial,'state-1').value).toEqual({count:'0',reason:'  compact reason\n'});
  expect(remote.calls).toHaveLength(1);
  drafts.edit(owner,slot,initial,'state-1',latest=>({...latest,reason:latest.reason+'newer'}));
  remote.accept(0);await settle();
  expect(remote.calls).toHaveLength(2);
  expect(remote.calls[1]).toMatchObject({expectedRevision:1,value:{value:String.raw`{"count":"0","reason":"  compact reason\nnewer"}`}});
  remote.accept(1);await drafts.flush();
  const reopened=createLearningDrafts(remote);await reopened.load();
  expect(reopened.readForm(owner,slot,initial,'state-1').value).toEqual({count:'0',reason:'  compact reason\nnewer'});
 });
 it('clears only the exact dispatched generation, including newer identical content after the save pump',async()=>{
  const remote=boundary(),drafts=createLearningDrafts(remote);await drafts.load();
  drafts.edit(owner,slot,initial,'state-1',()=>({count:'0',reason:'sent'}));await settle();
  const sent=drafts.capture(owner,slot);expect(sent).toBeDefined();
  remote.accept(0);await drafts.flush();
  drafts.edit(owner,slot,initial,'state-1',latest=>({...latest}));
  expect(sent&&drafts.acknowledge(sent)).toBe(false);
  expect(drafts.readForm(owner,slot,initial,'state-1').value).toEqual({count:'0',reason:'sent'});
  await settle();remote.accept(1);await drafts.flush();
  const current=drafts.capture(owner,slot);if(!current)throw Error('Expected live draft.');
  expect(drafts.acknowledge({...current})).toBe(false);
  expect(drafts.acknowledge(current)).toBe(true);await settle();
  expect(remote.calls[2]).toMatchObject({expectedRevision:2,value:null});
  expect(drafts.acknowledge(current)).toBe(false);
  remote.accept(2);await drafts.flush();
  expect(drafts.readForm(owner,slot,initial,'state-1').value).toEqual(initial);
  const reopened=createLearningDrafts(remote);await reopened.load();
  expect(reopened.readForm(owner,slot,initial,'state-1').value).toEqual(initial);
 });
 it.each(['accepted','predecessor','changed'] as const)('preserves failed-save text, freezes automatic writes, and reconciles %s only on explicit retry',async outcome=>{
  const remote=boundary(),drafts=createLearningDrafts(remote);await drafts.load();
  drafts.edit(owner,slot,initial,'state-1',()=>({count:'0',reason:'  keep this\n'}));await settle();
  const failure=expect(drafts.flush()).rejects.toThrow('Connection lost');
  remote.calls[0].result.reject(Error('Connection lost'));await failure;await settle();
  expect(drafts.readForm(owner,slot,initial,'state-1')).toMatchObject({value:{count:'0',reason:'  keep this\n'},error:'Connection lost'});
  expect(drafts.edit(owner,slot,initial,'state-1',()=>({count:'changed',reason:''}))).toBe(false);
  await expect(drafts.flush()).rejects.toThrow('Connection lost');
  expect(remote.calls).toHaveLength(1);
  if(outcome==='accepted')remote.records.push({owner,slot,revision:1,value:remote.calls[0].value});
  if(outcome==='changed')remote.records.push({owner,slot,revision:1,value:{...saved,value:'{"count":"8","reason":"remote"}'}});
  const retry=drafts.retry(owner,slot);await settle();
  if(outcome==='predecessor'){expect(remote.calls[1]).toMatchObject({expectedRevision:0,value:remote.calls[0].value});remote.accept(1);await retry;}
  else if(outcome==='accepted'){await retry;expect(remote.calls).toHaveLength(1);}
  else{await expect(retry).rejects.toThrow(/changed elsewhere/);expect(remote.calls).toHaveLength(1);expect(drafts.getSnapshot().entries[learningDraftKey(owner,slot)]).toMatchObject({status:'conflict',remote:{value:{value:'{"count":"8","reason":"remote"}'}}});}
  expect(drafts.readForm(owner,slot,initial,'state-1').value).toEqual({count:'0',reason:'  keep this\n'});
 });
 it.each(['basis','initial','shape'])('offers %s-mismatched text for recovery and discards only its exact observed generation',async mismatch=>{
  const value=mismatch==='shape'?{...saved,value:'{"count":0,"reason":"old shape"}'}:saved;
  const remote=boundary([{owner,slot,revision:4,value}]),drafts=createLearningDrafts(remote);await drafts.load();
  const form=drafts.readForm(owner,slot,mismatch==='initial'?{count:'new default',reason:''}:initial,mismatch==='basis'?'state-2':'state-1');
  expect(form).toMatchObject({status:'recovery',value:mismatch==='initial'?{count:'new default',reason:''}:initial,recovery:{generation:0,local:value,remote:{revision:4,value}}});
  expect(drafts.edit(owner,slot,initial,'state-2',latest=>({...latest,count:'7'}))).toBe(false);
  expect(drafts.discard(owner,slot,1)).toBe(false);
  expect(drafts.discard(owner,slot,0)).toBe(true);await settle();
  expect(remote.calls[0]).toMatchObject({expectedRevision:4,value:null});
  remote.accept(0);await drafts.flush();
  expect(drafts.readForm(owner,slot,initial,'state-2')).toMatchObject({status:'ready',value:initial});
 });
 it('forgets deleted tasks and ignores pending acknowledgements, stale loads, failures and later edits',async()=>{
  const remote=boundary(),drafts=createLearningDrafts(remote);await drafts.load();
  drafts.edit(owner,slot,initial,'state-1',()=>({count:'0',reason:'deleted'}));await settle();
  const token=drafts.capture(owner,slot);if(!token)throw Error('Expected live draft.');
  const flushed=drafts.flush();drafts.forgetTask(owner.taskId);
  remote.accept(0);await flushed;
  expect(drafts.acknowledge(token)).toBe(false);
  expect(drafts.edit(owner,slot,initial,'state-1',()=>({count:'8',reason:'late'}))).toBe(false);
  expect(drafts.getSnapshot().entries).toEqual({});
  expect(remote.calls).toHaveLength(1);
  const delayed=deferred<LearningDraftReadResult>(),loading=createLearningDrafts({...remote,read:()=>delayed.promise});
  const loaded=loading.load();loading.forgetTask(owner.taskId);delayed.resolve({kind:'available',epoch:'initial',records:remote.records});await loaded;
  expect(loading.getSnapshot().entries).toEqual({});
 });
 it('publishes newer edits and exact clears to subscribers while an earlier save is still pending',async()=>{
  const remote=boundary(),drafts=createLearningDrafts(remote);await drafts.load();
  const observed:string[]=[];const unsubscribe=drafts.subscribe(()=>{const local=drafts.getSnapshot().entries[learningDraftKey(owner,slot)]?.local;observed.push(local?.value??'cleared');});
  drafts.edit(owner,slot,initial,'state-1',()=>({count:'0',reason:'first'}));await settle();
  const pending=drafts.getSnapshot();
  drafts.edit(owner,slot,initial,'state-1',latest=>({...latest,reason:'newer'}));
  expect(drafts.getSnapshot()).not.toBe(pending);
  expect(observed.at(-1)).toBe('{"count":"0","reason":"newer"}');
  const token=drafts.capture(owner,slot);if(!token)throw Error('Expected draft.');
  drafts.acknowledge(token);expect(observed.at(-1)).toBe('cleared');
  remote.accept(0);await settle();expect(remote.calls[1].value).toBeNull();remote.accept(1);await drafts.flush();unsubscribe();
 });
 it('freezes new edits for quit and waits every pending form before reporting a flush failure',async()=>{
  const remote=boundary(),drafts=createLearningDrafts(remote);await drafts.load();
  drafts.edit(owner,slot,initial,'state-1',()=>({count:'0',reason:'before quit'}));
  drafts.edit(owner,'another-form',initial,'state-1',()=>({count:'2',reason:'other'}));
  drafts.setFrozen(true);
  expect(drafts.edit(owner,slot,initial,'state-1',()=>({count:'9',reason:'after frozen'}))).toBe(false);
  let finished=false;
  const flush=drafts.flush();void flush.then(()=>{finished=true;},()=>{finished=true;});
  const failed=expect(flush).rejects.toThrow('Disk unavailable');await settle();
  remote.calls[0].result.reject(Error('Disk unavailable'));await settle();
  expect(finished).toBe(false);
  remote.accept(1);await failed;
  expect(drafts.readForm(owner,slot,initial,'state-1').value).toEqual({count:'0',reason:'before quit'});
  drafts.setFrozen(false);
  expect(drafts.edit(owner,'another-form',initial,'state-1',latest=>({...latest,reason:'quit cancelled'}))).toBe(true);
  await settle();remote.accept(2);await drafts.flush(owner.taskId).catch(()=>undefined);
 });
 it('preserves both sides of a CAS conflict and allows an explicit reconciled discard with the observed remote revision',async()=>{
  const remote=boundary([{owner,slot,revision:3,value:saved}]),drafts=createLearningDrafts(remote);await drafts.load();
  drafts.edit(owner,slot,initial,'state-1',latest=>({...latest,reason:'local'}));await settle();
  const current:LearningDraftRecord={owner,slot,revision:4,value:{...saved,value:'{"count":"7","reason":"other window"}'}};
  remote.records[0]=current;
  const failed=expect(drafts.flush()).rejects.toThrow(/changed elsewhere/);
  remote.calls[0].result.resolve({kind:'conflict',epoch:'initial',current});await failed;
  expect(drafts.readForm(owner,slot,initial,'state-1')).toMatchObject({status:'recovery',value:{count:'0',reason:'local'},recovery:{local:{value:'{"count":"0","reason":"local"}'},remote:current,canDiscard:false}});
  expect(drafts.getSnapshot().entries[learningDraftKey(owner,slot)]).toMatchObject({status:'conflict',local:{value:'{"count":"0","reason":"local"}'},remote:current});
  expect(drafts.discard(owner,slot,1)).toBe(false);
  await expect(drafts.retry(owner,slot)).rejects.toThrow(/changed elsewhere/);
  expect(drafts.readForm(owner,slot,initial,'state-1').recovery?.canDiscard).toBe(true);
  expect(drafts.discard(owner,slot,1)).toBe(true);await settle();
  expect(remote.calls[1]).toMatchObject({expectedRevision:4,value:null});
  remote.accept(1);await drafts.flush();
 });
 it('restores longer and shorter explicitly variable event arrays while fixed row cells retain their shape',async()=>{
  const remote=boundary(),drafts=createLearningDrafts(remote),sequence={events:[{text:'',cells:['','']}],title:''};await drafts.load();
  expect(drafts.edit(owner,'sequence',sequence,'events-variable-v1',latest=>({...latest,events:[{text:'first',cells:['0','  ']},{text:'second',cells:['2','3']}]}),['events'])).toBe(true);
  await settle();remote.accept(0);await drafts.flush();
  const reopened=createLearningDrafts(remote);await reopened.load();
  expect(reopened.readForm(owner,'sequence',sequence,'events-variable-v1',['events']).value).toEqual({events:[{text:'first',cells:['0','  ']},{text:'second',cells:['2','3']}],title:''});
  expect(()=>reopened.edit(owner,'sequence',sequence,'events-variable-v1',latest=>({...latest,events:[{text:'bad cells',cells:['one']}]}),['events'])).toThrow(/shape/);
  expect(reopened.edit(owner,'sequence',sequence,'events-variable-v1',latest=>({...latest,events:[]}),['events'])).toBe(true);
  await settle();remote.accept(1);await reopened.flush();
  const empty=createLearningDrafts(remote);await empty.load();
  expect(empty.readForm(owner,'sequence',sequence,'events-variable-v1',['events']).value).toEqual({events:[],title:''});
  expect(empty.readForm(owner,'sequence',sequence,'events-variable-v1').status).toBe('recovery');
  const noTemplate:{events:{text:string}[]}={events:[]};
  expect(()=>empty.edit(owner,'empty-template',noTemplate,'v1',()=>({events:[{text:'no template'}]}),['events'])).toThrow(/shape/);
 });
 it('persists a tombstone when an edit returns exactly to the initial form behind an earlier pending save',async()=>{
  const remote=boundary(),drafts=createLearningDrafts(remote);await drafts.load();
  drafts.edit(owner,slot,initial,'state-1',()=>({count:'0',reason:'remove this'}));await settle();
  const token=drafts.capture(owner,slot);if(!token)throw Error('Expected draft.');
  expect(drafts.edit(owner,slot,initial,'state-1',()=>({...initial}))).toBe(true);
  expect(drafts.getSnapshot().entries[learningDraftKey(owner,slot)].local).toBeNull();
  expect(drafts.acknowledge(token)).toBe(false);
  remote.accept(0);await settle();expect(remote.calls[1]).toMatchObject({expectedRevision:1,value:null});
  remote.accept(1);await drafts.flush();
  const reopened=createLearningDrafts(remote);await reopened.load();
  expect(reopened.readForm(owner,slot,initial,'state-1')).toMatchObject({status:'ready',value:initial});
  expect(reopened.getSnapshot().entries[learningDraftKey(owner,slot)].local).toBeNull();
 });
 it('makes an unavailable initial read visible and coalesces concurrent explicit retries before accepting edits',async()=>{
  const remote=boundary(),reload=deferred<LearningDraftReadResult>();let reads=0;
  const drafts=createLearningDrafts({...remote,read:async()=>{reads+=1;return reads===1?{kind:'unavailable',message:'Sidecar preserved'}:reload.promise;}});
  await drafts.load();
  expect(drafts.readForm(owner,slot,initial,'state-1')).toMatchObject({status:'unavailable',error:'Sidecar preserved'});
  expect(drafts.edit(owner,slot,initial,'state-1',()=>({count:'0',reason:'blocked'}))).toBe(false);
  const first=drafts.retry(),second=drafts.retry();await settle();expect(reads).toBe(2);
  reload.resolve({kind:'available',epoch:'initial',records:[{owner,slot,revision:2,value:saved}]});await Promise.all([first,second]);
  expect(drafts.readForm(owner,slot,initial,'state-1')).toMatchObject({status:'ready',value:{count:'0',reason:'  raw reason\n'}});
  expect(remote.calls).toHaveLength(0);
 });
 it('ignores a rejected save after task deletion without blocking flush or resurrecting its failure',async()=>{
  const remote=boundary(),drafts=createLearningDrafts(remote);await drafts.load();
  drafts.edit(owner,slot,initial,'state-1',()=>({count:'0',reason:'deleted'}));await settle();
  const flush=drafts.flush();drafts.forgetTask(owner.taskId);remote.calls[0].result.reject(Error('Task was deleted'));await flush;
  expect(drafts.getSnapshot()).toMatchObject({ready:true,entries:{}});
  await drafts.retry();expect(remote.reads).toBe(1);
 });
 it('ignores an uncertain-save reconciliation failure arriving after its task was deleted',async()=>{
  const remote=boundary(),drafts=createLearningDrafts(remote);await drafts.load();
  drafts.edit(owner,slot,initial,'state-1',()=>({count:'0',reason:'local'}));await settle();
  const failure=expect(drafts.flush()).rejects.toThrow('Unknown result');remote.calls[0].result.reject(Error('Unknown result'));await failure;
  const reread=deferred<LearningDraftReadResult>();remote.read=()=>reread.promise;
  const retry=drafts.retry(owner,slot);await settle();drafts.forgetTask(owner.taskId);reread.reject(Error('Task was deleted'));
  await expect(retry).resolves.toBeUndefined();expect(drafts.getSnapshot().entries).toEqual({});await drafts.flush();
 });
 it('prevents an old revision-zero draft from resurrecting after epoch compaction until the user explicitly keeps local edits',async()=>{
  const remote=boundary(),drafts=createLearningDrafts(remote);await drafts.load();
  expect(drafts.getSnapshot().epoch).toBe('initial');
  drafts.edit(owner,slot,initial,'state-1',()=>({count:'0',reason:'  old unsaved\n'}));await settle();
  const token=drafts.capture(owner,slot);if(!token)throw Error('Expected draft.');
  expect(remote.calls[0]).toMatchObject({expectedEpoch:'initial',expectedRevision:0});
  remote.epoch=nextEpoch;const failed=expect(drafts.flush()).rejects.toThrow(/storage changed/);
  remote.calls[0].result.resolve({kind:'stale-epoch',epoch:nextEpoch});await failed;await settle();
  expect(remote.calls).toHaveLength(1);
  expect(drafts.getSnapshot().entries[learningDraftKey(owner,slot)]).toMatchObject({epoch:'initial',status:'error',canResolve:false,canDiscard:false});
  await expect(drafts.retry(owner,slot)).rejects.toThrow(/changed elsewhere/);
  expect(remote.calls).toHaveLength(1);
  expect(drafts.getSnapshot()).toMatchObject({epoch:nextEpoch,entries:{[learningDraftKey(owner,slot)]:{epoch:nextEpoch,status:'conflict',canResolve:true,canDiscard:true}}});
  expect(drafts.readForm(owner,slot,initial,'state-1')).toMatchObject({status:'recovery',value:{count:'0',reason:'  old unsaved\n'},recovery:{remote:null,canResolve:true,canDiscard:true}});
  expect(drafts.resolve(owner,slot,1,'local')).toBe(true);expect(drafts.acknowledge(token)).toBe(false);await settle();
  expect(remote.calls[1]).toMatchObject({expectedEpoch:nextEpoch,expectedRevision:0,value:{value:String.raw`{"count":"0","reason":"  old unsaved\n"}`}});
  remote.accept(1);await drafts.flush();
 });
 it.each(['local','remote'] as const)('resolves a reviewed conflict with the explicit %s choice and invalidates older tokens',async choice=>{
  const remote=boundary([{owner,slot,revision:3,value:saved}]),drafts=createLearningDrafts(remote);await drafts.load();
  drafts.edit(owner,slot,initial,'state-1',latest=>({...latest,reason:'local choice'}));await settle();
  const token=drafts.capture(owner,slot);if(!token)throw Error('Expected draft.');
  const current:LearningDraftRecord={owner,slot,revision:4,value:{...saved,value:'{"count":"9","reason":"saved choice"}'}};remote.records[0]=current;
  const failed=expect(drafts.flush()).rejects.toThrow(/changed elsewhere/);remote.calls[0].result.resolve({kind:'conflict',epoch:'initial',current});await failed;
  expect(drafts.resolve(owner,slot,1,choice)).toBe(false);
  await expect(drafts.retry(owner,slot)).rejects.toThrow(/changed elsewhere/);
  expect(drafts.resolve(owner,slot,2,choice)).toBe(false);drafts.setFrozen(true);expect(drafts.resolve(owner,slot,1,choice)).toBe(false);drafts.setFrozen(false);
  expect(drafts.resolve(owner,slot,1,choice)).toBe(true);expect(drafts.acknowledge(token)).toBe(false);await settle();
  if(choice==='remote'){
   await drafts.flush();expect(remote.calls).toHaveLength(1);
   expect(drafts.readForm(owner,slot,initial,'state-1')).toMatchObject({status:'ready',value:{count:'9',reason:'saved choice'}});
   expect(drafts.getSnapshot().entries[learningDraftKey(owner,slot)].status).toBe('clean');
  }else{
   expect(remote.calls[1]).toMatchObject({expectedEpoch:'initial',expectedRevision:4,value:{value:'{"count":"0","reason":"local choice"}'}});
   const changed:LearningDraftRecord={owner,slot,revision:5,value:{...saved,value:'{"count":"10","reason":"changed again"}'}};
   const rejected=expect(drafts.flush()).rejects.toThrow(/changed elsewhere/);remote.calls[1].result.resolve({kind:'conflict',epoch:'initial',current:changed});await rejected;
   expect(drafts.readForm(owner,slot,initial,'state-1')).toMatchObject({status:'recovery',value:{count:'0',reason:'local choice'},recovery:{remote:changed,canResolve:false,canDiscard:false}});
  }
 });
 it('resends under a new epoch only after a fresh read proves the exact surviving predecessor',async()=>{
  const remote=boundary([{owner,slot,revision:3,value:saved}]),drafts=createLearningDrafts(remote);await drafts.load();
  drafts.edit(owner,slot,initial,'state-1',latest=>({...latest,reason:'new local'}));await settle();
  remote.epoch=nextEpoch;const failure=expect(drafts.flush()).rejects.toThrow(/storage changed/);
  remote.calls[0].result.resolve({kind:'stale-epoch',epoch:nextEpoch});await failure;
  expect(remote.calls).toHaveLength(1);
  const retry=drafts.retry(owner,slot);await settle();
  expect(remote.calls[1]).toMatchObject({expectedEpoch:nextEpoch,expectedRevision:3,value:{value:'{"count":"0","reason":"new local"}'}});
  remote.accept(1);await retry;await drafts.flush();
  expect(drafts.getSnapshot().entries[learningDraftKey(owner,slot)]).toMatchObject({epoch:nextEpoch,status:'clean'});
 });
 it('marks a pruned tombstone clean after the fresh epoch read instead of writing an unsupported null revision-zero record',async()=>{
  const remote=boundary([{owner,slot,revision:2,value:null}]),drafts=createLearningDrafts(remote);await drafts.load();
  drafts.edit(owner,slot,initial,'state-1',()=>({...initial}));await settle();
  expect(remote.calls[0]).toMatchObject({expectedEpoch:'initial',expectedRevision:2,value:null});
  remote.epoch=nextEpoch;remote.records.splice(0);const failure=expect(drafts.flush()).rejects.toThrow(/storage changed/);
  remote.calls[0].result.resolve({kind:'stale-epoch',epoch:nextEpoch});await failure;await drafts.retry(owner,slot);await drafts.flush();
  expect(remote.calls).toHaveLength(1);
  expect(drafts.getSnapshot().entries[learningDraftKey(owner,slot)]).toMatchObject({epoch:nextEpoch,status:'clean',local:null,remote:null});
 });
 it('clears a purely unsaved form locally before the first transport dispatch without writing a null revision-zero record',async()=>{
  const remote=boundary(),drafts=createLearningDrafts(remote);await drafts.load();
  drafts.edit(owner,slot,initial,'state-1',()=>({count:'0',reason:'brief edit'}));
  expect(drafts.discard(owner,slot,1)).toBe(true);await drafts.flush();
  expect(remote.calls).toHaveLength(0);
  expect(drafts.getSnapshot().entries[learningDraftKey(owner,slot)]).toMatchObject({status:'clean',local:null,remote:null});
 });
 it('rejects malformed epochs on read and save without losing raw local input',async()=>{
  const remote=boundary();remote.epoch='malformed';const unavailable=createLearningDrafts(remote);await unavailable.load();
  expect(unavailable.readForm(owner,slot,initial,'state-1').status).toBe('unavailable');
  expect(unavailable.edit(owner,slot,initial,'state-1',()=>({count:'0',reason:'blocked'}))).toBe(false);
  remote.epoch='initial';const drafts=createLearningDrafts(remote);await drafts.load();
  drafts.edit(owner,slot,initial,'state-1',()=>({count:'0',reason:'  retain\n'}));await settle();
  const failed=expect(drafts.flush()).rejects.toThrow();
  remote.calls[0].result.resolve({kind:'saved',epoch:'malformed',record:{owner,slot,revision:1,value:remote.calls[0].value}});await failed;
  expect(drafts.readForm(owner,slot,initial,'state-1')).toMatchObject({status:'ready',value:{count:'0',reason:'  retain\n'}});
  expect(drafts.getSnapshot().entries[learningDraftKey(owner,slot)]).toMatchObject({status:'error',local:{value:String.raw`{"count":"0","reason":"  retain\n"}`},remote:null,canDiscard:false});
 });
 it('treats a valid but mismatched save-response epoch as unconfirmed and requires a fresh read',async()=>{
  const remote=boundary(),drafts=createLearningDrafts(remote);await drafts.load();
  drafts.edit(owner,slot,initial,'state-1',()=>({count:'0',reason:'keep'}));await settle();
  const failed=expect(drafts.flush()).rejects.toThrow(/storage changed/);
  remote.calls[0].result.resolve({kind:'saved',epoch:nextEpoch,record:{owner,slot,revision:1,value:remote.calls[0].value}});await failed;await settle();
  expect(remote.calls).toHaveLength(1);
  expect(drafts.getSnapshot().entries[learningDraftKey(owner,slot)]).toMatchObject({epoch:'initial',status:'error',remote:null,local:{value:'{"count":"0","reason":"keep"}'}});
 });
 it.each([
  {label:'another slot',otherOwner:owner,otherSlot:'starting-state'},
  {label:'another module owner',otherOwner:{...owner,moduleId:'other-module'},otherSlot:slot},
 ])('flushes and acknowledges one form despite a failed draft in $label while quit still rejects',async({otherOwner,otherSlot})=>{
  const remote=boundary(),drafts=createLearningDrafts(remote);await drafts.load();
  drafts.edit(otherOwner,otherSlot,initial,'state-1',()=>({count:'7',reason:'retain failed form'}));await settle();
  const unrelated=expect(drafts.flushForm(otherOwner,otherSlot)).rejects.toThrow('Other form failed');remote.calls[0].result.reject(Error('Other form failed'));await unrelated;
  drafts.edit(owner,slot,initial,'state-1',()=>({count:'0',reason:'ready to submit'}));
  const token=drafts.capture(owner,slot);if(!token)throw Error('Expected form generation before submission.');
  const persisted=drafts.flushForm(owner,slot);await settle();remote.accept(1);await expect(persisted).resolves.toBeUndefined();
  expect(drafts.readForm(owner,slot,initial,'state-1')).toMatchObject({status:'ready',value:{count:'0',reason:'ready to submit'}});
  expect(drafts.getSnapshot().entries[learningDraftKey(owner,slot)].status).toBe('clean');
  expect(drafts.acknowledge(token)).toBe(true);const cleared=drafts.flushForm(owner,slot);await settle();remote.accept(2);await cleared;
  expect(drafts.readForm(owner,slot,initial,'state-1').value).toEqual(initial);
  expect(drafts.readForm(otherOwner,otherSlot,initial,'state-1')).toMatchObject({value:{count:'7',reason:'retain failed form'},error:'Other form failed'});
  drafts.setFrozen(true);await expect(drafts.flush()).rejects.toThrow('Other form failed');expect(remote.calls).toHaveLength(3);
 });
 it('does not make a healthy form wait for or inherit another form’s failing retry',async()=>{
  const remote=boundary(),drafts=createLearningDrafts(remote);await drafts.load();
  drafts.edit(owner,'other-form',initial,'state-1',()=>({count:'7',reason:'held'}));await settle();
  const failed=expect(drafts.flushForm(owner,'other-form')).rejects.toThrow('First failure');remote.calls[0].result.reject(Error('First failure'));await failed;
  const reread=deferred<LearningDraftReadResult>();remote.read=()=>reread.promise;
  const retry=drafts.retry(owner,'other-form'),retryFailed=expect(retry).rejects.toThrow('Still blocked');await settle();
  drafts.edit(owner,slot,initial,'state-1',()=>({count:'0',reason:'independent'}));
  let complete=false;const flushed=drafts.flushForm(owner,slot);void flushed.then(()=>{complete=true;},()=>{});
  await settle();remote.accept(1);await settle();const completedBeforeUnrelatedRetry=complete;
  reread.resolve({kind:'unavailable',message:'Still blocked'});await retryFailed;await flushed.catch(()=>undefined);
  expect(completedBeforeUnrelatedRetry).toBe(true);await expect(flushed).resolves.toBeUndefined();
  drafts.setFrozen(true);await expect(drafts.flush()).rejects.toThrow('Still blocked');
  expect(drafts.getSnapshot().entries[learningDraftKey(owner,slot)].status).toBe('clean');
 });
 it('recovers an initially unreadable file only through its returned token and an explicit request',async()=>{
  const remote=boundary(),tokens:string[]=[];
  const drafts=createLearningDrafts({...remote,read:async()=>({kind:'unavailable',message:'Unreadable bytes preserved',recoveryToken}),recover:async(token:string)=>{tokens.push(token);return {kind:'recovered',epoch:nextEpoch,backupBasename};}});
  await drafts.load();
  expect(tokens).toEqual([]);expect(drafts.getSnapshot()).toMatchObject({ready:true,recoveryToken,cleanupNeeded:false,error:'Unreadable bytes preserved'});
  await expect(drafts.recoverUnreadable()).resolves.toEqual({kind:'recovered',epoch:nextEpoch,backupBasename});
  expect(tokens).toEqual([recoveryToken]);expect(drafts.getSnapshot()).toMatchObject({ready:true,epoch:nextEpoch,entries:{},cleanupNeeded:false});
  expect(drafts.getSnapshot().error).toBeUndefined();expect(drafts.getSnapshot().recoveryToken).toBeUndefined();expect(remote.calls).toHaveLength(0);
 });
 it.each(['local','remote'] as const)('preserves open raw edits through unreadable recovery and waits for an explicit %s choice',async choice=>{
  const result=deferred<LearningDraftRecoverResult>(),remote=Object.assign(boundary(),{recover:()=>result.promise}),drafts=createLearningDrafts(remote);await drafts.load();
  drafts.edit(owner,slot,initial,'state-1',()=>({count:'0',reason:'  open raw\n'}));await settle();
  const token=drafts.capture(owner,slot);if(!token)throw Error('Expected original generation.');
  const failed=expect(drafts.flush()).rejects.toThrow('Write uncertain');remote.calls[0].result.reject(Error('Write uncertain'));await failed;
  remote.read=async()=>({kind:'unavailable',message:'Unreadable bytes preserved',recoveryToken});
  await expect(drafts.retry(owner,slot)).rejects.toThrow('Unreadable bytes preserved');
  expect(drafts.getSnapshot().recoveryToken).toBe(recoveryToken);
  expect(drafts.readForm(owner,slot,initial,'state-1')).toMatchObject({status:'unavailable',value:{count:'0',reason:'  open raw\n'}});
  const recovered=drafts.recoverUnreadable();await settle();
  expect(drafts.edit(owner,slot,initial,'state-1',()=>({count:'9',reason:'blocked during recovery'}))).toBe(false);
  result.resolve({kind:'recovered',epoch:nextEpoch,backupBasename});await recovered;
  expect(drafts.acknowledge(token)).toBe(false);
  expect(drafts.readForm(owner,slot,initial,'state-1')).toMatchObject({status:'recovery',value:{count:'0',reason:'  open raw\n'},recovery:{remote:null,canResolve:true}});
  remote.read=async()=>({kind:'available',epoch:nextEpoch,records:[]});
  const checked=drafts.retry(owner,slot);await settle();
  expect(remote.calls).toHaveLength(1);await expect(checked).rejects.toThrow();
  const generation=drafts.getSnapshot().entries[learningDraftKey(owner,slot)].generation;
  expect(drafts.resolve(owner,slot,generation,choice)).toBe(true);await settle();
  if(choice==='local'){expect(remote.calls[1]).toMatchObject({expectedEpoch:nextEpoch,expectedRevision:0,value:{value:String.raw`{"count":"0","reason":"  open raw\n"}`}});remote.accept(1);await drafts.flushForm(owner,slot);}
  else{await drafts.flushForm(owner,slot);expect(remote.calls).toHaveLength(1);expect(drafts.readForm(owner,slot,initial,'state-1').value).toEqual(initial);}
 });
 it('requires a fresh returned token after the unreadable bytes change instead of retrying a stale recovery',async()=>{
  const remote=boundary(),tokens:string[]=[];let currentToken=recoveryToken;
  const drafts=createLearningDrafts({...remote,read:async()=>({kind:'unavailable',message:'Unreadable file',recoveryToken:currentToken}),recover:async(token:string):Promise<LearningDraftRecoverResult>=>{tokens.push(token);if(tokens.length===1)throw Error('Bytes changed at /private/example');return {kind:'recovered',epoch:nextEpoch,backupBasename};}});
  await drafts.load();await expect(drafts.recoverUnreadable()).rejects.toThrow(/could not be confirmed/);
  expect(drafts.getSnapshot().recoveryToken).toBeUndefined();expect(drafts.getSnapshot().maintenanceError).not.toContain('/private');
  await expect(drafts.recoverUnreadable()).rejects.toThrow(/not currently available/);expect(tokens).toEqual([recoveryToken]);
  currentToken='b'.repeat(64);await expect(drafts.retry()).rejects.toThrow('Unreadable file');
  expect(drafts.getSnapshot().recoveryToken).toBe(currentToken);expect(tokens).toHaveLength(1);
  await drafts.recoverUnreadable();expect(tokens).toEqual([recoveryToken,currentToken]);expect(remote.calls).toHaveLength(0);
 });
 it('keeps failed cleanup visible, accepts an explicit retry, and preserves a newer deletion notice during cleanup',async()=>{
  const outcomes=[deferred<LearningDraftCleanupResult>(),deferred<LearningDraftCleanupResult>(),deferred<LearningDraftCleanupResult>()];let attempts=0;
  const remote=Object.assign(boundary(),{cleanup:()=>outcomes[attempts++].promise}),drafts=createLearningDrafts(remote);await drafts.load();
  drafts.noteCleanupNeeded();expect(drafts.getSnapshot().cleanupNeeded).toBe(true);expect(attempts).toBe(0);
  const first=drafts.cleanupDeleted(),same=drafts.cleanupDeleted();expect(same).toBe(first);await settle();
  const failure=expect(first).rejects.toThrow(/could not be confirmed/);outcomes[0].reject(Error('Failed at /private/example'));await failure;
  expect(drafts.getSnapshot()).toMatchObject({cleanupNeeded:true});expect(drafts.getSnapshot().maintenanceError).not.toContain('/private');
  expect(drafts.edit(owner,slot,initial,'state-1',()=>({count:'0',reason:'healthy form still works'}))).toBe(true);await settle();remote.accept(0);await drafts.flushForm(owner,slot);
  const second=drafts.cleanupDeleted();await settle();drafts.noteCleanupNeeded();drafts.setFrozen(true);
  let finished=false;const flushed=drafts.flush();void flushed.then(()=>{finished=true;},()=>{});await settle();expect(finished).toBe(false);
  remote.epoch=nextEpoch;outcomes[1].resolve({kind:'cleaned',epoch:nextEpoch,removed:1});await second;await flushed;
  expect(drafts.getSnapshot()).toMatchObject({epoch:nextEpoch,cleanupNeeded:true});
  await expect(drafts.cleanupDeleted()).rejects.toThrow(/not currently available/);expect(attempts).toBe(2);drafts.setFrozen(false);
  const third=drafts.cleanupDeleted();await settle();outcomes[2].resolve({kind:'cleaned',epoch:nextEpoch,removed:0});await third;
  expect(drafts.getSnapshot().cleanupNeeded).toBe(false);expect(drafts.getSnapshot().maintenanceError).toBeUndefined();expect(remote.calls).toHaveLength(1);
  expect(drafts.getSnapshot().entries[learningDraftKey(owner,slot)]).toMatchObject({epoch:nextEpoch,status:'clean',remote:{revision:1}});
  expect(drafts.edit(owner,slot,initial,'state-1',latest=>({...latest,reason:'ordinary edit after cleanup'}))).toBe(true);await settle();
  expect(remote.calls[1]).toMatchObject({expectedEpoch:nextEpoch,expectedRevision:1});remote.accept(1);await drafts.flushForm(owner,slot);
 });
 it('reports cleanup needed by a read without performing cleanup or requiring optional maintenance transports',async()=>{
  const remote=boundary(),drafts=createLearningDrafts({...remote,read:async()=>({kind:'available',epoch:'initial',records:[],cleanup:'needed'})});await drafts.load();
  expect(drafts.getSnapshot().cleanupNeeded).toBe(true);await expect(drafts.cleanupDeleted()).rejects.toThrow(/not currently available/);
  expect(drafts.getSnapshot().cleanupNeeded).toBe(true);expect(remote.calls).toHaveLength(0);
 });
 it.each(['initial','same'] as const)('rejects a recovery response with an %s epoch instead of confirming an unsafe reset',async invalid=>{
  const remote=Object.assign(boundary([{owner,slot,revision:2,value:saved}]),{recover:async():Promise<LearningDraftRecoverResult>=>({kind:'recovered',epoch:invalid==='initial'?'initial':nextEpoch,backupBasename})});remote.epoch=nextEpoch;
  const drafts=createLearningDrafts(remote);await drafts.load();drafts.edit(owner,slot,initial,'state-1',latest=>({...latest,reason:'keep open'}));await settle();
  const failed=expect(drafts.flush()).rejects.toThrow('Unknown');remote.calls[0].result.reject(Error('Unknown'));await failed;
  remote.read=async()=>({kind:'unavailable',message:'Unreadable',recoveryToken});await expect(drafts.retry(owner,slot)).rejects.toThrow('Unreadable');
  await expect(drafts.recoverUnreadable()).rejects.toThrow(/could not be confirmed/);
  expect(drafts.getSnapshot().epoch).toBe(nextEpoch);expect(drafts.getSnapshot().recoveryToken).toBeUndefined();
  expect(drafts.readForm(owner,slot,initial,'state-1').value).toEqual({count:'0',reason:'keep open'});expect(remote.calls).toHaveLength(1);
 });
 it.each(['initial','same'] as const)('rejects a cleanup response that removes records with an %s epoch',async invalid=>{
  const remote=Object.assign(boundary(),{cleanup:async():Promise<LearningDraftCleanupResult>=>({kind:'cleaned',epoch:invalid==='initial'?'initial':nextEpoch,removed:1})});remote.epoch=nextEpoch;
  const drafts=createLearningDrafts(remote);await drafts.load();drafts.noteCleanupNeeded();await expect(drafts.cleanupDeleted()).rejects.toThrow(/could not be confirmed/);
  expect(drafts.getSnapshot()).toMatchObject({epoch:nextEpoch,cleanupNeeded:true});expect(remote.calls).toHaveLength(0);
 });
 it('waits pending saves before recovery, keeps quit waiting, and never restores a task deleted during recovery',async()=>{
  const recovered=deferred<LearningDraftRecoverResult>();let recoverCalls=0;
  const remote=Object.assign(boundary(),{recover:()=>{recoverCalls+=1;return recovered.promise;}}),drafts=createLearningDrafts(remote),deletedOwner={...owner,taskId:'deleted-task'};await drafts.load();
  drafts.edit(deletedOwner,slot,initial,'state-1',()=>({count:'7',reason:'will be deleted'}));await settle();
  const failed=expect(drafts.flushForm(deletedOwner,slot)).rejects.toThrow('Uncertain');remote.calls[0].result.reject(Error('Uncertain'));await failed;
  drafts.edit(owner,slot,initial,'state-1',()=>({count:'0',reason:'  pending raw\n'}));await settle();
  const token=drafts.capture(owner,slot);if(!token)throw Error('Expected pending generation.');
  remote.read=async()=>({kind:'unavailable',message:'Unreadable',recoveryToken});await expect(drafts.retry(deletedOwner,slot)).rejects.toThrow('Unreadable');
  const recovery=drafts.recoverUnreadable();expect(drafts.recoverUnreadable()).toBe(recovery);await settle();expect(recoverCalls).toBe(0);
  drafts.forgetTask(deletedOwner.taskId);drafts.setFrozen(true);let quitFinished=false;
  const quit=drafts.flush();void quit.then(()=>{quitFinished=true;},()=>{quitFinished=true;});const quitFailure=expect(quit).rejects.toThrow(/reset/);
  remote.accept(1);await settle();expect(recoverCalls).toBe(1);expect(quitFinished).toBe(false);
  recovered.resolve({kind:'recovered',epoch:nextEpoch,backupBasename});await recovery;await quitFailure;
  expect(drafts.acknowledge(token)).toBe(false);expect(drafts.getSnapshot().entries[learningDraftKey(deletedOwner,slot)]).toBeUndefined();
  expect(drafts.getSnapshot().entries[learningDraftKey(owner,slot)]).toMatchObject({status:'conflict',local:{value:String.raw`{"count":"0","reason":"  pending raw\n"}`},remote:null});
  expect(remote.calls).toHaveLength(2);await expect(drafts.recoverUnreadable()).rejects.toThrow(/not currently available/);
 });
 it('publishes global unreadable recovery metadata when the task that requested the read was deleted',async()=>{
  const remote=boundary(),drafts=createLearningDrafts(remote);await drafts.load();drafts.edit(owner,slot,initial,'state-1',()=>({count:'0',reason:'deleted'}));await settle();
  const failed=expect(drafts.flush()).rejects.toThrow('Unknown');remote.calls[0].result.reject(Error('Unknown'));await failed;
  const reread=deferred<LearningDraftReadResult>();remote.read=()=>reread.promise;const retry=drafts.retry(owner,slot);await settle();drafts.forgetTask(owner.taskId);
  const published:string[]=[];drafts.subscribe(()=>{if(drafts.getSnapshot().recoveryToken)published.push('recoverable');});
  reread.resolve({kind:'unavailable',message:'Unreadable file',recoveryToken});await retry;
  expect(published).toContain('recoverable');expect(drafts.getSnapshot()).toMatchObject({entries:{},recoveryToken,error:'Unreadable file'});
 });
});
