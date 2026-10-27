import {app,BrowserWindow,Menu,Tray,dialog,globalShortcut,ipcMain,nativeImage,safeStorage,screen,session,systemPreferences} from 'electron'
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises'
import {mkdirSync} from 'node:fs'
import {join,resolve,basename} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {createCompanion,evaluateExperiment,type Companion} from '../core/companion'
import type {SourceInput,SourceVersion,Task} from '../core/types'
import {NativeSourceAdapter,placeCompanion,type NativeCapture} from './native'
import type {NativeWindow} from './native'
import {chooseContextTarget,chooseShortcutTarget,isCompanionWindow,sameWindowIdentity} from './context-target'
import {createQuitDraftBarrier} from './quit-drafts'
import {createModifierShortcut,modifierKeymap} from './modifier-shortcut'
import {trayImageDataUrl} from './tray-image'
import {MetaProvider} from './provider'
import {CodexProvider} from './codex-provider'
import {parseModelDraft,structuredPrompt} from '../core/model-drafts'
import {parseScreenBriefModel,screenBriefInsight,screenBriefPrompt} from '../core/screen-brief'
import {editModule,saveModuleDocument} from '../core/module-state'
import type {BrowserService} from './browser/service'
import type {Command,CompanionEvent,HostStatus,AttachedWindow,CompactFitBounds} from '../shared/bridge'
import {publicErrorMessage} from '../shared/public-messages'
import type {ExportReply} from '../shared/export-contract'

