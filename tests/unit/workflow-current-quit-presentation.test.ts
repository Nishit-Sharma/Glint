import {withOrdinaryAppBindings} from '../support/concurrent-app-bindings.fixture';
import {afterEach,beforeAll,expect,test,vi} from 'vitest';
import {mkdir,mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import ts from 'typescript';
import {transformSync} from 'esbuild';
import {createHash} from 'node:crypto';
import {publicErrorMessage} from '../../src/shared/public-messages';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('../support/controlled-renderer.fixture')).hooks}));
import {createElement} from 'react';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';
import {createCompanion} from '../../src/core/companion';
import {prepareWorkflowReview,createReviewedWorkflow,createContextualReviewedWorkflow} from '../../src/core/workflow-review-host';
import {LearningDraftStore} from '../../src/host/learning-drafts';
import {createLearningDrafts} from '../../src/renderer/src/learning-drafts';
import {LearningDraftProvider,LearningDraftReview} from '../../src/renderer/src/learning-draft-context';
import {WorkflowSourceReview} from '../../src/renderer/src/components/WorkflowSourceReview';
import {navigationFormBasis} from '../../src/renderer/src/learning-draft-basis';
import {workflowSourceOwner,initialWorkflowSourceRaw,workflowSourceBasis} from '../../src/renderer/src/workflow-source-review-form';
import {workflowSourceAdmissions as admissions,type WorkflowSourceMode as Mode} from '../../src/shared/workflow-source-admission';
import {learningDraftKey} from '../../src/shared/learning-drafts';
import type {Command} from '../../src/shared/bridge';
import type {Run} from '../../src/renderer/src/ui';
function gate(){let release!:()=>void,enter!:()=>void;return {waiting:new Promise<void>(resolve=>release=resolve),entered:new Promise<void>(resolve=>enter=resolve),release:()=>release(),enter:()=>enter()};}
beforeAll(async()=>{await mkdir('evidence/quit-presentation',{recursive:true});});
const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
type Renderer=ReturnType<typeof createControlledRenderer>;
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'workflow-mode-final-')),core=await createCompanion({dataDir:directory}),gates={legacy:gate(),contextual:gate()};cleanup.push(async()=>{gates.legacy.release();gates.contextual.release();await core.close();await rm(directory,{recursive:true,force:true});});
 const task=await core.createTask({title:'Owned contextual mode transitions'}),sourced=await core.putSource(task.id,{kind:'text',role:'fact',label:'Owned finite hardware rules',content:'Idle + Clock -> Ready\nReady + Reset -> Idle'}),source=sourced.sources[0],version=source.versions[0],refs=[{sourceId:source.id,version:version.version,digest:version.digest}],saved=await core.saveArtifact(task.id,{title:'Owned linked rules',content:'An explanatory finite model, not HDL simulation.',sourceRefs:refs,mimeType:'text/markdown'}),basis={artifactId:saved.artifactId,revision:1,digest:saved.revision.digest},current=await core.getTask(task.id),prepared=await prepareWorkflowReview(core,{taskId:task.id,basis}),owner=workflowSourceOwner(task.id,basis);
 const store=new LearningDraftStore({directory,lookupTask:async id=>(await core.listTasks()).find(item=>item.id===id)}),cache=createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)});await cache.load();
 let epoch=0,opened=0,published=0,loseReply:Mode|undefined;const delivered:Mode[]=[];
 const baseRun=async(command:Command)=>{
  if(command.type==='workflow.prepare')return prepared;
  if(command.type==='workflow.review'||command.type==='workflow.contextual.review'){const mode=command.type==='workflow.review'?'legacy':'contextual';published++;const {type,...input}=command,result=await (mode==='legacy'?createReviewedWorkflow:createContextualReviewedWorkflow)(core,input);gates[mode].enter();await gates[mode].waiting;delivered.push(mode);if(loseReply===mode)throw Error('Owned reply lost after commit.');return result;}
  throw Error('No other command is permitted in this controller proof.');
 };
 let delegate:((command:Command)=>Promise<unknown>)|undefined;const run=(command:Command)=>delegate?delegate(command):baseRun(command);
 async function open(mode:Mode){const captured=++epoch,renderer=createControlledRenderer(()=>createElement(LearningDraftProvider,{cache,children:createElement(WorkflowSourceReview,{task:current,basis,mode,busy:false,run:run as Run,onCreated:()=>{opened++;},onCancel:()=>{epoch++;},continuationScope:mode+':entry:'+captured,isContinuationCurrent:()=>epoch===captured})}));renderer.render();await vi.waitFor(()=>{renderer.render();expect(renderer.nodes().filter(node=>node.type==='select')).toHaveLength(2);});return renderer;}
 function select(renderer:Renderer,index:number,value:string){renderer.nodes().filter(node=>node.type==='select')[index].props.onChange({target:{value}});renderer.render();}
 async function fill(renderer:Renderer,note:string){select(renderer,0,'Idle');select(renderer,1,'Clock');renderer.find(node=>node.type==='textarea'&&node.props.rows===3).props.onChange({target:{value:note}});renderer.render();await cache.flush();renderer.render();}
 function confirm(renderer:Renderer){renderer.find(node=>node.type==='input'&&node.props.type==='checkbox'&&node.props.checked===false&&node.props.disabled===false).props.onChange({target:{checked:true}});renderer.render();}
 function submit(renderer:Renderer){confirm(renderer);renderer.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});renderer.render();}
 const initial=initialWorkflowSourceRaw(prepared),identity=workflowSourceBasis(basis,refs),cacheBasis=navigationFormBasis(initial,{slot:admissions.legacy.reviewSlot,basisMode:'explicit',basis:identity,variableArrays:['eventSequence']});
 const raw=(mode:Mode)=>cache.readForm(owner,admissions[mode].reviewSlot,initial,cacheBasis,['eventSequence']);
 return {core,task,cache,store,owner,prepared,basis,identity,gates,delivered,baseRun,setRunAdapter:(value:Run)=>{delegate=value as (command:Command)=>Promise<unknown>;},open,fill,select,confirm,submit,raw,retire:()=>epoch++,lose:(mode:Mode|undefined)=>{loseReply=mode;},get opened(){return opened;},get published(){return published;}};
}

