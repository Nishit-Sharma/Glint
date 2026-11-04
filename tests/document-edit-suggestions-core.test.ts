import {createHash} from 'node:crypto';
import {Effect} from 'effect';
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,readFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {createCompanion,type Companion} from '../src/core/companion';
import {savedDocumentDraftBasis} from '../src/shared/saved-document-draft';
import {DOCUMENT_SUGGESTIONS_MIME,documentSuggestions,finishDocumentSuggestions,readDocumentSuggestionDecision} from '../src/shared/document-edit-suggestions';
import {prepareDocumentSuggestions} from '../src/host/document-edit-suggestions';
import {projectRequestTask} from '../src/core/request-context';
import {DEFAULT_CHARACTER} from '../src/shared/character-catalog';
import {writeFile} from 'node:fs/promises';

const faults=vi.hoisted(()=>({mode:undefined as 'before'|'after'|undefined}));
vi.mock('../src/core/store',async original=>{const actual=await original<typeof import('../src/core/store')>();return {...actual,writeState:(...args:Parameters<typeof actual.writeState>)=>faults.mode==='before'?Effect.fail(Error('Synthetic pre-publication store failure')):faults.mode==='after'?Effect.andThen(actual.writeState(...args),Effect.fail(Error('Synthetic reply lost after durable publication'))):actual.writeState(...args)};});
function evidenceResult(body:Parameters<typeof finishDocumentSuggestions>[0],content:string){const result=finishDocumentSuggestions(body,content);result.hunks=result.hunks.map(hunk=>({...hunk,evidence:{reason:'Synthetic correction grounded in the selected fact.',anchors:[{source:body.sourceRefs[0],start:0,quote:'Version1'}]}}));return result;}
const cores:Companion[]=[];afterEach(async()=>{faults.mode=undefined;for(const core of cores.splice(0))await core.close();});
async function fixture(options:{encoding?:'utf8';source?:boolean}={}){
 const directory=await mkdtemp(join(tmpdir(),'suggestions-core-')),core=await createCompanion({dataDir:directory});cores.push(core);
 const task=await core.createTask({title:'Owned suggestion check'});const sourced=await core.putSource(task.id,{kind:'text',role:'fact',label:'Owned facts',content:'Version1'}),source=sourced.sources[0],refs=source?[{sourceId:source.id,version:source.currentVersion,digest:source.versions.at(-1)!.digest}]:[];
 const generated=await core.runRequest({taskId:task.id,requestId:'owned-original',kind:'create',prompt:'Write the original document.',sourceIds:refs.map(ref=>ref.sourceId),expectedSourceRefs:refs},async()=>({title:'Owned document',content:'old\nkeep\nold\n',mimeType:'text/markdown',...(options.encoding?{encoding:options.encoding}:{})}));
 expect(generated.status,generated.error).toBe('completed');const original=(await core.getTask(task.id)).artifacts.find(artifact=>artifact.id===generated.artifactId)!,saved={artifactId:original.id,revision:original.revisions[0]},basis=savedDocumentDraftBasis(await core.getTask(task.id),saved.artifactId,saved.revision);
 const input={taskId:task.id,artifactId:saved.artifactId,basis,requestId:'owned-proposal',prompt:'Change first and last lines'},prepared=await core.beginDocumentEditSuggestions(input);
 const generate=(runner=async()=> 'first\nkeep\nlast\n')=>core.runRequest({taskId:task.id,requestId:input.requestId,kind:'revise',prompt:input.prompt,artifactId:prepared.artifactId,expectedRevision:1,expectedArtifacts:[{artifactId:saved.artifactId,revision:1,digest:saved.revision.digest}],sourceIds:refs.map(item=>item.sourceId),expectedSourceRefs:refs},async()=>({title:'Suggestions for Owned document',content:JSON.stringify(evidenceResult(prepared.body,await runner())),mimeType:DOCUMENT_SUGGESTIONS_MIME}));
 const decision=async(choice:'accept'|'reject'|'accept-all'|'reject-all',index?:number,intentId='intent-'+crypto.randomUUID())=>{const task=await core.getTask(input.taskId),revision=task.artifacts.find(item=>item.id===prepared.artifactId)!.revisions.at(-1)!;return readDocumentSuggestionDecision({type:'document-suggestions.decide',taskId:task.id,proposal:{artifactId:prepared.artifactId,revision:revision.revision,digest:revision.digest},intentId,choice,...(index===undefined?{}:{index})});};
 return {directory,core,input,task,saved,prepared,generate,decision,refs};
}
it('stages real runner output, preserves original until accept, keeps remaining own changes actionable and replays once after restart',async()=>{
 const f=await fixture();expect((await f.core.getTask(f.task.id)).artifacts[0].revisions).toHaveLength(1);expect((await f.generate()).status).toBe('completed');
 const original=structuredClone((await f.core.getTask(f.task.id)).artifacts[0].revisions[0]),command=await f.decision('accept',0,'exact-first');let task=await f.core.decideDocumentEditSuggestions(command);
 expect(task.artifacts[0].revisions.at(-1)?.content).toBe('first\nkeep\nold\n');expect(task.artifacts[0].revisions[0]).toEqual(original);expect(documentSuggestions(task.artifacts[1].revisions.at(-1)!)?.decisions).toEqual(['accepted','pending']);
 const replay=await f.core.decideDocumentEditSuggestions(command);expect(replay).toEqual(task);
 await f.core.close();const reopened=await createCompanion({dataDir:f.directory});cores.push(reopened);const reopenedReplay=await reopened.decideDocumentEditSuggestions(command);expect(reopenedReplay.artifacts).toEqual(task.artifacts);expect(reopenedReplay.requests).toEqual(task.requests);
 const proposal=task.artifacts[1].revisions.at(-1)!;task=await reopened.decideDocumentEditSuggestions(readDocumentSuggestionDecision({type:'document-suggestions.decide',taskId:task.id,proposal:{artifactId:f.prepared.artifactId,revision:proposal.revision,digest:proposal.digest},intentId:'rest',choice:'accept-all'}));
 expect(task.artifacts[0].revisions.at(-1)?.content).toBe('first\nkeep\nlast\n');expect(documentSuggestions(task.artifacts[1].revisions.at(-1)!)?.phase).toBe('closed');expect(task.requests.find(request=>request.id===f.input.requestId)?.answer?.revision).toBe(2);
});
it('reject-all does not create a document revision; stale document blocks accept but permits closure',async()=>{
 const f=await fixture();await f.generate();const before=(await f.core.getTask(f.task.id)).artifacts[0];await f.core.decideDocumentEditSuggestions(await f.decision('reject-all'));expect((await f.core.getTask(f.task.id)).artifacts[0]).toEqual(before);
 const g=await fixture();await g.generate();await g.core.saveArtifact(g.task.id,{artifactId:g.saved.artifactId,expectedRevision:1,title:'Owned document',content:'Manual newer edit',mimeType:'text/markdown',sourceRefs:[]});
 await expect(g.core.decideDocumentEditSuggestions(await g.decision('accept-all'))).rejects.toThrow();await g.core.decideDocumentEditSuggestions(await g.decision('reject-all'));expect((await g.core.getTask(g.task.id)).artifacts[0].revisions.at(-1)?.content).toBe('Manual newer edit');
});
it('keeps failed/cancelled pending output separate and prevents forged direct proposal saves',async()=>{
 const f=await fixture();expect((await f.generate(async()=>{throw Error('Synthetic transport failure');})).status).toBe('failed');await expect(f.core.decideDocumentEditSuggestions(await f.decision('accept-all'))).rejects.toThrow();await f.core.decideDocumentEditSuggestions(await f.decision('reject-all'));expect((await f.core.getTask(f.task.id)).artifacts[0].revisions).toHaveLength(1);
 await expect(f.core.saveArtifact(f.task.id,{title:'Forged',mimeType:DOCUMENT_SUGGESTIONS_MIME,content:'{}'})).rejects.toThrow('review controls');
});
it('applies a reviewed complete deletion with original encoding, while generic empty saves stay invalid and no-change proposals remain inert',async()=>{
 const f=await fixture({encoding:'utf8'});await f.generate(async()=>'');const task=await f.core.decideDocumentEditSuggestions(await f.decision('accept-all'));
 expect(task.artifacts[0].revisions.at(-1)).toMatchObject({content:'',encoding:'utf8'});expect(task.artifacts[0].revisions).toHaveLength(2);await expect(f.core.saveArtifact(task.id,{title:'Empty generic save',content:'',mimeType:'text/plain'})).rejects.toThrow();
 const g=await fixture();await g.generate(async()=>g.saved.revision.content);const unchanged=await g.core.getTask(g.task.id);expect(unchanged.artifacts[0].revisions).toHaveLength(1);expect(documentSuggestions(unchanged.artifacts[1].revisions.at(-1)!)?.phase).toBe('closed');
});

