import {reviewBrowserContinuation,prepareBrowserContinuation} from '../src/shared/browser-continuation';
import {prepareRequestFollowup} from '../src/shared/request-followup';
import {recognizeRangeSum,rangeSumVariables,RANGE_SUM_FORMULA,RANGE_SUM_ASSUMPTION} from '../src/learning/python-range-sum';
import {browserReviewNotesPreview} from '../src/shared/browser-review-notes';
import {emptyTaskSession} from '../src/core/task-session';
import {responseBranchSnapshot} from '../src/core/response-branch'
import {afterEach,describe,expect,it,vi} from 'vitest'
import {build} from 'esbuild'
import {mkdtemp,mkdir,readFile,rm,rename,writeFile,symlink,realpath} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createRequire} from 'node:module'
import {evictHostFixture} from './host-fixture-module-cache'
import {sourceTextSavePayload,sourceTextSaveBindingText,SOURCE_TEXT_SAVE_BINDING_PREFIX} from '../src/shared/source-text-save'
import {randomUUID,createHash} from 'node:crypto'
import {tmpdir} from 'node:os'
import type {Companion} from '../src/core/companion'
import type {Task} from '../src/core/types'
import type {Command} from '../src/shared/bridge'
import {placeCompanion,type NativeWindow} from '../src/host/native'
import {windowMetadataToken} from '../src/host/window-metadata'
import {MetaProvider} from '../src/host/provider'
import {CodexProvider,type CodexConnection} from '../src/host/codex-provider'
import {DEFAULT_CHARACTER} from '../src/shared/character-catalog'
import {localTaskDraftOwner,localTaskDraftBasis,emptyLocalTaskDraft,LOCAL_TASK_DRAFT_SLOT} from '../src/shared/local-task-draft'
import {serializeLearningDraftJson} from '../src/shared/learning-drafts'
import {largeWindowForm,fourColumnLesson,sqlSlot} from './raw-form-capacity.fixture'
import {navigationFormBasis} from '../src/renderer/src/learning-draft-basis'
import {WINDOW_WORKFLOW_MIME} from '../src/shared/window-workflow-artifact'
import {savedDocumentDraftOwner,savedDocumentDraftBasis} from '../src/shared/saved-document-draft'
import {REVISION_INSTRUCTIONS_SLOT,emptyRevisionInstructions} from '../src/shared/revision-instructions'
import {CONCEPT_MAP_MIME,CONCEPT_MAP_PROMPT,CONCEPT_MAP_PROGRESS,readConceptMap} from '../src/shared/concept-map';
import {conceptProposal,conceptSource} from './concept-map.fixture';