test.each(['legacy','contextual'] as const)('CURRENT-ENTRY QUIT RED: %s unchanged current entry must not present after freeze while its exact acknowledgement drains',async mode=>{
 const f=await fixture(),current=await f.open(mode);await f.fill(current,'Exact current raw, no retirement or newer edit');f.submit(current);await f.gates[mode].entered;const before=await f.core.getTask(f.task.id);expect(before.requests).toHaveLength(1);expect(before.requests[0].status).toBe('completed');expect(f.opened).toBe(0);
 f.cache.setFrozen(true);const quitting=f.cache.flushForQuit();f.gates[mode].release();await quitting;current.render();const after=await f.core.getTask(f.task.id),stored=await f.store.read(),snapshot=f.cache.getSnapshot();await writeFile('evidence/quit-presentation/'+mode+'-witness.json',JSON.stringify({boundary:'Actual component functions/core/cache/store; React scheduling/host tree and held response delivery are controlled; not actual App refresh/native quit.',mode,frozen:snapshot.frozen,publishedCalls:f.published,onCreatedCalls:f.opened,taskUnchangedAfterHeldCommit:JSON.stringify(after)===JSON.stringify(before),before,after,rawResult:stored,entry:snapshot.entries[learningDraftKey(f.owner,admissions[mode].reviewSlot)]},null,2)+'\n');
 expect(after).toEqual(before);expect(f.published).toBe(1);expect(f.raw(mode).value.assumptions).toBe('');expect(snapshot.frozen).toBe(true);expect(f.opened).toBe(0);
});