it.each([undefined,'utf8'] as const)('preserves encoding=%s and nonempty provenance through partial accept, reject, replay and reopen',async encoding=>{
 const f=await fixture({encoding,source:true});await f.generate();const original=(await f.core.getTask(f.task.id)).artifacts[0].revisions[0];
 const command=await f.decision('accept',0);let task=await f.core.decideDocumentEditSuggestions(command);
 expect(task.artifacts[0].revisions.at(-1)?.encoding).toBe(encoding);expect(task.artifacts[0].revisions.at(-1)?.sourceRefs).toEqual(f.refs);expect(documentSuggestions(task.artifacts[1].revisions.at(-1)!)?.target.encoding).toBe(encoding);
 const reject=await f.decision('reject-all');task=await f.core.decideDocumentEditSuggestions(reject);expect(task.artifacts[0].revisions).toHaveLength(2);expect(task.artifacts[0].revisions[0]).toEqual(original);expect(task.artifacts[1].revisions.every(item=>JSON.stringify(item.sourceRefs)===JSON.stringify(f.refs))).toBe(true);
 await f.core.close();const reopened=await createCompanion({dataDir:f.directory});cores.push(reopened);const replay=await reopened.decideDocumentEditSuggestions(reject);expect(replay.artifacts).toEqual(task.artifacts);expect(replay.requests).toEqual(task.requests);expect(replay.sources).toEqual(task.sources);
});
it.each(['advanced','invalidated'] as const)('retains historical provenance when %s sources block acceptance but allow rejection',async mode=>{
 const f=await fixture({source:true});await f.generate();const before=(await f.core.getTask(f.task.id)).artifacts[0];
 if(mode==='advanced')await f.core.putSource(f.task.id,{id:f.refs[0].sourceId,kind:'text',role:'fact',label:'Owned facts',content:'Version2'});else await f.core.invalidateSource(f.task.id,f.refs[0].sourceId,'Synthetic invalidation');
 await expect(f.core.decideDocumentEditSuggestions(await f.decision('accept-all'))).rejects.toThrow();const task=await f.core.decideDocumentEditSuggestions(await f.decision('reject-all'));
 expect(task.artifacts[0]).toEqual(before);expect(task.artifacts[1].revisions.at(-1)?.sourceRefs).toEqual(f.refs);expect(documentSuggestions(task.artifacts[1].revisions.at(-1)!)?.sourceRefs).toEqual(f.refs);
 await expect(f.core.saveArtifact(f.task.id,{title:'Cannot reuse stale sources',content:'New content',sourceRefs:f.refs})).rejects.toThrow();
});
it('serializes inspection after commits and preserves not-observed, applied, stale-unapplied and mismatched intent distinctions',async()=>{
 const f=await fixture();await f.generate();const first=await f.decision('accept',0,'same-intent');expect((await f.core.inspectDocumentEditSuggestionDecision(first)).kind).toBe('not-observed');
 const work=f.core.decideDocumentEditSuggestions(first),inspection=f.core.inspectDocumentEditSuggestionDecision(first);await work;expect((await inspection).kind).toBe('applied');
 await expect(f.core.inspectDocumentEditSuggestionDecision({...first,choice:'reject'})).rejects.toThrow('different action');
 const stale={...first,intentId:'never-applied',index:1};expect((await f.core.inspectDocumentEditSuggestionDecision(stale)).kind).toBe('unapplied-stale');await expect(f.core.decideDocumentEditSuggestions(stale)).rejects.toThrow('decisions changed');
});
it.each(['outer-refs','body-refs','target-encoding','target-title','target-mime','target-refs'] as const)('refuses corrupted %s metadata even when saved text bytes still match',async corruption=>{
 const f=await fixture({source:true,encoding:'utf8'});await f.generate();await f.core.close();
 const path=join(f.directory,'tasks.json'),state=JSON.parse(await readFile(path,'utf8')),task=state.tasks.find((item:any)=>item.id===f.task.id),target=task.artifacts[0].revisions.at(-1),proposal=task.artifacts[1].revisions.at(-1);
 if(corruption==='outer-refs')proposal.sourceRefs=[];
 if(corruption==='body-refs'){const body=JSON.parse(proposal.content);body.sourceRefs=[];proposal.content=JSON.stringify(body);proposal.digest=createHash('sha256').update(proposal.content).digest('hex');}
 if(corruption==='target-encoding')delete target.encoding;if(corruption==='target-title')target.title='Changed metadata';if(corruption==='target-mime')target.mimeType='text/plain';if(corruption==='target-refs')target.sourceRefs=[];
 await writeFile(path,JSON.stringify(state));const reopened=await createCompanion({dataDir:f.directory});cores.push(reopened);
 const command=readDocumentSuggestionDecision({type:'document-suggestions.decide',taskId:f.task.id,proposal:{artifactId:f.prepared.artifactId,revision:proposal.revision,digest:proposal.digest},intentId:'must-not-publish',choice:'accept-all'});
 await expect(reopened.decideDocumentEditSuggestions(command)).rejects.toThrow();expect((await reopened.getTask(f.task.id)).artifacts[0].revisions).toHaveLength(1);
});
it.each(['before','after'] as const)('reconciles %s-publication storage failure after required reopen without duplicating the exact retry',async mode=>{
 const f=await fixture();await f.generate();const command=await f.decision('accept',0),before=await f.core.getTask(f.task.id);faults.mode=mode;
 await expect(f.core.decideDocumentEditSuggestions(command)).rejects.toThrow();faults.mode=undefined;await expect(f.core.getTask(f.task.id)).rejects.toThrow('Close and reopen');await f.core.close();const reopened=await createCompanion({dataDir:f.directory});cores.push(reopened);const durable=await reopened.getTask(f.task.id);if(mode==='before')expect(durable.artifacts).toEqual(before.artifacts);else expect(durable.artifacts[0].revisions).toHaveLength(2);expect(durable.requests).toEqual(before.requests);expect((await reopened.inspectDocumentEditSuggestionDecision(command)).kind).toBe(mode==='before'?'not-observed':'applied');
 const result=await reopened.decideDocumentEditSuggestions(command);expect(result.artifacts[0].revisions).toHaveLength(2);expect(await reopened.decideDocumentEditSuggestions(command)).toEqual(result);
});