const here=fileURLToPath(new URL('.',import.meta.url))
const dataDir=resolve(process.env.WINDOW_COMPANION_DATA_DIR || (app.isPackaged?join(app.getPath('userData'),'tasks'):join(here,'../../.runtime')))
mkdirSync(join(dataDir,'profile'),{recursive:true,mode:0o700})
app.setPath('userData',join(dataDir,'profile'))
app.setPath('sessionData',join(dataDir,'profile'))
const native=new NativeSourceAdapter()
// Disposable integration instances must not compete with the user's running app for input.
const testNoGlobalInput=process.env.WINDOW_COMPANION_TEST_NO_GLOBAL_INPUT==='1'
let core:Companion,panel:BrowserWindow,credentialWindow:BrowserWindow|undefined
let shortcut='Control+Shift+Space',panelBounds:Electron.Rectangle|undefined,attachedWindowId:string|undefined,monitor:ReturnType<typeof setInterval>|undefined
let placementMode:'attached'|'edge'|'detached'='detached'
let viewMode:'companion'|'workspace'='workspace'
let attachedSourceInfo:AttachedWindow|undefined
let surfaceEpoch=0
const compactMinimumHeight=220
let compactHeight=440
type CompactFitState={id:string;epoch:number;maxHeight:number;phase:'preparing'|'running'|'settled';request:number}
let compactFit:CompactFitState|undefined
let shortcutRegistered=false,tray:Tray|undefined
const modifierShortcut=createModifierShortcut({platform:process.platform,hasAccessibilityPermission:()=>systemPreferences.isTrustedAccessibilityClient(false),onActivate:activateShortcut})
const pendingEffects=new Set<string>()
type CollapsePresentation={id:string;epoch:number;phase:'drawing'|'hidden';bounds:Electron.Rectangle;anchor?:Electron.Rectangle;mode:'companion'|'workspace';timer:ReturnType<typeof setTimeout>}
let collapsePresentation:CollapsePresentation|undefined
type EntrancePresentation={id:string;epoch:number;anchor:Electron.Rectangle;timer:ReturnType<typeof setTimeout>}
let entrancePresentation:EntrancePresentation|undefined
type ContextIntake={id:string;tucked:boolean;windows:NativeWindow[];expiresAt:number;capturing:boolean;selectedWindowId?:string;detachedFor?:string;ownerTaskId?:string;newTask?:boolean}
let contextIntake:ContextIntake|undefined
let currentViewTaskId:string|undefined
const browserWindowOwners=new Map<number,number>()
function ownBrowserWindow(processId:number){browserWindowOwners.set(processId,(browserWindowOwners.get(processId)??0)+1);let released=false;return()=>{if(released)return;released=true;const count=browserWindowOwners.get(processId)??0;if(count<=1)browserWindowOwners.delete(processId);else browserWindowOwners.set(processId,count-1)}}
const ownApplication=()=>({processId:process.pid,bundleId:'local.nishit.windowcompanion',executablePath:app.isPackaged?process.execPath:'',ownedProcessIds:new Set(browserWindowOwners.keys())})
type BoundCapture={capture:NativeCapture;version:number;digest:string}
const captures=new Map<string,BoundCapture>()
const captureRetentionMs=300000
function purgeExpiredCaptures(){const now=Date.now();for(const [key,{capture}] of captures){const capturedAt=Date.parse(capture.capturedAt);if(!Number.isFinite(capturedAt)||now-capturedAt>=captureRetentionMs)captures.delete(key)}}
const destinations=new Map<string,string>()
const emit=(event:CompanionEvent)=>{if(panel&&!panel.isDestroyed())panel.webContents.send('companion:event',event)}
const changed=(taskId?:string)=>emit({type:'changed',taskId})
const credentialPath=join(dataDir,'connection.bin')
let keyEpoch=0,connectionDisabled=false,selectedProvider:'meta'|'codex'='codex'
async function getKey(){
  if(connectionDisabled)return undefined
  if(process.env.MODEL_API_KEY)return process.env.MODEL_API_KEY
  if(process.env.META_API_KEY)return process.env.META_API_KEY
  try {if(!safeStorage.isEncryptionAvailable())return undefined;return safeStorage.decryptString(await readFile(credentialPath))} catch{return undefined}
}
const metaProvider=new MetaProvider({getKey,onStatus:connection=>{if(selectedProvider==='meta')emit({type:'connection',connection})}})
const codexProvider=new CodexProvider({enabled:()=>!connectionDisabled,allowUserInstructionFile:true,onStatus:connection=>{if(selectedProvider==='codex')emit({type:'connection',connection})}})
const browserCodexProvider=new CodexProvider({enabled:()=>!connectionDisabled,allowUserInstructionFile:true,serviceTier:'default',purpose:'browser-planner'})
let browserService:BrowserService|undefined
async function getBrowserService(){const lifecycle=quitEpoch;assertCurrentWork(lifecycle);if(!browserService){const {BrowserService}=await import('./browser/service');assertCurrentWork(lifecycle);browserService=new BrowserService(core,{panel:()=>panel,route:()=>({key:`${selectedProvider}:${keyEpoch}:${selectedProvider==='codex'?'luna-standard-browser-planner-v2-form-values':'meta'}`,provider:selectedProvider==='codex'?browserCodexProvider:metaProvider}),changed,progress:(taskId,requestId,text)=>emit({type:'stream',taskId,requestId,text}),headless:process.env.WINDOW_COMPANION_BROWSER_HEADLESS==='1',onWindowOwner:ownBrowserWindow})}return browserService}
const activeProvider=()=>selectedProvider==='codex'?codexProvider:metaProvider
const object=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Expected an object.');return value as Record<string,unknown>}
const str=(value:unknown,name:string,max=10000)=>{if(typeof value!=='string'||!value.length||value.length>max||value.includes('\0'))throw Error(`Invalid ${name}.`);return value}
function validateComposerValue(value:unknown,withRevision:boolean){
 const draft=object(value),keys=withRevision?['text','kind','revision']:['text','kind'];
 if(Object.keys(draft).some(key=>!keys.includes(key))||typeof draft.text!=='string'||draft.text.length>100000||draft.text.includes('\0')||!['explain','create','experiment','procedure'].includes(String(draft.kind)))throw Error('Invalid message draft.');
 if(withRevision&&(!Number.isSafeInteger(draft.revision)||Number(draft.revision)<0))throw Error('Invalid message draft revision.');
}
function validate(value:unknown):Command{
  const c=object(value);str(c.type,'command',80)
  const allowed=['tasks.list','tasks.create','tasks.update','tasks.get','tasks.delete','tasks.pause','tasks.resume','tasks.checkpoint','draft.save','draft.flushed','source.text','source.image','source.invalidate','source.preview','windows.list','windows.capture','context.start','context.capture','context.cancel','context.view','artifact.save','module.edit','module.document','browser.run','browser.inspect','browser.detach','procedure.save','procedure.check','experiment.evaluate','export.propose','export.approve','export.inspect','model.run','model.cancel','connection.status','connection.configure','connection.disconnect','connection.select','surface.collapse','surface.expand','surface.companion','surface.workspace','surface.standalone','surface.attach','surface.fit','shortcut.set','presentation.finish','presentation.reveal','presentation.show']
  if(!allowed.includes(c.type as string))throw Error('Unknown companion command.')
  if(JSON.stringify(c).length>18*1024*1024)throw Error('Command exceeds the local input limit.')
  if('taskId' in c)str(c.taskId,'task ID',200)
  if(c.type==='context.view'&&Object.keys(c).some(key=>!['type','taskId'].includes(key)))throw Error('Unknown context view field.')
  if(c.type==='browser.run'||c.type==='browser.inspect'){
    const keys=c.type==='browser.run'?['type','taskId','requestId','prompt','url','submittedDraft']:['type','taskId','runId','operationId','url']
    if(Object.keys(c).some(key=>!keys.includes(key)))throw Error('Unknown browser request field.')
    str(c.taskId,'task ID',200);str(c.url,'page address',4000)
    if(c.type==='browser.run'){str(c.requestId,'request ID',200);str(c.prompt,'request',16000)}else{str(c.runId,'earlier request',200);str(c.operationId,'earlier action',200)}
  }
  if(c.type==='draft.save'){
    if(Object.keys(c).some(key=>!['type','taskId','expectedRevision','draft'].includes(key)))throw Error('Unknown message draft field.');
    if(!Number.isSafeInteger(c.expectedRevision)||Number(c.expectedRevision)<0)throw Error('Invalid message draft revision.');
    validateComposerValue(c.draft,false);
  }
  if(c.type==='draft.flushed'){
    if(Object.keys(c).some(key=>!['type','quitId','error'].includes(key)))throw Error('Unknown message flush field.');
    str(c.quitId,'quit request',200);if(c.error!==undefined)str(c.error,'message save error',2000);
  }
  if('submittedDraft' in c){if(c.type!=='model.run'&&c.type!=='browser.run')throw Error('This command cannot submit a message draft.');validateComposerValue(c.submittedDraft,true);}
  if(c.type==='module.edit'||c.type==='module.document'){
    const keys=c.type==='module.edit'?['type','taskId','artifactId','artifactRevision','moduleId','action']:['type','taskId','artifactId','artifactRevision','sessionRevision']
    if(Object.keys(c).some(key=>!keys.includes(key)))throw Error('Unknown interactive-answer field.')
    str(c.taskId,'task ID',200);str(c.artifactId,'answer ID',200)
    if(!Number.isSafeInteger(c.artifactRevision)||Number(c.artifactRevision)<1)throw Error('Invalid answer revision.')
    if(c.type==='module.edit'){str(c.moduleId,'module ID',200);object(c.action)}else if(!Number.isSafeInteger(c.sessionRevision)||Number(c.sessionRevision)<0)throw Error('Invalid choice revision.')
  }
  if(c.type==='tasks.update'){
    if(Object.keys(c).some(key=>!['type','taskId','title','goal'].includes(key)))throw Error('Only the task name and goal can be edited.')
    str(c.taskId,'task ID',200);str(str(c.title,'task name',200).trim(),'task name',200)
    if('goal' in c&&(typeof c.goal!=='string'||c.goal.length>10000||c.goal.includes('\0')))throw Error('Invalid task goal.')
  }
  if(c.type==='surface.fit'){
    if(Object.keys(c).some(key=>!['type','fitId','height','phase'].includes(key)))throw Error('Only compact content height and presentation phase can be fitted.')
    str(c.fitId,'compact fit ID',200)
    if(typeof c.height!=='number'||!Number.isSafeInteger(c.height)||c.height<=0||c.height>100000)throw Error('Invalid compact content height.')
    if(!['preparing','running','settled'].includes(c.phase as string))throw Error('Invalid compact presentation phase.')
  }
  return c as unknown as Command
}
async function hostStatus():Promise<HostStatus>{const p=await native.permissionStatus();return {platform:process.platform,screenPermission:p.screen,accessibilityPermission:p.accessibility,shortcut:modifierKeymap(process.platform)?.label??shortcut,shortcutStatus:modifierKeymap(process.platform)?(modifierShortcut.status().state==='ready'?'registered':'unavailable'):(shortcutRegistered?'registered':'unavailable'),modifierShortcutStatus:modifierShortcut.status().state,fallbackShortcut:shortcut,fallbackShortcutStatus:shortcutRegistered?'registered':'unavailable',captureMode:'explicit-frozen',memoryEnabled:false,dataDir}}
const surfaceSize=(mode:typeof viewMode)=>mode==='companion'?{width:360,height:compactHeight}:{width:430,height:760}
function surfacePlacement(mode:typeof viewMode,source:Electron.Rectangle,work:Electron.Rectangle,height=surfaceSize(mode).height){
  const width=surfaceSize(mode).width
  let maxHeight=Math.floor(work.height)
  if(mode==='companion'){
    let low=0,high=maxHeight
    while(low<high){const candidate=Math.ceil((low+high)/2);if(placeCompanion(source,work,{width,height:candidate}).panelBounds)low=candidate;else high=candidate-1}
    maxHeight=low
  }
  return {maxHeight,placement:placeCompanion(source,work,{width,height:mode==='companion'?Math.max(compactMinimumHeight,Math.min(height,maxHeight)):Math.min(height,maxHeight)})}
}
function showSurface(mode:typeof viewMode,bounds:Electron.Rectangle,placement?:string,activate=true,entrance?:Electron.Rectangle,maxHeight=screen.getDisplayMatching(bounds).workArea.height){
  if(entrance)panel.hide()
  panel.setMinimumSize(mode==='companion'?320:360,mode==='companion'?compactMinimumHeight:500);panel.setBounds(bounds);viewMode=mode
  if(mode==='companion'){
    if(!compactFit||compactFit.epoch!==surfaceEpoch)compactFit={id:randomUUID(),epoch:surfaceEpoch,maxHeight,phase:'preparing',request:0}
    compactFit.maxHeight=maxHeight
  }
  if(entrance){const id=randomUUID(),epoch=surfaceEpoch;entrancePresentation={id,epoch,anchor:entrance,timer:setTimeout(()=>cancelEntrancePresentation(),3500)};emit({type:'presentation.enter',entranceId:id,mode})}
  emit({type:'surface',mode,placement,attachedWindow:attachedSourceInfo,...(mode==='companion'&&compactFit?{compactFit:{id:compactFit.id,maxHeight:compactFit.maxHeight}}:{})});if(activate&&!entrance)panel.show()
}
async function fitCompact(c:Extract<Command,{type:'surface.fit'}>):Promise<CompactFitBounds|null>{
  const fit=compactFit,epoch=surfaceEpoch,id=attachedWindowId
  const owns=()=>fit===compactFit&&fit?.epoch===surfaceEpoch&&epoch===surfaceEpoch&&c.fitId===fit.id&&viewMode==='companion'&&panel.getSize()[0]>100&&!collapsePresentation&&!quitting
  if(!fit||!owns())return null
  if(c.phase==='running'){
    if(fit.phase==='settled')return null
    fit.phase='running';fit.request++
    return {height:panel.getBounds().height,maxHeight:fit.maxHeight}
  }
  if(c.phase==='preparing'&&fit.phase!=='preparing')return null
  fit.phase=c.phase
  const request=++fit.request
  let bounds:Electron.Rectangle,maxHeight:number
  const detached=placementMode==='detached'
  if(id&&!detached){
    let source:NativeWindow
    try{source=await native.inspect(id)}catch{return null}
    if(!owns()||fit.request!==request||attachedWindowId!==id)return null
    const work=screen.getDisplayMatching(source.bounds).workArea,placed=surfacePlacement('companion',source.bounds,work,c.height)
    if(!placed.placement.panelBounds)return null
    bounds=placed.placement.panelBounds;maxHeight=placed.maxHeight
  }else{
    const current=panel.getBounds(),work=screen.getDisplayMatching(current).workArea
    maxHeight=Math.floor(work.height)
    if(maxHeight<compactMinimumHeight||work.width<360)return null
    const height=Math.max(compactMinimumHeight,Math.min(c.height,maxHeight))
    bounds={x:Math.max(work.x,Math.min(current.x,work.x+work.width-360)),y:Math.max(work.y,Math.min(current.y,work.y+work.height-height)),width:360,height}
  }
  if(!owns()||fit.request!==request)return null
  compactHeight=Math.max(compactMinimumHeight,c.height);fit.maxHeight=maxHeight
  if(id&&!detached)placementMode='attached'
  const current=panel.getBounds()
  if(bounds.x!==current.x||bounds.y!==current.y||bounds.width!==current.width||bounds.height!==current.height){panel.setMinimumSize(320,compactMinimumHeight);panel.setBounds(bounds)}
  return {height:bounds.height,maxHeight}
}
async function expand(mode:typeof viewMode=viewMode){
  if(entrancePresentation&&viewMode===mode)return
  const entrance=entrancePresentation?.anchor??(panel.getSize()[0]<=100?panel.getBounds():undefined);cancelEntrancePresentation(false)
  cancelCollapsePresentation()
  let epoch=++surfaceEpoch
  const preferred=surfaceSize(mode)
  if(attachedWindowId){
    const id=attachedWindowId
    try{
      const source=await native.inspect(attachedWindowId),work=screen.getDisplayMatching(source.bounds).workArea,{placement,maxHeight}=surfacePlacement(mode,source.bounds,work)
      if(epoch!==surfaceEpoch)return
      attachedSourceInfo={id:source.id,title:source.title,ownerName:source.owner.name}
      if(placement.panelBounds){showSurface(mode,placement.panelBounds,'outside-source',true,entrance,maxHeight);placementMode='attached';return}
      const choice=await dialog.showMessageBox(panel,{type:'question',message:'No space beside the source window',detail:'Opening a detached panel at the screen edge may cover part of your source. Keep the small edge anchor, or choose to open the panel anyway.',buttons:['Keep edge anchor','Open detached panel'],defaultId:0,cancelId:0})
      if(epoch!==surfaceEpoch)return
      if(choice.response!==1){if(entrance)collapse(entrance);else requestCollapse(placement.anchorBounds);return}
      const width=Math.min(preferred.width,Math.floor(work.width*.42)),height=Math.min(preferred.height,work.height)
      if(width<(mode==='companion'?320:360))throw Error('This display has no room for a readable detached panel. Move the source to a larger display or resize it.')
      const center=source.bounds.x+source.bounds.width/2,leftSpace=center-work.x,rightSpace=work.x+work.width-center
      if(contextIntake?.selectedWindowId===id)contextIntake.detachedFor=id
      showSurface(mode,{x:rightSpace>=leftSpace?work.x+work.width-width:work.x,y:work.y,width,height},'user-detached',true,entrance,height);placementMode='detached';return
    }catch(error){if(error instanceof Error&&error.message.startsWith('This display')){if(epoch!==surfaceEpoch)return;throw error}const ownsSurface=epoch===surfaceEpoch;const retiredEpoch=await retireUnavailableWindow(id,'The attached window is unavailable. Rebind an explicit source.');if(!ownsSurface)return;epoch=retiredEpoch}
  }
  if(epoch!==surfaceEpoch)return
  const work=screen.getDisplayMatching(panel.getBounds()).workArea
  const maxHeight=work.height,bounds=mode==='workspace'&&panelBounds?panelBounds:{x:work.x+work.width-preferred.width-20,y:work.y+20,...preferred,height:Math.min(preferred.height,maxHeight)}
  showSurface(mode,bounds,undefined,true,entrance,maxHeight)
}
function collapse(bounds?:Electron.Rectangle,expectedEpoch?:number,show=true){if(expectedEpoch!==undefined){if(expectedEpoch!==surfaceEpoch)return}else surfaceEpoch++;if(panel.getSize()[0]>100&&viewMode==='workspace')panelBounds=panel.getBounds();panel.setMinimumSize(28,36);panel.setBounds(bounds||{x:panel.getBounds().x,y:panel.getBounds().y,width:74,height:64});emit({type:'surface',mode:'anchor',attachedWindow:attachedSourceInfo});if(show)panel.showInactive()}
function cancelCollapsePresentation(restore=true){
 const pending=collapsePresentation;if(!pending)return
 collapsePresentation=undefined;clearTimeout(pending.timer);surfaceEpoch++;emit({type:'presentation.cancel',exitId:pending.id})
 if(restore&&pending.phase==='hidden'&&!quitting){showSurface(pending.mode,pending.bounds,'presentation-cancelled',false);panel.showInactive()}
}
function cancelEntrancePresentation(restore=true){
 const pending=entrancePresentation;if(!pending)return;entrancePresentation=undefined;clearTimeout(pending.timer);surfaceEpoch++;emit({type:'presentation.cancel',exitId:pending.id})
 if(restore&&!quitting)collapse(pending.anchor)
}
function requestCollapse(anchor?:Electron.Rectangle){
 contextIntake=undefined
 if(collapsePresentation||quitting)return null
 if(entrancePresentation){const bounds=entrancePresentation.anchor;cancelEntrancePresentation(false);collapse(bounds);return null}
 if(panel.getSize()[0]<=100){collapse();return null}
 if(credentialWindow&&!credentialWindow.isDestroyed())return null
 const id=randomUUID(),epoch=++surfaceEpoch
 const pending:CollapsePresentation={id,epoch,phase:'drawing',bounds:panel.getBounds(),anchor,mode:viewMode,timer:setTimeout(()=>cancelCollapsePresentation(),3500)};collapsePresentation=pending
 void panel.webContents.capturePage().then(image=>{if(collapsePresentation!==pending)return;const dataUrl=image.toDataURL();emit({type:'presentation.exit',exitId:id,purpose:'collapse',dataUrl:dataUrl.length<=32*1024*1024?dataUrl:''})}).catch(()=>{if(collapsePresentation===pending)cancelCollapsePresentation()})
 return null
}
async function attach(id:string,mode:typeof viewMode='companion',activate=true,expectedEpoch?:number,guard:()=>void=()=>{}){
  guard()
  const entrance=activate&&panel.getSize()[0]<=100?panel.getBounds():undefined
  if(activate){cancelEntrancePresentation(false);cancelCollapsePresentation()}
  const epoch=activate?++surfaceEpoch:expectedEpoch??surfaceEpoch
  const source=await native.inspect(id);guard()
  if(epoch!==surfaceEpoch||(!activate&&(attachedWindowId!==id||collapsePresentation||entrancePresentation||compactFit?.epoch===epoch&&compactFit.phase==='running')))return null
  attachedWindowId=id
  attachedSourceInfo={id:source.id,title:source.title,ownerName:source.owner.name}
  const work=screen.getDisplayMatching(source.bounds).workArea
  const {placement,maxHeight}=surfacePlacement(mode,source.bounds,work)
  viewMode=mode
  if(placement.panelBounds){placementMode='attached';showSurface(mode,placement.panelBounds,'outside-source',activate,entrance,maxHeight);if(mode==='workspace')panelBounds=placement.panelBounds}
  else {placementMode='edge';collapse(placement.anchorBounds,epoch)}
  return placement
}
async function retireUnavailableWindow(id:string,reason:string){
  if(attachedWindowId===id){attachedWindowId=undefined;attachedSourceInfo=undefined;surfaceEpoch++}
  const epoch=surfaceEpoch
  for(const task of await core.listTasks())for(const source of task.sources)if(source.versions.at(-1)?.windowId===id){
    captures.delete(`${task.id}:${source.id}`)
    if(source.freshness==='fresh'){await core.invalidateSource(task.id,source.id,reason);changed(task.id)}
  }
  if(epoch===surfaceEpoch)emit({type:'surface',mode:panel.getSize()[0]<=100?'anchor':viewMode,attachedWindow:attachedSourceInfo,...(panel.getSize()[0]>100&&viewMode==='companion'&&compactFit?.epoch===surfaceEpoch?{compactFit:{id:compactFit.id,maxHeight:compactFit.maxHeight}}:{})})
  return epoch
}
async function monitorAttached(){
  purgeExpiredCaptures()
  const id=attachedWindowId,epoch=surfaceEpoch;if(!id||quitting||collapsePresentation)return
  try{
    const current=await native.inspect(id);if(attachedWindowId!==id||epoch!==surfaceEpoch||quitting)return
    for(const before of await core.listTasks()){
      const after=await core.observeWindow(before.id,{windowId:current.id,documentToken:current.documentToken,title:current.title,boundsToken:JSON.stringify(current.bounds)})
      const invalidated=after.sources.filter(source=>source.freshness==='refresh-required'&&before.sources.find(old=>old.id===source.id)?.freshness==='fresh')
      if(invalidated.length){for(const source of invalidated)captures.delete(`${before.id}:${source.id}`);changed(before.id)}
    }
    if(attachedWindowId===id&&epoch===surfaceEpoch&&placementMode!=='detached'&&panel.getSize()[0]>100){
      if(entrancePresentation||compactFit?.epoch===epoch&&compactFit.phase==='running'){
        const bounds=panel.getBounds(),work=screen.getDisplayMatching(current.bounds).workArea
        const overlaps=bounds.x<current.bounds.x+current.bounds.width&&bounds.x+bounds.width>current.bounds.x&&bounds.y<current.bounds.y+current.bounds.height&&bounds.y+bounds.height>current.bounds.y
        const outside=bounds.x<work.x||bounds.y<work.y||bounds.x+bounds.width>work.x+work.width||bounds.y+bounds.height>work.y+work.height
        if(overlaps||outside){
          const safe=placeCompanion(current.bounds,work,{width:work.width,height:work.height})
          panel.hide();cancelEntrancePresentation(false);collapse(safe.anchorBounds??undefined)
        }
        return
      }
      await attach(id,viewMode,false,epoch)
    }
  }catch{
    if(quitting)return
    const ownsSurface=attachedWindowId===id&&epoch===surfaceEpoch
    const retiredEpoch=await retireUnavailableWindow(id,'The attached window is unavailable. Rebind an explicit source.')
    if(!ownsSurface)return
    const work=screen.getDisplayMatching(panel.getBounds()).workArea
    collapse({x:work.x+work.width-90,y:work.y+20,width:74,height:64},retiredEpoch)
  }
}
async function taskMutation(taskId:string,work:()=>Promise<unknown>){await work();changed(taskId);return core.getTask(taskId)}
function boundCapture(taskId:string,source:SourceVersion):NativeCapture|undefined{
  purgeExpiredCaptures()
  const key=`${taskId}:${source.id}`,bound=captures.get(key)
  if(!bound)return undefined
  const capture=bound.capture
  try{
    const metadata=JSON.parse(source.content)
    if(bound.version!==source.version||bound.digest!==source.digest||metadata.captureId!==capture.sourceVersion||metadata.imageSha256!==capture.imageSha256||metadata.capturedAt!==capture.capturedAt||JSON.stringify(metadata.transform)!==JSON.stringify(capture.transform)||source.windowId!==capture.source.id||source.documentToken!==capture.source.documentToken)throw Error('Capture binding changed.')
    return capture
  }catch{captures.delete(key);return undefined}
}
/** Metadata only, sampled before focus changes. The shortcut never picks an
 * arbitrary background window and never grants capture, network or action use. */