test.each(['legacy','contextual'] as const)('QUIT PRESENTATION ABA RED: %s old success stays retired across freeze/resume and a fresh same-entry retry works',async mode=>{
 const f=await fixture(),current=await f.open(mode);await f.fill(current,'Same exact retry after Keep open');f.submit(current);await f.gates[mode].entered;f.cache.setFrozen(true);const quitting=f.cache.flushForQuit(),cancelled=expect(quitting).rejects.toThrow(/cancelled|resumed/i);f.cache.setFrozen(false);f.gates[mode].release();await cancelled;await vi.waitFor(()=>{current.render();expect(f.raw(mode).value.assumptions).toBe('');});await f.cache.flush();expect(f.opened).toBe(0);expect((await f.core.getTask(f.task.id)).requests).toHaveLength(1);
 f.gates[mode]=gate();f.gates[mode].release();await f.fill(current,'Same exact retry after Keep open');f.submit(current);await vi.waitFor(()=>expect(f.opened).toBe(1));expect((await f.core.getTask(f.task.id)).requests).toHaveLength(1);expect(f.published).toBe(2);
});
test.each(['legacy','contextual'] as const)('QUIT PRESENTATION FAILURE RED: %s failed reply is not painted while frozen or after freeze/resume ABA',async mode=>{
 for(const resume of [false,true]){const f=await fixture(),current=await f.open(mode);f.lose(mode);await f.fill(current,'Keep uncertain exact raw');f.submit(current);await f.gates[mode].entered;f.cache.setFrozen(true);const quitting=f.cache.flushForQuit(),settled=resume?expect(quitting).rejects.toThrow(/cancelled|resumed/i):quitting;if(resume)f.cache.setFrozen(false);f.gates[mode].release();await settled;await vi.waitFor(()=>{current.render();expect(current.nodes().filter(node=>node.type==='button'&&node.props.type==='submit')[0].children.map(node=>node.props.text??'').join('')).not.toContain('Creating');});expect(current.nodes().filter(node=>node.type==='#text').map(node=>node.props.text).join(' ')).not.toContain('Owned reply lost after commit.');expect(f.opened).toBe(0);expect(f.raw(mode).value.assumptions).toBe('Keep uncertain exact raw');expect((await f.core.getTask(f.task.id)).requests).toHaveLength(1);
 if(resume){f.lose(undefined);f.gates[mode]=gate();f.gates[mode].release();current.nodes().filter(node=>node.type==='input'&&node.props.type==='checkbox').at(-1)!.props.onChange({target:{checked:false}});current.render();f.confirm(current);current.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await vi.waitFor(()=>expect(f.opened).toBe(1));expect((await f.core.getTask(f.task.id)).requests).toHaveLength(1);}
 }
});
test.each(['legacy','contextual'] as const)('QUIT PRESENTATION NEWER RAW: %s older confirmed result cannot clear a newer generation during quit',async mode=>{
 const f=await fixture(),current=await f.open(mode);await f.fill(current,'Dispatched exact raw');f.submit(current);await f.gates[mode].entered;await f.fill(current,'Newer unapplied raw');f.cache.setFrozen(true);const quitting=f.cache.flushForQuit();f.gates[mode].release();await quitting;expect(f.opened).toBe(0);expect(f.raw(mode).value.assumptions).toBe('Newer unapplied raw');expect((await f.core.getTask(f.task.id)).requests).toHaveLength(1);
});