// Actual production host is bundled; only Electron/OS/provider boundaries below
// are inert synthetic seams. No live connection, native GUI or provider credit.
it('reaches production allowlist and actual revise producer with a synthetic provider and keeps ordinary revision default',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'suggestions-host-')),root=resolve('.'),key='suggestionHost'+crypto.randomUUID().replaceAll('-',''),out=join(directory,'host.cjs');
 const seam={calls:[] as any[],output:'',desktopCards:[] as any[]};Reflect.set(globalThis,key,seam);const global=`globalThis[${JSON.stringify(key)}]`;
 await symlink(resolve('node_modules'),join(directory,'node_modules'),'dir');await writeFile(join(directory,'character-preferences.json'),JSON.stringify({schemaVersion:1,revision:0,profile:DEFAULT_CHARACTER}));
 const electron=`const noop=()=>{};export const app={getPath:()=>process.env.WINDOW_COMPANION_DATA_DIR,setPath:noop,isReady:()=>false,disableHardwareAcceleration:noop,isHardwareAccelerationEnabled:()=>true,whenReady:()=>new Promise(()=>{}),on:noop,quit:noop};export const BrowserWindow=class{};export class Notification{static isSupported(){return true;}constructor(options){this.record={options,listeners:new Map(),shown:0};${global}.desktopCards.push(this.record);}on(event,callback){this.record.listeners.set(event,callback);return this;}show(){this.record.shown++;}close(){this.record.listeners.get('close')?.();}};export const clipboard={};export const ClipboardItem=class{};export const Menu=undefined;export const Tray=class{};export const dialog={showMessageBox:async()=>({response:1})};export const globalShortcut={register:()=>true,unregister:noop,unregisterAll:noop};export const ipcMain={};export const nativeImage={};export const safeStorage={};export const screen={getDisplayMatching:()=>({workArea:{x:0,y:0,width:1000,height:800}})};export const session={};export const systemPreferences={isTrustedAccessibilityClient:()=>false};`;
 const provider=`export const buildCodexInput=()=>[];export class MetaProvider{async status(){return {configured:true,provider:'Synthetic',endpoint:'fixture://no-network',model:'synthetic',state:'ready'}};async accountScope(){return 'synthetic'};async run(input){${global}.calls.push(input);return ${global}.output};reset(){};close(){}};export class CodexProvider extends MetaProvider{}`;
 await build({stdin:{contents:await readFile(join(root,'src/host/index.ts'),'utf8')+'\nexport {validate,command,createCompanion};export const initialize=async c=>{core=c;captureSettings=await CaptureSettings.open(dataDir);botPreferences=await BotPreferences.open(dataDir,core);panel={isDestroyed:()=>false,webContents:{send:()=>{}}}};',resolveDir:join(root,'src/host'),loader:'ts'},bundle:true,platform:'node',format:'cjs',packages:'external',outfile:out,define:{'import.meta.url':JSON.stringify(pathToFileURL(out).href)},plugins:[{name:'owned-synthetic-boundaries',setup(b){b.onResolve({filter:/^(electron|\.\/provider|\.\/codex-provider|\.\/native)$/},args=>({path:args.path,namespace:'synthetic'}));b.onLoad({filter:/.*/,namespace:'synthetic'},args=>({contents:args.path==='electron'?electron:args.path==='./native'?'export class NativeSourceAdapter{};export const placeCompanion=()=>({});':provider,loader:'js'}));}}]});
 const previous=process.env.WINDOW_COMPANION_DATA_DIR;process.env.WINDOW_COMPANION_DATA_DIR=directory;let host:any;try{host=createRequire(pathToFileURL(out))(out);}finally{if(previous===undefined)delete process.env.WINDOW_COMPANION_DATA_DIR;else process.env.WINDOW_COMPANION_DATA_DIR=previous;}
 const core:Companion=await host.createCompanion({dataDir:join(directory,'store')});cores.push(core);await host.initialize(core);const created=await core.createTask({title:'Synthetic host doc'}),task=await core.putSource(created.id,{kind:'text',role:'fact',label:'Correction reference',content:'first and last'}),source=task.sources[0],refs=[{sourceId:source.id,version:source.currentVersion,digest:source.versions.at(-1)!.digest}],generated=await core.runRequest({taskId:task.id,requestId:'host-original',kind:'create',prompt:'Write the original document.',sourceIds:refs.map(ref=>ref.sourceId),expectedSourceRefs:refs},async()=>({title:'Owned document',content:'old\nkeep\nold\n',mimeType:'text/markdown'}));expect(generated.status,generated.error).toBe('completed');const original=(await core.getTask(task.id)).artifacts.find(artifact=>artifact.id===generated.artifactId)!,saved={artifactId:original.id,revision:original.revisions[0]},basis=savedDocumentDraftBasis(await core.getTask(task.id),saved.artifactId,saved.revision),command={type:'model.run',taskId:task.id,requestId:'actual-host-suggestions',kind:'revise',prompt:'Change first and last',artifactId:saved.artifactId,sourceIds:refs.map(ref=>ref.sourceId),expectedSourceRefs:refs,revisionBasis:basis,suggestEdits:true};
 seam.output=JSON.stringify({content:'first\nkeep\nlast\n',evidence:[{reason:'Correct opening from reference.',anchors:[{...refs[0],start:0,quote:'first'}]},{reason:'Correct closing from reference.',anchors:[{...refs[0],start:10,quote:'last'}]}]});
 for(const invalid of [{...command,suggestEdits:false},{...command,kind:'create'},{...command,revisionBasis:undefined},{...command,permissions:['network']}])expect(()=>host.validate(invalid)).toThrow();
 const result=await host.command(host.validate(command));expect(result.artifacts[0].revisions).toHaveLength(1);expect(documentSuggestions(result.artifacts[1].revisions.at(-1))).toMatchObject({phase:'ready',requestId:command.requestId});expect(seam.calls).toHaveLength(1);expect(seam.calls[0].sources.at(-1).content).toBe(saved.revision.content);
 const proposal=result.artifacts[1].revisions.at(-1),accept={type:'document-suggestions.decide',taskId:task.id,proposal:{artifactId:result.artifacts[1].id,revision:proposal.revision,digest:proposal.digest},intentId:'host-accept',choice:'accept',index:0};
 const accepted=await host.command(host.validate(accept));expect(accepted.artifacts[0].revisions.at(-1).content).toBe('first\nkeep\nold\n');expect((await host.command(host.validate({type:'document-suggestions.inspect',decision:accept}))).kind).toBe('applied');
 const next=accepted.artifacts[1].revisions.at(-1),rejected=await host.command(host.validate({type:'document-suggestions.decide',taskId:task.id,proposal:{artifactId:result.artifacts[1].id,revision:next.revision,digest:next.digest},intentId:'host-reject-rest',choice:'reject-all'}));expect(rejected.artifacts[0].revisions).toHaveLength(2);expect(seam.calls).toHaveLength(1);
 seam.output='first\nkeep\nlast\n';const current=rejected.artifacts[0].revisions.at(-1);await host.command(host.validate({...command,requestId:'ordinary-revise',suggestEdits:undefined,revisionBasis:savedDocumentDraftBasis(rejected,saved.artifactId,current)}));expect((await core.getTask(task.id)).artifacts[0].revisions).toHaveLength(3);expect(seam.desktopCards).toEqual([]);Reflect.deleteProperty(globalThis,key);
});

