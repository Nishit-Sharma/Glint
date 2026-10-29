import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LearningDraftStore} from '../src/host/learning-drafts';
import {emptyLocalTaskDraft,localTaskDraftBasis,localTaskDraftOwner,LOCAL_TASK_DRAFT_SLOT} from '../src/shared/local-task-draft';
import {learningDraftKey,serializeLearningDraftJson} from '../src/shared/learning-drafts';
import {createLocalTaskDraftController} from '../src/renderer/src/local-task-draft-controller';
import type {LearningDraftReadResult} from '../src/shared/learning-drafts';
import type {createLearningDrafts as createCache} from '../src/renderer/src/learning-drafts';

const control=vi.hoisted(()=>({cache:undefined as ReturnType<typeof createCache>|undefined,states:[] as unknown[],kind:'text' as 'text'|'draft'}));
// Server rendering does not run effects or navigate. Control only the actual
// App's initial New-task route and read current snapshots without subscribing.
// Exact initializer assertions below bind the hook positions to this source.
vi.mock('react',async importOriginal=>{
 const react=await importOriginal<typeof import('react')>();
 return {...react,useState(initial:unknown){
  const position=control.states.push(initial),routes:Record<number,unknown>={3:true,6:'tasks',9:'tasks',17:true,33:{kind:control.kind,key:'controlled-local-entry',epoch:0,activationEpoch:0}};
  return react.useState(Object.hasOwn(routes,position)?routes[position]:initial);
 },useSyncExternalStore(_subscribe:unknown,getSnapshot:()=>unknown){return getSnapshot();}};
});
vi.mock('../src/renderer/src/bot-session',()=>({useBotSession:()=>({state:{kind:'legacy'}})}));
vi.mock('../src/renderer/src/learning-drafts',async importOriginal=>{
 const actual=await importOriginal<typeof import('../src/renderer/src/learning-drafts')>();
 return {...actual,createLearningDrafts:(...args:Parameters<typeof actual.createLearningDrafts>)=>control.cache??actual.createLearningDrafts(...args)};
});
import App from '../src/renderer/src/App';