async function actualAppRun(environment:Record<string,unknown>){
 const source=await readFile(new URL('../../src/renderer/src/App.tsx',import.meta.url),'utf8'),file=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),bodies=new Map<string,string>();
 function visit(node:ts.Node){if(ts.isFunctionDeclaration(node)&&node.body&&node.name&&['run','refresh'].includes(node.name.text))bodies.set(node.name.text,node.getText(file));ts.forEachChild(node,visit);}visit(file);expect([...bodies.keys()].sort()).toEqual(['refresh','run']);
 environment=withOrdinaryAppBindings(file,{...environment,arrivedRequests:{current:environment.arrivedRequests}});
 const names=Object.keys(environment);
 const code=transformSync('const factory=(env:any)=>{const {'+names.join(',')+'}=env;'+bodies.get('refresh')+'\n'+bodies.get('run')+';return run;};module.exports=factory;',{loader:'ts',format:'cjs'}).code,module={exports:undefined as unknown};new Function('module','exports',code)(module,{});
 return {run:(module.exports as (env:Record<string,unknown>)=>Run)(environment),appSha256:createHash('sha256').update(source).digest('hex'),runSha256:createHash('sha256').update(bodies.get('run')!).digest('hex'),refreshSha256:createHash('sha256').update(bodies.get('refresh')!).digest('hex')};
}
test.each([['legacy',false],['contextual',false],['legacy',true],['contextual',true]] as const)('actual App run/refresh bodies: %s with refresh admitted after freeze=%s',async(mode,readAfterFreeze)=>{
 const f=await fixture(),current=await f.open(mode);await f.fill(current,'Actual App run held-refresh boundary');const read=gate(),events:string[]=[],globalErrors:string[]=[],taskRef={current:await f.core.getTask(f.task.id)};let quitting=false;
 const extracted=await actualAppRun({
  bridge:{invoke:async(command:Command)=>{if(command.type==='tasks.list'){if(quitting){events.push('new read refused after quit');throw Error('The app is closing.');}const result=await f.core.listTasks();events.push('tasks.list admitted and read before freeze');read.enter();await read.waiting;events.push('already-admitted list reply delivered after freeze='+f.cache.getSnapshot().frozen);return result;}return f.baseRun(command);}},
  deletedTaskIds:{current:new Set()},drafts:{hydrate:()=>events.push('composer hydration callback')},requestRef:{current:undefined},arrivedRequests:new Set(),taskRef,readModelDraft:()=>false,readScreenBrief:()=>false,MODULE_MIME:'application/vnd.window-companion.modules+json',setArrivalIdentities:()=>{},setTasks:()=>events.push('setTasks callback'),setTask:()=>events.push('setTask callback'),viewRestored:{current:true},viewSelectionEpoch:{current:0},restoreTaskView:()=>undefined,setError:(message:string)=>{if(message)globalErrors.push(message);else events.push('setError cleared at run start');},setTasksHydrated:()=>{},lock:{current:false},setBusy:()=>{},lastRunError:{current:''},isExportCommand:()=>false,setNotice:()=>{},requestErrorOwner:{current:undefined},setErrorValue:(message:string)=>{if(message)globalErrors.push(message);},publicErrorMessage,learningDrafts:f.cache,
 });
 f.setRunAdapter(extracted.run);try{
  if(!readAfterFreeze)f.gates[mode].release();f.submit(current);if(readAfterFreeze)await f.gates[mode].entered;else await read.entered;expect((await f.core.getTask(f.task.id)).requests[0].status).toBe('completed');quitting=true;f.cache.setFrozen(true);const closing=f.cache.flushForQuit();if(readAfterFreeze)f.gates[mode].release();read.release();await closing;current.render();
  const name=mode+(readAfterFreeze?'-refused-refresh':'-admitted-refresh');await writeFile('evidence/quit-presentation/actual-app-'+name+'.json',JSON.stringify({boundary:'Exact current App run/refresh bodies extracted by TypeScript AST and transpiled, with controlled hook component; bridge/read delivery and React setter callbacks substituted. No full App mount, Electron/native quit, or live IPC ordering claim.',mode,readAfterFreeze,appSha256:extracted.appSha256,runSha256:extracted.runSha256,refreshSha256:extracted.refreshSha256,events,globalErrors,onCreated:f.opened,publications:f.published,raw:await f.store.read()},null,2)+'\n');
  expect(f.opened).toBe(0);expect(f.published).toBe(1);if(readAfterFreeze){expect(f.raw(mode).value.assumptions).toBe('Actual App run held-refresh boundary');expect(globalErrors).toEqual([publicErrorMessage(Error('The app is closing.'))]);expect(events).toContain('new read refused after quit');expect(events).not.toContain('setTask callback');}else{expect(f.raw(mode).value.assumptions).toBe('');expect(globalErrors).toEqual([]);expect(events).toContain('already-admitted list reply delivered after freeze=true');expect(events).toContain('setTask callback');}
 }finally{read.release();f.gates[mode].release();await f.cache.flush().catch(()=>{});}
});