function activateShortcut(){const taskId=currentViewTaskId;return activateContext({type:'context.start',...(taskId?{ownerTaskId:taskId}:{newTask:true})},'shortcut')}
async function activateContext(options:Extract<Command,{type:'context.start'}>={type:'context.start'},invocation:'interface'|'shortcut'='interface'){
 if(quitting||credentialWindow&&!credentialWindow.isDestroyed())return
 const id=randomUUID(),tucked=!panel.isVisible()||panel.getSize()[0]<=100
 contextIntake={id,tucked,windows:[],expiresAt:Date.now()+120000,capturing:false,ownerTaskId:options.source?.taskId??options.ownerTaskId,newTask:options.newTask}
 try{
  const [foreground,windows]=await Promise.all([native.foregroundWindow(),native.listWindows()]);if(contextIntake?.id!==id)return
  const own=ownApplication(),eligible=windows.filter(window=>!isCompanionWindow(window,own))
  let refreshTarget:NativeWindow|undefined;
  if(options.source){const ref=object(options.source);if(Object.keys(ref).sort().join(',')!=='digest,sourceId,taskId,version'||typeof ref.digest!=='string'||!Number.isSafeInteger(ref.version))throw Error('Choose a saved source to refresh.');const t=await core.getTask(str(ref.taskId,'task ID',200));if(contextIntake?.id!==id)return;const source=t.sources.find(s=>s.id===str(ref.sourceId,'source ID',200)),version=source?.versions.find(v=>v.version===ref.version&&v.digest===ref.digest);if(!version||version.kind!=='window')throw Error('Choose a window source to refresh.');refreshTarget=eligible.find(window=>window.id===version.windowId&&window.documentToken===version.documentToken);}
  const bound=invocation==='interface'&&foreground&&isCompanionWindow(foreground,own)&&attachedWindowId?eligible.find(window=>window.id===attachedWindowId):undefined
  const result=invocation==='shortcut'?chooseShortcutTarget(foreground,windows,own):chooseContextTarget(options.source?refreshTarget:bound??foreground,windows,own)
  if(result.kind==='unavailable'){contextIntake=undefined;if(tucked)await expand('workspace');emit({type:'context.error',message:result.reason});return}
  contextIntake.windows=result.kind==='target'?[result.window]:result.windows
  if(result.kind==='choose'&&tucked)await expand('workspace')
  if(contextIntake?.id!==id)return
  emit({type:'context.activate',activation:{activationId:id,tucked,target:result.kind==='target'?result.window:undefined,choices:result.kind==='choose'?result.windows:[],...(invocation==='shortcut'?{trigger:'shortcut' as const}:{}),...(options.newTask?{newTask:true}:{}),...(options.source?{analyze:true,source:options.source,ownerTaskId:options.source.taskId}:options.ownerTaskId?{ownerTaskId:options.ownerTaskId}:{}),...(options.requestId?{requestId:options.requestId}:{})}})
 }catch(error){if(contextIntake?.id!==id)return;contextIntake=undefined;emit({type:'context.error',message:publicErrorMessage(error)})}
}
async function captureWindowSource(c:{taskId?:string;windowId:string;sourceId?:string;newTaskTitle?:string},contextGuard:()=>void=()=>{},expected?:NativeWindow):Promise<Task>{
      const lifecycle=quitEpoch,guard=()=>{assertCurrentWork(lifecycle);contextGuard();}
      if(c.sourceId){if(!c.taskId)throw Error('Select a saved task before refreshing a source.');const t=await core.getTask(c.taskId);if(t.sources.find(s=>s.id===c.sourceId)?.versions.at(-1)?.kind!=='window')throw Error('Select a window source to refresh.')}
      guard();const target=await native.inspect(str(c.windowId,'window ID',100));guard();if(expected&&!sameWindowIdentity(target,expected))throw Error('Source changed; use the shortcut again.');if(isCompanionWindow(target,ownApplication()))throw Error('Choose an external window. Companion windows cannot be captured.')
      const permission=await native.permissionStatus();if(permission.screen!=='granted')throw Error('Existing screen recording permission is required. No capture was attempted.')
      const choice=await dialog.showMessageBox(panel,{type:'question',message:'Capture this window?',detail:`${target.owner.name}\n${target.title||'Untitled window'}\n\nThis snapshot stays on your Mac and expires after five minutes. It is shared only when you approve a request.`,buttons:['Cancel','Capture selected window'],defaultId:0,cancelId:0})
      if(choice.response!==1)throw Error('Capture cancelled. No pixels were captured.')
      guard();const reviewed=await native.inspect(c.windowId);guard();if(isCompanionWindow(reviewed,ownApplication())||!sameWindowIdentity(reviewed,target))throw Error('Source changed; select and refresh it.')
      const capture=await native.capture(str(c.windowId,'window ID',100),{maxPixels:2560,expectedDocumentToken:target.documentToken})
      if(!sameWindowIdentity(capture.source,target))throw Error('Source changed during capture. No snapshot was saved.')
      guard();purgeExpiredCaptures();const oldKey=c.sourceId?`${c.taskId}:${c.sourceId}`:undefined
      const total=capture.png.length+[...captures.entries()].filter(([key])=>key!==oldKey).reduce((n,[,value])=>n+value.capture.png.length,0)
      if(capture.png.length>8*1024*1024||total>32*1024*1024){
        // A rejected refresh cannot leave old pixels looking like a successful refresh.
        if(c.sourceId){captures.delete(oldKey!);await core.invalidateSource(c.taskId!,c.sourceId,'Capture refresh exceeded the memory limit. Refresh with a smaller source window.');changed(c.taskId)}
        throw Error(capture.png.length>8*1024*1024?'Selected capture exceeds 8 MiB. Use a smaller source window.':'In-memory window references exceed 32 MiB. Refresh with smaller source windows.')
      }
      if(oldKey)captures.delete(oldKey)
      // A cancelled native capture must not create an empty task. Create the
      // local task only after consent and the bounded capture have succeeded.
      guard();const createdTask=c.taskId?undefined:await core.createTask({title:c.newTaskTitle||capture.source.title||capture.source.owner.name||'Window task'}),selectedTaskId=c.taskId??createdTask!.id;
      const discardUnpublishedTask=async(expected=createdTask)=>{if(!expected)return false;try{return await core.discardTaskIfUnchanged(expected);}catch{return false;/* Keep a closing/failed store intact for restart reconciliation. */}};
      try{guard();}catch(error){await discardUnpublishedTask();throw error;}
      let t:Task;try{t=await core.putSource(selectedTaskId,{id:c.sourceId,kind:'window',label:(capture.source.title||capture.source.owner.name||'Untitled window').slice(0,200),content:JSON.stringify({captureId:capture.sourceVersion,imageSha256:capture.imageSha256,transform:capture.transform,capturedAt:capture.capturedAt,freshness:'frozen-explicit-capture'}),role:'fact',windowId:capture.source.id,documentToken:capture.source.documentToken,title:capture.source.title,boundsToken:JSON.stringify(capture.source.bounds)},createdTask)}catch(error){await discardUnpublishedTask();throw error;}
      const source=c.sourceId?t.sources.find(x=>x.id===c.sourceId):t.sources.at(-1);if(!source)throw Error('Source was not stored.')
      try{guard();}catch(error){const discarded=createdTask&&await discardUnpublishedTask(t);if(!discarded){try{await core.invalidateSource(selectedTaskId,source.id,'The capture was interrupted before its pixels were published. Capture the window again.');}catch{}if(c.taskId)changed(c.taskId);}throw error;}
      const version=source.versions.at(-1)!
      captures.set(`${selectedTaskId}:${source.id}`,{capture,version:version.version,digest:version.digest});changed(selectedTaskId);return t
}
function assertCurrentWork(lifecycle:number){if(quitting||lifecycle!==quitEpoch)throw Error('The app started closing. Start this action again.');}
async function command(c:Command):Promise<unknown>{
  const lifecycle=quitEpoch
  switch(c.type){
    case 'tasks.list':return core.listTasks()
    case 'tasks.get':return core.getTask(c.taskId)
    case 'tasks.create':{const t=await core.createTask({title:str(c.title,'title',200),goal:c.goal});changed(t.id);return t}
    case 'tasks.update':return taskMutation(c.taskId,()=>core.updateTask(c.taskId,{title:c.title,...(c.goal!==undefined?{goal:c.goal}:{})}))
    case 'tasks.delete':await core.deleteTask(c.taskId);for(const k of captures.keys())if(k.startsWith(c.taskId+':'))captures.delete(k);changed();return null
    case 'tasks.pause':return taskMutation(c.taskId,()=>core.pause(c.taskId))
    case 'tasks.resume':return taskMutation(c.taskId,()=>core.resume(c.taskId))
    case 'tasks.checkpoint':return taskMutation(c.taskId,()=>core.checkpoint(c.taskId,str(c.note,'checkpoint',10000)))
    case 'module.edit':return taskMutation(c.taskId,()=>editModule(core,c))
    case 'module.document':{const saved=await saveModuleDocument(core,c);changed(c.taskId);return {...saved,task:await core.getTask(c.taskId)}}
    case 'draft.save':return core.saveComposerDraft(c.taskId,c.expectedRevision,c.draft)
    case 'draft.flushed':quitDrafts.acknowledge(c.quitId,c.error);return null
    case 'browser.run':{const service=await getBrowserService();assertCurrentWork(lifecycle);return service.run(c)}
    case 'browser.inspect':return (await getBrowserService()).inspect(c)
    case 'browser.detach':return taskMutation(c.taskId,()=>core.clearBrowserContext(c.taskId))
    case 'source.text':{
      const s=object(c.source);if(s.kind!=='text')throw Error('This intake accepts text only; use explicit native image/window intake.')
      str(s.label,'source label',200);str(s.content,'source text',1000000)
      if(!['fact','style','inspiration'].includes(s.role as string))throw Error('Choose a source role.')
      if(s.id!==undefined)str(s.id,'source ID',200)
      if(s.id){const t=await core.getTask(c.taskId);const old=t.sources.find(x=>x.id===s.id);if(old&&old.versions.at(-1)?.kind!=='text')throw Error('Source kind cannot be replaced through text intake.')}
      const selected:SourceInput={kind:'text',label:s.label as string,content:s.content as string,role:s.role as SourceInput['role'],...(s.id?{id:s.id as string}:{})}
      return taskMutation(c.taskId,()=>core.putSource(c.taskId,selected))
    }
    case 'source.image':{
      if(c.sourceId){const t=await core.getTask(c.taskId);if(t.sources.find(s=>s.id===c.sourceId)?.versions.at(-1)?.kind!=='image')throw Error('Select an imported image to replace.')}
      const choice=await dialog.showOpenDialog(panel,{title:'Add an image',properties:['openFile'],filters:[{name:'Images',extensions:['png','jpg','jpeg']} ]})
      assertCurrentWork(lifecycle);if(choice.canceled)return core.getTask(c.taskId)
      const bytes=await readFile(choice.filePaths[0]);assertCurrentWork(lifecycle);if(bytes.length>8*1024*1024)throw Error('Choose an image smaller than 8 MiB.')
      const image=nativeImage.createFromBuffer(bytes);const size=image.getSize();if(image.isEmpty()||size.width*size.height>40000000)throw Error('Image is empty or exceeds 40 megapixels.')
      return taskMutation(c.taskId,()=>core.putSource(c.taskId,{id:c.sourceId,kind:'image',label:basename(choice.filePaths[0]),content:image.toDataURL(),role:c.role}))
    }
    case 'source.invalidate':captures.delete(`${c.taskId}:${c.sourceId}`);return taskMutation(c.taskId,()=>core.invalidateSource(c.taskId,c.sourceId,'Explicitly marked changed. Refresh or replace this source.'))
    case 'source.preview':{purgeExpiredCaptures();const t=await core.getTask(c.taskId),source=t.sources.find(s=>s.id===c.sourceId),version=source?.versions.at(-1);if(c.reference!==undefined){const ref=object(c.reference);if(Object.keys(ref).sort().join(',')!=='digest,sourceId,version'||typeof ref.sourceId!=='string'||!Number.isSafeInteger(ref.version)||typeof ref.digest!=='string')throw Error('Select a saved source version.');if(ref.sourceId!==source?.id||ref.version!==version?.version||ref.digest!==version?.digest)return null;}const capture=source?.freshness==='fresh'&&version?boundCapture(c.taskId,version):undefined;return capture?{dataUrl:capture.dataUrl,capturedAt:capture.capturedAt,transform:capture.transform,reference:{sourceId:source!.id,version:version!.version,digest:version!.digest}}:null}
    case 'windows.list':return (await native.listWindows()).filter(w=>!isCompanionWindow(w,ownApplication()))
    case 'context.view':currentViewTaskId=c.taskId;return null
    case 'context.start':if(c.newTask!==undefined&&typeof c.newTask!=='boolean'||c.newTask&&(c.source!==undefined||c.ownerTaskId!==undefined))throw Error('Choose how to start this context.');if(c.requestId!==undefined)str(c.requestId,'context request',200);if(c.ownerTaskId!==undefined)str(c.ownerTaskId,'task ID',200);if(c.source&&c.ownerTaskId&&c.source.taskId!==c.ownerTaskId)throw Error('This context belongs to a different task.');await activateContext(c);return null
    case 'context.cancel':if(contextIntake?.id===c.activationId)contextIntake=undefined;return null
    case 'context.capture':{
      const intake=contextIntake,id=str(c.activationId,'activation ID',200),windowId=str(c.windowId,'window ID',100)
      const guard=()=>{assertCurrentWork(lifecycle);if(!intake||contextIntake!==intake||id!==intake.id||Date.now()>intake.expiresAt||quitting)throw Error('This screen selection expired. Use the shortcut again.')}
      guard();if(intake!.capturing)throw Error('A screen capture is already awaiting your decision.')
      if(intake!.ownerTaskId&&c.taskId!==intake!.ownerTaskId||intake!.newTask&&c.taskId!==undefined)throw Error('This context belongs to a different task.')
      const selected=intake!.windows.find(window=>window.id===windowId);if(!selected||isCompanionWindow(selected,ownApplication()))throw Error('Choose an external window from this selection.')
      intake!.capturing=true
      try{
        const current=await native.inspect(windowId);guard();if(current.documentToken!==selected.documentToken||current.owner.processId!==selected.owner.processId)throw Error('Source changed; select and refresh it.')
        let task=c.taskId?await core.getTask(c.taskId):undefined;guard()
        intake!.selectedWindowId=windowId
        if(intake!.tucked&&intake!.detachedFor!==windowId){
          const placement=await attach(windowId,'companion',true,undefined,guard);guard();if(!placement)throw Error('This screen selection expired. Use the shortcut again.');if(placement.mode==='edge-anchor')return {activationId:id,tucked:intake!.tucked,state:'no-room',task}
        }
        guard();
        // Appshot adds a context attachment. It never refreshes a source that
        // another request could start using while native consent is pending.
        const captured=await captureWindowSource({...(task?{taskId:task.id}:{newTaskTitle:(selected.title||selected.owner.name||'Window task').slice(0,200)}),windowId},guard,selected);guard()
        const source=captured.sources.at(-1);if(!source)throw Error('Source was not stored.')
        contextIntake=undefined;return {activationId:id,tucked:intake!.tucked,state:'captured',task:captured,sourceId:source.id}
      }finally{if(intake)intake.capturing=false}
    }
    case 'windows.capture':str(c.taskId,'task ID',200);return captureWindowSource(c)
    case 'artifact.save':{
      const a=object(c.artifact);if(a.mimeType==='image/png'){
        if(a.encoding!=='base64')throw Error('PNG artifacts require base64 encoding.')
        const bytes=Buffer.from(str(a.content,'image',12*1024*1024),'base64');if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Artifact is not a PNG.')
        const image=nativeImage.createFromBuffer(bytes);if(image.isEmpty()||image.getSize().width*image.getSize().height>40000000)throw Error('Invalid image dimensions.')
      }else if(a.mimeType&&!['text/plain','text/markdown','application/json'].includes(a.mimeType as string))throw Error('Unsupported artifact format.')
      return taskMutation(c.taskId,()=>core.saveArtifact(c.taskId,c.artifact))
    }
    case 'procedure.save':return taskMutation(c.taskId,()=>core.saveProcedure(c.taskId,c.procedure))
    case 'procedure.check':return core.checkProcedure(c.taskId,c.procedureId,{values:c.context})
    case 'experiment.evaluate':return evaluateExperiment(c.spec,c.inputs)
    case 'export.propose':{
      const t=await core.getTask(c.taskId),artifact=t.artifacts.find(a=>a.id===c.artifactId),revision=artifact?.revisions.find(r=>r.revision===c.revision);if(!revision)throw Error('Artifact revision unavailable.')
      const ext=revision.mimeType==='image/png'?'png':revision.mimeType==='application/json'?'json':revision.mimeType==='text/plain'?'txt':'md'
      const choice=await dialog.showSaveDialog(panel,{title:'Save a copy',defaultPath:`${revision.title.replace(/[^\w -]/g,'').slice(0,80)||'artifact'}.${ext}`,properties:['createDirectory','dontAddToRecent']})
      assertCurrentWork(lifecycle);if(choice.canceled||!choice.filePath)return null
      const action:ExportReply<Extract<Command,{type:'export.propose'}>>=await core.proposeExport(c.taskId,{artifactId:c.artifactId,revision:c.revision,path:choice.filePath});destinations.set(action.proposal.id,action.proposal.path);changed(c.taskId);return action
    }
    case 'export.approve':{
      const t=await core.getTask(c.taskId);const action=t.actions.find(a=>a.proposal.id===c.actionId)
      if(!action||destinations.get(c.actionId)!==action.proposal.path)throw Error('Choose the export destination again in this session.')
      const choice=await dialog.showMessageBox(panel,{type:'question',message:'Save this version?',detail:`${action.proposal.path}\n${action.proposal.byteLength} bytes · Version ${action.proposal.revision}\n\nCreates one new file. Existing files will not be overwritten.`,buttons:['Cancel','Approve export'],defaultId:0,cancelId:0})
      assertCurrentWork(lifecycle);if(choice.response!==1)throw Error('Export not approved. No file was written.')
      const approved=await core.approveExport(c.taskId,c.actionId,c.digest)
      assertCurrentWork(lifecycle);if(!approved.approvalId)throw Error('Approval unavailable.')
      const result:ExportReply<Extract<Command,{type:'export.approve'}>>=await core.executeExport(c.taskId,{actionId:c.actionId,approvalId:approved.approvalId,requestId:str(c.requestId,'request ID',200)});destinations.delete(c.actionId);changed(c.taskId);return result
    }
    case 'export.inspect':{const result:ExportReply<Extract<Command,{type:'export.inspect'}>>=await core.inspectExport(c.taskId,c.actionId);return result}
    case 'model.cancel':return taskMutation(c.taskId,()=>core.cancelRequest(c.taskId,c.requestId))
    case 'model.run':{
      if(!['explain','create','revise','experiment','procedure','brief'].includes(c.kind))throw Error('Choose a supported request kind.')
      if(c.artifactId&&c.kind!=='revise')throw Error('Only a revision request can replace an artifact.')
      const prompt=str(c.prompt,'request',16000);const epoch=keyEpoch,provider=activeProvider()
      const before=await core.getTask(c.taskId),target=c.artifactId?before.artifacts.find(a=>a.id===c.artifactId):undefined,targetRevision=target?.revisions.at(-1)
      assertCurrentWork(lifecycle);if(c.kind==='revise'&&!targetRevision)throw Error('Select an existing artifact to revise.')
      const result=await core.runRequest({taskId:c.taskId,requestId:str(c.requestId,'request ID',200),kind:c.kind,prompt,...(c.submittedDraft?{submittedDraft:c.submittedDraft}:{}),...(c.sourceIds!==undefined?{sourceIds:c.sourceIds}:{}),...(c.expectedSourceRefs!==undefined?{expectedSourceRefs:c.expectedSourceRefs}:{}),...(target?{artifactId:target.id,expectedRevision:targetRevision!.revision}:{})},async ctx=>{
        assertCurrentWork(lifecycle);if(c.expectedSourceRefs!==undefined){const refs=c.expectedSourceRefs;if(!Array.isArray(refs)||refs.length!==ctx.sourceRefs.length||refs.some(ref=>!ref||Object.keys(ref).sort().join(',')!=='digest,sourceId,version'||!ctx.sourceRefs.some(actual=>actual.sourceId===ref.sourceId&&actual.version===ref.version&&actual.digest===ref.digest))||new Set(refs.map(ref=>ref.sourceId)).size!==refs.length)throw Error('Source changed; select and refresh it.')}
        const connection=await provider.status();assertCurrentWork(lifecycle)
        if(!connection.configured)throw Error('Provider availability is unverified. Check the connection before authorizing a new request. Nothing was sent.')
        {
          const consent=await dialog.showMessageBox(panel,{type:'question',message:`Send this request to ${connection.provider==='Meta'?'Meta':'OpenAI'}?`,detail:`${connection.provider==='Meta'?'Destination: Meta (api.meta.ai)':'Destination: OpenAI through your Codex account'}\n\nSources:\n${ctx.task.sources.map(s=>s.versions.at(-1)!.label).join('\n')||'No sources selected'}\n\nRequest: ${prompt}\n\n${connection.provider==='Meta'?'Uses your selected Meta account.':'Uses your Codex account and its existing instructions.'} This requests a response; it does not allow changes to your apps or files. Stopping disconnects this app, but the service may already be processing the request.`,buttons:['Cancel',`Send to ${connection.provider==='Meta'?'Meta':'OpenAI'}`],defaultId:0,cancelId:0})
          assertCurrentWork(lifecycle);if(consent.response!==1)throw Error('Model request was not authorized. Nothing was sent.')
        }
        assertCurrentWork(lifecycle);if(ctx.signal.aborted||epoch!==keyEpoch)throw Error('Request stopped or connection changed before transmission.')
        const sources=ctx.task.sources.map(s=>({...s.versions.at(-1)!}))
        for(const s of sources)if(s.kind==='window'){
          const capture=boundCapture(c.taskId,s);if(!capture||Date.now()-Date.parse(capture.capturedAt)>=captureRetentionMs)throw Error('Refresh the selected window before each model request. Captures are frozen and are not stored in task history.')
          let current
          try{current=await native.inspect(capture.source.id)}catch{await retireUnavailableWindow(capture.source.id,'The selected window is unavailable. Rebind an explicit source.');throw Error('The selected window is unavailable; select and refresh it.')}
          if(current.documentToken!==capture.source.documentToken){captures.delete(`${c.taskId}:${s.id}`);await core.invalidateSource(c.taskId,s.id,'Native window metadata changed. Rebind explicitly.');throw Error('Source changed; select and refresh it.')}
          s.content=capture.dataUrl;captures.delete(`${c.taskId}:${s.id}`)
        }
        if(targetRevision)sources.push({id:`artifact:${target!.id}`,version:targetRevision.revision,digest:targetRevision.digest,kind:'text',label:`Revision target: ${targetRevision.title}`,role:'fact',content:targetRevision.content,capturedAt:targetRevision.createdAt})
        if(ctx.signal.aborted||epoch!==keyEpoch)throw Error('Request stopped or connection changed before transmission.')
        let streamed=''
        const structured=c.kind==='experiment'||c.kind==='procedure'?c.kind:undefined
        const content=await provider.run({prompt:c.kind==='brief'?screenBriefPrompt(ctx.sourceRefs):structured?structuredPrompt(structured,prompt):prompt,sources,signal:ctx.signal,onChunk:delta=>{const first=streamed.length===0;streamed+=delta;if(epoch===keyEpoch&&(!structured||first))emit({type:'stream',taskId:c.taskId,requestId:c.requestId,text:c.kind==='brief'?screenBriefInsight(streamed):structured?(structured==='experiment'?'Preparing your experiment…':'Preparing your procedure…'):streamed})}})
        if(epoch!==keyEpoch)throw Error('Connection changed during request.')
        if(structured){const draft=parseModelDraft(content,structured);return {title:draft.title,content:JSON.stringify(draft,null,2),mimeType:'application/json'}}
        if(c.kind==='brief'){const brief=parseScreenBriefModel(content,ctx.sourceRefs);return {title:'Screen brief',content:JSON.stringify(brief),mimeType:'application/json'}}
        return {title:targetRevision?.title||(c.kind==='explain'?'Explanation':'Draft'),content,mimeType:'text/markdown'}
      });changed(c.taskId);if(result.status!=='completed')throw Error(result.error||`Request ${result.status}.`);return core.getTask(c.taskId)
    }
    case 'connection.status':return {connection:await activeProvider().status(),host:await hostStatus()}
    case 'connection.configure':return selectedProvider==='meta'?configureConnection():{connection:await codexProvider.status(),host:await hostStatus()}
    case 'connection.select':{
      if(c.provider!=='meta'&&c.provider!=='codex')throw Error('Select an installed provider route.')
      keyEpoch++;for(const t of await core.listTasks())for(const r of t.requests)if(r.status==='running')await core.cancelRequest(t.id,r.id)
      metaProvider.reset();codexProvider.reset();browserCodexProvider.reset();selectedProvider=c.provider;connectionDisabled=false
      await writeFile(join(dataDir,'provider.json'),JSON.stringify({provider:selectedProvider}),{mode:0o600});await rm(join(dataDir,'connection-disabled'),{force:true});changed()
      return {connection:await activeProvider().status(),host:await hostStatus()}
    }
    case 'connection.disconnect':{
      keyEpoch++;connectionDisabled=true;for(const t of await core.listTasks())for(const r of t.requests)if(r.status==='running')await core.cancelRequest(t.id,r.id)
      await writeFile(join(dataDir,'connection-disabled'),'disabled',{mode:0o600});await rm(credentialPath,{force:true});metaProvider.reset();codexProvider.reset();browserCodexProvider.reset();changed();return {connection:await activeProvider().status(),host:await hostStatus()}
    }
    case 'presentation.finish':{
      if(exitPending&&c.exitId===exitPending){finishQuit();return null}
      const pending=collapsePresentation;if(!pending||c.exitId!==pending.id||pending.phase!=='drawing'||pending.epoch!==surfaceEpoch)throw Error('No matching exit is pending.')
      panel.hide();pending.phase='hidden';collapse(pending.anchor,pending.epoch,false);return {purpose:'collapse',mode:'anchor'}
    }
    case 'presentation.reveal':{
      const pending=collapsePresentation;if(!pending||c.exitId!==pending.id||pending.phase!=='hidden'||pending.epoch!==surfaceEpoch)throw Error('No matching presentation is pending.')
      clearTimeout(pending.timer);collapsePresentation=undefined;panel.showInactive();return null
    }
    case 'presentation.show':{
      const pending=entrancePresentation;if(!pending||c.entranceId!==pending.id||pending.epoch!==surfaceEpoch)throw Error('No matching presentation is pending.')
      clearTimeout(pending.timer);entrancePresentation=undefined;panel.show();return null
    }
    case 'surface.collapse':return requestCollapse()
    case 'surface.fit':return fitCompact(c)
    case 'surface.expand':await expand(attachedWindowId?'companion':viewMode);return null
    case 'surface.companion':panel.setAlwaysOnTop(true);await expand('companion');return null
    case 'surface.standalone':{if(contextIntake?.selectedWindowId)contextIntake.detachedFor=contextIntake.selectedWindowId;const entrance=entrancePresentation?.anchor??(panel.getSize()[0]<=100?panel.getBounds():undefined);cancelEntrancePresentation(false);cancelCollapsePresentation();surfaceEpoch++;const work=screen.getDisplayMatching(panel.getBounds()).workArea,width=Math.min(1080,work.width-32),height=Math.min(720,work.height-32);placementMode='detached';panel.setAlwaysOnTop(false);panelBounds={x:work.x+Math.round((work.width-width)/2),y:work.y+Math.round((work.height-height)/2),width,height};showSurface('workspace',panelBounds,'standalone',true,entrance);return null;}
    case 'surface.workspace':await expand('workspace');return null
    case 'surface.attach':return attach(str(c.windowId,'window ID',100))
    case 'shortcut.set':{
      const next=str(c.accelerator,'shortcut',80);if(!/^(CommandOrControl|Control|Ctrl|Command|Cmd|Alt|Option|Shift|Super)(\+[A-Za-z0-9]+)+$/.test(next))throw Error('Choose a shortcut such as Option+Space or Control+Shift+Space.')
      if(next===shortcut&&shortcutRegistered)return hostStatus()
      if(!globalShortcut.register(next,()=>void activateShortcut()))throw Error('Shortcut is unavailable.');if(next!==shortcut)globalShortcut.unregister(shortcut);shortcut=next;shortcutRegistered=true;await writeFile(join(dataDir,'shortcut.json'),JSON.stringify({shortcut}),{mode:0o600});return hostStatus()
    }
  }
}