const bridge={invoke:vi.fn(async()=>undefined),subscribe:vi.fn(()=>()=>{})};
const directories:string[]=[];
beforeEach(()=>{
 control.states=[];control.cache=undefined;control.kind='text';bridge.invoke.mockClear();bridge.subscribe.mockClear();
 vi.stubGlobal('window',{companion:bridge});vi.stubGlobal('location',{search:''});vi.stubGlobal('matchMedia',()=>({matches:false}));
});
afterEach(async()=>{vi.unstubAllGlobals();for(const path of directories.splice(0))await rm(path,{recursive:true,force:true});});
async function cacheWith(read:LearningDraftReadResult){
 const {createLearningDrafts}=await vi.importActual<typeof import('../src/renderer/src/learning-drafts')>('../src/renderer/src/learning-drafts');
 const save=vi.fn(async()=>{throw Error('A render must not save');});
 const cache=createLearningDrafts({read:async()=>read,save});await cache.load();control.cache=cache;return {cache,save};
}
function render(){
 control.states=[];const html=renderToStaticMarkup(createElement(App));
 expect(control.states[2]).toBe(false);expect(control.states[5]).toBe('work');expect(control.states[8]).toBe('work');expect(control.states[16]).toBe(false);expect(control.states[32]).toBeUndefined();
 expect(html).toContain('<main id="main"');expect(html).toContain('class="local-task-start"');
 expect(html).toContain(control.kind==='text'?'Start with text':'Start with a draft');
 expect(bridge.invoke).not.toHaveBeenCalled();expect(bridge.subscribe).not.toHaveBeenCalled();return html;
}
async function savedLocal(raw={...emptyLocalTaskDraft,content:'Earlier exact local input'}){
 const directory=await mkdtemp(join(tmpdir(),'local-task-recovery-layout-'));directories.push(directory);
 const lookup=vi.fn(async()=>undefined),store=new LearningDraftStore({directory,lookupTask:lookup}),owner=localTaskDraftOwner('text'),slot=LOCAL_TASK_DRAFT_SLOT,basis=localTaskDraftBasis('text');
 const value=(raw:typeof emptyLocalTaskDraft)=>({initial:serializeLearningDraftJson(emptyLocalTaskDraft),value:serializeLearningDraftJson(raw,'local-task-form'),basis});
 await store.save(owner,slot,'initial',0,value(raw));
 const {createLearningDrafts}=await vi.importActual<typeof import('../src/renderer/src/learning-drafts')>('../src/renderer/src/learning-drafts');
 const cache=createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)});await cache.load();control.cache=cache;
 return {directory,store,lookup,cache,owner,slot,basis,value,path:join(directory,'learning-drafts.json')};
}
test.each(['text','draft'] as const)('the actual App %s entry has one global read/recovery region',async kind=>{
 control.kind=kind;const {save}=await cacheWith({kind:'unavailable',message:'Controlled malformed store',recoveryToken:'a'.repeat(64)}),html=render();
 expect(html.match(/aria-label="Practice draft recovery"/g)).toHaveLength(1);
 expect(html.match(/>Retry reading practice drafts<\/button>/g)).toHaveLength(1);
 expect(html.match(/>Preserve file and start fresh practice drafts<\/button>/g)).toHaveLength(1);
 expect(html).toContain('Retry local draft storage');expect(html).not.toContain('Files → Unfinished practice');expect(save).not.toHaveBeenCalled();
});
test('the actual App local entry has one deleted-task cleanup action and no recovery work on render',async()=>{
 const {save}=await cacheWith({kind:'available',epoch:'initial',records:[],cleanup:'needed'}),html=render();
 expect(html.match(/aria-label="Practice draft recovery"/g)).toHaveLength(1);
 expect(html.match(/>Retry deleted-practice cleanup<\/button>/g)).toHaveLength(1);
 expect(html).not.toContain('Files → Unfinished practice');expect(save).not.toHaveBeenCalled();
});
test('a real taskless saved record restores in New task without a task Files route or render side effect',async()=>{
 const f=await savedLocal(),before=await readFile(f.path),html=render();
 expect(html).toContain('Earlier exact local input');expect(html).toContain('Input saved on this Mac. Choose Create task to submit it.');
 expect(html).not.toContain('Files → Unfinished practice');expect(html).not.toContain('Practice draft recovery');
 expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>Cancel<\/button>/);
 expect(await readFile(f.path)).toEqual(before);expect(f.lookup).not.toHaveBeenCalled();
});
test('real CAS recovery offers both local versions and resolves back to an explicitly discardable local form',async()=>{
 const f=await savedLocal();await f.store.save(f.owner,f.slot,'initial',1,f.value({...emptyLocalTaskDraft,content:'Foreign saved local input'}));
 f.cache.edit(f.owner,f.slot,emptyLocalTaskDraft,f.basis,raw=>({...raw,content:'Open local input'}));await expect(f.cache.flush()).rejects.toThrow();
 await f.cache.retry(f.owner,f.slot).catch(()=>{});
 const key=learningDraftKey(f.owner,f.slot),entry=f.cache.getSnapshot().entries[key];expect(entry.canResolve).toBe(true);
 const before=await readFile(f.path),html=render();
 expect(html).toContain('Open local input');expect(html).toContain('Foreign saved local input');expect(html).toContain('Inspect earlier local input');
 for(const label of ['Retry local draft storage','Keep my local input','Use saved local input'])expect(html).toMatch(new RegExp('<button(?![^>]*disabled)[^>]*>'+label+'</button>'));
 expect(html).not.toContain('Files → Unfinished practice');expect(await readFile(f.path)).toEqual(before);
 expect(f.cache.resolve(f.owner,f.slot,entry.generation,'remote')).toBe(true);expect(render()).toMatch(/<button(?![^>]*disabled)[^>]*>Cancel<\/button>/);
 const controller=createLocalTaskDraftController({cache:f.cache,form:'text',send:async()=>{throw Error('Discard must not create a task');},isCurrent:()=>true,onCreated:()=>{throw Error('Discard must not open a task');}});
 expect(await controller.discard()).toBe(true);expect(await f.store.read()).toMatchObject({kind:'available',records:[{revision:3,value:null}]});expect(f.lookup).not.toHaveBeenCalled();
});
test('an uncertain restored attempt exposes same-save retry, back and explicit discard without auto creating',async()=>{
 const f=await savedLocal({...emptyLocalTaskDraft,content:'Possibly committed exact input',intentId:'10000000-0000-4000-8000-000000000001',binding:'local-task-start-form:v1:'+'a'.repeat(64)}),before=await readFile(f.path),html=render();
 expect(html).toContain('Possibly committed exact input');expect(html).toContain('The task may already exist.');
 for(const label of ['Retry same save','Back to new task','Discard local input and retry identity'])expect(html).toMatch(new RegExp('<button(?![^>]*disabled)[^>]*>'+label+'</button>'));
 expect(html).not.toContain('Files → Unfinished practice');expect(await readFile(f.path)).toEqual(before);expect(f.lookup).not.toHaveBeenCalled();
});