const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const done of cleanups.splice(0).reverse())await done();});
export type ControlledTurn={delta:(text:string)=>void;finish:(text:string)=>void;calls:Array<{method:string;params:Record<string,any>}>;connection:CodexConnection;};
function controlledConnection(id:string,turns:Map<string,ControlledTurn>):CodexConnection{
 const listeners=new Set<(message:{method:string;params:Record<string,any>})=>void>(),calls:Array<{method:string;params:Record<string,any>}>=[],emit=(method:string,params:Record<string,any>)=>{for(const listener of listeners)listener({method,params:{threadId:'thread-'+id,...params}});};
 const owned:ControlledTurn={calls,connection:undefined!,delta:text=>{emit('item/started',{turnId:'turn-'+id,item:{id:'answer-'+id,type:'agentMessage',phase:'final_answer'}});emit('item/agentMessage/delta',{turnId:'turn-'+id,itemId:'answer-'+id,delta:text});},finish:text=>{emit('item/completed',{item:{type:'agentMessage',id:'answer-'+id,phase:'final_answer',text}});emit('turn/completed',{turn:{id:'turn-'+id,status:'completed'}});}};
 const connection:CodexConnection={request:async(method,params)=>{calls.push({method,params});if(method==='initialize')return {};if(method==='account/read')return {account:{type:'chatgpt',email:'synthetic@example.invalid'}};if(method==='model/list')return {data:[{model:'gpt-6-luna',serviceTiers:[{id:'default',name:'Standard'},{id:'priority',name:'Fast'}],supportedReasoningEfforts:[{reasoningEffort:'medium'}]}]};if(method==='thread/start')return {model:params.model,serviceTier:params.serviceTier,reasoningEffort:(params.config as any)?.model_reasoning_effort,sandbox:{type:'readOnly'},thread:{id:'thread-'+id},instructionSources:[]};if(method==='turn/start'){const prompt=[...(params.input as any[])].reverse().find((part:any)=>part.type==='text')?.text;if(typeof prompt!=='string'||!prompt.startsWith('User task: '))throw Error('Missing actual outgoing user task');turns.set(prompt.slice(11).split('\n\nHost question protocol:')[0],owned);queueMicrotask(()=>emit('turn/started',{turn:{id:'turn-'+id}}));return {turn:{id:'turn-'+id}};}if(method==='turn/interrupt'){queueMicrotask(()=>emit('turn/completed',{turn:{id:'turn-'+id,status:'interrupted'}}));return {};}throw Error('Unexpected controlled RPC '+method);},notify:()=>{},subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},close:()=>{}};owned.connection=connection;return connection;
}
export async function concurrentHost(settingsBytes?:string){
  const root=resolve('.'),flights=new Set<Promise<unknown>>()
  const dir=await mkdtemp(join(tmpdir(),'setup-host-boundary-')),key='hostBoundary'+randomUUID().replaceAll('-','')
  cleanups.push(()=>rm(dir,{recursive:true,force:true}))
  const loadProject=createRequire(pathToFileURL(join(root,'package.json'))),effectPackage=await realpath(loadProject.resolve('effect/package.json'))
  let dependencies:string|undefined
  for(const directory of loadProject.resolve.paths('effect')??[]){
    if(await realpath(join(directory,'effect','package.json')).catch(()=>undefined)!==effectPackage)continue
    dependencies=await realpath(directory);break
  }
  if(!dependencies)throw Error('The project dependency directory could not be resolved.')
  await symlink(dependencies,join(dir,'node_modules'),'dir')
  if(settingsBytes!==undefined)await writeFile(join(dir,'capture-settings.json'),settingsBytes);
  // These command tests start with a chosen legacy appearance; first-run setup has its own journey.
  await writeFile(join(dir,'character-preferences.json'),JSON.stringify({schemaVersion:1,revision:0,profile:DEFAULT_CHARACTER}));
  const calls={saveDialogs:[] as any[],confirmations:[] as string[],details:[] as any[],provider:[] as any[],captures:0,presentationCaptures:0,shows:0,quitCalls:0,events:[] as any[]}
  let configured=true,response=1,bytes=1024*1024,label='capture-A',output='Synthetic completed output'
  const window=(id:string)=>({id,title:'Unchanged synthetic title',owner:{name:'Owned synthetic source',processId:1},documentToken:'constant-metadata',bounds:{x:0,y:0,width:100,height:100}})
  const turns=new Map<string,ControlledTurn>();let sequence=0;
  const seams={
    connect:async()=>controlledConnection(String(++sequence),turns),fetch:async()=>{throw Error('Unexpected unconfigured Meta fixture transport');},
    registeredShortcuts:new Map<string,()=>void>(),settingsSyncFail:false,settingsRenameFail:false,settingsDirectory:dir,settingsRead:undefined as undefined|(()=>Promise<void>),storeBeforeRename:undefined as undefined|(()=>Promise<void>),applicationPath:undefined as undefined|((path:string)=>Promise<void>),
    openDialog:async(_panel:unknown,_detail:any)=>({canceled:true,filePaths:[] as string[]}),
    saveDialog:async(_panel:unknown,detail:any)=>{calls.saveDialogs.push(detail);return {canceled:true,filePath:undefined as string|undefined}},
    confirm:async(_panel:unknown,detail:any)=>{calls.confirmations.push(detail.message);calls.details.push(detail);return {response}},
    recurringAccount:'opaque-fixture-account',accountScope:async()=>seams.recurringAccount,
    status:async()=>({configured,provider:'Codex (temporary)',endpoint:'fixture://no-network',model:'fixture',state:'ready'}),
    run:async(input:any)=>{await input.captureFence?.check();input.captureFence?.assertCurrent();calls.provider.push(input);return output},placeCompanion,quitCalls:0,quitFlush:undefined as undefined|((id:string)=>void),autoPresentation:true,presentationCapture:async()=>({toDataURL:()=>''}),
    native:{foregroundWindow:async()=>window('window:1'),listWindows:async()=>[window('window:1'),window('window:2')],permissionStatus:async()=>({screen:'granted'}),inspect:async(id:string)=>window(id),capture:async(id:string,options?:{beforeCapture?:()=>Promise<void>;assertCurrent?:()=>void})=>{await options?.beforeCapture?.();options?.assertCurrent?.();calls.captures++;return {source:window(id),sourceVersion:label,capturedAt:new Date().toISOString(),png:Buffer.alloc(bytes),dataUrl:'data:image/png;base64,'+Buffer.from(label).toString('base64'),imageSha256:label,transform:{fixture:true}}}},
  }
  Reflect.set(globalThis,key,seams)
  const seam=`globalThis[${JSON.stringify(key)}]`
  const electron=`const noop=()=>{};export const app={getPath:()=>process.env.WINDOW_COMPANION_DATA_DIR,setPath:noop,isReady:()=>false,disableHardwareAcceleration:noop,isHardwareAccelerationEnabled:()=>true,whenReady:()=>new Promise(()=>{}),on:noop,quit:()=>{${seam}.quitCalls++}};export const BrowserWindow=class {};export const Notification={isSupported:()=>false};export const Menu=undefined;export const dialog={showOpenDialog:(...a)=>${seam}.openDialog(...a),showSaveDialog:(...a)=>${seam}.saveDialog(...a),showMessageBox:(...a)=>${seam}.confirm(...a)};export const Tray=class{};export const systemPreferences={isTrustedAccessibilityClient:()=>false};export const globalShortcut={unregisterAll:()=>${seam}.registeredShortcuts.clear(),unregister:key=>${seam}.registeredShortcuts.delete(key),register:(key,callback)=>{${seam}.registeredShortcuts.set(key,callback);return true}};export const ipcMain={};export const clipboard={writeText:()=>{throw Error('Unexpected clipboard boundary');}};export class ClipboardItem{};export const nativeImage={};export const safeStorage={};export const screen={getDisplayMatching:()=>({workArea:{x:0,y:0,width:1800,height:1100}})};export const session={};`
  const unusedProvider=`export class MetaProvider{accountScope(){return ${seam}.accountScope()};status(){return ${seam}.status()};run(input){return ${seam}.run(input)};reset(){};close(){}};export class CodexProvider extends MetaProvider{}`
  const native=`export class NativeSourceAdapter{inspectProtection(id,pid){return Promise.resolve({osId:Number(id.split(':')[1]),processId:pid,knownProtected:false})};foregroundWindow(){return ${seam}.native.foregroundWindow()};listWindows(){return ${seam}.native.listWindows()};inspect(id){return ${seam}.native.inspect(id)};capture(id,o){return ${seam}.native.capture(id,o)};permissionStatus(){return ${seam}.native.permissionStatus()}};export const placeCompanion=(...a)=>${seam}.placeCompanion(...a);`
  const captureFs=`import * as fs from 'node:fs/promises';export const mkdir=fs.mkdir,rm=fs.rm;export const readFile=async(...args)=>{await ${seam}.settingsRead?.();return fs.readFile(...args);};export const rename=async(...args)=>{if(${seam}.settingsRenameFail){${seam}.settingsRenameFail=false;throw Error('Synthetic settings replacement failed');}return fs.rename(...args);};export const open=async(...args)=>{const handle=await fs.open(...args);if(args[1]==='r'&&${seam}.settingsSyncFail){${seam}.settingsSyncFail=false;handle.sync=async()=>{throw Error('Synthetic settings directory sync failed');};}return handle;};`
  const storeFs=`import * as fs from 'node:fs/promises';export const mkdir=fs.mkdir,open=fs.open,readFile=fs.readFile,rm=fs.rm;export const rename=async(...args)=>{await ${seam}.storeBeforeRename?.();return fs.rename(...args);};`
  const hostFs=`import * as fs from 'node:fs/promises';export const mkdir=fs.mkdir,readFile=fs.readFile,writeFile=fs.writeFile,rm=fs.rm;export const realpath=async(path,...args)=>{await ${seam}.applicationPath?.(String(path));return fs.realpath(path,...args);};`
  const outfile=join(dir,'host-under-test.cjs')
  const hostSource=await readFile(join(root,'src/host/index.ts'),'utf8');expect(hostSource.split('new MetaProvider({getKey,')).toHaveLength(2);expect(hostSource.split('new CodexProvider({enabled:()=>!connectionDisabled,allowUserInstructionFile:true,serviceTier:')).toHaveLength(3);
  await build({stdin:{contents:hostSource.replace('new MetaProvider({getKey,','new MetaProvider({getKey:async()=>'+JSON.stringify('synthetic-key')+',fetch:'+seam+'.fetch,').replaceAll('new CodexProvider({enabled:()=>!connectionDisabled,allowUserInstructionFile:true,serviceTier:', 'new CodexProvider({connect:'+seam+'.connect,enabled:()=>!connectionDisabled,allowUserInstructionFile:false,serviceTier:')+'\nexport {command,dispatchCompanionCommand,validate,createCompanion,attach,monitorAttached,activateShortcut,stopForQuit,beginQuit,quitDrafts,recurringWorkRunner};export const resumeForTest=()=>{quitting=false};export const stopMonitor=()=>{if(monitor)clearInterval(monitor)};export const setCore=async c=>{core=c;captureSettings=await CaptureSettings.open(dataDir);botPreferences=await BotPreferences.open(dataDir,core)};export const setPanel=p=>{panel=p};export const setLocalTaskOwnerForTest=()=>{botPreferences={read:async()=>({kind:"available",current:{kind:"ready",defaultBotId:"synthetic-owned-companion"}})}};export const captureCache=captures;export const setBrowserServiceForTest=value=>{browserService=value};export const invokeCompanionForTest=value=>dispatchCompanionCommand({sender:panel.webContents,senderFrame:panel.webContents.mainFrame},value);',resolveDir:join(root,'src/host'),sourcefile:join(root,'src/host/index.ts'),loader:'ts'},bundle:true,platform:'node',format:'cjs',define:{'import.meta.url':JSON.stringify(pathToFileURL(outfile).href)},packages:'external',outfile,plugins:[{name:'inert-host-boundaries',setup(b){b.onResolve({filter:/^node:fs\/promises$/},a=>a.importer.endsWith('/capture-settings.ts')?{path:a.path,namespace:'fixture-fs'}:a.importer.endsWith('/core/store.ts')?{path:a.path,namespace:'fixture-store-fs'}:a.importer.endsWith('/index.ts')?{path:a.path,namespace:'fixture-host-fs'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture-fs'},()=>({contents:captureFs,loader:'js'}));b.onLoad({filter:/.*/,namespace:'fixture-store-fs'},()=>({contents:storeFs,loader:'js'}));b.onLoad({filter:/.*/,namespace:'fixture-host-fs'},()=>({contents:hostFs,loader:'js'}));b.onResolve({filter:/^(electron|\.\/native)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='electron'?electron:native,loader:'js'}))}}]})
  const previous=process.env.WINDOW_COMPANION_DATA_DIR;process.env.WINDOW_COMPANION_DATA_DIR=dir
  let host:any;const loadHost=createRequire(pathToFileURL(outfile));
  try{host=loadHost(outfile)}finally{if(previous===undefined)delete process.env.WINDOW_COMPANION_DATA_DIR;else process.env.WINDOW_COMPANION_DATA_DIR=previous}
  let core:Companion=await host.createCompanion({dataDir:join(dir,'store')});await host.setCore(core)
  let bounds={x:1350,y:20,width:430,height:760},minimum=[360,500]
  let visible=true;const presentationAcks:Promise<unknown>[]=[];
  host.setPanel({isDestroyed:()=>false,isVisible:()=>visible,hide:()=>{visible=false},setAlwaysOnTop:()=>{},webContents:{isLoading:()=>false,capturePage:async()=>{calls.presentationCaptures++;return seams.presentationCapture();},send:(_topic:string,event:any)=>{calls.events.push(event);if(event.type==='draft.flush')seams.quitFlush?.(event.quitId);if(event.type==='presentation.prepare'&&seams.autoPresentation)presentationAcks.push(host.command({type:'presentation.capture',exitId:event.exitId}));if(event.type==='presentation.exit'&&seams.autoPresentation)presentationAcks.push(host.command({type:'presentation.finish',exitId:event.exitId}).then(()=>event.purpose==='collapse'?host.command({type:'presentation.reveal',exitId:event.exitId}):null));if(event.type==='presentation.enter')presentationAcks.push(host.command({type:'presentation.show',entranceId:event.entranceId}));}},setMinimumSize:(w:number,h:number)=>{minimum=[w,h]},setBounds:(b:typeof bounds)=>{bounds=b},getBounds:()=>bounds,getSize:()=>[bounds.width,bounds.height],show:()=>{visible=true;calls.shows++},showInactive:()=>{visible=true}})
  cleanups.push(async()=>{host.stopMonitor();await host.recurringWorkRunner.stop();await host.stopForQuit();await Promise.allSettled([...flights]);await core.close();evictHostFixture(loadHost,outfile);Reflect.deleteProperty(globalThis,key)})
  const command=async(c:unknown):Promise<any>=>host.command(host.validate(c))
  return {get core(){return core;},readyForCreate:()=>host.setLocalTaskOwnerForTest(),reopen:async()=>{await core.close();core=await host.createCompanion({dataDir:join(dir,'store')});await host.setCore(core);},command,turns,setBrowserService:(value:unknown)=>host.setBrowserServiceForTest({close:async()=>{},...(value as object)}),ipcCommand:(value:unknown)=>{const work=host.invokeCompanionForTest(value);flights.add(work);void work.finally(()=>flights.delete(work)).catch(()=>{});return work;},untrustedCommand:(value:unknown)=>host.dispatchCompanionCommand({sender:{},senderFrame:{}},value),calls,seams,recurringWorkRunner:host.recurringWorkRunner,directory:dir,stop:host.stopForQuit,beginQuit:host.beginQuit,barrier:host.quitDrafts,resume:host.resumeForTest,hide:()=>{visible=false;},nativeQuitCalls:()=>seams.quitCalls,shortcut:host.activateShortcut,settlePresentation:async()=>{await Promise.resolve();for(let index=0;index<presentationAcks.length;index++)await presentationAcks[index]},bounds:()=>bounds,minimum:()=>minimum,attach:host.attach,monitor:host.monitorAttached,cache:host.captureCache as Map<string,any>,setConfigured:(v:boolean)=>{configured=v},setResponse:(v:number)=>{response=v},setOutput:(v:string)=>{output=v},setCapture:(size:number,name:string)=>{bytes=size;label=name}}
}