function configureConnection(){
  if(credentialWindow&&!credentialWindow.isDestroyed()){credentialWindow.focus();return null}
  credentialWindow=new BrowserWindow({width:480,height:520,parent:panel,modal:true,show:false,title:'Connect Meta',resizable:false,webPreferences:{preload:join(here,'../preload/credentials.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}})
  if(process.platform==='darwin'||process.platform==='win32')credentialWindow.setContentProtection(true)
  credentialWindow.once('ready-to-show',()=>{if(credentialWindow&&!credentialWindow.isDestroyed())credentialWindow.show()})
  credentialWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));credentialWindow.webContents.on('will-navigate',e=>e.preventDefault())
  const html=`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-setup';"><style>body{font:14px/1.5 system-ui;margin:32px;color:#252525}h1{font-size:23px}input[type=password]{box-sizing:border-box;width:100%;padding:12px;border:1px solid #aaa;font:inherit}label{display:block;margin:20px 0}button{background:#252525;color:white;border:0;padding:12px 20px;font:inherit}small{color:#666}p[role=status]{color:#8c2a22}</style></head><body><h1>Connect Meta</h1><p>Approved requests and selected sources are sent directly to Meta at <b>api.meta.ai</b>.</p><p>Use a Meta API key from an account with API access.</p><label>Meta API key<input id="key" type="password" autocomplete="off" spellcheck="false"></label><label><input id="ack" type="checkbox"> Allow selected sources to be sent to Meta when I approve a request.</label><small>Your key is stored securely on this device. You can disconnect in Settings.</small><p><button id="save">Save connection</button></p><p id="status" role="status"></p><script nonce="setup">document.getElementById('save').onclick=async()=>{const input=document.getElementById('key'),key=input.value;input.value='';try{await window.connectionSetup.save(key,document.getElementById('ack').checked)}catch(e){document.getElementById('status').textContent=e.message}};</script></body></html>`
  void credentialWindow.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));return null
}