async function undoDecision(f:Awaited<ReturnType<typeof fixture>>,intentId='undo-'+crypto.randomUUID()){
 const task=await f.core.getTask(f.task.id),proposal=task.artifacts.find(artifact=>artifact.id===f.prepared.artifactId)!.revisions.at(-1)!,body=documentSuggestions(proposal)!;
 return readDocumentSuggestionDecision({type:'document-suggestions.decide',taskId:task.id,proposal:{artifactId:f.prepared.artifactId,revision:proposal.revision,digest:proposal.digest},intentId,choice:'undo',undoOf:body.undo?.intentId,undoTarget:body.undo?.target});
}
it('undoes only the latest acceptance, retaining earlier accepted changes and later rejection, with replay/reopen receipts',async()=>{
 const f=await fixture();await f.generate();await f.core.decideDocumentEditSuggestions(await f.decision('accept',0));await f.core.decideDocumentEditSuggestions(await f.decision('accept',1));
 const undo=await undoDecision(f,'exact-undo'),task=await f.core.decideDocumentEditSuggestions(undo);
 expect(task.artifacts[0].revisions.at(-1)?.content).toBe('first\nkeep\nold\n');expect(documentSuggestions(task.artifacts[1].revisions.at(-1)!)?.decisions).toEqual(['accepted','pending']);expect((await f.core.inspectDocumentEditSuggestionDecision(undo)).kind).toBe('applied');
 expect((await f.core.decideDocumentEditSuggestions(undo)).artifacts).toEqual(task.artifacts);await f.core.close();const reopened=await createCompanion({dataDir:f.directory});cores.push(reopened);expect((await reopened.decideDocumentEditSuggestions(undo)).artifacts).toEqual(task.artifacts);
 const g=await fixture();await g.generate();await g.core.decideDocumentEditSuggestions(await g.decision('accept',0));await g.core.decideDocumentEditSuggestions(await g.decision('reject-all'));const restored=await g.core.decideDocumentEditSuggestions(await undoDecision(g));
 expect(restored.artifacts[0].revisions.at(-1)?.content).toBe(g.saved.revision.content);expect(documentSuggestions(restored.artifacts[1].revisions.at(-1)!)?.decisions).toEqual(['pending','rejected']);
});
it.each(['target','source','receipt'] as const)('blocks undo after %s changes without overwriting the document',async change=>{
 const f=await fixture();await f.generate();await f.core.decideDocumentEditSuggestions(await f.decision('accept-all'));let undo=await undoDecision(f);
 if(change==='target')await f.core.saveArtifact(f.task.id,{artifactId:f.saved.artifactId,expectedRevision:2,title:'Owned document',content:'A newer manual edit',mimeType:'text/markdown',sourceRefs:f.refs});
 if(change==='source')await f.core.invalidateSource(f.task.id,f.refs[0].sourceId,'Changed source');
 if(change==='receipt')undo={...undo,undoOf:'different-acceptance'};
 const before=(await f.core.getTask(f.task.id)).artifacts;await expect(f.core.decideDocumentEditSuggestions(undo)).rejects.toThrow();expect((await f.core.getTask(f.task.id)).artifacts).toEqual(before);
});
it.each(['before','after'] as const)('recovers an uncertain undo %s durable publication through the original exact intent',async mode=>{
 const f=await fixture();await f.generate();await f.core.decideDocumentEditSuggestions(await f.decision('accept-all'));const undo=await undoDecision(f);faults.mode=mode;await expect(f.core.decideDocumentEditSuggestions(undo)).rejects.toThrow();faults.mode=undefined;await f.core.close();const reopened=await createCompanion({dataDir:f.directory});cores.push(reopened);
 expect((await reopened.inspectDocumentEditSuggestionDecision(undo)).kind).toBe(mode==='after'?'applied':'not-observed');await reopened.decideDocumentEditSuggestions(undo);const task=await reopened.getTask(f.task.id);expect(task.artifacts[0].revisions).toHaveLength(3);expect(task.artifacts[0].revisions.at(-1)?.content).toBe(f.saved.revision.content);
});
it.each(['missing','quote','offset','reference'] as const)('refuses %s per-hunk evidence before publishing a candidate',async invalid=>{
 const f=await fixture(),task=await f.core.getTask(f.task.id),plan=(await prepareDocumentSuggestions(f.core,task,{type:'model.run',taskId:task.id,requestId:f.input.requestId,kind:'revise',prompt:f.input.prompt,artifactId:f.saved.artifactId,revisionBasis:f.input.basis,sourceIds:f.refs.map(ref=>ref.sourceId),expectedSourceRefs:f.refs,suggestEdits:true},()=>{}))!;
 const anchor={...f.refs[0],start:0,quote:'Version1'},item={reason:'The selected reference supplies the correction.',anchors:[anchor]},evidence=invalid==='missing'?[]:[structuredClone(item),structuredClone(item)];
 if(invalid==='quote')evidence[0].anchors[0].quote='Invented quote';if(invalid==='offset')evidence[0].anchors[0].start=1;if(invalid==='reference')evidence[0].anchors[0].sourceId='unselected-source';
 const result=await f.core.runRequest(plan.request,async ctx=>plan.bind(ctx.task).finish(JSON.stringify({content:'first\nkeep\nlast\n',evidence})));
 expect(result.status).toBe('failed');const after=await f.core.getTask(task.id);expect(after.artifacts[0].revisions).toHaveLength(1);expect(documentSuggestions(after.artifacts[1].revisions.at(-1)!)?.phase).toBe('pending');
});
it('never recovers a filtered target or proposal through a raw task fallback',async()=>{
 const f=await fixture(),task=await f.core.getTask(f.task.id),plan=(await prepareDocumentSuggestions(f.core,task,{type:'model.run',taskId:task.id,requestId:f.input.requestId,kind:'revise',prompt:f.input.prompt,artifactId:f.saved.artifactId,revisionBasis:f.input.basis,sourceIds:f.refs.map(ref=>ref.sourceId),expectedSourceRefs:f.refs,suggestEdits:true},()=>{}))!;
 for(const id of [f.saved.artifactId,f.prepared.artifactId])expect(()=>plan.bind({...task,artifacts:task.artifacts.filter(artifact=>artifact.id!==id)})).toThrow('unavailable');
 expect(()=>plan.bind(projectRequestTask(task,[]))).toThrow('unavailable');
});
it('keeps legacy proposals inspectable and rejectable while refusing evidence-free acceptance',async()=>{
 const f=await fixture();await f.core.runRequest({taskId:f.task.id,requestId:f.input.requestId,kind:'revise',prompt:f.input.prompt,artifactId:f.prepared.artifactId,expectedRevision:1,sourceIds:f.refs.map(ref=>ref.sourceId),expectedSourceRefs:f.refs},async()=>({title:'Historical proposal',content:JSON.stringify(finishDocumentSuggestions(f.prepared.body,'first\nkeep\nlast\n')),mimeType:DOCUMENT_SUGGESTIONS_MIME}));
 await expect(f.core.decideDocumentEditSuggestions(await f.decision('accept-all'))).rejects.toThrow('no quoted evidence');await f.core.decideDocumentEditSuggestions(await f.decision('reject-all'));expect((await f.core.getTask(f.task.id)).artifacts[0].revisions).toHaveLength(1);
});