app.whenReady().then(async()=>{
  if(Menu?.buildFromTemplate)Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform==='darwin'?[{label:'Window Companion',submenu:[{role:'about' as const},{type:'separator' as const},{role:'hide' as const},{role:'hideOthers' as const},{role:'unhide' as const},{type:'separator' as const},{role:'quit' as const}]}]:[]),
    {label:'File',submenu:[{label:'Use screen context',accelerator:undefined,click:()=>void activateContext()},{role:'close'}]},
    {label:'Edit',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
    {label:'View',submenu:[{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'}]},
    {label:'Window',submenu:[{label:'Minimize',accelerator:'CommandOrControl+M',click:()=>void requestCollapse()},{role:'front'}]},
  ]))
  await mkdir(dataDir,{recursive:true,mode:0o700});core=await createCompanion({dataDir});if(quitting){await core.close();return}
  try{await readFile(join(dataDir,'connection-disabled'));connectionDisabled=true}catch{}
  try{const saved=JSON.parse(await readFile(join(dataDir,'provider.json'),'utf8'));if(saved.provider==='meta'||saved.provider==='codex')selectedProvider=saved.provider}catch{}
  try{const saved=JSON.parse(await readFile(join(dataDir,'shortcut.json'),'utf8'));if(typeof saved.shortcut==='string')shortcut=saved.shortcut}catch{}
  session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));session.defaultSession.setPermissionCheckHandler(()=>false)
  if(quitting)return
  panel=new BrowserWindow({width:430,height:760,x:screen.getPrimaryDisplay().workArea.x+screen.getPrimaryDisplay().workArea.width-450,y:screen.getPrimaryDisplay().workArea.y+20,frame:false,show:false,alwaysOnTop:true,title:'Window Companion',backgroundColor:process.platform==='darwin'?'#00000000':'#f6f7f9',...(process.platform==='darwin'?{transparent:true,hasShadow:false}:{}),webPreferences:{preload:join(here,'../preload/index.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}})
  if(process.platform==='darwin'||process.platform==='win32')panel.setContentProtection(true)
  panel.webContents.setWindowOpenHandler(()=>({action:'deny'}));panel.webContents.on('will-navigate',e=>e.preventDefault());panel.on('close',e=>{if(!quitApproved){e.preventDefault();if(!quitting)void requestCollapse()}})
  ipcMain.handle('companion:command',async(event,value)=>{
    try{
      if(event.sender!==panel.webContents||event.senderFrame!==panel.webContents.mainFrame)throw Error('Untrusted companion caller.')
      const c=validate(value);if(quitting&&!['presentation.finish','draft.save','draft.flushed'].includes(c.type))throw Error('The app is closing.');const key=c.type==='windows.capture'?'capture:window':c.type==='export.approve'?`export:${c.actionId}`:c.type==='model.run'||c.type==='browser.run'?`model:${c.taskId}`:c.type==='browser.inspect'?`inspect:${c.taskId}:${c.operationId}`:undefined
      if(key&&pendingEffects.has(key))throw Error('This effect is already awaiting a result.')
      if(key)pendingEffects.add(key)
      try{return await command(c)}finally{if(key)pendingEffects.delete(key)}
    }catch(error){throw Error(publicErrorMessage(error))}
  })
  ipcMain.handle('credential:save',async(event,value)=>{
    try{
      if(!credentialWindow||event.sender!==credentialWindow.webContents||event.senderFrame!==credentialWindow.webContents.mainFrame)throw Error('Untrusted credential entry.')
      const v=object(value);if(v.acknowledged!==true)throw Error('Authorize this destination before connecting.');const key=str(v.key,'API key',512);if(!safeStorage.isEncryptionAvailable())throw Error('OS secure storage unavailable; connection was not saved.')
      await writeFile(credentialPath,safeStorage.encryptString(key),{mode:0o600});selectedProvider='meta';await writeFile(join(dataDir,'provider.json'),JSON.stringify({provider:selectedProvider}),{mode:0o600});connectionDisabled=false;await rm(join(dataDir,'connection-disabled'),{force:true});keyEpoch++;metaProvider.reset();codexProvider.reset();browserCodexProvider.reset();credentialWindow.close();credentialWindow=undefined;changed();return true
    }catch(error){throw Error(publicErrorMessage(error))}
  })
  if(process.env.ELECTRON_RENDERER_URL)await panel.loadURL(process.env.ELECTRON_RENDERER_URL);else await panel.loadFile(join(here,'../renderer/index.html'))
  if(quitting||quitApproved)return
  panel.show();if(!testNoGlobalInput)shortcutRegistered=globalShortcut.register(shortcut,()=>void activateShortcut())
  if(!testNoGlobalInput)await modifierShortcut.start()
  if(quitting||quitApproved)return
  const trayImage=nativeImage.createFromDataURL(trayImageDataUrl).resize({width:18,height:18});if(process.platform==='darwin')trayImage.setTemplateImage(true)
  if(!testNoGlobalInput){tray=new Tray(trayImage);tray.setToolTip('Window Companion');tray.setContextMenu(Menu.buildFromTemplate([{label:'Use screen context',click:()=>void activateContext()},{label:'Open Companion',click:()=>void expand()},{type:'separator'},{label:'Quit Companion',click:()=>app.quit()}]));tray.on('click',()=>void expand())}
  monitor=setInterval(()=>{void monitorAttached().catch(()=>{})},2000)
}).catch(error=>{if(quitting||quitApproved)return;console.error('Companion startup failed:',error.message);dialog.showErrorBox('Companion could not open',publicErrorMessage(error));app.quit()})
let quitEpoch=0,quitting=false,quitApproved=false,quitInProgress=false,finalizingQuit=false,exitPending:string|undefined,exitTimeout:ReturnType<typeof setTimeout>|undefined
const quitDrafts=createQuitDraftBarrier({
 send:quitId=>emit({type:'draft.flush',quitId}),
 confirmDiscard:async reason=>{const options={type:'warning',message:'Quit without saving messages?',detail:reason+'\n\nKeep the app open to retain your unsent messages, or quit without saving the unconfirmed edits.',buttons:['Keep app open','Quit without saving'],defaultId:0,cancelId:0} as const;const result=await (panel&&!panel.isDestroyed()?dialog.showMessageBox(panel,{...options,buttons:[...options.buttons]}):dialog.showMessageBox({...options,buttons:[...options.buttons]}));return result.response===1;},
})
async function stopForQuit(){
 quitting=true;quitEpoch++;keyEpoch++;contextIntake=undefined;modifierShortcut.stop();globalShortcut.unregisterAll();shortcutRegistered=false;if(monitor){clearInterval(monitor);monitor=undefined;}
 captures.clear();metaProvider.reset();codexProvider.close();browserCodexProvider.close();browserService?.close();browserService=undefined;
 try{if(core)for(const task of await core.listTasks())for(const request of task.requests)if(request.status==='running')await core.cancelRequest(task.id,request.id);}catch{return 'The local task store could not confirm pending message saves.';}
}
async function finishQuit(){
 if(quitApproved||finalizingQuit)return;finalizingQuit=true;exitPending=undefined;if(exitTimeout)clearTimeout(exitTimeout);if(panel&&!panel.isDestroyed())panel.hide();
 try{await core?.close();}catch{dialog.showErrorBox('Local task store could not close cleanly','Acknowledged messages are saved. Reopen the app before continuing this task.');}
 quitApproved=true;tray?.destroy();tray=undefined;app.quit();
}
function drawQuit(){
 if(entrancePresentation){panel.hide();cancelEntrancePresentation(false);void finishQuit();return;}
 if(collapsePresentation){panel.hide();cancelCollapsePresentation(false);void finishQuit();return;}
 if(!panel||panel.isDestroyed()||!panel.isVisible()||panel.webContents.isLoading()||credentialWindow&&!credentialWindow.isDestroyed()){void finishQuit();return;}
 const exitId=randomUUID();exitPending=exitId;
 // The animation deadline does not bypass the preceding durable draft barrier.
 exitTimeout=setTimeout(()=>void finishQuit(),3500);
 void panel.webContents.capturePage().then(image=>{if(exitPending!==exitId)return;const dataUrl=image.toDataURL();if(dataUrl.length>32*1024*1024){void finishQuit();return;}emit({type:'presentation.exit',exitId,dataUrl})}).catch(()=>void finishQuit());
}
async function beginQuit(){
 const stopFailure=await stopForQuit();
 if(panel&&!panel.isDestroyed()||stopFailure){
  const decision=await quitDrafts.request(stopFailure);
  if(!decision.allowQuit){
   quitting=false;quitInProgress=false;emit({type:'draft.resume',quitId:decision.id});
   if(!testNoGlobalInput){shortcutRegistered=globalShortcut.register(shortcut,()=>void activateShortcut());await modifierShortcut.start();}
   monitor=setInterval(()=>{void monitorAttached().catch(()=>{})},2000);return;
  }
 }
 drawQuit();
}
app.on('before-quit',event=>{
 if(quitApproved)return;
 event.preventDefault();if(quitInProgress)return;quitInProgress=true;quitting=true;
 void beginQuit().catch(()=>{quitInProgress=false;quitting=false;dialog.showErrorBox('Messages could not be saved','The app stayed open. Keep a copy of your message before trying again.');});
})
app.on('window-all-closed',()=>app.quit())