it.each(['source','skill'] as const)('preserves generated target lineage through pending, empty apply, metadata rejection and undo before %s withdrawal',async withdrawal=>{
 const directory=await mkdtemp(join(tmpdir(),'suggestion-lineage-')),core=await createCompanion({dataDir:directory});cores.push(core);const created=await core.createTask({title:'Lineage correction'}),sourced=await core.putSource(created.id,{id:'facts',kind:'text',role:'fact',label:'Exact facts',content:'Remove the obsolete paragraph.'}),version=sourced.sources[0].versions[0],refs=[{sourceId:version.id,version:version.version,digest:version.digest}];
 const skill=await core.saveInstructionSkill({taskId:created.id,intentId:'correction-skill',name:'Document style',description:'Synthetic lineage',instructions:'Use plain language.',resources:[]});await core.setInstructionSkill(created.id,0,skill.reference);
 const generated=await core.runRequest({taskId:created.id,requestId:'generated-document',kind:'create',prompt:'Write the paragraph.',sourceIds:['facts'],instructionSkill:skill.reference,instructionSkillRevision:1},async()=>({title:'Generated document',content:'Obsolete paragraph.\n',mimeType:'text/markdown'}));expect(generated.status).toBe('completed');
 const task=await core.getTask(created.id),target=task.artifacts.find(item=>item.id===generated.answer!.artifactId)!,revision=target.revisions[0],basis=savedDocumentDraftBasis(task,target.id,revision),plan=(await prepareDocumentSuggestions(core,task,{type:'model.run',taskId:task.id,requestId:'lineage-proposal',kind:'revise',prompt:'Remove obsolete paragraph.',artifactId:target.id,revisionBasis:basis,sourceIds:['facts'],expectedSourceRefs:refs,suggestEdits:true},()=>{}))!;
 let current=await core.getTask(task.id);const pending=current.artifacts.find(item=>item.id===plan.request.artifactId)!;expect(pending.revisions[0].contextSkillRefs).toEqual([skill.reference]);expect(pending.revisions[0].contextSourceRefs).toEqual(refs);
 expect((await core.runRequest(plan.request,async ctx=>plan.bind(ctx.task).finish(JSON.stringify({content:'',evidence:[{reason:'The reference explicitly withdraws the paragraph.',anchors:[{...refs[0],start:0,quote:'Remove the obsolete paragraph.'}]}]})))).status).toBe('completed');
 const command=async(choice:'accept-all'|'undo',intentId:string)=>{current=await core.getTask(task.id);const proposal=current.artifacts.find(item=>item.id===pending.id)!.revisions.at(-1)!,body=documentSuggestions(proposal)!;return readDocumentSuggestionDecision({type:'document-suggestions.decide',taskId:task.id,proposal:{artifactId:pending.id,revision:proposal.revision,digest:proposal.digest},intentId,choice,...(choice==='undo'?{undoOf:body.undo!.intentId,undoTarget:body.undo!.target}:{})});};
 await core.decideDocumentEditSuggestions(await command('accept-all','apply-empty'));await core.decideDocumentEditSuggestions(await command('undo','undo-empty'));current=await core.getTask(task.id);
 for(const id of [target.id,pending.id])for(const saved of current.artifacts.find(item=>item.id===id)!.revisions){expect(saved.contextSkillRefs).toEqual([skill.reference]);expect(saved.contextSourceRefs).toEqual(refs);}
 const accept=await command('accept-all','after-withdrawal');if(withdrawal==='skill')await core.setInstructionSkill(task.id,1,null);else await core.revokeSource(task.id,'facts');await expect(core.decideDocumentEditSuggestions(accept)).rejects.toThrow();
 current=await core.getTask(task.id);const projected=projectRequestTask(current,withdrawal==='skill'?refs:[],[current],withdrawal==='skill'?null:skill.reference);expect(projected.artifacts.some(item=>item.id===target.id||item.id===pending.id)).toBe(false);
 const latest=current.artifacts.find(item=>item.id===target.id)!.revisions.at(-1)!;await expect(core.beginDocumentEditSuggestions({taskId:task.id,artifactId:target.id,basis:savedDocumentDraftBasis(current,target.id,latest),requestId:'after-withdrawal',prompt:'Try again.'})).rejects.toThrow();
});
