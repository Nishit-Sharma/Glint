import {readImageCopyCommand} from '../shared/image-copy';
import {copySavedImage,IMAGE_COPY_BYTE_LIMIT} from './image-copy';
import {MemoryExports} from './memory-export';
import {readMemoryExportCommand} from '../shared/memory-export';
import {fitFloatingBounds,type FloatingBounds} from '../shared/bot-catalog';
import {NotificationToast} from './notification-toast';
import {TaskNotifications} from './task-notifications';
import {notificationMuteScope,readNotificationCommand} from '../shared/task-notifications';
import {PdfPageImports} from './pdf-page-import';
import {inspectPdfRequest} from './pdf-request-inspection';
import {isPdfPageCommand,readPdfPageCommand} from '../shared/pdf-page-import';
import {isStudyCommand,readStudyCommand} from '../shared/study-workbench';
import {modelImageInput} from '../shared/request-inference';
import {readTaskMemoryPolicyCommand} from '../shared/task-memory-policy'
import {queuedInferenceReview} from './queued-inference-review'
import {composeOrdinaryRequest,dispatchOrdinaryRequest,instructionSkillReview} from './ordinary-request-composition';
import {isInstructionSkillCommand,readInstructionSkillCommand,instructionSkillSelection,type InstructionSkillReference} from '../shared/instruction-skill';
import type {ProviderModelReceipt} from '../shared/response-model';
import {readRequestInferenceCommand,requestInferenceSaved,resolveRequestInference,buildCodexInferenceWire,requestInferenceScopeFields,type RequestInferenceCatalog,type RequestInferenceSelection} from '../shared/request-inference'
import {readCodeBlockCopy,writeCodeBlockCopy} from '../shared/code-block-copy';
import {ContentBackups,ContentBackupGate,recoverContentRestore} from './content-backup';
import {isContentBackupCommand,readContentBackupCommand} from '../shared/content-backup';
import {DocumentSpeech} from './document-speech';
import {isSpeechCommand,readSpeechCommand} from '../shared/document-speech';
import {isReadingCommand,readReadingCommand} from '../shared/reading-view';
import {CodeWorkspaces} from './code-workspace';
import {isCodeCommand,readCodeCommand,CODE_WORKSPACE_ERROR} from '../shared/code-workspace';
import {readConversationAttemptReceipt} from '../shared/conversation-attempt';
import {readQueueCommand,pendingFollowups,type QueuedFollowup,type QueueCommand} from '../shared/queued-followup';
import {createRecurringWorkRunner} from './recurring-work-runner';
import {readRecurringWorkChange} from '../shared/recurring-work';
import {readBrowserWorkflowSave,readBrowserWorkflowRun} from '../shared/browser-workflow';
import {readMemoryChange} from '../shared/user-memory';
import {CliPreviewHost,readCliCommand} from './cli-preview';
import {readLocalContactsCommand} from '../shared/local-contacts';
import {readPublicGithubCommand} from '../shared/public-github';
import {PublicGithubReader} from './public-github';
import {userMemoryContext} from './user-memory-context';
import {readMemoryPreviewInput} from '../shared/project-memory';
import {DocumentImports} from './document-import';
import {readDocumentImportOwner,readDocumentImportAdd,documentImportMessages} from '../shared/document-import';
import {readBrowserContinuationInput} from '../shared/browser-continuation';
import {inspectTargetPractice,inspectOriginalTargetPractice,submitTargetPractice} from '../core/experiment-target-practice-host';
import {readTargetPracticeInput,readTargetPracticeSubmission} from '../learning/experiment-target-practice';
import {saveSourceFormula,inspectSourceFormulaSave} from '../core/source-formula-host';
import {readSourceFormulaCommand,readSourceFormulaInput,SOURCE_FORMULA_MIME} from '../learning/source-formula';
import {helperSourceBatchPreview,readHelperSourceBatchRequest,readHelperSourceBatchSave,readHelperSourceBatchInspection} from '../shared/helper-source-batch';
import {createExperimentPractice,inspectExperimentPractice} from '../core/experiment-practice-host';
import {createPackingPractice,inspectPackingPractice} from '../core/packing-practice-host';
import {createPackingConcept,inspectPackingConcept} from '../core/packing-concept-host';
import {createSignalPractice,inspectSignalPractice} from '../core/signal-sequential-practice-host';
import {createSignalOverwrite,inspectSignalOverwrite} from '../core/signal-overwrite-host';
import {createSignalConcept,inspectSignalConcept} from '../core/signal-concept-host';
import {createTruthTable,inspectTruthTable} from '../core/truth-table-host'
import {assertRevisionInstructionRequest} from '../shared/revision-instructions'
import {parseSavedDocumentDraftBasis} from '../shared/saved-document-draft'
import {createWindowWorkflow,windowWorkflowCandidateForReview} from '../core/window-workflow-host'
import {createWindowWorkflowCaptureFence} from './window-workflow-capture'
import {LearningDraftStore} from './learning-drafts'
import {parseLearningDraftOwner,parseLearningDraftSlot,parseLearningDraftValue,parseLearningDraftEpoch,parseLearningDraftRecoveryToken} from '../shared/learning-drafts'
import {inspectRecordedTextHelper,createRecordedTextHelper,readRecordedTextRequest,readRecordedTextAcceptance} from '../core/recorded-text-helper-host'
import {createDocumentRecipe,saveDocumentRecipe,inspectDocumentRecipeSave} from '../core/document-recipe-host';
import {previewDocumentRecipe,readDocumentRecipeCreate,readDocumentRecipeRequest,readDocumentRecipeSave,readDocumentRecipeInspection} from '../shared/document-recipe';
import {createTextHelper} from '../core/text-helper-host'
import {readResponseBranchInput} from '../core/response-branch'
import {readLocalTaskStart} from '../shared/local-task-start'
import {readSuggestedTaskInput} from '../shared/task-starters';
import {readSourceTextSave,readSourceTextSaveInspection} from '../shared/source-text-save'
import {parseSourceTextExpected} from '../shared/source-text-draft'
import {readTaskHandoffSave} from '../shared/task-handoff';
import {readTaskArchiveChange} from '../shared/task-archive';
import {readSavedDocumentSourceInput} from '../shared/saved-document-source';
import {readConversationExportCommand} from '../shared/conversation-export';
import {ConversationExports} from './conversation-export';
import {prepareWorkflowReview,createReviewedWorkflow,createContextualReviewedWorkflow} from '../core/workflow-review-host'
import {createWorkflowExample} from '../core/workflow-lab-host'
import {DocumentSourceAdapter,readMacFocusedDocument} from './document-source-native'
import {DocumentSourceFollow} from './document-source-follow'
import {BrowserInspectionAttempts} from './browser/inspection-attempts'
import {documentStampChange,persistedDocumentStamp,type DocumentBinding,type RuntimeDocumentStamp,type DocumentCapture} from '../shared/document-source'
import {taskHistoryReview} from './request-review'
import {BotPreferences} from './bot-preferences'
import {readBotCommand} from '../shared/bot-catalog'
import {app,BrowserWindow,clipboard,ClipboardItem,Menu,Tray,dialog,globalShortcut,ipcMain,nativeImage,safeStorage,screen,session,systemPreferences} from 'electron'
import {readFile,writeFile,mkdir,rm,realpath} from 'node:fs/promises'
import {mkdirSync} from 'node:fs'
import {join,resolve,basename} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {createCompanion,evaluateExperiment,type Companion} from '../core/companion'
import type {SourceInput,SourceVersion,SourceRef,Task,RequestOutput} from '../core/types'
import {NativeSourceAdapter,placeCompanion,type NativeCapture} from './native'
import type {NativeWindow} from './native'
import {chooseContextTarget,chooseShortcutTarget,hasOnlyWindowBoundsChanged,isCompanionWindow,sameWindowIdentity} from './context-target'
import {Schema} from 'effect'
import {CaptureSettings,CaptureSettingsSaveError} from './capture-settings'
import {CURRENT_CAPTURE_POLICY_VERSION,CaptureApplicationIdentitySchema,evaluateCapturePolicy,evaluateCapturePrivacy,type CaptureApplicationIdentity,type CaptureSnapshot,type CaptureState} from '../shared/capture-policy'
import {CharacterPreferences} from './character-preferences'
import {ResponsePreferences,responsePreferencesContext} from './response-preferences'
import {HardwareAccelerationSettings} from './system-settings'
import {FallbackShortcutSettings} from './fallback-shortcut'
import {DEFAULT_FALLBACK_SHORTCUT,readFallbackShortcutCommand} from '../shared/fallback-shortcut'
import {readSystemSettingsCommand} from '../shared/system-settings'
import {readProjectCommand} from '../shared/projects'
import {readResponsePreferencesUpdate} from '../shared/response-preferences'
import {createNativeSourceDrag} from './source-drag'
import {createSourceDragPreview} from './source-drag-preview'
import {TaskViewPreferences} from './task-view-preferences'
import {readTaskAttentionCommand} from '../shared/task-attention'
import {readCharacterUpdate} from '../shared/character-catalog'
import {createQuitDraftBarrier} from './quit-drafts'
import {createModifierShortcut,modifierKeymap} from './modifier-shortcut'
import {trayImageDataUrl} from './tray-image'
import {MetaProvider} from './provider'
import {CodexProvider} from './codex-provider'
import {parseModelDraft,structuredPrompt} from '../core/model-drafts'
import {parseScreenBriefModel,screenBriefInsight,screenBriefPrompt} from '../core/screen-brief'
import {editModule,saveModuleDocument} from '../core/module-state'
import {readTaskArtifactText} from '../core/task-dialogue'
import {assertRawModuleOperationAllowed} from '../shared/module-contract'
import {prepareBriefActionPlan} from './brief-action-plan'
import {prepareCanvasGeneration} from './design-canvas-generation';
import {createDesignCanvas,saveDesignCanvas,saveCanvasSvg} from '../core/design-canvas';
import {DESIGN_CANVAS_MIME,DESIGN_SVG_MIME,readCanvasSketchContext} from '../shared/design-canvas';
import {prepareConceptMapGeneration} from './concept-map-generation';
import type {BrowserService} from './browser/service'
import type {Command,CompanionEvent,HostStatus,AttachedWindow,CompactFitBounds,ContextActivation,ContextPending} from '../shared/bridge'
import {publicErrorMessage} from '../shared/public-messages'
import type {ExportReply} from '../shared/export-contract'

const here=fileURLToPath(new URL('.',import.meta.url))
const cliRoot=app.isPackaged?join(process.resourcesPath,'app.asar.unpacked','out'):join(here,'..');
const cliPreview=new CliPreviewHost({executable:process.execPath,script:join(cliRoot,'main','cli.js'),launcher:join(cliRoot,'native','glint')});
const dataDir=resolve(process.env.WINDOW_COMPANION_DATA_DIR || (app.isPackaged?join(app.getPath('userData'),'tasks'):join(here,'../../.runtime')))
// Must run synchronously on the first tick, before ready or any window creation.
const systemSettings=new HardwareAccelerationSettings(dataDir,{isReady:()=>app.isReady(),disableHardwareAcceleration:()=>app.disableHardwareAcceleration(),isHardwareAccelerationEnabled:()=>app.isHardwareAccelerationEnabled(),onGpuInfo:callback=>{app.on('gpu-info-update',callback);}})
mkdirSync(join(dataDir,'profile'),{recursive:true,mode:0o700})
app.setPath('userData',join(dataDir,'profile'))
app.setPath('sessionData',join(dataDir,'profile'))
let botPreferences:BotPreferences
const characterPreferences=CharacterPreferences.open(dataDir)
const responsePreferences=new ResponsePreferences(dataDir)
const memoryExports=new MemoryExports(()=>core.getUserMemory(),async info=>{const selected=await dialog.showSaveDialog(panel,{title:`Export ${info.count} saved memory ${info.count===1?'fact':'facts'}`,defaultPath:'glint-memory.json',filters:[{name:'Glint memory JSON',extensions:['json']}],properties:['createDirectory','dontAddToRecent']});return selected.canceled?null:selected.filePath??null;})
const native=new NativeSourceAdapter()
// Disposable integration instances must not compete with the user's running app for input.
const testNoGlobalInput=process.env.WINDOW_COMPANION_TEST_NO_GLOBAL_INPUT==='1'
const contentBackupGate=new ContentBackupGate()
let core:Companion,panel:BrowserWindow,credentialWindow:BrowserWindow|undefined,contentBackups:ContentBackups
let shortcut=DEFAULT_FALLBACK_SHORTCUT,panelBounds:Electron.Rectangle|undefined,attachedWindowId:string|undefined,monitor:ReturnType<typeof setInterval>|undefined
let placementMode:'attached'|'edge'|'detached'='detached'
let viewMode:'companion'|'workspace'='workspace',floatingWindow=false
let floatingBounds:FloatingBounds|undefined
let floatingSave:Promise<void>=Promise.resolve()
let attachedSourceInfo:AttachedWindow|undefined
let attachedOwnerProcessId:number|undefined
let sourceDrag:ReturnType<typeof createNativeSourceDrag>|undefined,sourceDragPreview:ReturnType<typeof createSourceDragPreview>|undefined,sourceContextEpoch=0
let surfaceEpoch=0
const compactMinimumHeight=220
let compactHeight=440
type CompactFitState={id:string;epoch:number;maxHeight:number;phase:'preparing'|'running'|'settled';request:number}
let compactFit:CompactFitState|undefined
let shortcutRegistered=false,tray:Tray|undefined
const fallbackShortcutSettings=new FallbackShortcutSettings({directory:dataDir,current:()=>shortcut,committed:value=>{shortcut=value;shortcutRegistered=globalShortcut.isRegistered(value);},activate:()=>{void activateShortcut();},registry:globalShortcut})
const modifierShortcut=createModifierShortcut({platform:process.platform,hasAccessibilityPermission:()=>systemPreferences.isTrustedAccessibilityClient(false),onActivate:activateShortcut})
const pendingEffects=new Set<string>()
const browserInspectionAttempts=new BrowserInspectionAttempts()
type CollapsePresentation={id:string;epoch:number;phase:'drawing'|'hidden';captureStarted:boolean;bounds:Electron.Rectangle;anchor?:Electron.Rectangle;mode:'companion'|'workspace';timer:ReturnType<typeof setTimeout>}
let collapsePresentation:CollapsePresentation|undefined
type EntrancePresentation={id:string;epoch:number;anchor:Electron.Rectangle;timer:ReturnType<typeof setTimeout>}
let entrancePresentation:EntrancePresentation|undefined
type ContextIntake={invocation:'interface'|'shortcut'|'drop'|'picker';id:string;tucked:boolean;windows:NativeWindow[];expiresAt:number;capturing:boolean;selectedWindowId?:string;detachedFor?:string;ownerTaskId?:string;newTask?:boolean;activation?:ContextActivation;sourceScope?:{privacy:number;connection:number};dropPlacement?:{epoch:number;noRoom:boolean};oneSnapshot?:boolean}
let contextIntake:ContextIntake|undefined
let captureSettings:CaptureSettings,capturePrivacyEpoch=0,captureSetupReviewOpen=false
let captureSettingsHealth:'ready'|'changing'|'unconfirmed'='ready',capturePrivacyAbort=new AbortController()
const documentSources=new DocumentSourceAdapter({
 platform:process.platform,foreground:()=>native.foregroundWindow(),trusted:async()=>(await native.permissionStatus()).accessibility==='granted',readFocusedDocument:readMacFocusedDocument,
 eligible:async(target,guard)=>{try{await checkCaptureTarget(target,undefined,guard);return true;}catch{guard();return false;}},
})
const documentFollow=new DocumentSourceFollow({
 core:{getTask:taskId=>core.getTask(taskId),reconcileDocumentSource:(binding,observation,guard)=>core.reconcileDocumentSource(binding,observation,guard)},
 observe:async(target,options)=>{let current:NativeWindow;try{current=await native.inspect(target.id);}catch{options.assertCurrent();return {kind:'frozen',reason:'closed'};}options.assertCurrent();if(current.owner.processId!==target.owner.processId)return {kind:'frozen',reason:'closed'};return documentSources.observe(current,options);},
 approve:async(scope,guard)=>{const choice=await dialog.showMessageBox(panel,{type:'question',message:'Follow this selected window for this session?',detail:`${scope.application}\n${scope.title||'Untitled window'}\n\nAllow fresh snapshots of only this selected window when it is active and its app reports a document-address change. The first supported observation may take a new snapshot.\n\nDocument addresses are compared locally as fingerprints. They are an advisory signal, not a verified tab identity; edits at the same address can be missed. Missing or ambiguous metadata pauses following. Background windows and private apps are excluded.\n\nSnapshots stay locally for five minutes. Nothing is sent to an AI service automatically. This choice ends when you stop following, switch tasks or sources, change privacy settings, or quit. Shortcut setup does not enable it.`,buttons:['Cancel','Follow selected window'],defaultId:0,cancelId:0});guard();return choice.response===1;},
 refresh:refreshFollowedSource,retire:binding=>retireCapturedSource(binding.taskId,binding.ref),changed:taskId=>changed(taskId),
})
let documentSelectionEpoch=0
function retireDocumentFollow(reason:string){documentSelectionEpoch++;documentFollow.stop(reason)}
let requestedViewTaskId:string|undefined
let currentViewTaskId:string|undefined
const publicGithub=new PublicGithubReader()
const documentImports=new DocumentImports({getTask:id=>core.getTask(id),putSource:(...args)=>core.putSource(...args)},async()=>{const choice=await dialog.showOpenDialog(panel,{title:'Import document',properties:['openFile'],filters:[{name:'Readable documents',extensions:['pdf','docx','doc','txt','md','csv']}]});return choice.canceled?undefined:choice.filePaths[0];})
const pdfPageImports=new PdfPageImports({getTask:id=>core.getTask(id),addPdfPageSources:(...args)=>core.addPdfPageSources(...args)},async()=>{const choice=await dialog.showOpenDialog(panel,{title:'Import visual PDF pages',properties:['openFile'],filters:[{name:'PDF document',extensions:['pdf']}]});return choice.canceled?undefined:choice.filePaths[0];});
let viewSelectionQueue:Promise<unknown>=Promise.resolve()
const taskViewPreferences=new TaskViewPreferences(dataDir,async id=>(await core.listTasks()).some(task=>task.id===id),id=>core.getTask(id))
const taskNotifications=new TaskNotifications({readNotifications:()=>taskViewPreferences.readNotifications(),mutateNotifications:update=>contentBackupGate.run('notifications.poll',()=>taskViewPreferences.mutateNotifications(update))},()=>core.listTasks(),async()=>({focused:!!panel&&!panel.isDestroyed()&&panel.isVisible()&&panel.isFocused(),mutedBotIds:notificationMuteScope(await botPreferences.read())}),()=>emit({type:'notifications.changed'}),Date.now,(notice,event)=>notificationToast.show(notice.id,event?.kind==='needs-input'?'Your study input is needed':event?.kind==='completed'?'Study attempt complete':notice.kind==='break'?'Time for a break?':'Your quiet hours',event?.summary??(notice.kind==='break'?'Your daily active-use reminder threshold was reached. You can continue whenever you choose.':'You asked for a reminder on opening Glint during this time. You can continue.')))
const documentSpeech=new DocumentSpeech({directory:dataDir,core:{getTask:id=>core.getTask(id),replaceSession:(...args)=>core.replaceSession(...args)}})
const codeWorkspaces=new CodeWorkspaces({directory:dataDir,core:{getTask:id=>core.getTask(id),saveArtifact:(...args)=>core.saveArtifact(...args)},choose:async()=>{const selected=await dialog.showOpenDialog(panel,{title:'Choose local code folder',message:'Browse supported text and code files locally. Each file write needs its own review.',properties:['openDirectory','dontAddToRecent']});return selected.canceled?undefined:selected.filePaths[0];}})
const learningDrafts=new LearningDraftStore({directory:dataDir,lookupTask:async id=>(await core.listTasks()).find(task=>task.id===id)})
const browserWindowOwners=new Map<number,number>()
function ownBrowserWindow(processId:number){browserWindowOwners.set(processId,(browserWindowOwners.get(processId)??0)+1);let released=false;return()=>{if(released)return;released=true;const count=browserWindowOwners.get(processId)??0;if(count<=1)browserWindowOwners.delete(processId);else browserWindowOwners.set(processId,count-1)}}
const notificationToast=new NotificationToast(action=>{if(quitting||quitApproved)return;if(action.kind==='open')void expand('workspace').then(()=>emit({type:'notifications.activate',action})).catch(()=>{});else emit({type:'notifications.activate',action});},ownBrowserWindow)
const ownApplication=()=>({processId:process.pid,bundleId:'local.nishit.windowcompanion',executablePath:app.isPackaged?process.execPath:'',ownedProcessIds:new Set(browserWindowOwners.keys())})
type BoundCapture={capture:NativeCapture;version:number;digest:string}
const captures=new Map<string,BoundCapture>()
const captureRetentionMs=300000
function purgeExpiredCaptures(){const now=Date.now();for(const [key,{capture}] of captures){const capturedAt=Date.parse(capture.capturedAt);if(!Number.isFinite(capturedAt)||now-capturedAt>=captureRetentionMs)captures.delete(key)}}
const destinations=new Map<string,string>()
const conversationExports=new ConversationExports(taskId=>core.getTask(taskId))
const emit=(event:CompanionEvent)=>{if(panel&&!panel.isDestroyed())panel.webContents.send('companion:event',event)}
systemSettings.onRuntime(runtime=>emit({type:'system.gpu-info',runtime}))
const changed=(taskId?:string)=>emit({type:'changed',taskId})
const credentialPath=join(dataDir,'connection.bin')
let keyEpoch=0,connectionDisabled=false,selectedProvider:'meta'|'codex'='codex'
const ordinaryAskNotice='After this approval, Ask sends your explicit questions and drafts immediately to this service with the selected sources and task history shown beside your message, plus enabled saved guidance. Review context whenever needed. Task history can contain copied or derived content from earlier sources even when those sources are now deselected. This session approval ends after connection, account metadata or Codex instructions changes, or when Glint quits. Codex account changes with identical email, plan and workspace metadata cannot be distinguished. No browser, app, file-write or message-sending authority is granted.\n\n';
// Ordinary Ask consent is scoped to this live connection and provider account metadata; no durable account-bound grant exists.
let ordinaryTransmissionConsent:string|undefined
async function getKey(){
  if(connectionDisabled)return undefined
  if(process.env.MODEL_API_KEY)return process.env.MODEL_API_KEY
  if(process.env.META_API_KEY)return process.env.META_API_KEY
  try {if(!safeStorage.isEncryptionAvailable())return undefined;return safeStorage.decryptString(await readFile(credentialPath))} catch{return undefined}
}
const metaProvider=new MetaProvider({getKey,onStatus:connection=>{if(selectedProvider==='meta')emit({type:'connection',connection})}})
const codexProvider=new CodexProvider({enabled:()=>!connectionDisabled,allowUserInstructionFile:true,serviceTier:'default',onStatus:connection=>{if(selectedProvider==='codex')emit({type:'connection',connection})}})
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
  if(c.type==='image.copy')return readImageCopyCommand(c);
  if(c.type==='code-block.copy')return readCodeBlockCopy(c);
  if(String(c.type).startsWith('contacts.'))return readLocalContactsCommand(c);
  if(String(c.type).startsWith('cli.'))return readCliCommand(c);
  if(String(c.type).startsWith('github.'))return readPublicGithubCommand(c);
  if(String(c.type).startsWith('content-backup.'))return readContentBackupCommand(c);
  if(String(c.type).startsWith('speech.'))return readSpeechCommand(c);
  if(String(c.type).startsWith('reading.preferences.'))return readReadingCommand(c);
  if(String(c.type).startsWith('skills.'))return readInstructionSkillCommand(c);
  if(String(c.type).startsWith('source.pdf.'))return readPdfPageCommand(c);
  if(String(c.type).startsWith('study.'))return readStudyCommand(c);
  if(String(c.type).startsWith('code.'))return readCodeCommand(c);
  if(String(c.type).startsWith('conversation.export.'))return readConversationExportCommand(c);
  if(String(c.type).startsWith('projects.'))return readProjectCommand(c);
  const allowed=['system.settings.get','system.settings.update','notifications.get','notifications.change','notifications.context','notifications.opened','notifications.copy','inference.catalog','inference.preview','inference.select','canvas.create','canvas.save','canvas.svg','task-attention.get','task-attention.change','queue.submit','queue.edit','queue.cancel','queue.hold','schedules.get','schedules.change','memory.task.set','memory.get','memory.export','memory.change','memory.preview','source.drag.cancel','source.choose','bots.get','bots.change','bots.assign','capture.settings.get','capture.settings.revoke','capture.settings.private','preferences.get','preferences.update','response-preferences.get','response-preferences.update','tasks.list','tasks.create','tasks.start-local','tasks.start-suggested','tasks.branch','tasks.update','tasks.archive','tasks.get','tasks.delete','tasks.pause','tasks.resume','tasks.checkpoint','draft.save','draft.flushed','learning-drafts.read','learning-drafts.save','learning-drafts.recover','learning-drafts.cleanup','source.text','source.text.inspect','source.document','source.import.choose','source.import.add','source.import.cancel','source.image','source.follow.get','source.follow.enable','source.follow.stop','source.invalidate','source.preview','windows.list','windows.capture','context.start','context.pending','context.capture','context.cancel','context.view','task-view.get','task-pins.get','task-pins.set','artifact.save','artifact.handoff','module.edit','module.document','helper.document.create','helper.document.preview','helper.document.save','helper.document.inspect','helper.create','helper.recorded.inspect','helper.recorded.create','helper.source-batch.preview','helper.source-batch.save','helper.source-batch.inspect','workflow.example','workflow.prepare','truth.review','truth.inspect','packing.practice','packing.practice.inspect','experiment.target.inspect','experiment.target.inspect-original','experiment.target.submit','experiment.source.save','experiment.source.inspect','experiment.practice','experiment.practice.inspect','packing.review','packing.inspect','signal.review','signal.inspect','signal.practice','signal.practice.inspect','signal.overwrite','signal.overwrite.inspect','workflow.review','workflow.contextual.review','workflow.window.review','browser.workflow.save','browser.workflow.run','browser.run','browser.control.status','browser.control','browser.continue','browser.continue.prepare','browser.continue.release','browser.inspect','browser.inspect.cancel','browser.review.notes','browser.detach','procedure.save','procedure.check','experiment.evaluate','export.propose','export.approve','export.inspect','model.run','model.cancel','connection.status','connection.configure','connection.disconnect','connection.select','surface.collapse','surface.expand','surface.companion','surface.floating','surface.hide','surface.workspace','surface.standalone','surface.attach','surface.fit','shortcut.get','shortcut.set','shortcut.reset','presentation.capture','presentation.finish','presentation.reveal','presentation.show']
  if(c.type==='browser.workflow.save'){const {type,...input}=c;return {type,...readBrowserWorkflowSave(input)};}
  if(c.type==='browser.workflow.run'){const {type,...input}=c;return {type,...readBrowserWorkflowRun(input)};}
  if(c.type==='browser.continue'||c.type==='browser.continue.prepare'||c.type==='browser.continue.release'){const {type,...input}=c;return {type:c.type,...readBrowserContinuationInput(input)};}
  if(c.type==='tasks.branch'){const {type,...input}=c;return {type:'tasks.branch',...readResponseBranchInput(input)};}
  if(!allowed.includes(c.type as string))throw Error('Unknown companion command.')
  if(JSON.stringify(c).length>18*1024*1024)throw Error('Command exceeds the local input limit.')
  if(c.type==='experiment.target.inspect'){const {type,...input}=c;return {type,...readTargetPracticeInput(input)};}
  if(c.type==='experiment.target.inspect-original'){const {type,...input}=c;return {type,...readTargetPracticeSubmission(input)};}
  if(c.type==='experiment.target.submit'){const {type,...input}=c;return {type,...readTargetPracticeSubmission(input)};}
  if(c.type==='source.drag.cancel'||c.type==='source.choose'){if(Object.keys(c).length!==1)throw Error('Unknown source gesture field.');return {type:c.type};}
  if(c.type==='source.follow.get'||c.type==='source.follow.enable'||c.type==='source.follow.stop'){if(Object.keys(c).some(key=>key!=='type'))throw Error('Unknown document follow field.');return {type:c.type};}
  if(c.type==='context.pending'){if(Object.keys(c).some(key=>key!=='type'))throw Error('Unknown context recovery field.');return {type:'context.pending'};}
  if(c.type==='capture.settings.get'){if(Object.keys(c).some(key=>key!=='type'))throw Error('Unknown capture settings field.');return {type:c.type};}
  if(c.type==='capture.settings.revoke'||c.type==='capture.settings.private'){
    const keys=c.type==='capture.settings.revoke'?['type','expectedRevision']:['type','expectedRevision','keep','windowIds'];
    if(Object.keys(c).some(key=>!keys.includes(key))||!Number.isSafeInteger(c.expectedRevision)||Number(c.expectedRevision)<0)throw Error('Invalid capture settings change.');
    if(c.type==='capture.settings.private'&&(!Array.isArray(c.keep)||c.keep.length>100||c.keep.some(i=>!Number.isSafeInteger(i)||i<0)||new Set(c.keep).size!==c.keep.length||!Array.isArray(c.windowIds)||c.windowIds.length>100||c.windowIds.some(id=>typeof id!=='string'||!/^window:\d+$/.test(id))||new Set(c.windowIds).size!==c.windowIds.length))throw Error('Choose private applications from native windows.');
  }
  if(c.type==='context.start'||c.type==='context.capture'||c.type==='context.cancel'||c.type==='windows.capture'){
    const keys=c.type==='context.start'?['type','newTask','source','requestId','ownerTaskId']:c.type==='context.capture'?['type','activationId','windowId','taskId']:c.type==='context.cancel'?['type','activationId']:['type','taskId','windowId','sourceId'];
    if(Object.keys(c).some(key=>!keys.includes(key)))throw Error('Unknown capture request field.');
  }
  if(c.type==='inference.catalog'||c.type==='inference.preview'||c.type==='inference.select')return readRequestInferenceCommand(c);
  if(typeof c.type==='string'&&c.type.startsWith('notifications.'))return readNotificationCommand(c);
  if(c.type==='task-attention.get'||c.type==='task-attention.change')return readTaskAttentionCommand(c);
  if(c.type==='task-pins.get'){if(Object.keys(c).some(key=>key!=='type'))throw Error('Unknown task pin field.');return {type:c.type};}
  if(c.type==='tasks.archive'){const {type,...input}=c;return {type,...readTaskArchiveChange(input)};}
  if(c.type==='task-pins.set'){if(Object.keys(c).some(key=>!['type','taskId','pinned'].includes(key))||typeof c.pinned!=='boolean')throw Error('Invalid task pin change.');return {type:c.type,taskId:str(c.taskId,'task ID',200),pinned:c.pinned};}
  if(c.type==='schedules.get'){if(Object.keys(c).some(key=>key!=='type'))throw Error('Unknown schedule field.');return {type:'schedules.get'};}
  if(c.type==='schedules.change'){if(Object.keys(c).some(key=>!['type','change'].includes(key)))throw Error('Unknown schedule field.');return {type:'schedules.change',change:readRecurringWorkChange(c.change)};}
  if(c.type==='memory.export')return readMemoryExportCommand(c);
  if(c.type==='memory.task.set')return readTaskMemoryPolicyCommand(c);
  if(c.type==='memory.get'){if(Object.keys(c).some(key=>key!=='type'))throw Error('Unknown memory field.');return {type:c.type};}
  if(c.type==='memory.preview'){const {type,...input}=c;return {type,...readMemoryPreviewInput(input)};}
  if(c.type==='memory.change'){const {type,...input}=c;return {type,...readMemoryChange(input)};}
  if(c.type==='response-preferences.get'){if(Object.keys(c).some(key=>key!=='type'))throw Error('Unknown response preference field.');return {type:'response-preferences.get'};}
  if(c.type==='system.settings.get'||c.type==='system.settings.update')return readSystemSettingsCommand(c);
  if(c.type==='shortcut.get'||c.type==='shortcut.set'||c.type==='shortcut.reset')return readFallbackShortcutCommand(c);
  if(c.type==='response-preferences.update'){if(Object.keys(c).some(key=>!['type','expectedRevision','enabled','text'].includes(key)))throw Error('Unknown response preference field.');return {type:'response-preferences.update',...readResponsePreferencesUpdate({expectedRevision:c.expectedRevision,enabled:c.enabled,text:c.text})};}
  if(c.type==='preferences.get'){if(Object.keys(c).some(key=>key!=='type'))throw Error('Unknown appearance preference field.');return {type:'preferences.get'};}
  if(c.type==='bots.change'){if(Object.keys(c).some(key=>!['type','change'].includes(key)))throw Error('Unknown companion field.');return {type:'bots.change',change:readBotCommand(c.change)};}
  if(c.type==='bots.assign'){if(Object.keys(c).some(key=>!['type','taskId','botId','expectedBotId'].includes(key)))throw Error('Unknown assignment field.');return {type:'bots.assign',taskId:str(c.taskId,'task ID',200),botId:str(c.botId,'companion ID',200),expectedBotId:str(c.expectedBotId,'previous companion ID',200)};}
  if(c.type==='preferences.update'){if(Object.keys(c).some(key=>!['type','expectedRevision','profile'].includes(key)))throw Error('Unknown appearance preference field.');return {type:'preferences.update',...readCharacterUpdate({expectedRevision:c.expectedRevision,profile:c.profile})};}
  if(c.type==='presentation.capture'){if(Object.keys(c).some(key=>!['type','exitId'].includes(key)))throw Error('Unknown presentation capture field.');return {type:'presentation.capture',exitId:str(c.exitId,'exit ID',200)};}
  if(c.type==='tasks.start-suggested'){const {type,...input}=c;return {type,...readSuggestedTaskInput(input)};}
  if('taskId' in c)str(c.taskId,'task ID',200)
  if(c.type==='task-view.get'&&Object.keys(c).some(key=>key!=='type'))throw Error('Unknown task view field.')
  if(c.type==='context.view'&&Object.keys(c).some(key=>!['type','taskId'].includes(key)))throw Error('Unknown context view field.')
  if(c.type==='browser.control.status'||c.type==='browser.control'){
    const keys=c.type==='browser.control'?['type','taskId','requestId','id','action']:['type','taskId','requestId'];
    if(Object.keys(c).some(key=>!keys.includes(key)))throw Error('Unknown browser control field.');
    str(c.taskId,'task ID',200);str(c.requestId,'request ID',200);
    if(c.type==='browser.control'){str(c.id,'browser control ID',200);if(c.action!=='take'&&c.action!=='return')throw Error('Invalid browser control action.');}
  }
  if(c.type==='browser.run'||c.type==='browser.inspect'||c.type==='browser.inspect.cancel'){
    const keys=c.type==='browser.run'?['type','taskId','requestId','prompt','url','submittedDraft']:c.type==='browser.inspect'?['type','taskId','runId','operationId','url','attemptId']:['type','taskId','runId','operationId','attemptId']
    if(Object.keys(c).some(key=>!keys.includes(key)))throw Error('Unknown browser request field.')
    str(c.taskId,'task ID',200);if(c.type!=='browser.inspect.cancel')str(c.url,'page address',4000)
    if(c.type==='browser.run'){str(c.requestId,'request ID',200);str(c.prompt,'request',16000)}else{str(c.runId,'earlier request',200);str(c.operationId,'earlier action',200);if(c.type==='browser.inspect.cancel'||c.attemptId!==undefined)str(c.attemptId,'inspection attempt',200)}
  }
  if(c.type==='learning-drafts.read'||c.type==='learning-drafts.cleanup'){if(Object.keys(c).some(key=>key!=='type'))throw Error('Unknown practice draft field.');return {type:c.type};}
  if(c.type==='learning-drafts.recover'){if(Object.keys(c).some(key=>!['type','recoveryToken'].includes(key)))throw Error('Unknown practice recovery field.');return {type:c.type,recoveryToken:parseLearningDraftRecoveryToken(c.recoveryToken)};}
  if(c.type==='learning-drafts.save'){
    if(Object.keys(c).some(key=>!['type','owner','slot','expectedEpoch','expectedRevision','value'].includes(key))||!Number.isSafeInteger(c.expectedRevision)||Number(c.expectedRevision)<0)throw Error('Invalid practice draft.');
    const owner=parseLearningDraftOwner(c.owner),slot=parseLearningDraftSlot(c.slot);
    return {type:c.type,owner,expectedEpoch:parseLearningDraftEpoch(c.expectedEpoch),slot,expectedRevision:Number(c.expectedRevision),value:parseLearningDraftValue(c.value,owner,slot)};
  }
  if(c.type==='source.import.choose'||c.type==='source.import.cancel'){const {type,...input}=c;return {type,...readDocumentImportOwner(input)};}
  if(c.type==='source.import.add'){const {type,...input}=c;return {type,...readDocumentImportAdd(input)};}
  if(c.type==='source.document'){const {type,...input}=c;return {type,...readSavedDocumentSourceInput(input)};}
  if(c.type==='artifact.handoff'){const {type,...input}=c;return {type,...readTaskHandoffSave(input)};}
  if(c.type==='source.text.inspect'){
    const {type,...input}=c;return {type,...readSourceTextSaveInspection(input)};
  }
  if(c.type==='source.text'){
    if(Object.keys(c).some(key=>!['type','taskId','source','expectedSource','edit'].includes(key)))throw Error('Unknown text-source field.');
    const source=object(c.source);
    if(Object.keys(source).some(key=>!['kind','id','label','content','role'].includes(key))||source.kind!=='text'||!['fact','style','inspiration'].includes(String(source.role)))throw Error('Choose an ordinary text source and role.');
    const expectedSource=c.expectedSource===undefined?undefined:parseSourceTextExpected(c.expectedSource),sourceId=source.id===undefined?undefined:str(source.id,'source ID',200);
    if(sourceId&&!expectedSource||expectedSource?.sourceId!==sourceId)throw Error('Open the current source before saving an edit.');
    if(sourceId&&c.edit===undefined)throw Error('Reopen the source editor before saving this edit.');
    if(c.edit!==undefined){const edit=object(c.edit);if(Object.keys(edit).some(key=>!['intentId','binding'].includes(key)))throw Error('Unknown source save field.');const parsed=readSourceTextSave({taskId:c.taskId,source,expectedSource,intentId:edit.intentId,binding:edit.binding});return {type:'source.text',taskId:parsed.taskId,source:parsed.source,expectedSource:parsed.expectedSource,edit:{intentId:parsed.intentId,binding:parsed.binding}};}
    return {type:'source.text',taskId:str(c.taskId,'task ID',200),source:{kind:'text',...(sourceId?{id:sourceId}:{}),label:str(source.label,'source label',200),content:str(source.content,'source text',1000000),role:source.role as SourceInput['role']},...(expectedSource?{expectedSource}:{})};
  }
  if(String(c.type).startsWith('queue.'))return readQueueCommand(c);
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
  if(c.type==='model.run'){
    if(Object.keys(c).some(key=>!['type','taskId','requestId','prompt','kind','artifactId','sourceIds','expectedSourceRefs','canvasContext','revisionBasis','conversationAttempt','submittedDraft','briefAction'].includes(key)))throw Error('Unknown model request field.');
    str(c.requestId,'request ID',200);str(c.prompt,'request',16000);
    if(c.canvasContext!==undefined){if(c.kind!=='design-canvas')throw Error('Canvas context applies only to an explicit sketch request.');const context=readCanvasSketchContext(c.canvasContext);if(c.artifactId!==context.basis.artifactId)throw Error('Choose the exact saved canvas for this sketch.');c.canvasContext=context;}else if(c.kind==='design-canvas')throw Error('Choose the saved canvas context before asking for a sketch.');
    if(c.conversationAttempt!==undefined){readConversationAttemptReceipt(c.conversationAttempt);if(!['explain','create'].includes(String(c.kind))||c.artifactId||c.briefAction||c.submittedDraft||c.revisionBasis||c.sourceIds===undefined||c.expectedSourceRefs===undefined)throw Error('Choose a separate ordinary text attempt with current context.');}
    if(c.revisionBasis!==undefined){const basis=parseSavedDocumentDraftBasis(str(c.revisionBasis,'document revision basis',16*1024));if(c.kind!=='revise'||c.artifactId!==basis.artifactId||c.taskId!==basis.taskId||c.briefAction!==undefined||c.submittedDraft!==undefined)throw Error('Revision instructions require their exact saved document.');}
  }
  if(c.type==='experiment.source.save'||c.type==='experiment.source.inspect'){const {type,...input}=c;if(type==='experiment.source.save')readSourceFormulaCommand(input);else{if(Object.keys(input).some(key=>key!=='input'))throw Error('Unknown formula inspection field.');readSourceFormulaInput(input.input);}return c as Command;}
  if(c.type==='helper.document.create'){const {type,...input}=c;return {type,...readDocumentRecipeCreate(input)};}
  if(c.type==='helper.document.preview'){const {type,...input}=c;return {type,...readDocumentRecipeRequest(input)};}
  if(c.type==='helper.document.save'){const {type,...input}=c;return {type,...readDocumentRecipeSave(input)};}
  if(c.type==='helper.document.inspect'){const {type,...input}=c;return {type,...readDocumentRecipeInspection(input)};}
  if(c.type==='helper.source-batch.preview'||c.type==='helper.source-batch.save'||c.type==='helper.source-batch.inspect'){const {type,...input}=c;type==='helper.source-batch.preview'?readHelperSourceBatchRequest(input):type==='helper.source-batch.save'?readHelperSourceBatchSave(input):readHelperSourceBatchInspection(input);return c as Command}
  if(c.type==='helper.recorded.inspect'||c.type==='helper.recorded.create'){const {type,...input}=c;type==='helper.recorded.inspect'?readRecordedTextRequest(input):readRecordedTextAcceptance(input);return c as Command}
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
async function hostStatus():Promise<HostStatus>{const p=await native.permissionStatus();return {profileDir:app.getPath('userData'),sessionDir:app.getPath('sessionData'),platform:process.platform,screenPermission:p.screen,accessibilityPermission:p.accessibility,shortcut:modifierKeymap(process.platform)?.label??shortcut,shortcutStatus:modifierKeymap(process.platform)?(modifierShortcut.status().state==='ready'?'registered':'unavailable'):(shortcutRegistered?'registered':'unavailable'),modifierShortcutStatus:modifierShortcut.status().state,fallbackShortcut:shortcut,fallbackShortcutStatus:globalShortcut.isRegistered(shortcut)?'registered':'unavailable',fallbackShortcutDefault:DEFAULT_FALLBACK_SHORTCUT,captureMode:'explicit-frozen',memoryEnabled:core?(await core.getUserMemory()).enabled:false,dataDir}}
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
  if(mode==='companion'&&!floatingWindow){
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
  let detached=placementMode==='detached'
  const freePlacement=()=>{
    const current=panel.getBounds(),work=screen.getDisplayMatching(current).workArea
    const maxHeight=Math.floor(work.height)
    if(maxHeight<compactMinimumHeight||work.width<360)return null
    const height=Math.max(compactMinimumHeight,Math.min(c.height,maxHeight))
    return {maxHeight,bounds:{x:Math.max(work.x,Math.min(current.x,work.x+work.width-360)),y:Math.max(work.y,Math.min(current.y,work.y+work.height-height)),width:360,height}}
  }
  if(id&&!detached){
    let source:NativeWindow
    try{source=await native.inspect(id)}catch{return null}
    if(!owns()||fit.request!==request||attachedWindowId!==id||attachedOwnerProcessId!==undefined&&source.owner.processId!==attachedOwnerProcessId)return null
    // A native user move can win while source inspection is in flight. Retain
    // its position while fitting content; the source binding stays unchanged.
    detached=placementMode==='detached'
    if(detached){const free=freePlacement();if(!free)return null;({bounds,maxHeight}=free)}
    else{
      const work=screen.getDisplayMatching(source.bounds).workArea,placed=surfacePlacement('companion',source.bounds,work,c.height)
      if(!placed.placement.panelBounds)return null
      bounds=placed.placement.panelBounds;maxHeight=placed.maxHeight
    }
  }else{
    const free=freePlacement();if(!free)return null;({bounds,maxHeight}=free)
  }
  if(!owns()||fit.request!==request)return null
  compactHeight=Math.max(compactMinimumHeight,c.height);fit.maxHeight=maxHeight
  if(id&&!detached)placementMode='attached'
  const current=panel.getBounds()
  if(bounds.x!==current.x||bounds.y!==current.y||bounds.width!==current.width||bounds.height!==current.height){panel.setMinimumSize(320,compactMinimumHeight);panel.setBounds(bounds)}
  return {height:bounds.height,maxHeight}
}
async function expand(mode:typeof viewMode=viewMode){
  await floatingSave;if(floatingWindow&&viewMode==='companion')await botPreferences.saveFloatingState({floatingBounds:panel.getBounds(),floatingVisible:false});floatingWindow=false
  sourceDrag?.cancel()
  if(entrancePresentation&&viewMode===mode)return
  const entrance=entrancePresentation?.anchor??(panel.getSize()[0]<=100?panel.getBounds():undefined);cancelEntrancePresentation(false)
  cancelCollapsePresentation()
  let epoch=++surfaceEpoch
  const preferred=surfaceSize(mode)
  if(attachedWindowId){
    const id=attachedWindowId
    try{
      const source=await native.inspect(attachedWindowId);if(attachedOwnerProcessId!==undefined&&source.owner.processId!==attachedOwnerProcessId)throw Error('Attached window identity changed.');const work=screen.getDisplayMatching(source.bounds).workArea,{placement,maxHeight}=surfacePlacement(mode,source.bounds,work)
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
async function openFloatingCompanion(){
 await floatingSave;const state=await botPreferences.read();if(state.kind!=='available'||state.current.kind!=='ready')throw Error('Open your saved companions before showing the floating window.');
 const catalog=state.current;if(!catalog.bots.some(bot=>bot.id===(catalog.floatingBotId??catalog.defaultBotId)&&!bot.hidden))throw Error('Restore or choose a visible companion before showing the floating window.');
 const saved=catalog.floatingBounds??floatingBounds,work=screen.getDisplayMatching(saved??panel.getBounds()).workArea;
 if(work.width<320||work.height<220)throw Error('This display has no room for a readable floating companion.');
 const bounds=fitFloatingBounds(saved,work);await botPreferences.saveFloatingState({floatingBounds:bounds,floatingVisible:true});
 sourceDrag?.cancel();cancelEntrancePresentation(false);cancelCollapsePresentation();surfaceEpoch++;
 retireDocumentFollow('Floating companion opened. Choose a window explicitly to follow it again.');
 if(viewMode==='workspace'&&panel.getSize()[0]>100)panelBounds=panel.getBounds();
 attachedWindowId=undefined;attachedSourceInfo=undefined;attachedOwnerProcessId=undefined;placementMode='detached';floatingWindow=true;compactFit=undefined;floatingBounds=bounds;
 panel.setAlwaysOnTop(true);showSurface('companion',bounds);
}
async function hideFloatingCompanion(){
 if(!floatingWindow||viewMode!=='companion')throw Error('Open the floating companion before hiding it.');
 floatingBounds=panel.getBounds();await botPreferences.saveFloatingState({floatingBounds,floatingVisible:false});panel.hide();
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
 sourceDrag?.cancel()
 contextIntake=undefined
 if(collapsePresentation||quitting)return null
 if(entrancePresentation){const bounds=entrancePresentation.anchor;cancelEntrancePresentation(false);collapse(bounds);return null}
 if(panel.getSize()[0]<=100){collapse();return null}
 if(credentialWindow&&!credentialWindow.isDestroyed())return null
 const id=randomUUID(),epoch=++surfaceEpoch
 const pending:CollapsePresentation={id,epoch,phase:'drawing',captureStarted:false,bounds:panel.getBounds(),anchor,mode:viewMode,timer:setTimeout(()=>cancelCollapsePresentation(),3500)};collapsePresentation=pending
 emit({type:'presentation.prepare',exitId:id,purpose:'collapse'})
 return null
}
function captureForCurrentExit(exitId:string){
 const collapse=collapsePresentation,quit=exitPending
 const pending=quit?.id===exitId?quit:collapse?.id===exitId&&collapse.phase==='drawing'&&collapse.epoch===surfaceEpoch?collapse:undefined
 if(!pending)throw Error('No matching exit is pending.')
 if(pending.captureStarted)return null
 pending.captureStarted=true
 const terminal=pending===quit,owns=()=>terminal?exitPending===pending:collapsePresentation===pending&&collapse?.phase==='drawing'&&collapse.epoch===surfaceEpoch
 void (async()=>{
  const image=await panel.webContents.capturePage()
  if(!owns())return
  const dataUrl=image.toDataURL()
  if(terminal&&dataUrl.length>32*1024*1024){void finishQuit();return}
  emit({type:'presentation.exit',exitId,purpose:terminal?'quit':'collapse',dataUrl:dataUrl.length<=32*1024*1024?dataUrl:''})
 })().catch(()=>{if(owns()){if(terminal)void finishQuit();else cancelCollapsePresentation()}})
 return null
}
async function attach(id:string,mode:typeof viewMode='companion',activate=true,expectedEpoch?:number,guard:()=>void=()=>{},expected?:NativeWindow){
  guard()
  if(expected){
    const startedEpoch=surfaceEpoch,reviewed=await native.inspect(id);guard()
    if(startedEpoch!==surfaceEpoch)return null
    if(!sameWindowIdentity(reviewed,expected)||reviewed.osId!==expected.osId||expected.knownProtected||reviewed.knownProtected||isCompanionWindow(reviewed,ownApplication()))throw Error('Source changed; choose the window again.')
    await checkCaptureTarget(reviewed,undefined,guard);guard()
    if(startedEpoch!==surfaceEpoch)return null
    const follow=documentFollow.read();if(activate){documentSelectionEpoch++;if(follow.kind==='bound'&&follow.windowId!==id)retireDocumentFollow('A different window was attached.')}
    const entrance=activate&&panel.getSize()[0]<=100?panel.getBounds():undefined
    if(activate){cancelEntrancePresentation(false);cancelCollapsePresentation()}
    return commitAttachment(reviewed,mode,activate,activate?++surfaceEpoch:expectedEpoch??surfaceEpoch,entrance)
  }
  const follow=documentFollow.read();if(activate){documentSelectionEpoch++;if(follow.kind==='bound'&&follow.windowId!==id)retireDocumentFollow('A different window was attached.')}
  const entrance=activate&&panel.getSize()[0]<=100?panel.getBounds():undefined
  if(activate){cancelEntrancePresentation(false);cancelCollapsePresentation()}
  const epoch=activate?++surfaceEpoch:expectedEpoch??surfaceEpoch
  const source=await native.inspect(id);guard()
  if(epoch!==surfaceEpoch||(!activate&&(attachedWindowId!==id||collapsePresentation||entrancePresentation||compactFit?.epoch===epoch&&compactFit.phase==='running')))return null
  return commitAttachment(source,mode,activate,epoch,entrance)
}
function commitAttachment(source:NativeWindow,mode:typeof viewMode,activate:boolean,epoch:number,entrance?:Electron.Rectangle){
  // A stale monitor reflow must not undo a newer native user placement.
  if(!activate&&placementMode==='detached')return null
  attachedWindowId=source.id
  attachedOwnerProcessId=source.owner.processId
  attachedSourceInfo={id:source.id,title:source.title,ownerName:source.owner.name}
  const work=screen.getDisplayMatching(source.bounds).workArea
  const {placement,maxHeight}=surfacePlacement(mode,source.bounds,work)
  viewMode=mode
  if(placement.panelBounds){placementMode='attached';showSurface(mode,placement.panelBounds,'outside-source',activate,entrance,maxHeight);if(mode==='workspace')panelBounds=placement.panelBounds}
  else {placementMode='edge';collapse(placement.anchorBounds,epoch)}
  return placement
}
async function retireUnavailableWindow(id:string,reason:string){
  sourceDrag?.cancel()
  const follow=documentFollow.read();if(follow.kind==='bound'&&follow.windowId===id)retireDocumentFollow(reason)
  if(attachedWindowId===id){attachedWindowId=undefined;attachedOwnerProcessId=undefined;attachedSourceInfo=undefined;surfaceEpoch++}
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
    if(attachedOwnerProcessId!==undefined&&current.owner.processId!==attachedOwnerProcessId)throw Error('Attached window identity changed.')
    for(const before of await core.listTasks()){
      const after=await core.observeWindow(before.id,{windowId:current.id,documentToken:current.documentToken,title:current.title,boundsToken:JSON.stringify(current.bounds)})
      const invalidated=after.sources.filter(source=>source.freshness==='refresh-required'&&before.sources.find(old=>old.id===source.id)?.freshness==='fresh')
      if(invalidated.length){for(const source of invalidated)captures.delete(`${before.id}:${source.id}`);changed(before.id)}
    }
    await documentFollow.poll();if(attachedWindowId!==id||epoch!==surfaceEpoch||quitting)return
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
async function cleanupDeletedTasks(taskIds:readonly string[],clearView=false){
 const ids=new Set(taskIds);let draftCleanup:'unconfirmed'|undefined,viewCleanup:'unconfirmed'|undefined;
 const follow=documentFollow.read();if(currentViewTaskId&&ids.has(currentViewTaskId)||follow.kind==='bound'&&ids.has(follow.taskId))retireDocumentFollow('Task deleted.');
 for(const id of ids){publicGithub.cancel(id);try{await learningDrafts.purgeTask(id);}catch{draftCleanup='unconfirmed';}for(const key of captures.keys())if(key.startsWith(id+':'))captures.delete(key);}
 if(clearView&&(currentViewTaskId&&ids.has(currentViewTaskId)||requestedViewTaskId&&ids.has(requestedViewTaskId))){
  documentSpeech.cancel();sourceDrag?.cancel();sourceContextEpoch++;if(contextIntake?.ownerTaskId&&ids.has(contextIntake.ownerTaskId))contextIntake=undefined;
  if(requestedViewTaskId&&ids.has(requestedViewTaskId))requestedViewTaskId=undefined;
  const selection=viewSelectionQueue.then(async()=>{if(currentViewTaskId&&ids.has(currentViewTaskId)){currentViewTaskId=undefined;const saved=await taskViewPreferences.select(null);if(saved.kind==='unavailable')viewCleanup='unconfirmed';}});viewSelectionQueue=selection.catch(()=>{});
  try{await selection;}catch{viewCleanup='unconfirmed';}
 }
 return {...(draftCleanup?{draftCleanup}:{}),...(viewCleanup?{viewCleanup}:{})};
}
function boundCapture(taskId:string,source:SourceVersion):NativeCapture|undefined{
  purgeExpiredCaptures()
  const key=`${taskId}:${source.id}`,bound=captures.get(key)
  if(!bound||bound.version!==source.version||bound.digest!==source.digest)return undefined
  const capture=bound.capture
  try{
    const metadata=JSON.parse(source.content)
    if(metadata.captureId!==capture.sourceVersion||metadata.imageSha256!==capture.imageSha256||metadata.capturedAt!==capture.capturedAt||JSON.stringify(metadata.transform)!==JSON.stringify(capture.transform)||source.windowId!==capture.source.id||source.documentToken!==capture.source.documentToken)throw Error('Capture binding changed.')
    return capture
  }catch{if(captures.get(key)===bound)captures.delete(key);return undefined}
}
/** Metadata only, sampled before focus changes. The shortcut never picks an
 * arbitrary background window and never grants capture, network or action use. */
function sourceScopeKey(){return JSON.stringify([quitEpoch,sourceContextEpoch,currentViewTaskId,requestedViewTaskId,keyEpoch,capturePrivacyEpoch,captureSettingsHealth,contextIntake?.id,contextIntake?.capturing,captureSetupReviewOpen,!!credentialWindow&&!credentialWindow.isDestroyed()])}
function assertSourceScope(key:string){if(captureSettingsHealth!=='ready'||key!==sourceScopeKey()||quitting)throw Error('Source attachment cancelled.');}
function sourceIntakeCurrent(intake:ContextIntake){return !intake.sourceScope||captureSettingsHealth==='ready'&&intake.sourceScope.privacy===capturePrivacyEpoch&&intake.sourceScope.connection===keyEpoch&&currentViewTaskId===intake.ownerTaskId&&requestedViewTaskId===intake.ownerTaskId}
async function activateDroppedSource(target:NativeWindow,gestureGuard:()=>void,oneSnapshot=false){
 const ownerTaskId=currentViewTaskId,lifecycle=quitEpoch,tucked=!panel.isVisible()||panel.getSize()[0]<=100,scope=sourceScopeKey();
 const guard=()=>{gestureGuard();assertCurrentWork(lifecycle);assertSourceScope(scope);};
 guard();await checkCaptureTarget(target,undefined,guard);guard();
 const startedEpoch=surfaceEpoch,placement=await attach(target.id,'companion',true,undefined,guard,target);
 // Intentional metadata placement changes the anchor and presentation key. Pin
 // the expected committed epoch and nonpresentation scope after that transition.
 assertCurrentWork(lifecycle);assertSourceScope(scope);
 if(!placement||surfaceEpoch!==startedEpoch+1)throw Error('This source attachment ended. Choose the window again.');
 retireDocumentFollow('A dropped source retired document following.');sourceContextEpoch++;
 const id=randomUUID(),activation:ContextActivation={activationId:id,tucked,target,choices:[],origin:'user-drop',intent:'attach',...(ownerTaskId?{ownerTaskId}:{newTask:true})};
 contextIntake={invocation:'drop',id,tucked,windows:[target],expiresAt:Date.now()+120000,capturing:false,selectedWindowId:target.id,ownerTaskId,newTask:!ownerTaskId,activation,sourceScope:{privacy:capturePrivacyEpoch,connection:keyEpoch},dropPlacement:{epoch:surfaceEpoch,noRoom:placement.mode==='edge-anchor'},oneSnapshot};
 emit({type:'context.activate',activation});
}
async function activateSourcePicker(){
 sourceDrag?.cancel();sourceContextEpoch++;contextIntake=undefined;
 if(quitting||currentViewTaskId!==requestedViewTaskId||credentialWindow&&!credentialWindow.isDestroyed())throw Error('Source attachment cancelled.');
 if(captureSettingsHealth!=='ready'){
  const scope=sourceScopeKey(),expansion=expand('workspace'),expectedSurface=surfaceEpoch;await expansion;
  if(scope!==sourceScopeKey()||surfaceEpoch!==expectedSurface||quitting)throw Error('Source attachment cancelled.');
  throw Error('Capture privacy changed. Review the current settings before choosing a source.');
 }
 retireDocumentFollow('An explicit source picker retired document following.');
 const ownerTaskId=currentViewTaskId,id=randomUUID(),tucked=!panel.isVisible()||panel.getSize()[0]<=100,lifecycle=quitEpoch;
 const intake:ContextIntake={invocation:'picker',id,tucked,windows:[],expiresAt:Date.now()+120000,capturing:false,ownerTaskId,newTask:!ownerTaskId,sourceScope:{privacy:capturePrivacyEpoch,connection:keyEpoch}};contextIntake=intake;
 const scope=sourceScopeKey();let expectedSurface=surfaceEpoch;
 const guard=()=>{assertCurrentWork(lifecycle);assertSourceScope(scope);if(contextIntake!==intake||surfaceEpoch!==expectedSurface)throw Error('Source attachment cancelled.');};
 try{
  const permission=await native.permissionStatus();guard();
  if(permission.captureSupported===false||permission.screen!=='granted'){
   const expansion=expand('workspace');expectedSurface=surfaceEpoch;await expansion;guard();
   throw Error(permission.captureSupported===false?'Window snapshots are supported on macOS. This platform is untested.':'Existing screen recording permission is required. No capture was attempted.');
  }
  const windows=await native.listWindows();guard();const choices:NativeWindow[]=[];
  for(const target of windows){guard();try{await checkCaptureTarget(target,undefined,guard);guard();choices.push(target);}catch{guard();}}
  guard();intake.windows=choices;
  const expansion=expand('workspace');expectedSurface=surfaceEpoch;await expansion;guard();
  const activation:ContextActivation={activationId:id,tucked,choices,origin:'source-picker',intent:'attach',...(ownerTaskId?{ownerTaskId}:{newTask:true})};intake.activation=activation;emit({type:'context.activate',activation});
 }catch(error){if(contextIntake===intake)contextIntake=undefined;throw error;}
}
function installNativeWindowMove(){
 const saveFloating=(bounds:Electron.Rectangle)=>{if(!floatingWindow||viewMode!=='companion'||quitting||panel.getSize()[0]<=100)return;if(bounds.width<320||bounds.height<220||bounds.width>16000||bounds.height>16000)return;floatingBounds=bounds;floatingSave=floatingSave.then(()=>botPreferences.saveFloatingState({floatingBounds:bounds})).catch(error=>{console.error('Floating placement could not be saved:',publicErrorMessage(error));});};
 panel.on('will-resize',(_event,bounds)=>saveFloating(bounds));

 // Electron emits will-move only for manual native moves, not setBounds or
 // setPosition. The anchor retains its separate character-to-source gesture.
 panel.on('will-move',(_event,bounds)=>{
  if(quitting||panel.getSize()[0]<=100||collapsePresentation||entrancePresentation)return
  // Free placement applies to this open panel only. Keep the selected source,
  // document-follow authority and polling; an explicit reopen repositions it.
  placementMode='detached';saveFloating(bounds)
  if(viewMode==='workspace')panelBounds={...bounds}
 })
}
function installNativeSourceDrag(){
 sourceDragPreview=createSourceDragPreview(()=>panel.getBounds());
 const context=()=>({anchor:!quitting&&captureSettingsHealth==='ready'&&!captureSetupReviewOpen&&!contextIntake?.capturing&&currentViewTaskId===requestedViewTaskId&&panel.getSize()[0]<=100&&!collapsePresentation&&!entrancePresentation&&(!credentialWindow||credentialWindow.isDestroyed()),key:JSON.stringify([sourceScopeKey(),documentSelectionEpoch,surfaceEpoch,collapsePresentation?.id,entrancePresentation?.id])});
 const ignoredWindowIds=()=>{const match=/^window:([1-9]\d*):[01]$/.exec(panel.getMediaSourceId());if(!match||!Number.isSafeInteger(Number(match[1])))throw Error('Native anchor identity is unavailable.');return [`window:${match[1]}`,...sourceDragPreview!.ids(),...notificationToast.ids()];};
 sourceDrag=createNativeSourceDrag({native,own:ownApplication,context,cursor:()=>screen.getCursorScreenPoint(),bounds:()=>panel.getBounds(),ignoredWindowIds,
  move:bounds=>{const work=screen.getDisplayMatching(bounds).workArea;panel.setBounds({...bounds,x:Math.max(work.x,Math.min(bounds.x,work.x+work.width-bounds.width)),y:Math.max(work.y,Math.min(bounds.y,work.y+work.height-bounds.height))});},
  checkTarget:async(target,assertCurrent)=>{const guard=()=>{assertCurrent();if(captureSettingsHealth!=='ready')throw Error('Capture privacy changed. Snapshots are paused until you review Screen & shortcut settings.');};guard();await checkCaptureTarget(target,undefined,guard);guard();},
  attach:activateDroppedSource,
  presented:()=>sourceDragPreview!.presented(),
  preview:(state,target)=>{if(!panel.isDestroyed()){sourceDragPreview!.show(state,target);emit({type:'source.drag',state});}},
 });
 panel.webContents.on('before-mouse-event',(event,input)=>{try{if(sourceDrag!.mouse(input))event.preventDefault();}catch(error){sourceDrag!.cancel();emit({type:'context.error',message:publicErrorMessage(error)});}});
 panel.webContents.on('before-input-event',(event,input)=>{if(input.type==='keyDown'&&input.key==='Escape'&&context().anchor){event.preventDefault();sourceDrag!.cancel();}});
 panel.webContents.on('render-process-gone',()=>sourceDrag?.cancel());panel.webContents.on('did-start-navigation',()=>sourceDrag?.cancel());panel.on('blur',()=>sourceDrag?.cancel());
}
function activateShortcut(){if(captureSetupReviewOpen){contextIntake=undefined;emit({type:'context.error',message:'Finish the setup review, then press the shortcut again.'});return Promise.resolve();}const taskId=currentViewTaskId;return activateContext({type:'context.start',...(taskId?{ownerTaskId:taskId}:{newTask:true})},'shortcut')}
async function activateContext(options:Extract<Command,{type:'context.start'}>={type:'context.start'},invocation:'interface'|'shortcut'='interface'){
 sourceDrag?.cancel();sourceContextEpoch++
 if(quitting||credentialWindow&&!credentialWindow.isDestroyed())return
 retireDocumentFollow('A new explicit source selection retired document following.')
 const id=randomUUID(),tucked=!panel.isVisible()||panel.getSize()[0]<=100
 contextIntake={invocation,id,tucked,windows:[],expiresAt:Date.now()+120000,capturing:false,ownerTaskId:options.source?.taskId??options.ownerTaskId,newTask:options.newTask}
 try{
  const [foreground,windows]=await Promise.all([native.foregroundWindow(),native.listWindows()]);if(contextIntake?.id!==id)return
  const own=ownApplication(),eligible=windows.filter(window=>!isCompanionWindow(window,own))
  let refreshTarget:NativeWindow|undefined;
  if(options.source){const ref=object(options.source);if(Object.keys(ref).sort().join(',')!=='digest,sourceId,taskId,version'||typeof ref.digest!=='string'||!Number.isSafeInteger(ref.version))throw Error('Choose a saved source to refresh.');const t=await core.getTask(str(ref.taskId,'task ID',200));if(contextIntake?.id!==id)return;const source=t.sources.find(s=>s.id===str(ref.sourceId,'source ID',200)),version=source?.versions.find(v=>v.version===ref.version&&v.digest===ref.digest);if(!version||version.kind!=='window')throw Error('Choose a window source to refresh.');refreshTarget=eligible.find(window=>window.id===version.windowId&&window.documentToken===version.documentToken);}
  const bound=invocation==='interface'&&foreground&&isCompanionWindow(foreground,own)&&attachedWindowId?eligible.find(window=>window.id===attachedWindowId):undefined
  const result=invocation==='shortcut'?chooseShortcutTarget(foreground,windows,own):chooseContextTarget(options.source?refreshTarget:bound??foreground,windows,own)
  if(result.kind==='unavailable'){contextIntake=undefined;if(tucked)await expand('workspace');emit({type:'context.error',message:result.reason});return}
  contextIntake.windows=result.kind==='target'?[result.window]:result.windows
  const bots=await botPreferences.read();if(contextIntake?.id!==id)return;
  if(tucked&&(result.kind==='choose'||bots.kind==='available'&&bots.current.kind==='choose'))await expand('workspace')
  if(contextIntake?.id!==id)return
  const activation:ContextActivation={activationId:id,tucked,target:result.kind==='target'?result.window:undefined,choices:result.kind==='choose'?result.windows:[],...(invocation==='shortcut'?{trigger:'shortcut' as const}:{}),...(options.newTask?{newTask:true}:{}),...(options.source?{analyze:true,source:options.source,ownerTaskId:options.source.taskId}:options.ownerTaskId?{ownerTaskId:options.ownerTaskId}:{}),...(options.requestId?{requestId:options.requestId}:{})};contextIntake.activation=activation;emit({type:'context.activate',activation})
 }catch(error){if(contextIntake?.id!==id)return;contextIntake=undefined;emit({type:'context.error',message:publicErrorMessage(error)})}
}
async function createAssignedTask(input:{title:string;goal?:string}){const state=await botPreferences.read();if(state.kind!=='available'||state.current.kind!=='ready')throw Error('Choose your companion before starting a task.');return core.createTask({...input,assignedBotId:state.current.defaultBotId});}
async function captureApplication(window:NativeWindow):Promise<CaptureApplicationIdentity|null>{
 const parse=Schema.decodeUnknownOption(CaptureApplicationIdentitySchema,{onExcessProperty:'error'});
 const bundle=parse({kind:'bundle-id',value:window.owner.bundleId});
 if(bundle._tag==='Some')return bundle.value;
 // Capture currently supports macOS. Do not turn untested Windows paths into Unix identities.
 if(process.platform!=='darwin'||!window.owner.path)return null;
 try{const path=parse({kind:'executable-path',value:await realpath(window.owner.path)});return path._tag==='Some'?path.value:null;}catch{return null;}
}
async function checkCaptureTarget(target:NativeWindow|NativeWindow[],state:CaptureState|undefined,guard:()=>void,revision?:number,shortcut=false,requireProtection=false){
 guard();const settings=state??await captureSettings.read();guard();
 if(settings.kind!=='available')throw Error(settings.message);
 if(revision!==undefined&&settings.current.revision!==revision)throw Error('Capture privacy changed. Start a new capture.');
 const prepared=[];
 for(const expected of Array.isArray(target)?target:[target]){
  const identitySource=await native.inspect(expected.id);guard();if(!sameWindowIdentity(identitySource,expected))throw Error('Source changed; select and refresh it.');
  const application=await captureApplication(identitySource);guard();prepared.push({expected,application});
 }
 const inspected=[];
 for(const item of prepared){const current=await native.inspect(item.expected.id);guard();if(!sameWindowIdentity(current,item.expected))throw Error('Source changed; select and refresh it.');inspected.push({...item,current});}
 const permission=await native.permissionStatus();guard();if(permission.captureSupported===false||permission.screen==='unsupported')throw Error('Window snapshots are supported on macOS. This platform is untested.');
 for(const {application,current} of inspected){
  if(requireProtection){const protection=await native.inspectProtection(current.id,current.owner.processId);guard();if(protection.knownProtected)throw Error(captureBlockMessage('protected-window'));}
  const facts={screenPermission:permission.screen==='granted'?'granted' as const:'not-granted' as const,target:{application,self:isCompanionWindow(current,ownApplication()),knownProtected:current.knownProtected===true}};
  const decision=shortcut?evaluateCapturePolicy(settings,{...facts,trigger:'shortcut'}):evaluateCapturePrivacy(settings,facts);
  if(decision.kind==='blocked')throw Error(captureBlockMessage(decision.reason));
 }
}

function captureBlockMessage(reason:string){
 if(reason==='os-permission')return 'Existing screen recording permission and supported native capture are required. No capture was attempted.';
 if(reason==='self-window')return 'Choose an external window. Companion windows cannot be captured.';
 if(reason==='private-application')return 'This app is private. Its windows cannot be captured or sent.';
 if(reason==='application-unidentified')return 'This app could not be compared with your private apps. Capture is blocked.';
 if(reason==='protected-window')return 'This window is known to be protected. Capture is blocked.';
 return 'Capture setup is unavailable. Press the screen context shortcut to review setup.';
}
function captureSaveObservation(observed:CaptureState,before:CaptureSnapshot,policy:CaptureSnapshot['policy']){
 return observed.kind==='available'&&observed.current.revision===before.revision+1&&JSON.stringify(observed.current.policy)===JSON.stringify(policy)?'matches-intended':'different-or-unavailable';
}
async function updateCapturePrivacy(c:Extract<Command,{type:'capture.settings.revoke'|'capture.settings.private'}>){
 sourceDrag?.cancel();sourceContextEpoch++
 retireDocumentFollow('Capture privacy changed. Bind a window again explicitly.');
 const lifecycle=quitEpoch,epoch=++capturePrivacyEpoch;captureSettingsHealth='changing';capturePrivacyAbort.abort();capturePrivacyAbort=new AbortController();contextIntake=undefined;captures.clear();emit({type:'capture.retired'});
 const guard=()=>{assertCurrentWork(lifecycle);if(epoch!==capturePrivacyEpoch)throw Error('Capture privacy changed again. Read the current settings.');};
 try{
 const state=await captureSettings.read();guard();if(state.kind!=='available')return state;
 if(state.current.revision!==c.expectedRevision)return {kind:'conflict',current:state.current};
 let privateApps:CaptureApplicationIdentity[]=[];
 if(c.type==='capture.settings.private'){
  for(const index of c.keep){const identity=state.current.policy.privateApps[index];if(!identity)throw Error('Private apps changed. Read the current settings.');privateApps.push(identity);}
  for(const id of c.windowIds){const target=await native.inspect(id);guard();if(isCompanionWindow(target,ownApplication()))throw Error('Choose an external app.');const identity=await captureApplication(target);guard();if(!identity)throw Error('This app has no verified application identity. No privacy change was saved.');const current=await native.inspect(id);guard();if(!sameWindowIdentity(target,current))throw Error('Source changed. Choose the app again.');if(!privateApps.some(app=>app.kind===identity.kind&&app.value===identity.value))privateApps.push(identity);}
  const choice=await dialog.showMessageBox(panel,{type:'question',message:'Update private apps?',detail:`These apps will be blocked from window capture and sending snapshots.\n\n${privateApps.map(app=>app.value).join('\n')||'No private apps'}\n\nCurrent snapshots have been cleared. Task history is kept.`,buttons:['Cancel','Save private apps'],defaultId:0,cancelId:0});guard();if(choice.response!==1)throw Error('Private app update cancelled. Current snapshots were cleared.');
 }
 try{const result=await captureSettings.update(c.type==='capture.settings.revoke'?{kind:'revoke-setup',expectedRevision:c.expectedRevision}:{kind:'replace-private-apps',expectedRevision:c.expectedRevision,privateApps});guard();if(result.kind==='saved')captureSettingsHealth='ready';return result;}
 catch(error){if(error instanceof CaptureSettingsSaveError&&error.outcome==='uncertain'){const current=await captureSettings.read();guard();return {kind:'unconfirmed',state:current,observation:captureSaveObservation(current,state.current,c.type==='capture.settings.revoke'?{...state.current.policy,setupApproval:'not-approved'}:{...state.current.policy,privateApps}),message:'The save could not be confirmed. Snapshots remain cleared. Read the current settings before continuing.'};}throw error;}
 }finally{if(epoch===capturePrivacyEpoch&&captureSettingsHealth==='changing')captureSettingsHealth='unconfirmed';}
}
async function refreshFollowedSource(binding:DocumentBinding,stamp:RuntimeDocumentStamp,assertCurrent:()=>void){
 const lifecycle=quitEpoch,privacy=capturePrivacyEpoch;
 const guard=()=>{assertCurrentWork(lifecycle);assertCurrent();documentFollow.assertGrant(binding);if(currentViewTaskId!==binding.taskId||attachedWindowId!==binding.windowId||privacy!==capturePrivacyEpoch||captureSettingsHealth!=='ready')throw Error('The followed task, window or privacy scope changed.');};
 guard();const target=await native.inspect(binding.windowId);guard();if(target.owner.processId!==binding.processId)throw Error('The followed window owner changed.');
 const work=screen.getDisplayMatching(target.bounds).workArea,placement=surfacePlacement(viewMode,target.bounds,work).placement;
 if(!placement.panelBounds)return null;
 const check=async()=>{guard();if(!surfacePlacement(viewMode,target.bounds,screen.getDisplayMatching(target.bounds).workArea).placement.panelBounds)throw Error('There is no room beside the selected window. No new snapshot was published.');const observed=await documentSources.observe(target,{assertCurrent:guard,signal:capturePrivacyAbort.signal});guard();if(observed.kind!=='document'||documentStampChange(stamp,observed.stamp)!==undefined)throw Error('The selected active document observation changed. No snapshot was published.');return observed.stamp;};
 let capture:DocumentCapture|undefined;
 const task=await captureWindowSource({taskId:binding.taskId,windowId:binding.windowId,sourceId:binding.ref.sourceId},guard,target,undefined,{binding,stamp,check},value=>{capture=value;});guard();
 return {task,sourceId:binding.ref.sourceId,target:await native.inspect(binding.windowId),capture};
}
function retireCapturedSource(taskId:string,reference:SourceRef){const key=`${taskId}:${reference.sourceId}`,cached=captures.get(key);if(cached?.version===reference.version&&cached.digest===reference.digest)captures.delete(key)}
async function captureWindowSource(c:{taskId?:string;windowId:string;sourceId?:string;newTaskTitle?:string},contextGuard:()=>void=()=>{},expected?:NativeWindow,shortcutIntake?:ContextIntake,follow?:{binding:DocumentBinding;stamp:RuntimeDocumentStamp;check:()=>Promise<RuntimeDocumentStamp>},onCaptured?:(capture:DocumentCapture)=>void,dropIntake?:ContextIntake):Promise<Task>{
      const sourceBindingEpoch=documentSelectionEpoch;
      const lifecycle=quitEpoch,privacy=capturePrivacyEpoch,guard=()=>{assertCurrentWork(lifecycle);contextGuard();if(privacy!==capturePrivacyEpoch||captureSettingsHealth==='changing')throw Error('Capture privacy changed. Start a new capture.');}
      let refreshReference:SourceRef|undefined;if(c.sourceId){if(!c.taskId)throw Error('Select a saved task before refreshing a source.');const t=await core.getTask(c.taskId),version=t.sources.find(s=>s.id===c.sourceId)?.versions.at(-1);if(version?.kind!=='window')throw Error('Select a window source to refresh.');refreshReference={sourceId:c.sourceId,version:version.version,digest:version.digest};}
      guard();const target=await native.inspect(str(c.windowId,'window ID',100));guard();if(expected&&!sameWindowIdentity(target,expected))throw Error('Source changed; use the shortcut again.');
      if(dropIntake&&(contextIntake!==dropIntake||dropIntake.invocation!=='drop'||dropIntake.windows.length!==1||!sameWindowIdentity(target,dropIntake.windows[0])))throw Error('This source attachment expired.');
      let settings=await captureSettings.read();guard();await checkCaptureTarget(target,settings,guard,undefined,false,!!dropIntake);
      // All document observations in this capture share one last-known hint.
      // Missing hints never erase a learned boolean; address identity stays fixed.
      let captureStamp=follow?.stamp;
      const acceptCaptureStamp=(stamp:RuntimeDocumentStamp)=>{if(captureStamp&&documentStampChange(captureStamp,stamp)!==undefined)throw Error('Document observation changed during capture. Capture the selected window again.');if(!captureStamp||stamp.edited!==undefined)captureStamp=stamp;};
      if(follow){documentFollow.assertGrant(follow.binding);acceptCaptureStamp(await follow.check());guard();}
      else if(shortcutIntake){
        if(contextIntake!==shortcutIntake||shortcutIntake.invocation!=='shortcut'||shortcutIntake.windows.length!==1||!sameWindowIdentity(target,shortcutIntake.windows[0]))throw Error('This shortcut capture expired.');
        if(settings.kind!=='available')throw Error(settings.message);
        if(settings.current.policy.setupApproval!=='approved'||captureSettingsHealth==='unconfirmed'){
          const reviewed=settings.current;
          captureSetupReviewOpen=true;let choice:{response:number};
          try{choice=await dialog.showMessageBox(panel,{type:'question',message:'Set up shortcut snapshots?',detail:`${target.owner.name}\n${target.title||'Untitled window'}\n\nAllow the screen context shortcut to capture the focused window, starting with this one. This setup stays on after reopening and compatible updates.\n\nSnapshots stay locally for five minutes. Capture setup does not authorize sending to an AI service. This does not allow changes to apps or files. Turn it off or choose private apps in Screen & shortcut settings.\n\nPrivate apps: ${reviewed.policy.privateApps.map(app=>app.value).join(', ')||'None'}`,buttons:['Cancel','Allow shortcut snapshots'],defaultId:0,cancelId:0});}finally{captureSetupReviewOpen=false;}
          guard();if(choice.response!==1)throw Error('Capture cancelled. No pixels were captured.');
          await checkCaptureTarget(target,await captureSettings.read(),guard,reviewed.revision);
          try{
            const saved=await captureSettings.update({kind:'approve-setup',expectedRevision:reviewed.revision,policyVersion:CURRENT_CAPTURE_POLICY_VERSION,privateApps:reviewed.policy.privateApps});guard();
            if(saved.kind!=='saved')throw Error('Capture setup changed. Press the shortcut again to review it.');
            captureSettingsHealth='ready';
          }catch(error){
            if(error instanceof CaptureSettingsSaveError&&error.outcome==='uncertain'){captureSettingsHealth='unconfirmed';const observed=await captureSettings.read();guard();const observation=captureSaveObservation(observed,reviewed,{...reviewed.policy,setupApproval:'approved'});throw Error(observation==='matches-intended'?'Setup appears saved, but its save could not be confirmed. Press the shortcut again for a new review.':'Setup could not be reconciled. Snapshots are paused. Review Screen & shortcut settings.');}
            throw error;
          }
          settings=await captureSettings.read();guard();
        }
      }else if(dropIntake?.oneSnapshot){
        if(captureSettingsHealth!=='ready')throw Error('Capture privacy needs review. Press the shortcut again or save your privacy settings.');
      }else{
        if(captureSettingsHealth!=='ready')throw Error('Capture privacy needs review. Press the shortcut again or save your privacy settings.');
        const choice=await dialog.showMessageBox(panel,{type:'question',message:'Capture this window?',detail:`${target.owner.name}\n${target.title||'Untitled window'}\n\nThis one snapshot stays locally for five minutes. It is shared only when you send an AI request. Initial AI-service consent is separate. Manual capture asks each time.`,buttons:['Cancel','Capture selected window'],defaultId:0,cancelId:0});
        guard();if(choice.response!==1)throw Error('Capture cancelled. No pixels were captured.');
      }
      if(settings.kind!=='available')throw Error(settings.message);
      const revision=settings.current.revision;
      const beforeDocument=await documentSources.observe(target,{assertCurrent:guard,signal:capturePrivacyAbort.signal});guard();if(follow&&(beforeDocument.kind!=='document'||documentStampChange(follow.stamp,beforeDocument.stamp)!==undefined))throw Error('Document observation changed before capture. No new snapshot was published.');
      if(beforeDocument.kind==='document')acceptCaptureStamp(beforeDocument.stamp);
      const finalCheck=async()=>{await checkCaptureTarget(target,undefined,guard,revision,!!shortcutIntake,!!dropIntake);guard();if(follow){acceptCaptureStamp(await follow.check());guard();}else if(captureStamp){const current=await documentSources.observe(target,{assertCurrent:guard,signal:capturePrivacyAbort.signal});guard();if(current.kind!=='document')throw Error('Document observation changed during capture. Capture the selected window again.');acceptCaptureStamp(current.stamp);}};
      await finalCheck();guard();
      const capture=await native.capture(str(c.windowId,'window ID',100),{maxPixels:2560,expectedDocumentToken:target.documentToken,beforeCapture:finalCheck,assertCurrent:guard});
      guard();await finalCheck();guard();
      if(!sameWindowIdentity(capture.source,target))throw Error('Source changed during capture. No snapshot was saved.')
      guard();purgeExpiredCaptures();const oldKey=c.sourceId?`${c.taskId}:${c.sourceId}`:undefined
      const total=capture.png.length+[...captures.entries()].filter(([key])=>key!==oldKey).reduce((n,[,value])=>n+value.capture.png.length,0)
      if(capture.png.length>8*1024*1024||total>32*1024*1024){
        // A rejected refresh cannot leave old pixels looking like a successful refresh.
        if(c.taskId&&refreshReference){retireCapturedSource(c.taskId,refreshReference);await core.invalidateSource(c.taskId,refreshReference.sourceId,'Capture refresh exceeded the memory limit. Refresh with a smaller source window.',refreshReference);changed(c.taskId)}
        throw Error(capture.png.length>8*1024*1024?'Selected capture exceeds 8 MiB. Use a smaller source window.':'In-memory window references exceed 32 MiB. Refresh with smaller source windows.')
      }
      if(c.taskId&&refreshReference)retireCapturedSource(c.taskId,refreshReference)
      // A cancelled native capture must not create an empty task. Create the
      // local task only after consent and the bounded capture have succeeded.
      guard();const createdTask=c.taskId?undefined:await createAssignedTask({title:c.newTaskTitle||capture.source.title||capture.source.owner.name||'Window task'}),selectedTaskId=c.taskId??createdTask!.id;
      const discardUnpublishedTask=async(expected=createdTask)=>{if(!expected)return false;try{return await core.discardTaskIfUnchanged(expected);}catch{return false;/* Keep a closing/failed store intact for restart reconciliation. */}};
      try{guard();}catch(error){await discardUnpublishedTask();throw error;}
      let t:Task;try{t=await core.putSource(selectedTaskId,{id:c.sourceId,kind:'window',label:(capture.source.title||capture.source.owner.name||'Untitled window').slice(0,200),content:JSON.stringify({captureId:capture.sourceVersion,imageSha256:capture.imageSha256,transform:capture.transform,capturedAt:capture.capturedAt,freshness:'frozen-explicit-capture'}),role:'fact',windowId:capture.source.id,documentToken:capture.source.documentToken,windowProcessId:capture.source.owner.processId,...(captureStamp?{documentStamp:persistedDocumentStamp(captureStamp)}:{}),title:capture.source.title,boundsToken:JSON.stringify(capture.source.bounds)},createdTask,follow?.binding.ref??refreshReference,guard)}catch(error){await discardUnpublishedTask();throw error;}
      const source=c.sourceId?t.sources.find(x=>x.id===c.sourceId):t.sources.at(-1);if(!source)throw Error('Source was not stored.')
      try{await finalCheck();guard();}catch(error){const discarded=createdTask&&await discardUnpublishedTask(t);if(!discarded){try{await core.invalidateSource(selectedTaskId,source.id,'The capture was interrupted before its pixels were published. Capture the window again.',{sourceId:source.id,version:source.currentVersion,digest:source.versions.at(-1)!.digest});}catch{}if(c.taskId)changed(c.taskId);}throw error;}
      const version=source.versions.at(-1)!
      const liveCapture=captureStamp?{ref:{sourceId:source.id,version:version.version,digest:version.digest},stamp:{...captureStamp}}:undefined;
      if(!follow&&sourceBindingEpoch===documentSelectionEpoch&&(createdTask||currentViewTaskId===selectedTaskId&&requestedViewTaskId===selectedTaskId))documentFollow.bind({task:t,sourceId:source.id,target:capture.source,capture:liveCapture});
      captures.set(`${selectedTaskId}:${source.id}`,{capture,version:version.version,digest:version.digest});if(liveCapture)onCaptured?.(liveCapture);changed(selectedTaskId);return t
}
type RecurringGrant={id:string;scope:string;epoch:number;route:'meta'|'codex';preferences:string;accountScope?:string;controller:AbortController;active?:{taskId:string;requestId:string}};
type RecurringInvocation={grant:RecurringGrant;taskId:string;requestId:string;prompt:string};
const recurringGrants=new Map<string,RecurringGrant>();
const recurringScope=(item:import('../shared/recurring-work').RecurringWork)=>JSON.stringify([item.id,item.title,item.instruction,item.intervalHours,item.mode,item.timeZone]);
function assertRecurringGrant(grant:RecurringGrant){if(recurringGrants.get(grant.id)!==grant||grant.controller.signal.aborted||grant.epoch!==keyEpoch||grant.route!==selectedProvider)throw Error('Recurring response authorization changed. Review the schedule and Resume.');}
async function checkRecurringGrant(grant:RecurringGrant){
 assertRecurringGrant(grant);
 const item=(await core.getRecurringWork()).find(item=>item.id===grant.id);
 if(!item?.enabled||item.mode!=='response'||recurringScope(item)!==grant.scope)throw Error('The saved recurring scope changed. Review the schedule and Resume.');
 const preferences=await responsePreferences.lease();await preferences.check();assertRecurringGrant(grant);
 if(JSON.stringify(preferences.current)!==grant.preferences)throw Error('Response preferences changed. Review the schedule and Resume.');
}
async function retireRecurringGrant(id:string){
 const grant=recurringGrants.get(id);if(!grant)return;
 recurringGrants.delete(id);grant.controller.abort();
 if(grant.active){try{await core.cancelRequest(grant.active.taskId,grant.active.requestId);}catch{}}
}
async function retireRecurringGrants(){for(const id of [...recurringGrants.keys()])await retireRecurringGrant(id);}
async function authorizeRecurring(item:import('../shared/recurring-work').RecurringWork,lifecycle:number):Promise<RecurringGrant>{
 const epoch=keyEpoch,route=selectedProvider,preferences=await responsePreferences.lease();await preferences.check();
 const connection=await activeProvider().status();assertCurrentWork(lifecycle);
 if(!connection.configured)throw Error('Check the provider connection before authorizing recurring responses.');
 const accountScope=await activeProvider().accountScope();
 assertCurrentWork(lifecycle);if(epoch!==keyEpoch||route!==selectedProvider)throw Error('Connection changed. Resume again to review its current scope.');
 const unverified=item.history.filter(run=>run.status==='failed'||run.status==='interrupted'||run.status==='running').at(-1);
 const choice=await dialog.showMessageBox(panel,{type:'question',message:'Authorize recurring responses for this app session?',detail:`Schedule: ${item.title}\nEvery ${item.intervalHours} elapsed hours. Next due: ${item.nextDueAt}${item.timeZone?' ('+item.timeZone+' display zone)':''}.\n\nDestination: ${connection.provider} · ${connection.model} · ${connection.tier??'selected tier'}\n\nExact saved question:\n${item.instruction}\n\nSources: none. Saved user memory: none. Each occurrence starts a separate task with no earlier task history.\n\n${preferences.consent}\n\n${unverified?`Previous occurrence (${unverified.scheduledFor}) has an unverified outcome. Its task is kept and that occurrence will not be retried. This authorization covers future due occurrences only; review the earlier task before continuing if duplication matters.\n\n`:''}${route==='codex'?'Uses the current Codex sign-in and its existing user instructions. Sign-in email/plan/workspace metadata and user instructions are checked before each generation. Account changes with identical metadata cannot be distinguished.':'Uses the selected Meta account through the key already configured in Glint.'}\n\nAuthorize one response per due occurrence while Glint is open, using your existing account allowance and any applicable charges. Results stay in local tasks. No browser, app, capture, export, external file write, or message-sending authority is granted.\n\nSleep/closure delays work; only the latest missed occurrence runs after you Resume. A failed or unverified response pauses the schedule and is never retried automatically. Restart, edits, connection or preference changes require a new Resume authorization.`,buttons:['Cancel','Authorize repeats this session'],defaultId:0,cancelId:0});
 assertCurrentWork(lifecycle);await preferences.check();if(choice.response!==1)throw Error('Recurring responses were not authorized. The schedule stays paused.');
 if(epoch!==keyEpoch||route!==selectedProvider)throw Error('Connection changed. Resume again to authorize its current scope.');
 if(await activeProvider().accountScope()!==accountScope)throw Error('The account or instructions changed. Resume again to authorize the current scope.');
 return {id:item.id,scope:recurringScope(item),epoch,route,preferences:JSON.stringify(preferences.current),...(accountScope?{accountScope}:{}),controller:new AbortController()};
}
const recurringWorkRunner=createRecurringWorkRunner({
 prepare:async guard=>{
  const lifecycle=quitEpoch;guard();assertCurrentWork(lifecycle);
  const items=await core.getRecurringWork();guard();assertCurrentWork(lifecycle);
  for(const item of items)if(item.enabled&&item.mode==='response'){
   const grant=recurringGrants.get(item.id);
   try{if(!grant)throw Error();await checkRecurringGrant(grant);}
   catch{await retireRecurringGrant(item.id);await core.haltRecurringWork(item.id,'Recurring authorization is unavailable or its connection/preferences changed. Review history and Resume to authorize the current scope.');}
  }
  guard();assertCurrentWork(lifecycle);
  if(!items.some(item=>item.enabled&&Date.parse(item.nextDueAt)<=Date.now()))return [];
  const state=await botPreferences.read();guard();assertCurrentWork(lifecycle);
  if(state.kind!=='available'||state.current.kind!=='ready')throw Error('Choose a companion before running scheduled work.');
  const ids=await core.prepareRecurringWork(state.current.defaultBotId,()=>{guard();assertCurrentWork(lifecycle);},[...recurringGrants.keys()]);
  if(ids.length){changed();emit({type:'schedules.changed'});}
  const prepared=await core.getRecurringWork();
  for(const item of prepared)for(const run of item.history)if(item.mode==='response'&&run.status==='running'&&run.requestId&&ids.includes(run.taskId)){
   const grant=recurringGrants.get(item.id);
   try{
    guard();assertCurrentWork(lifecycle);if(!grant)throw Error('Recurring authorization was retired.');await checkRecurringGrant(grant);
    grant.active={taskId:run.taskId,requestId:run.requestId};
    await command({type:'model.run',taskId:run.taskId,requestId:run.requestId,kind:'explain',prompt:item.instruction,sourceIds:[],expectedSourceRefs:[]},{grant,taskId:run.taskId,requestId:run.requestId,prompt:item.instruction});
   }catch{if(grant)await retireRecurringGrant(item.id);}
   finally{if(grant)grant.active=undefined;await core.finishRecurringWork(item.id,run.taskId,run.requestId);emit({type:'schedules.changed'});changed(run.taskId);}
  }
  return ids;
 },
 changed:ids=>{emit({type:'schedules.changed'});if(ids.length)changed();},
});
function assertCurrentWork(lifecycle:number){if(quitting||contentBackupGate.busy||lifecycle!==quitEpoch)throw Error('The app started closing. Start this action again.');}
let queueDrain:Promise<void>|undefined;
async function resolveTaskRequestInference(task:Task,prompt:string,kind:'explain'|'create',queued?:{inference?:RequestInferenceSelection},knownCatalog?:RequestInferenceCatalog){
 const epoch=keyEpoch,route=selectedProvider,automatic=!queued&&requestInferenceSaved(task.session).policy==='automatic';
 const catalog=automatic&&route==='codex'?(knownCatalog??await codexProvider.catalog()):undefined;
 if(epoch!==keyEpoch||route!==selectedProvider)throw Error('The connection changed while resolving this task model policy. Ask again.');
 if(catalog?.kind==='unavailable')throw Error(catalog.message);
 return resolveRequestInference(task.session,route,codexProvider.defaultInference(),queued,{prompt,kind,models:catalog?.kind==='available'?catalog.models:[]});
}
async function queuedScope(taskId:string,prompt:string,basis:string,inference?:RequestInferenceSelection,skill:InstructionSkillReference|null=null,reviewedQueue?:{id:string;revision:number}){
 const epoch=keyEpoch,route=selectedProvider,provider=activeProvider(),account=await provider.accountScope(),preferences=await responsePreferences.lease(),memory=await core.leaseUserMemory(taskId,prompt);
 const chosenSkill=await core.instructionSkillContext(taskId,skill,reviewedQueue),folderGuidance=await codeWorkspaces.guidanceLease(taskId);await preferences.check();await memory.check();await folderGuidance.check();if(epoch!==keyEpoch||route!==selectedProvider||quitting)throw Error('The connection changed before the follow-up was queued.');
 return {scope:createHash('sha256').update(JSON.stringify([basis,epoch,route,account,preferences.current,memory.receipt,...requestInferenceScopeFields(inference),...(skill?['instruction-skill:v1',skill]:[]),...(folderGuidance.scope?[folderGuidance.scope]:[])])).digest('hex'),grant:JSON.stringify([epoch,route,account]),consent:memory.consent+'\n\n'+preferences.consent+'\n\n'+instructionSkillReview(chosenSkill)+folderGuidance.consent};
}
async function saveQueuedCommand(c:Extract<QueueCommand,{type:'queue.submit'|'queue.edit'}>){
 const lifecycle=quitEpoch,task=await core.getTask(c.taskId),items=task.session?.queuedFollowups??[],existing=items.find(item=>item.id===c.id),active=pendingFollowups(items);
 if(task.session?.browserContext||task.requests.some(request=>request.status==='running'&&!['explain','create'].includes(request.kind)))throw Error('Only ordinary text follow-ups can be queued. Browser and external actions need their own review.');
 if(c.type==='queue.submit'&&!existing&&!task.requests.some(request=>request.status==='running')&&!active.length)throw Error('Ask directly when no response is running.');
 if(c.type==='queue.submit'&&existing){if(existing.prompt===c.prompt&&existing.kind===c.kind&&JSON.stringify(existing.sourceRefs)===JSON.stringify(c.expectedSourceRefs))return task;throw Error('This queued follow-up identity already has different text.');}
 if(c.type==='queue.edit'&&(!existing||existing.revision!==c.expectedRevision||!['queued','held'].includes(existing.status)))throw Error('This queued follow-up changed. Reload before editing.');
 const sources=task.sources.filter(source=>c.sourceIds.includes(source.id)),refs=sources.map(source=>({sourceId:source.id,version:source.currentVersion,digest:source.versions.at(-1)!.digest}));
 if(new Set(c.sourceIds).size!==c.sourceIds.length||refs.length!==c.sourceIds.length||JSON.stringify(refs)!==JSON.stringify(c.expectedSourceRefs))throw Error('Source versions changed. Review the queued context.');
 const precedingRequestIds=existing?[...existing.precedingRequestIds]:[...task.requests.filter(request=>request.status==='running').map(request=>request.id),...active.map(item=>item.id)];
 const inference=(await resolveTaskRequestInference(task,c.prompt,c.kind,existing)).selection;
 const skill=existing?existing.instructionSkill??null:instructionSkillSelection(task.session).selection;
 const basis=await core.queuedFollowupBasis(c.taskId,refs,precedingRequestIds),snapshot=await queuedScope(c.taskId,c.prompt,basis,inference,skill);let authorized=ordinaryTransmissionConsent===snapshot.grant;
 if(c.type==='queue.edit'&&!authorized){
  const review=await queuedInferenceReview(inference,selectedProvider,{current:()=>activeProvider().status(),selected:selection=>codexProvider.statusFor(selection)}),connection=review.connection;assertCurrentWork(lifecycle);if(!connection.configured)throw Error('Check the provider connection before reviewing this follow-up.');
  const project=task.projectId?(await core.projectCommand({type:'projects.list'})).find(project=>project.id===task.projectId):undefined;
  const decision=await dialog.showMessageBox(panel,{type:'question',message:`Send this request to ${connection.provider==='Meta'?'Meta':'OpenAI'}?`,detail:`Destination: ${review.destination}\n\n${ordinaryAskNotice}Reviewed queued request:\n${c.prompt}\n\nSources:\n${refs.map(ref=>{const source=task.sources.find(source=>source.id===ref.sourceId)!,version=source.versions.at(-1)!;return `${version.label} · ${version.kind} · version ${ref.version}`;}).join('\n')||'No sources selected'}\n\nTask history includes earlier requests and saved answers, including preceding responses.\n\n${project?`Project instructions revision ${project.revision}:\n${project.instructions}\n\n`:''}${snapshot.consent}`,buttons:['Cancel',`Send to ${connection.provider==='Meta'?'Meta':'OpenAI'}`],defaultId:0,cancelId:0});
  assertCurrentWork(lifecycle);if(decision.response!==1)throw Error('Follow-up was not authorized. Its saved text is kept.');
  if((await queuedScope(c.taskId,c.prompt,basis,inference,skill)).scope!==snapshot.scope)throw Error('The queued context or provider session changed before transmission.');
  ordinaryTransmissionConsent=snapshot.grant;authorized=true;
 }
 const item:QueuedFollowup={id:c.id,revision:(existing?.revision??0)+1,prompt:c.prompt,kind:c.kind,createdAt:existing?.createdAt??new Date().toISOString(),sourceRefs:refs,precedingRequestIds,basis,...(skill?{instructionSkill:skill}:{}),...(inference?{inference}:{}),scope:snapshot.scope,status:authorized?'queued':'held',...(!authorized?{reason:'Approve an initial Ask for this provider session, then review and queue this follow-up again.'}:{})};
 const result=await core.saveQueuedFollowup(c.taskId,item,existing?.revision??0,c.type==='queue.submit'?c.submittedDraft:undefined);changed(c.taskId);return result;
}
function drainQueuedFollowups(){
 if(queueDrain||quitting||contentBackupGate.busy)return;
 queueDrain=(async()=>{while(!quitting&&!contentBackupGate.busy){
  const tasks=await core.listTasks();
  if(tasks.some(task=>task.requests.some(request=>request.status==='running'))||[...pendingEffects].some(key=>key.startsWith('model:')))return;
  const task=tasks.find(task=>pendingFollowups(task.session?.queuedFollowups)[0]?.status==='queued'),item=pendingFollowups(task?.session?.queuedFollowups)[0];if(!task||!item)return;const taskId=task.id;
  try{
   if(item.precedingRequestIds.some(id=>task.requests.some(request=>request.id===id&&request.status!=='completed')))throw Error('An earlier response did not complete. Review this follow-up before continuing.');
   const basis=await core.queuedFollowupBasis(taskId,item.sourceRefs,item.precedingRequestIds),current=await queuedScope(taskId,item.prompt,basis,item.inference,item.instructionSkill??null,{id:item.id,revision:item.revision});
   if(basis!==item.basis||current.scope!==item.scope||ordinaryTransmissionConsent!==current.grant)throw Error('The queued context or provider session changed. Review this exact follow-up before queueing it again.');
   if([...pendingEffects].some(key=>key.startsWith('model:')))return;
   const key=`model:${taskId}`;pendingEffects.add(key);
   try{await command({type:'model.run',taskId,requestId:item.id,kind:item.kind,prompt:item.prompt,sourceIds:item.sourceRefs.map(ref=>ref.sourceId),expectedSourceRefs:[...item.sourceRefs]},undefined,item);}finally{pendingEffects.delete(key);}
  }catch(error){await core.holdQueuedFollowups(taskId,error instanceof Error?error.message:'Queued follow-up needs review.');changed(taskId);}
 }})().catch(()=>{}).finally(()=>{queueDrain=undefined;});
}
async function command(c:Command,recurring?:RecurringInvocation,queued?:QueuedFollowup):Promise<unknown>{
  if(contentBackupGate.busy&&!['draft.save','draft.flushed','learning-drafts.read','learning-drafts.save'].includes(c.type))throw Error('Content backup: Content is frozen. Finish the backup or restart Glint after restore.')
  if(quitting&&!['presentation.capture','presentation.finish','draft.save','draft.flushed','learning-drafts.read','learning-drafts.save'].includes(c.type))throw Error('The app is closing.')
  const lifecycle=quitEpoch
  if(isStudyCommand(c)){
    const epoch=sourceContextEpoch,guard=()=>{assertCurrentWork(lifecycle);if(currentViewTaskId!==c.taskId||requestedViewTaskId!==c.taskId||sourceContextEpoch!==epoch)throw Error('The study owner task changed. Your saved work is kept.');};guard();
    if(c.type==='study.preview'){const result=await core.previewStudyNotes(c.taskId,c.reference);guard();return result;}
    if(c.type==='study.view'){const result=await core.getStudyView(c.taskId,c.deckRef);guard();return result;}
    const result=c.type==='study.action'?await core.actOnStudy(c,guard):await core.saveStudySet(c,guard);changed(c.taskId);return result;
  }
  if(isPdfPageCommand(c)){
    if(c.type==='source.pdf.cancel')return pdfPageImports.cancel(c);
    const epoch=sourceContextEpoch,connectionEpoch=keyEpoch,guard=()=>{assertCurrentWork(lifecycle);if(currentViewTaskId!==c.taskId||requestedViewTaskId!==c.taskId||sourceContextEpoch!==epoch)throw Error('The visual PDF owner task changed. Existing sources are kept.');};guard();
    if(c.type==='source.pdf.choose')return pdfPageImports.pick(c,guard);
    if(c.type==='source.pdf.page')return pdfPageImports.preview(c,c.page,guard);
    if(c.type==='source.pdf.add'){const result=await pdfPageImports.add(c,guard);changed(c.taskId);return result;}
    if(selectedProvider!=='codex')throw Error('Visual request inspection uses the selected Codex connection. Choose it explicitly in Settings.');
    const context=await core.previewInstructionRequest(c.taskId,c.expectedSkillRevision,[...c.sourceIds]),preferences=await responsePreferences.lease(),memory=await core.leaseUserMemory(c.taskId,c.prompt),catalog=await codexProvider.catalog(),folderGuidance=await codeWorkspaces.guidanceLease(c.taskId);guard();await folderGuidance.check();
    const inference=await resolveTaskRequestInference(context.task,c.prompt,c.kind,undefined,catalog);if(!inference.selection)throw Error('The requested Codex model choice is unavailable.');
    const capability=modelImageInput(catalog.kind==='available'?catalog.models.find(model=>model.id===inference.selection!.model):undefined);
    const result=inspectPdfRequest(c.taskId,{prompt:c.prompt,sources:context.task.sources.map(source=>({...source.versions.at(-1)!})),taskHistory:context.taskHistory,projectInstructions:context.projectInstructions,preferences:preferences.current,memory,instructionSkill:context.instructionSkill,folderGuidance:folderGuidance.current},inference.selection,capability);
    await preferences.check();await memory.check();await folderGuidance.check();const current=await core.previewInstructionRequest(c.taskId,c.expectedSkillRevision,[...c.sourceIds]);const currentInference=await resolveTaskRequestInference(current.task,c.prompt,c.kind,undefined,catalog);
    const latest=inspectPdfRequest(c.taskId,{prompt:c.prompt,sources:current.task.sources.map(source=>({...source.versions.at(-1)!})),taskHistory:current.taskHistory,projectInstructions:current.projectInstructions,preferences:preferences.current,memory,instructionSkill:current.instructionSkill,folderGuidance:folderGuidance.current},inference.selection,capability);
    if(result.wireDigest!==latest.wireDigest||JSON.stringify(inference)!==JSON.stringify(currentInference)||connectionEpoch!==keyEpoch||selectedProvider!=='codex')throw Error('The visual request context changed. Inspect it again before sending.');guard();preferences.assertCurrent();memory.assertCurrent();folderGuidance.assertCurrent();return result;
  }
  if(isInstructionSkillCommand(c)){
    const epoch=sourceContextEpoch,guard=()=>{assertCurrentWork(lifecycle);if(currentViewTaskId!==c.taskId||requestedViewTaskId!==c.taskId||sourceContextEpoch!==epoch)throw Error('The skill owner task changed. Saved work is kept.');};guard();
    if(c.type==='skills.list'){const catalog=await core.getInstructionSkillCatalog(c.taskId);guard();return catalog;}
    if(c.type==='skills.availability.set'){const saved=await core.setInstructionSkillAvailability(c,guard);changed(c.taskId);return saved;}
    if(c.type==='skills.directory.copy'){const saved=await core.copyDirectorySkill(c,guard);changed(c.taskId);return saved;}
    if(c.type==='skills.save'){const {type,...input}=c,saved=await core.saveInstructionSkill(input,guard);changed(c.taskId);return saved;}
    if(c.type==='skills.use'){const result=await core.setInstructionSkill(c.taskId,c.expectedRevision,c.selection,guard);changed(c.taskId);return result;}
    const context=await core.previewInstructionRequest(c.taskId,c.expectedRevision,[...c.sourceIds]),preferences=await responsePreferences.lease(),memory=await core.leaseUserMemory(c.taskId,c.prompt),folderGuidance=await codeWorkspaces.guidanceLease(c.taskId);guard();await preferences.check();await memory.check();await folderGuidance.check();
    if(context.task.sources.some(source=>source.versions.at(-1)?.kind!=='text'))throw Error('Inspect a saved-text request composition. Frozen window or image bodies are not read by this inspector.');
    const request=composeOrdinaryRequest({prompt:c.prompt,sources:context.task.sources.map(source=>({...source.versions.at(-1)!})),taskHistory:context.taskHistory,projectInstructions:context.projectInstructions,preferences:preferences.current,memory,instructionSkill:context.instructionSkill,folderGuidance:folderGuidance.current});
    guard();const latestContext=await core.previewInstructionRequest(c.taskId,c.expectedRevision,[...c.sourceIds]);await preferences.check();await memory.check();await folderGuidance.check();const latestRequest=composeOrdinaryRequest({prompt:c.prompt,sources:latestContext.task.sources.map(source=>({...source.versions.at(-1)!})),taskHistory:latestContext.taskHistory,projectInstructions:latestContext.projectInstructions,preferences:preferences.current,memory,instructionSkill:latestContext.instructionSkill,folderGuidance:folderGuidance.current});if(JSON.stringify(request)!==JSON.stringify(latestRequest))throw Error('The task context changed. Inspect its current composition again.');guard();preferences.assertCurrent();memory.assertCurrent();folderGuidance.assertCurrent();return {taskId:c.taskId,revision:c.expectedRevision,request};
  }
  if(c.type==='github.cancel'){publicGithub.cancel(c.taskId,c.operationId);return null;}
  if(c.type==='github.capture'||c.type==='github.disconnect'){
    const epoch=sourceContextEpoch,guard=()=>{assertCurrentWork(lifecycle);if(currentViewTaskId!==c.taskId||requestedViewTaskId!==c.taskId||sourceContextEpoch!==epoch)throw Error('The selected task changed. The saved GitHub snapshot is unchanged.');};
    guard();
    if(c.type==='github.disconnect'){publicGithub.cancel(c.taskId);const saved=await core.disconnectPublicGithub(c,guard);changed(c.taskId);return saved;}
    const saved=await publicGithub.read(c.taskId,c.operationId,c.repository,guard,(read,current)=>core.savePublicGithubSnapshot(c,read.snapshot,read.content,current));changed(c.taskId);return saved;
  }
  if(c.type.startsWith('surface.')&&c.type!=='surface.fit'||c.type==='context.start'||c.type==='context.capture'||c.type==='source.follow.enable'||c.type==='source.follow.stop'||c.type==='connection.configure'||c.type==='connection.select'||c.type==='connection.disconnect'||c.type==='tasks.delete'||c.type==='tasks.pause'||c.type==='bots.assign'||c.type==='bots.change'){publicGithub.cancel();sourceDrag?.cancel();if(c.type!=='context.capture')sourceContextEpoch++;}
  if(isReadingCommand(c)){const epoch=sourceContextEpoch,guard=()=>{assertCurrentWork(lifecycle);if(currentViewTaskId!==c.taskId||requestedViewTaskId!==c.taskId||sourceContextEpoch!==epoch)throw Error('Reading task changed.');};guard();return c.type==='reading.preferences.get'?core.getReadingPreferences(c.taskId):core.changeReadingPreferences(c,guard);}
  if(isSpeechCommand(c)){const epoch=sourceContextEpoch,guard=()=>{assertCurrentWork(lifecycle);if(currentViewTaskId!==c.taskId||requestedViewTaskId!==c.taskId||sourceContextEpoch!==epoch)throw Error('Listening selection changed.');};const result=await documentSpeech.command(c,guard);if(c.type==='speech.select'||c.type==='speech.generate')changed(c.taskId);return result;}
  if(isCodeCommand(c)){const epoch=sourceContextEpoch,guard=()=>{assertCurrentWork(lifecycle);if(currentViewTaskId!==c.taskId||requestedViewTaskId!==c.taskId||sourceContextEpoch!==epoch)throw Error(CODE_WORKSPACE_ERROR);};const result=await codeWorkspaces.command(c,guard);if(['code.instructions.use','code.instructions.disable','code.folder.disconnect'].includes(c.type)){await core.markResponseContextChanged(c.taskId,guard);sourceContextEpoch++;changed(c.taskId);}else if(['code.file.open','code.file.reload','code.file.save'].includes(c.type))changed(c.taskId);return result;}
  switch(c.type){
    case 'image.copy':return copySavedImage(c,id=>core.getTask(id),{createFromBuffer:bytes=>nativeImage.createFromBuffer(bytes),writePng:bytes=>clipboard.write([new ClipboardItem({'image/png':new Blob([new Uint8Array(bytes)])})]),readPng:async()=>{const item=(await clipboard.read()).find(item=>item.types.includes('image/png'));if(!item)throw Error('The new clipboard image is unavailable.');const data=await item.getType('image/png');if(data.size>IMAGE_COPY_BYTE_LIMIT)throw Error('The new clipboard image exceeds the copy limit.');return Buffer.from(await data.arrayBuffer());}},()=>{assertCurrentWork(lifecycle);if(currentViewTaskId!==c.taskId||requestedViewTaskId!==c.taskId)throw Error('Return to the owning image before copying it.');})
    case 'code-block.copy':return writeCodeBlockCopy(c,text=>clipboard.writeText(text))
    case 'conversation.export.preview':return conversationExports.preview(c)
    case 'conversation.export.save':return conversationExports.save(c,async snapshot=>{
      const choice=await dialog.showSaveDialog(panel,{title:'Save conversation transcript',defaultPath:`${snapshot.title.replace(/[^\w -]/g,'').slice(0,70)||'conversation'}-conversation.${snapshot.format==='markdown'?'md':'json'}`,filters:[{name:snapshot.format==='markdown'?'Markdown':'JSON',extensions:[snapshot.format==='markdown'?'md':'json']}],properties:['createDirectory','dontAddToRecent']})
      return choice.canceled?null:choice.filePath??null
    },()=>assertCurrentWork(lifecycle))
    case 'projects.list':case 'projects.pins.get':case 'projects.sidebar.get':case 'projects.memory.get':case 'projects.delete.preview':return core.projectCommand(c)
    case 'projects.delete':{const saved=await core.projectCommand(c,()=>assertCurrentWork(lifecycle)),cleanup=saved.mode==='delete-tasks'?await cleanupDeletedTasks(saved.taskIds,true):{};changed();return {...saved,...cleanup};}
    case 'projects.memory.change':{const saved=await core.projectCommand(c,()=>assertCurrentWork(lifecycle));if(saved.kind==='saved')changed();return saved;}
    case 'projects.assign.bulk':case 'projects.sidebar.set':case 'projects.pins.set':case 'projects.create':case 'projects.update':case 'projects.assign':case 'projects.sources.add':case 'projects.sources.update':case 'projects.sources.remove':case 'projects.sources.use':{const saved=await core.projectCommand(c,()=>assertCurrentWork(lifecycle));changed();return saved;}
    case 'source.follow.get':return documentFollow.read()
    case 'source.follow.enable':return documentFollow.enable()
    case 'source.follow.stop':retireDocumentFollow('Stopped by you. Use a new gesture to choose a window.');return documentFollow.read()
    case 'capture.settings.get':return {...await captureSettings.read(),sessionPaused:captureSettingsHealth!=='ready'}
    case 'capture.settings.revoke':case 'capture.settings.private':return updateCapturePrivacy(c)
    case 'bots.get':return botPreferences.read()
    case 'bots.change':{const result=await botPreferences.command(c.change);if(c.change.type==='complete'&&result.kind==='saved'){await botPreferences.finishExample(core);changed();const state=await botPreferences.read();return state.kind==='available'?{kind:'saved',current:state.current}:state;}return result;}
    case 'bots.assign':{const state=await botPreferences.read();if(state.kind!=='available'||state.current.kind!=='ready'||!state.current.bots.some(bot=>bot.id===c.botId))throw Error('This companion is unavailable. Your task is kept.');return taskMutation(c.taskId,()=>core.assignBot(c.taskId,c.botId,c.expectedBotId));}
    case 'schedules.get':return {items:await core.getRecurringWork(),runtime:recurringWorkRunner.read()}
    case 'schedules.change':{
      const current=(await core.getRecurringWork()).find(item=>item.id===c.change.id);
      if((current?.revision??0)!==c.change.expectedRevision)throw Error('This schedule changed. Reload before saving again.');
      await retireRecurringGrant(c.change.id);
      const grant=c.change.kind==='resume'&&current?.mode==='response'?await authorizeRecurring(current,lifecycle):undefined;
      const result=await core.changeRecurringWork(c.change,()=>assertCurrentWork(lifecycle));
      if(grant)recurringGrants.set(grant.id,grant);
      emit({type:'schedules.changed'});return {items:result,runtime:recurringWorkRunner.read()};
    }
    case 'cli.preferences.get':return core.getCliPreferences()
    case 'cli.preferences.update':{const {type,...input}=c;return core.changeCliPreferences(input,()=>assertCurrentWork(lifecycle));}
    case 'cli.preview':await core.getTask(c.taskId);return cliPreview.preview(c.taskId,dataDir)
    case 'contacts.get':return core.getLocalContacts()
    case 'contacts.change':{const {type,...input}=c;const result=await core.changeLocalContacts(input,()=>assertCurrentWork(lifecycle));if(result.kind==='saved')changed();return result;}
    case 'memory.export':return memoryExports.save(c,()=>assertCurrentWork(lifecycle))
    case 'memory.task.set':{const result=await core.setTaskMemoryPolicy(c,()=>assertCurrentWork(lifecycle));changed(c.taskId);return result;}
    case 'memory.get':return core.getUserMemory()
    case 'memory.preview':{const {type,...input}=c;return core.previewUserMemory(input);}
    case 'memory.change':{const {type,...input}=c;const result=await core.changeUserMemory(input,()=>assertCurrentWork(lifecycle));if(result.kind==='saved')changed();return result;}
    case 'response-preferences.get':return responsePreferences.read()
    case 'system.settings.get':return systemSettings.read()
    case 'system.settings.update':return systemSettings.update(c,()=>assertCurrentWork(lifecycle))
    case 'response-preferences.update':return responsePreferences.update({expectedRevision:c.expectedRevision,enabled:c.enabled,text:c.text},()=>assertCurrentWork(lifecycle))
    case 'preferences.get':return (await characterPreferences).read()
    case 'preferences.update':return (await characterPreferences).update({expectedRevision:c.expectedRevision,profile:c.profile})
    case 'tasks.list':return core.listTasks()
    case 'tasks.get':return core.getTask(c.taskId)
    case 'tasks.create':{const t=await createAssignedTask({title:str(c.title,'title',200),goal:c.goal});changed(t.id);return t}
    case 'tasks.branch':{const {type,...input}=c,state=await botPreferences.read();assertCurrentWork(lifecycle);if(state.kind!=='available'||state.current.kind!=='ready')throw Error('Choose your companion before starting a task.');const saved=await core.branchFromResponse(input,state.current.defaultBotId,()=>assertCurrentWork(lifecycle));changed(saved.task.id);return saved;}
    case 'tasks.start-suggested':{const {type,...input}=c,value=readSuggestedTaskInput(input),state=await botPreferences.read();assertCurrentWork(lifecycle);if(state.kind!=='available'||state.current.kind!=='ready')throw Error('Choose your companion before starting a task.');const saved=await core.startSuggestedTask(value,state.current.defaultBotId,()=>assertCurrentWork(lifecycle));changed(saved.task.id);return saved;}
    case 'tasks.start-local':{const {type,...input}=c,value=readLocalTaskStart(input),state=await botPreferences.read();assertCurrentWork(lifecycle);if(state.kind!=='available'||state.current.kind!=='ready')throw Error('Choose your companion before starting a task.');const saved=await core.startLocalTask(value,state.current.defaultBotId,()=>assertCurrentWork(lifecycle));changed(saved.task.id);return saved;}
    case 'tasks.update':return taskMutation(c.taskId,()=>core.updateTask(c.taskId,{title:c.title,...(c.goal!==undefined?{goal:c.goal}:{})}))
    case 'tasks.delete':{await core.deleteTask(c.taskId);const cleanup=await cleanupDeletedTasks([c.taskId]);changed();return cleanup.draftCleanup?{kind:'deleted',draftCleanup:'unconfirmed'}:null;}
    case 'tasks.pause':{const follow=documentFollow.read();if(currentViewTaskId===c.taskId||follow.kind==='bound'&&follow.taskId===c.taskId)retireDocumentFollow('Task paused.');}return taskMutation(c.taskId,()=>core.pause(c.taskId))
    case 'tasks.resume':return taskMutation(c.taskId,()=>core.resume(c.taskId))
    case 'tasks.archive':{const {type,...input}=c;return taskMutation(c.taskId,()=>core.setTaskArchived(input,()=>assertCurrentWork(lifecycle)));}
    case 'tasks.checkpoint':return taskMutation(c.taskId,()=>core.checkpoint(c.taskId,str(c.note,'checkpoint',10000)))
    case 'helper.source-batch.preview':{const {type,...input}=c;return helperSourceBatchPreview(await core.getTask(c.taskId),input);}
    case 'helper.source-batch.save':{const {type,...input}=c;const saved=await core.saveHelperSourceBatchReport(input,()=>assertCurrentWork(lifecycle));changed(c.taskId);return saved;}
    case 'helper.source-batch.inspect':{const {type,...input}=c;return core.inspectHelperSourceBatchSave(input);}
    case 'helper.recorded.inspect':{const {type,...input}=c;return inspectRecordedTextHelper(core,input);}
    case 'helper.recorded.create':{const {type,...input}=c;const saved=await createRecordedTextHelper(core,input,()=>assertCurrentWork(lifecycle));changed(c.taskId);return saved;}
    case 'helper.document.create':{const {type,...input}=c;const saved=await createDocumentRecipe(core,input,()=>assertCurrentWork(lifecycle));changed(c.taskId);return saved;}
    case 'helper.document.preview':{const {type,...input}=c;return previewDocumentRecipe(await core.getTask(c.taskId),input);}
    case 'helper.document.save':{const {type,...input}=c;const saved=await saveDocumentRecipe(core,input,()=>assertCurrentWork(lifecycle));changed(c.taskId);return saved;}
    case 'helper.document.inspect':{const {type,...input}=c;return inspectDocumentRecipeSave(core,input);}
    case 'helper.create':{const {type,...input}=c;const saved=await createTextHelper(core,input,()=>assertCurrentWork(lifecycle));changed(c.taskId);return saved;}
    case 'workflow.prepare':{const {type,...input}=c;return prepareWorkflowReview(core,input);}
    case 'truth.review':{const {type,...input}=c;const saved=await createTruthTable(core,input);changed(c.taskId);return saved;}
    case 'truth.inspect':{const {type,...input}=c;return inspectTruthTable(core,input);}
    case 'experiment.source.save':{const {type,...input}=c,saved=await saveSourceFormula(core,input,()=>assertCurrentWork(lifecycle));changed(c.input.taskId);return saved;}
    case 'experiment.source.inspect':return inspectSourceFormulaSave(core,c.input);
    case 'experiment.target.inspect':{const {type,...input}=c;return inspectTargetPractice(core,input);}
    case 'experiment.target.inspect-original':{const {type,...input}=c;return inspectOriginalTargetPractice(core,input);}
    case 'experiment.target.submit':{const {type,...input}=c;const saved=await submitTargetPractice(core,input,()=>assertCurrentWork(lifecycle));changed(c.taskId);return saved;}
    case 'experiment.practice':{const {type,...input}=c;const saved=await createExperimentPractice(core,input);changed(c.taskId);return saved;}
    case 'experiment.practice.inspect':{const {type,...input}=c;return inspectExperimentPractice(core,input);}
    case 'packing.practice':{const {type,...input}=c;const saved=await createPackingPractice(core,input);changed(c.taskId);return saved;}
    case 'packing.practice.inspect':{const {type,...input}=c;return inspectPackingPractice(core,input);}
    case 'packing.review':{const {type,...input}=c;const saved=await createPackingConcept(core,input);changed(c.taskId);return saved;}
    case 'packing.inspect':{const {type,...input}=c;return inspectPackingConcept(core,input);}
    case 'signal.review':{const {type,...input}=c;const saved=await createSignalConcept(core,input);changed(c.taskId);return saved;}
    case 'signal.inspect':{const {type,...input}=c;return inspectSignalConcept(core,input);}
    case 'signal.practice':{const {type,...input}=c;const saved=await createSignalPractice(core,input);changed(c.taskId);return saved;}
    case 'signal.practice.inspect':{const {type,...input}=c;return inspectSignalPractice(core,input);}
    case 'signal.overwrite':{const {type,...input}=c;const saved=await createSignalOverwrite(core,input);changed(c.taskId);return saved;}
    case 'signal.overwrite.inspect':{const {type,...input}=c;return inspectSignalOverwrite(core,input);}
    case 'workflow.window.review':{
      const {type,...input}=c,task=await core.getTask(c.taskId),candidate=windowWorkflowCandidateForReview(task,c.candidate),privacy=capturePrivacyEpoch;
      const ref=candidate.provenance.source.ref,version=task.sources.find(source=>source.id===ref.sourceId)?.versions.find(version=>version.version===ref.version&&version.digest===ref.digest);
      const assertScope=()=>{assertCurrentWork(lifecycle);if(privacy!==capturePrivacyEpoch||captureSettingsHealth!=='ready')throw Error('Capture privacy changed during image review.');};
      const fence=createWindowWorkflowCaptureFence(candidate.provenance,{now:Date.now,readCapture:()=>version?boundCapture(c.taskId,version):undefined,assertScope,checkTarget:async capture=>{assertScope();await documentFollow.poll();assertScope();await checkCaptureTarget(capture.source,undefined,assertScope);assertScope();}});
      const result=await createWindowWorkflow(core,input,fence);changed(c.taskId);
      if(result.status!=='completed'||!result.answer)throw Error(result.error??'The image review publication did not complete. Inspect its saved outcome before another attempt.');
      return {task:await core.getTask(c.taskId),artifactId:result.answer.artifactId,revision:result.answer.revision};
    }
    case 'workflow.review':{const {type,...input}=c;const saved=await createReviewedWorkflow(core,input);changed(c.taskId);return saved;}
    case 'workflow.contextual.review':{const {type,...input}=c;const saved=await createContextualReviewedWorkflow(core,input);changed(c.taskId);return saved;}
    case 'workflow.example':{
      if(Object.keys(c).sort().join(',')!=='requestId,taskId,type')throw Error('Unsupported workflow example fields.');
      const taskId=str(c.taskId,'task ID',200),requestId=str(c.requestId,'request ID',200);
      const result=await createWorkflowExample(core,{taskId,requestId});
      if(result.status!=='completed'||!result.artifactId)throw Error(result.error??'The workflow example could not be created.');
      const task=await core.getTask(taskId),artifact=task.artifacts.find(item=>item.id===result.artifactId)!;
      changed(taskId);return {task,artifactId:artifact.id,revision:artifact.revisions.at(-1)!.revision};
    }
    case 'browser.workflow.save':{const {saveBrowserWorkflow}=await import('../core/browser-workflow-host');assertCurrentWork(lifecycle);const {type,...input}=c;const saved=await saveBrowserWorkflow(core,input);changed(c.taskId);return saved;}
    case 'browser.workflow.run':{const service=await getBrowserService();assertCurrentWork(lifecycle);const {type,...input}=c;return service.runWorkflow(input,()=>assertCurrentWork(lifecycle));}
    case 'module.edit':return taskMutation(c.taskId,()=>editModule(core,c))
    case 'module.document':{const saved=await saveModuleDocument(core,c);changed(c.taskId);return {...saved,task:await core.getTask(c.taskId)}}
    case 'learning-drafts.read':return learningDrafts.read()
    case 'learning-drafts.recover':return learningDrafts.recover(c.recoveryToken)
    case 'learning-drafts.cleanup':return learningDrafts.cleanup()
    case 'learning-drafts.save':return learningDrafts.save(c.owner,c.slot,c.expectedEpoch,c.expectedRevision,c.value)
    case 'queue.submit':case 'queue.edit':return saveQueuedCommand(c);
    case 'queue.cancel':{const result=await core.cancelQueuedFollowup(c.taskId,c.id,c.expectedRevision);changed(c.taskId);return result;}
    case 'queue.hold':{const result=await core.holdQueuedFollowups(c.taskId,'Source selection changed. Review the exact queued follow-up before queueing it again.');changed(c.taskId);return result;}
    case 'draft.save':return core.saveComposerDraft(c.taskId,c.expectedRevision,c.draft)
    case 'draft.flushed':if(!contentBackupDrafts.acknowledge(c.quitId,c.error))quitDrafts.acknowledge(c.quitId,c.error);return null
    case 'browser.review.notes':{const {type,...input}=c;const saved=await core.saveBrowserReviewNotes(input,()=>assertCurrentWork(lifecycle));changed(c.taskId);return saved;}
    case 'browser.continue.prepare':{const {type,...input}=c;const task=await core.prepareBrowserContinuationAttempt(input);changed(c.taskId);return task;}
    case 'browser.continue.release':{const {type,...input}=c;const result=await core.releaseBrowserContinuationAttempt(input);changed(c.taskId);return result;}
    case 'browser.continue':{const service=await getBrowserService();assertCurrentWork(lifecycle);const {type,...input}=c;return service.continue(input)}
    case 'browser.run':{const service=await getBrowserService();assertCurrentWork(lifecycle);return service.run(c)}
    case 'browser.control.status':return browserService?.controlStatus(c)??{mode:'unavailable'}
    case 'browser.control':{if(!browserService)throw Error('This browser control is no longer active.');return browserService.changeControl(c)}
    case 'browser.inspect':{
      if(!c.attemptId)return (await getBrowserService()).inspect(c)
      const attempt=browserInspectionAttempts.begin({...c,attemptId:c.attemptId});
      try{return await (await getBrowserService()).inspect(c,attempt)}finally{attempt.finish()}
    }
    case 'browser.inspect.cancel':return browserInspectionAttempts.stop(c)
    case 'browser.detach':return taskMutation(c.taskId,()=>core.clearBrowserContext(c.taskId))
    case 'source.import.cancel':return documentImports.cancel(c)
    case 'source.import.choose':
    case 'source.import.add':{
      const ownerTaskId=c.taskId,context=sourceContextEpoch;
      const guard=()=>{assertCurrentWork(lifecycle);if(currentViewTaskId!==ownerTaskId||requestedViewTaskId!==ownerTaskId||context!==sourceContextEpoch)throw Error(documentImportMessages.inactive);};
      guard();if(c.type==='source.import.choose')return documentImports.pick(c,guard);
      const result=await documentImports.add(c,guard);changed(c.taskId);return result;
    }
    case 'source.document':{const {type,...input}=c;const result=await core.copySavedDocumentSource(input,()=>assertCurrentWork(lifecycle));changed(c.taskId);return result;}
    case 'artifact.handoff':{const {type,...input}=c;const saved=await core.saveTaskHandoff(input,()=>assertCurrentWork(lifecycle));changed(c.taskId);return saved;}
    case 'source.text.inspect':{const {type,...input}=c;return core.inspectTextSourceSave(input)}
    case 'source.text':{
      const s=object(c.source);if(s.kind!=='text')throw Error('This intake accepts text only; use explicit native image/window intake.')
      str(s.label,'source label',200);str(s.content,'source text',1000000)
      if(!['fact','style','inspiration'].includes(s.role as string))throw Error('Choose a source role.')
      if(s.id!==undefined)str(s.id,'source ID',200)
      const expectedSource=c.expectedSource===undefined?undefined:parseSourceTextExpected(c.expectedSource);
      if(s.id&&!expectedSource||expectedSource?.sourceId!==s.id)throw Error('Open the current source before saving an edit.');
      if(s.id){const t=await core.getTask(c.taskId);const old=t.sources.find(x=>x.id===s.id);if(!old||old.versions.at(-1)?.kind!=='text')throw Error('Select the current saved text source to edit.')}
      const selected:SourceInput={kind:'text',label:s.label as string,content:s.content as string,role:s.role as SourceInput['role'],...(s.id?{id:s.id as string}:{})}
      if(c.edit){const result=await core.saveTextSource({taskId:c.taskId,source:selected,expectedSource,intentId:c.edit.intentId,binding:c.edit.binding},()=>assertCurrentWork(lifecycle));changed(c.taskId);return {...result,task:await core.getTask(c.taskId)}}
      return taskMutation(c.taskId,()=>core.putSource(c.taskId,selected,undefined,expectedSource,()=>assertCurrentWork(lifecycle)))
    }
    case 'source.image':{
      if(c.sourceId){const t=await core.getTask(c.taskId);if(t.sources.find(s=>s.id===c.sourceId)?.versions.at(-1)?.kind!=='image')throw Error('Select an imported image to replace.')}
      const choice=await dialog.showOpenDialog(panel,{title:'Add an image',properties:['openFile'],filters:[{name:'Images',extensions:['png','jpg','jpeg']} ]})
      assertCurrentWork(lifecycle);if(choice.canceled)return core.getTask(c.taskId)
      const bytes=await readFile(choice.filePaths[0]);assertCurrentWork(lifecycle);if(bytes.length>8*1024*1024)throw Error('Choose an image smaller than 8 MiB.')
      const image=nativeImage.createFromBuffer(bytes);const size=image.getSize();if(image.isEmpty()||size.width*size.height>40000000)throw Error('Image is empty or exceeds 40 megapixels.')
      return taskMutation(c.taskId,()=>core.putSource(c.taskId,{id:c.sourceId,kind:'image',label:basename(choice.filePaths[0]),content:image.toDataURL(),role:c.role}))
    }
    case 'source.invalidate':{const follow=documentFollow.read();if(follow.kind==='bound'&&follow.taskId===c.taskId&&follow.sourceId===c.sourceId)retireDocumentFollow('Source explicitly marked changed.');}captures.delete(`${c.taskId}:${c.sourceId}`);return taskMutation(c.taskId,()=>core.invalidateSource(c.taskId,c.sourceId,'Explicitly marked changed. Refresh or replace this source.'))
    case 'source.preview':{purgeExpiredCaptures();const t=await core.getTask(c.taskId),source=t.sources.find(s=>s.id===c.sourceId),version=source?.versions.at(-1);if(c.reference!==undefined){const ref=object(c.reference);if(Object.keys(ref).sort().join(',')!=='digest,sourceId,version'||typeof ref.sourceId!=='string'||!Number.isSafeInteger(ref.version)||typeof ref.digest!=='string')throw Error('Select a saved source version.');if(ref.sourceId!==source?.id||ref.version!==version?.version||ref.digest!==version?.digest)return null;}const capture=source?.freshness==='fresh'&&version?boundCapture(c.taskId,version):undefined;if(!capture||!version)return null;
      const privacy=capturePrivacyEpoch,guard=()=>{assertCurrentWork(lifecycle);if(privacy!==capturePrivacyEpoch||captureSettingsHealth!=='ready'||boundCapture(c.taskId,version)!==capture)throw Error('Capture privacy changed.');};
      try{await checkCaptureTarget(capture.source,undefined,guard);guard();return {dataUrl:capture.dataUrl,capturedAt:capture.capturedAt,transform:capture.transform,reference:{sourceId:source!.id,version:version.version,digest:version.digest}};}
      catch{if(captures.get(`${c.taskId}:${version.id}`)?.capture===capture)captures.delete(`${c.taskId}:${version.id}`);return null;}
    }
    case 'windows.list':return (await native.listWindows()).filter(w=>!isCompanionWindow(w,ownApplication()))
    case 'source.drag.cancel':sourceDrag?.cancel();return null
    case 'source.choose':await activateSourcePicker();return null
    case 'inference.catalog':case 'inference.preview':case 'inference.select':{
      const owner=c.taskId,context=sourceContextEpoch,connectionEpoch=keyEpoch;
      const guard=()=>{assertCurrentWork(lifecycle);if(currentViewTaskId!==owner||requestedViewTaskId!==owner||context!==sourceContextEpoch||connectionEpoch!==keyEpoch)throw Error('The selected task or connection changed. Reopen its model settings.');};guard();
      if(c.type==='inference.select'){
        if(c.policy==='automatic'&&selectedProvider!=='codex')throw Error('Connect Codex before choosing Automatic routing.');
        if(c.selection&&c.policy!=='automatic'){if(selectedProvider!=='codex')throw Error('Connect Codex before choosing its model settings.');codexProvider.validateInference(c.selection);}
        const saved=await core.setRequestInference(owner,c.expectedRevision,c.selection,guard,c.policy??'fixed');changed(owner);return saved;
      }
      if(selectedProvider!=='codex')return {kind:'unavailable',message:'Model, reasoning and speed controls are available for the connected Codex adapter. Meta keeps its fixed adapter settings.'};
      const catalog=await codexProvider.catalog();guard();if(c.type==='inference.catalog'||catalog.kind!=='available')return catalog;
      const task=await core.getTask(owner);guard();const saved=requestInferenceSaved(task.session),prompt=c.prompt??task.session?.draft??'',kind=c.kind??(task.session?.draftKind==='create'?'create':'explain'),resolved=await resolveTaskRequestInference(task,prompt,kind,undefined,catalog);guard();const selection=resolved.selection!;codexProvider.validateInference(selection);
      return {taskId:owner,revision:saved.revision,prompt,kind,selection,decision:resolved.decision,wire:buildCodexInferenceWire(selection)};
    }
    case 'notifications.get':return taskNotifications.view()
    case 'notifications.context':if(c.taskId!==null)await core.getTask(c.taskId);await taskNotifications.context(c.taskId);return null
    case 'notifications.opened':await taskNotifications.poll(true);return taskNotifications.view()
    case 'notifications.change':{const state=await taskViewPreferences.changeNotifications(c.change);emit({type:'notifications.changed'});return state;}
    case 'notifications.copy':{const state=await taskViewPreferences.readNotifications();if(state.kind!=='available')throw Error(state.message);const notice=state.current.notices.find(notice=>notice.id===c.noticeId);if(!notice||!('attemptId' in notice))throw Error('This notice has no study request identifier.');clipboard.writeText(notice.attemptId);return {identifier:notice.attemptId,kind:'local-study-attempt'};}
    case 'task-attention.get':return taskViewPreferences.readAttention()
    case 'task-attention.change':return taskViewPreferences.changeAttention(c.change)
    case 'task-view.get':return taskViewPreferences.read()
    case 'task-pins.get':return taskViewPreferences.readPins()
    case 'task-pins.set':return taskViewPreferences.setPinned(c.taskId,c.pinned)
    case 'context.pending':{
      if(contextIntake&&(Date.now()>=contextIntake.expiresAt||!sourceIntakeCurrent(contextIntake))){sourceDrag?.cancel();sourceContextEpoch++;contextIntake=undefined;}
      const intake=contextIntake;const result:ContextPending=quitting||!intake||!intake.activation?{kind:'none'}:intake.capturing?{kind:'busy'}:{kind:'ready',activation:structuredClone(intake.activation)};
      return result;
    }
    case 'context.view':documentSpeech.cancel();{
      const requestedTaskChanged=requestedViewTaskId!==c.taskId;
      if(requestedTaskChanged||currentViewTaskId!==c.taskId){publicGithub.cancel();sourceDrag?.cancel();sourceContextEpoch++;}
      // A requested task change permanently retires the scoped gesture.
      if(requestedTaskChanged&&contextIntake?.sourceScope)contextIntake=undefined;
      documentSelectionEpoch++;requestedViewTaskId=c.taskId;const follow=documentFollow.read();if(follow.kind==='bound'&&follow.taskId!==c.taskId)retireDocumentFollow('Task selection changed.');const selection=viewSelectionQueue.then(async()=>{if(c.taskId)await core.getTask(c.taskId);const current=documentFollow.read();if(current.kind==='bound'&&current.taskId!==c.taskId)retireDocumentFollow('Task selection changed.');currentViewTaskId=c.taskId;return taskViewPreferences.select(c.taskId??null)});viewSelectionQueue=selection.catch(()=>{});return selection}
    case 'context.start':if(c.newTask!==undefined&&typeof c.newTask!=='boolean'||c.newTask&&(c.source!==undefined||c.ownerTaskId!==undefined))throw Error('Choose how to start this context.');if(c.requestId!==undefined)str(c.requestId,'context request',200);if(c.ownerTaskId!==undefined)str(c.ownerTaskId,'task ID',200);if(c.source&&c.ownerTaskId&&c.source.taskId!==c.ownerTaskId)throw Error('This context belongs to a different task.');await activateContext(c);return null
    case 'context.cancel':if(contextIntake?.id===c.activationId){sourceDrag?.cancel();sourceContextEpoch++;contextIntake=undefined;retireDocumentFollow('Source selection cancelled.');}return null
    case 'context.capture':{
      const intake=contextIntake,id=str(c.activationId,'activation ID',200),windowId=str(c.windowId,'window ID',100)
      const guard=()=>{assertCurrentWork(lifecycle);if(!intake||contextIntake!==intake||id!==intake.id||Date.now()>=intake.expiresAt||quitting)throw Error('This screen selection expired. Use the shortcut again.');if(!sourceIntakeCurrent(intake))throw Error('Source attachment cancelled.');}
      guard();if(intake!.capturing)throw Error('A screen capture is already awaiting your decision.')
      if(intake!.ownerTaskId&&c.taskId!==intake!.ownerTaskId||intake!.newTask&&c.taskId!==undefined)throw Error('This context belongs to a different task.')
      const selected=intake!.windows.find(window=>window.id===windowId);if(!selected||isCompanionWindow(selected,ownApplication()))throw Error('Choose an external window from this selection.')
      intake!.capturing=true
      try{
        const current=await native.inspect(windowId);guard();if(!sameWindowIdentity(current,selected)&&!((intake!.invocation==='interface'||intake!.invocation==='shortcut'&&intake!.selectedWindowId===undefined)&&hasOnlyWindowBoundsChanged(selected,current)))throw Error('Source changed; select and refresh it.')
        // Bind the first shortcut inspection before entering the strict capture sink.
        // A no-room retry keeps this token; it cannot settle geometry again.
        if(intake!.invocation==='shortcut'){
          if(intake!.windows.length!==1||intake!.windows[0]!==selected)throw Error('This shortcut capture expired.');
          intake!.windows=[current];
          if(intake!.activation)intake!.activation={...intake!.activation,target:current};
        }
        let task=c.taskId?await core.getTask(c.taskId):undefined;guard()
        intake!.selectedWindowId=windowId
        if(intake!.tucked&&intake!.detachedFor!==windowId){
          if(intake!.dropPlacement?.epoch===surfaceEpoch){if(intake!.dropPlacement.noRoom)return {activationId:id,tucked:intake!.tucked,state:'no-room',task};}
          else{const placement=await attach(windowId,'companion',true,undefined,guard,current);guard();if(!placement)throw Error('This screen selection expired. Use the shortcut again.');if(placement.mode==='edge-anchor')return {activationId:id,tucked:intake!.tucked,state:'no-room',task};}
        }
        guard();
        // Appshot adds a context attachment. It never refreshes a source that
        // another request could start using while native consent is pending.
        const captured=await captureWindowSource({...(task?{taskId:task.id}:{newTaskTitle:(selected.title||selected.owner.name||'Window task').slice(0,200)}),windowId},guard,current,intake!.invocation==='shortcut'?intake:undefined,undefined,undefined,intake!.invocation==='drop'?intake:undefined);guard()
        const source=captured.sources.at(-1);if(!source)throw Error('Source was not stored.')
        contextIntake=undefined;return {activationId:id,tucked:intake!.tucked,state:'captured',task:captured,sourceId:source.id}
      }catch(error){if(contextIntake===intake)contextIntake=undefined;throw error;}finally{if(intake)intake.capturing=false}
    }
    case 'windows.capture':str(c.taskId,'task ID',200);return captureWindowSource(c)
    case 'canvas.create':{const saved=await createDesignCanvas(core,{taskId:str(c.taskId,'task ID',200),requestId:str(c.requestId,'request ID',200)});changed(c.taskId);return saved;}
    case 'canvas.save':{const {type,...input}=c;const saved=await saveDesignCanvas(core,input);changed(c.taskId);return saved;}
    case 'canvas.svg':{const {type,...input}=c;const saved=await saveCanvasSvg(core,input);changed(c.taskId);return saved;}
    case 'artifact.save':{
      const a=object(c.artifact);
      if(a.artifactId){const current=await core.getTask(c.taskId),revision=current.artifacts.find(item=>item.id===a.artifactId)?.revisions.at(-1);if(revision&&[DESIGN_CANVAS_MIME,DESIGN_SVG_MIME].includes(revision.mimeType))throw Error('Use the canvas editor to save this design.');if(revision?.mimeType===SOURCE_FORMULA_MIME)throw Error('Keep the cited formula publication unchanged. Save a separately reviewed transcription from its source.');if(revision)assertRawModuleOperationAllowed(revision.mimeType,'revise');}
      if(a.mimeType==='image/png'){
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
      assertRawModuleOperationAllowed(revision.mimeType,'export')
      const ext=revision.mimeType===DESIGN_SVG_MIME?'svg':revision.mimeType==='image/png'?'png':revision.mimeType==='application/json'?'json':revision.mimeType==='text/plain'?'txt':'md'
      const choice=await dialog.showSaveDialog(panel,{title:'Save a copy',defaultPath:`${revision.title.replace(/[^\w -]/g,'').slice(0,80)||'artifact'}.${ext}`,properties:['createDirectory','dontAddToRecent']})
      assertCurrentWork(lifecycle);if(choice.canceled||!choice.filePath)return null
      const action:ExportReply<Extract<Command,{type:'export.propose'}>>=await core.proposeExport(c.taskId,{artifactId:c.artifactId,revision:c.revision,path:choice.filePath});destinations.set(action.proposal.id,action.proposal.path);changed(c.taskId);return action
    }
    case 'export.approve':{
      const t=await core.getTask(c.taskId);const action=t.actions.find(a=>a.proposal.id===c.actionId)
      if(!action||destinations.get(c.actionId)!==action.proposal.path)throw Error('Choose the export destination again in this session.')
      const revision=t.artifacts.find(a=>a.id===action.proposal.artifactId)?.revisions.find(r=>r.revision===action.proposal.revision);if(!revision)throw Error('Artifact revision unavailable.')
      assertRawModuleOperationAllowed(revision.mimeType,'export')
      const choice=await dialog.showMessageBox(panel,{type:'question',message:'Save this version?',detail:`${action.proposal.path}\n${action.proposal.byteLength} bytes · Version ${action.proposal.revision}\n\nCreates one new file. Existing files will not be overwritten.`,buttons:['Cancel','Approve export'],defaultId:0,cancelId:0})
      assertCurrentWork(lifecycle);if(choice.response!==1)throw Error('Export not approved. No file was written.')
      const approved=await core.approveExport(c.taskId,c.actionId,c.digest)
      assertCurrentWork(lifecycle);if(!approved.approvalId)throw Error('Approval unavailable.')
      const result:ExportReply<Extract<Command,{type:'export.approve'}>>=await core.executeExport(c.taskId,{actionId:c.actionId,approvalId:approved.approvalId,requestId:str(c.requestId,'request ID',200)});destinations.delete(c.actionId);changed(c.taskId);return result
    }
    case 'export.inspect':{const result:ExportReply<Extract<Command,{type:'export.inspect'}>>=await core.inspectExport(c.taskId,c.actionId);return result}
    case 'model.cancel':return taskMutation(c.taskId,()=>core.cancelRequest(c.taskId,c.requestId))
    case 'model.run':{
      if(!['explain','create','revise','experiment','procedure','brief','concept-map','design-canvas'].includes(c.kind))throw Error('Choose a supported request kind.')
      if(c.artifactId&&c.kind!=='revise'&&c.kind!=='design-canvas')throw Error('Only a revision request can replace an artifact.')
      const epoch=keyEpoch,privacy=capturePrivacyEpoch,privacySignal=capturePrivacyAbort.signal,provider=activeProvider()
      const before=await core.getTask(c.taskId),target=c.artifactId?before.artifacts.find(a=>a.id===c.artifactId):undefined,targetRevision=target?.revisions.at(-1)
      assertCurrentWork(lifecycle);if(c.kind==='revise'&&!targetRevision)throw Error('Select an existing artifact to revise.')
      if(targetRevision&&[DESIGN_CANVAS_MIME,DESIGN_SVG_MIME].includes(targetRevision.mimeType)&&c.kind!=='design-canvas')throw Error('Edit the local canvas with its shape controls.');
      if(c.kind==='revise'&&targetRevision?.mimeType===SOURCE_FORMULA_MIME)throw Error('Keep the cited formula publication unchanged. Save a separately reviewed transcription from its source.');
      if(c.kind==='revise'&&targetRevision)assertRawModuleOperationAllowed(targetRevision.mimeType,'revise')
      if(c.revisionBasis!==undefined)assertRevisionInstructionRequest(before,c.artifactId!,c.revisionBasis,c.sourceIds,c.expectedSourceRefs)
      if(c.canvasContext&&c.kind!=='design-canvas')throw Error('Canvas context applies only to an explicit sketch request.');
      const canvasGeneration=prepareCanvasGeneration(before,c),conceptGeneration=prepareConceptMapGeneration(before,c);
      const plan=prepareBriefActionPlan(before,c),kind=plan?.request.kind??c.kind,prompt=plan?.request.prompt??str(c.prompt,'request',16000)
      const ordinary=!plan&&!target&&['explain','create'].includes(kind);
      const inference=ordinary&&!recurring?await resolveTaskRequestInference(before,prompt,kind==='create'?'create':'explain',queued):undefined;
      const skillChoice=ordinary&&!recurring?instructionSkillSelection(before.session):undefined,skill=queued?queued.instructionSkill??null:skillChoice?.selection??null;
      const preferences=ordinary?await responsePreferences.lease():undefined,memory=ordinary&&!recurring?await core.leaseUserMemory(c.taskId,prompt):undefined,folderGuidance=ordinary&&!recurring?await codeWorkspaces.guidanceLease(c.taskId):undefined;assertCurrentWork(lifecycle);
      const requestScope=[preferences?.scope,folderGuidance?.scope].filter(Boolean).join('|')||undefined;
      if(recurring){if(c.taskId!==recurring.taskId||c.requestId!==recurring.requestId||prompt!==recurring.prompt||kind!=='explain'||c.artifactId||c.submittedDraft||c.briefAction||JSON.stringify(c.sourceIds)!=='[]'||JSON.stringify(c.expectedSourceRefs)!=='[]'||before.sources.length||before.artifacts.length||before.requests.length||JSON.stringify(preferences?.current)!==recurring.grant.preferences)throw Error('The exact recurring response scope is unavailable.');await checkRecurringGrant(recurring.grant);}
      const request=canvasGeneration?.request??conceptGeneration?.request??plan?.request??{...(ordinary&&!recurring&&(skill||skillChoice?.revision)?{instructionSkill:skill,...(!queued?{instructionSkillRevision:skillChoice!.revision}:{})}:{}),...(inference?.selection?{inference:inference.selection,...(inference.revision===undefined?{}:{inferenceRevision:inference.revision})}:{}),...(queued?{queuedFollowup:{id:queued.id,revision:queued.revision,basis:queued.basis,scope:queued.scope}}:{}),taskId:c.taskId,requestId:str(c.requestId,'request ID',200),kind,prompt,...(memory?{memory:memory.receipt}:{}),...(c.conversationAttempt?{conversationAttempt:c.conversationAttempt}:{}),...(recurring?{executionScope:'recurring-response:v1:'+recurring.grant.id+':'+c.requestId}:requestScope?{executionScope:requestScope}:{}),...(c.submittedDraft?{submittedDraft:c.submittedDraft}:{}),...(c.sourceIds!==undefined?{sourceIds:c.sourceIds}:{}),...(c.expectedSourceRefs!==undefined?{expectedSourceRefs:c.expectedSourceRefs}:{}),...(target?{artifactId:target.id,expectedRevision:targetRevision!.revision}:{})}
      let captureRequest=false;let assertWindowPublication=()=>{};
      const assertResultCurrent=()=>{if(recurring)assertRecurringGrant(recurring.grant);memory?.assertCurrent();preferences?.assertCurrent();folderGuidance?.assertCurrent();assertWindowPublication();assertCurrentWork(lifecycle);if(epoch!==keyEpoch)throw Error('Connection changed during request.');if(captureRequest&&(privacy!==capturePrivacyEpoch||captureSettingsHealth!=='ready'||privacySignal.aborted))throw Error('Capture privacy changed during the request.');};
      const result=await core.runRequest(request,async ctx=>{
        if(queued)changed(c.taskId);
        const response=canvasGeneration?.bind(ctx)??conceptGeneration?.bind(ctx)??plan?.bind(ctx),reviewResponse=response&&response.kind!=='ordinary'?response:undefined;
        captureRequest=ctx.task.sources.some(source=>source.versions.at(-1)?.kind==='window');
        assertCurrentWork(lifecycle);if(request.expectedSourceRefs!==undefined){const refs=request.expectedSourceRefs;if(!Array.isArray(refs)||refs.length!==ctx.sourceRefs.length||refs.some(ref=>!ref||Object.keys(ref).sort().join(',')!=='digest,sourceId,version'||!ctx.sourceRefs.some(actual=>actual.sourceId===ref.sourceId&&actual.version===ref.version&&actual.digest===ref.digest))||new Set(refs.map(ref=>ref.sourceId)).size!==refs.length)throw Error('Source changed; select and refresh it.')}
        const revisionTarget=targetRevision&&!canvasGeneration?readTaskArtifactText(ctx.task,target!.id,targetRevision.revision):undefined
        if(revisionTarget&&!revisionTarget.available)throw Error(revisionTarget.reason)
        const revisionTargetDigest=revisionTarget?.available?createHash('sha256').update(revisionTarget.text).digest('hex'):undefined
        const styledContext=preferences?responsePreferencesContext(recurring?undefined:ctx.taskHistory,preferences.current):recurring?undefined:ctx.taskHistory;
        const taskContext=memory?userMemoryContext(styledContext,memory):styledContext;
        await memory?.check();
        await preferences?.check();await folderGuidance?.check();
        const connection=inference?.selection?await codexProvider.statusFor(inference.selection):await provider.status();assertCurrentWork(lifecycle)
        if(!connection.configured)throw Error('Provider availability is unverified. Check the connection before authorizing a new request. Nothing was sent.')
        const accountScope=ordinary&&!recurring?await provider.accountScope():undefined;
        assertCurrentWork(lifecycle);
        const transmissionScope=JSON.stringify([epoch,selectedProvider,accountScope]);
        if(queued){const snapshot=await queuedScope(c.taskId,prompt,queued.basis,queued.inference,queued.instructionSkill??null,{id:queued.id,revision:queued.revision});if(snapshot.scope!==queued.scope||ordinaryTransmissionConsent!==transmissionScope)throw Error('The queued context or provider session changed before transmission.');}
        if(recurring){await checkRecurringGrant(recurring.grant);}else if(queued){/* Queue submission already expressed this exact text intent. */}else if(!ordinary||ordinaryTransmissionConsent!==transmissionScope){
          const consent=await dialog.showMessageBox(panel,{type:'question',message:`Send this request to ${connection.provider==='Meta'?'Meta':'OpenAI'}?`,detail:`${connection.provider==='Meta'?'Destination: Meta (api.meta.ai)':'Destination: OpenAI through your Codex account'}\n\n${ordinary?ordinaryAskNotice:''}Sources:\n${ctx.task.sources.map(s=>{const v=s.versions.at(-1)!;return `${v.label} · ${v.kind==='window'?'window snapshot':v.kind} · ${v.role} reference · version ${v.version}`}).join('\n')||'No sources selected'}\n\n${ctx.taskHistory?`${taskHistoryReview(ctx.taskHistory)}\n\n`:''}${targetRevision?`Revising “${targetRevision.title}” (version ${targetRevision.revision}).\n\n`:''}${plan?`Using “${plan.review.basisTitle}” (version ${plan.review.basisRevision}). ${plan.review.purpose}\n\n`:''}Request: ${prompt}\n\n${instructionSkillReview(ctx.instructionSkill)}${memory?memory.consent+'\n\n':''}${ctx.projectInstructions?.text?`Project: ${ctx.projectInstructions.name} · saved instructions revision ${ctx.projectInstructions.revision}\n${ctx.projectInstructions.text}\nEnd of project instructions.\n\n`:''}${preferences?preferences.consent+'\n\n':''}${folderGuidance?.consent??''}${reviewResponse?.kind==='design-canvas'?'This sends the saved canvas layout, selected shape text, your sketch request and the listed current text sources. A validated sketch adds editable local shapes as a new canvas revision. User strokes stay unchanged. No screenshot or external tool is used.\n\n':reviewResponse?.kind==='concept-map'?'This prepares an inspectable concept map from the listed text sources. Relationships are proposed interpretations with source excerpts and uncertainty, not verified facts.\n\n':reviewResponse?.kind==='window-workflow-proposal'?'This prepares proposed image transcription and inferred finite state transitions for your review. It does not simulate HDL.\n\n':reviewResponse?'This prepares table transcription for your review. It does not run a database query.\n\n':''}${connection.provider==='Meta'?'Uses your selected Meta account.':'Uses your Codex account and its existing instructions.'} This requests a response; it does not allow changes to your apps or files. Stopping disconnects this app, but the service may already be processing the request.`,buttons:['Cancel',`Send to ${connection.provider==='Meta'?'Meta':'OpenAI'}`],defaultId:0,cancelId:0})
          assertCurrentWork(lifecycle);await memory?.check();await preferences?.check();await folderGuidance?.check();if(consent.response!==1)throw Error('Model request was not authorized. Nothing was sent.');
          if(ctx.signal.aborted||epoch!==keyEpoch)throw Error('Request stopped or connection changed before transmission.');
          if(accountScope&&await provider.accountScope()!==accountScope)throw Error('The connection or instructions changed. Ask again to review the current destination.');
          if(ordinary)ordinaryTransmissionConsent=transmissionScope;
        }
        assertCurrentWork(lifecycle);if(ctx.signal.aborted||epoch!==keyEpoch)throw Error('Request stopped or connection changed before transmission.')
        const sources=recurring?[]:ctx.task.sources.map(s=>({...s.versions.at(-1)!}))
        const windowSources=sources.filter(source=>source.kind==='window').map(source=>({source,binding:{...source},capture:boundCapture(c.taskId,source)}))
        for(const {source,capture} of windowSources){
          if(!capture)throw Error('Refresh the selected window. Captures are frozen, expire after five minutes and are not stored in task history.')
          let current
          try{current=await native.inspect(capture.source.id)}catch{
            assertCurrentWork(lifecycle);if(ctx.signal.aborted||epoch!==keyEpoch)throw Error('Request stopped or connection changed before transmission.')
            if(captures.get(`${c.taskId}:${source.id}`)?.capture!==capture)throw Error('Source changed or expired; select and refresh it.')
            await retireUnavailableWindow(capture.source.id,'The selected window is unavailable. Rebind an explicit source.');throw Error('The selected window is unavailable; select and refresh it.')
          }
          assertCurrentWork(lifecycle);if(ctx.signal.aborted||epoch!==keyEpoch)throw Error('Request stopped or connection changed before transmission.')
          if(captures.get(`${c.taskId}:${source.id}`)?.capture!==capture)throw Error('Source changed or expired; select and refresh it.')
          if(isCompanionWindow(current,ownApplication())||!sameWindowIdentity(current,capture.source)){captures.delete(`${c.taskId}:${source.id}`);await core.invalidateSource(c.taskId,source.id,'Native window metadata changed. Rebind explicitly.');throw Error('Source changed; select and refresh it.')}
        }
        if(targetRevision&&revisionTarget?.available)sources.push({id:`artifact:${target!.id}`,version:targetRevision.revision,digest:revisionTargetDigest!,kind:'text',label:`Revision target: ${targetRevision.title} (saved artifact digest ${targetRevision.digest})`,role:'fact',content:revisionTarget.text,capturedAt:targetRevision.createdAt})
        assertCurrentWork(lifecycle);if(ctx.signal.aborted||epoch!==keyEpoch)throw Error('Request stopped or connection changed before transmission.')
        for(const {source,capture} of windowSources){
          if(!capture||captures.get(`${c.taskId}:${source.id}`)?.capture!==capture||boundCapture(c.taskId,source)!==capture)throw Error('Source changed or expired; select and refresh it.')
          source.content=capture.dataUrl
        }
        const assertWindowUse=()=>{
          if(recurring)assertRecurringGrant(recurring.grant);
          assertCurrentWork(lifecycle);if(ctx.signal.aborted||epoch!==keyEpoch)throw Error('Request stopped or connection changed before transmission.');
          if(windowSources.length&&(privacy!==capturePrivacyEpoch||captureSettingsHealth!=='ready'))throw Error('Capture privacy changed before transmission.');
          for(const {binding,capture} of windowSources)if(!capture||boundCapture(c.taskId,binding)!==capture)throw Error('Source changed or expired; select and refresh it.');
        };
        const windowFence=windowSources.length?{assertCurrent:assertWindowUse,check:async()=>{
          assertWindowUse();
          await documentFollow.poll();assertWindowUse();
          await checkCaptureTarget(windowSources.map(({capture})=>capture!.source),undefined,assertWindowUse);assertWindowUse();
        }}:undefined;
        const captureFence=preferences||memory||folderGuidance?{assertCurrent:()=>{memory?.assertCurrent();preferences?.assertCurrent();folderGuidance?.assertCurrent();assertWindowUse();},check:async()=>{await memory?.check();await preferences?.check();await folderGuidance?.check();await windowFence?.check();memory?.assertCurrent();preferences?.assertCurrent();folderGuidance?.assertCurrent();}}:windowFence;
        await captureFence?.check();assertWindowUse();
        if(response?.kind==='window-workflow-proposal'||response?.kind==='concept-map')assertWindowPublication=assertWindowUse;
        let streamed=''
        const structured=kind==='experiment'||kind==='procedure'?kind:undefined
        if(reviewResponse)emit({type:'stream',taskId:c.taskId,requestId:c.requestId,text:reviewResponse.progress})
        let modelReceipt:ProviderModelReceipt|undefined;
        const composed=ordinary&&!recurring?composeOrdinaryRequest({prompt,sources,taskHistory:ctx.taskHistory,projectInstructions:ctx.projectInstructions,preferences:preferences?.current,memory,instructionSkill:ctx.instructionSkill,folderGuidance:folderGuidance?.current}):{prompt:reviewResponse?reviewResponse.prompt:kind==='brief'?screenBriefPrompt(ctx.sourceRefs):structured?structuredPrompt(structured,prompt):prompt,sources,...(!recurring&&ctx.projectInstructions?{projectInstructions:ctx.projectInstructions}:{}),...(['explain','create','revise'].includes(kind)?{taskContext}:{})};
        const options={modelReceipt:{requestId:request.requestId,onConfirmed:(receipt:ProviderModelReceipt)=>{modelReceipt=receipt;}},...(inference?.selection?{inference:inference.selection}:{}),...((recurring?.grant.accountScope??accountScope)?{expectedAccountScope:recurring?.grant.accountScope??accountScope}:{}),captureFence,signal:AbortSignal.any([ctx.signal,...(recurring?[recurring.grant.controller.signal]:[]),...(windowSources.length?[privacySignal]:[]),...(preferences?[preferences.signal]:[]),...(memory?[memory.signal]:[]),...(folderGuidance?[folderGuidance.signal]:[])]),onChunk:(delta:string)=>{memory?.assertCurrent();preferences?.assertCurrent();folderGuidance?.assertCurrent();if(reviewResponse)return;const first=streamed.length===0;streamed+=delta;if(epoch===keyEpoch&&(!windowSources.length||privacy===capturePrivacyEpoch)&&(!structured||first))emit({type:'stream',taskId:c.taskId,requestId:c.requestId,text:kind==='brief'?screenBriefInsight(streamed):structured?(structured==='experiment'?'Preparing your experiment…':'Preparing your procedure…'):streamed})}};
        const content=ordinary&&!recurring?await dispatchOrdinaryRequest(provider,{prompt,sources,taskHistory:ctx.taskHistory,projectInstructions:ctx.projectInstructions,preferences:preferences?.current,memory,instructionSkill:ctx.instructionSkill,folderGuidance:folderGuidance?.current},options):await provider.run({...composed,...options});
        await memory?.check();await preferences?.check();await folderGuidance?.check();
        if(windowSources.length&&(privacy!==capturePrivacyEpoch||captureSettingsHealth!=='ready'))throw Error('Capture privacy changed during the request.');
        if(epoch!==keyEpoch)throw Error('Connection changed during request.')
        if(response?.kind==='window-workflow-proposal'||response?.kind==='concept-map'){await captureFence?.check();assertWindowUse();}
        let output:RequestOutput;
        if(reviewResponse)output=reviewResponse.finish(content);
        else if(structured){const draft=parseModelDraft(content,structured);output={title:draft.title,content:JSON.stringify(draft,null,2),mimeType:'application/json'};}
        else if(kind==='brief'){const brief=parseScreenBriefModel(content,ctx.sourceRefs);output={title:'Screen brief',content:JSON.stringify(brief),mimeType:'application/json'};}
        else output={title:targetRevision?.title||(kind==='explain'?'Explanation':'Draft'),content,mimeType:'text/markdown'};
        return {...output,...(modelReceipt?{modelReceipt}:{})};
      },assertResultCurrent);changed(c.taskId);drainQueuedFollowups();if(result.status!=='completed')throw Error(result.error||`Request ${result.status}.`);return core.getTask(c.taskId)
    }
    case 'connection.status':return {connection:await activeProvider().status(),host:await hostStatus()}
    case 'connection.configure':return selectedProvider==='meta'?configureConnection():{connection:await codexProvider.status(),host:await hostStatus()}
    case 'connection.select':{
      if(c.provider!=='meta'&&c.provider!=='codex')throw Error('Select an installed provider route.')
      keyEpoch++;await retireRecurringGrants();for(const t of await core.listTasks())for(const r of t.requests)if(r.status==='running')await core.cancelRequest(t.id,r.id)
      metaProvider.reset();codexProvider.reset();browserCodexProvider.reset();selectedProvider=c.provider;connectionDisabled=false
      await writeFile(join(dataDir,'provider.json'),JSON.stringify({provider:selectedProvider}),{mode:0o600});await rm(join(dataDir,'connection-disabled'),{force:true});changed()
      return {connection:await activeProvider().status(),host:await hostStatus()}
    }
    case 'connection.disconnect':{
      keyEpoch++;await retireRecurringGrants();connectionDisabled=true;for(const t of await core.listTasks())for(const r of t.requests)if(r.status==='running')await core.cancelRequest(t.id,r.id)
      await writeFile(join(dataDir,'connection-disabled'),'disabled',{mode:0o600});await rm(credentialPath,{force:true});metaProvider.reset();codexProvider.reset();browserCodexProvider.reset();changed();return {connection:await activeProvider().status(),host:await hostStatus()}
    }
    case 'presentation.capture':return captureForCurrentExit(c.exitId)
    case 'presentation.finish':{
      if(exitPending&&c.exitId===exitPending.id){finishQuit();return null}
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
    case 'surface.floating':await openFloatingCompanion();return null
    case 'surface.hide':await hideFloatingCompanion();return null
    case 'surface.companion':panel.setAlwaysOnTop(true);await expand('companion');return null
    case 'surface.standalone':{await floatingSave;if(floatingWindow&&viewMode==='companion')await botPreferences.saveFloatingState({floatingBounds:panel.getBounds(),floatingVisible:false});floatingWindow=false;retireDocumentFollow('The task was detached from its window.');if(contextIntake?.selectedWindowId)contextIntake.detachedFor=contextIntake.selectedWindowId;const entrance=entrancePresentation?.anchor??(panel.getSize()[0]<=100?panel.getBounds():undefined);cancelEntrancePresentation(false);cancelCollapsePresentation();surfaceEpoch++;const work=screen.getDisplayMatching(panel.getBounds()).workArea,width=Math.min(1080,work.width-32),height=Math.min(720,work.height-32);placementMode='detached';panel.setAlwaysOnTop(false);panelBounds={x:work.x+Math.round((work.width-width)/2),y:work.y+Math.round((work.height-height)/2),width,height};showSurface('workspace',panelBounds,'standalone',true,entrance);return null;}
    case 'surface.workspace':await expand('workspace');return null
    case 'surface.attach':return attach(str(c.windowId,'window ID',100))
    case 'shortcut.get':return hostStatus()
    case 'shortcut.set':await fallbackShortcutSettings.change(c.accelerator,c.expectedShortcut,()=>assertCurrentWork(lifecycle));return hostStatus()
    case 'shortcut.reset':await fallbackShortcutSettings.reset(c.expectedShortcut,()=>assertCurrentWork(lifecycle));return hostStatus()
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

async function dispatchCompanionCommand(event:Pick<Electron.IpcMainInvokeEvent,'sender'|'senderFrame'>,value:unknown){
    try{
      if(event.sender!==panel.webContents||event.senderFrame!==panel.webContents.mainFrame)throw Error('Untrusted companion caller.')
      const c=validate(value);if(isContentBackupCommand(c)){if(!['content-backup.status','content-backup.restart'].includes(c.type)&&(pendingEffects.size||credentialWindow&&!credentialWindow.isDestroyed()))throw Error('Content backup: Finish active requests, actions and connection dialogs before backing up or restoring.');return await contentBackups.command(c);}const key=c.type==='schedules.change'?`schedule:${c.change.id}`:c.type==='windows.capture'?'capture:window':c.type==='export.approve'?`export:${c.actionId}`:c.type==='model.run'||c.type==='browser.run'||c.type==='browser.workflow.run'||c.type==='browser.continue'?`model:${c.taskId}`:c.type==='browser.inspect'?`inspect:${c.taskId}:${c.operationId}`:undefined
      if(key&&pendingEffects.has(key))throw Error('This effect is already awaiting a result.')
      if(key)pendingEffects.add(key)
      try{return await contentBackupGate.run(c.type,()=>command(c))}finally{if(key)pendingEffects.delete(key);if(key?.startsWith('model:')||c.type==='queue.submit'||c.type==='queue.edit'||c.type==='queue.cancel')drainQueuedFollowups();}
    }catch(error){throw Error(publicErrorMessage(error))}
  }
app.whenReady().then(async()=>{
  if(Menu?.buildFromTemplate)Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform==='darwin'?[{label:'Glint',submenu:[{role:'about' as const,label:'About Glint'},{type:'separator' as const},{role:'hide' as const,label:'Hide Glint'},{role:'hideOthers' as const},{role:'unhide' as const},{type:'separator' as const},{role:'quit' as const,label:'Quit Glint'}]}]:[]),
    {label:'File',submenu:[{label:'Use screen context',accelerator:undefined,click:()=>void activateContext()},{role:'close'}]},
    {label:'Edit',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
    {label:'View',submenu:[{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'}]},
    {label:'Window',submenu:[{label:'Minimize',accelerator:'CommandOrControl+M',click:()=>void requestCollapse()},{role:'front'}]},
  ]))
  await mkdir(dataDir,{recursive:true,mode:0o700});core=await createCompanion({dataDir,beforeReadState:()=>recoverContentRestore(dataDir)});contentBackups=createContentBackups();captureSettings=await CaptureSettings.open(dataDir);botPreferences=await BotPreferences.open(dataDir,core);await botPreferences.finishExample(core);const restoredView=await taskViewPreferences.read();currentViewTaskId=restoredView.kind==='available'?restoredView.taskId??undefined:undefined;requestedViewTaskId=currentViewTaskId;if(quitting){await core.close();return}
  try{await readFile(join(dataDir,'connection-disabled'));connectionDisabled=true}catch{}
  try{const saved=JSON.parse(await readFile(join(dataDir,'provider.json'),'utf8'));if(saved.provider==='meta'||saved.provider==='codex')selectedProvider=saved.provider}catch{}
  try{const saved=JSON.parse(await readFile(join(dataDir,'shortcut.json'),'utf8'));if(typeof saved.shortcut==='string')shortcut=saved.shortcut}catch{}
  session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));session.defaultSession.setPermissionCheckHandler(()=>false)
  if(quitting)return
  panel=new BrowserWindow({width:430,height:760,x:screen.getPrimaryDisplay().workArea.x+screen.getPrimaryDisplay().workArea.width-450,y:screen.getPrimaryDisplay().workArea.y+20,frame:false,show:false,alwaysOnTop:true,title:'Glint',backgroundColor:process.platform==='darwin'?'#00000000':'#f6f7f9',...(process.platform==='darwin'?{transparent:true,hasShadow:false}:{}),webPreferences:{preload:join(here,'../preload/index.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}})
  if(process.platform==='darwin'||process.platform==='win32')panel.setContentProtection(true)
  panel.webContents.setWindowOpenHandler(()=>({action:'deny'}));panel.webContents.on('will-navigate',e=>e.preventDefault());panel.on('close',e=>{if(!quitApproved){e.preventDefault();if(!quitting)void requestCollapse()}})
  installNativeSourceDrag()
  installNativeWindowMove()
  ipcMain.handle('companion:command',dispatchCompanionCommand)
  ipcMain.handle('credential:save',async(event,value)=>{
    try{
      if(contentBackupGate.busy)throw Error('Content backup: Finish the content operation before changing connections.');
      if(!credentialWindow||event.sender!==credentialWindow.webContents||event.senderFrame!==credentialWindow.webContents.mainFrame)throw Error('Untrusted credential entry.')
      const v=object(value);if(v.acknowledged!==true)throw Error('Authorize this destination before connecting.');const key=str(v.key,'API key',512);if(!safeStorage.isEncryptionAvailable())throw Error('OS secure storage unavailable; connection was not saved.')
      await writeFile(credentialPath,safeStorage.encryptString(key),{mode:0o600});selectedProvider='meta';await writeFile(join(dataDir,'provider.json'),JSON.stringify({provider:selectedProvider}),{mode:0o600});connectionDisabled=false;await rm(join(dataDir,'connection-disabled'),{force:true});keyEpoch++;await retireRecurringGrants();metaProvider.reset();codexProvider.reset();browserCodexProvider.reset();credentialWindow.close();credentialWindow=undefined;changed();return true
    }catch(error){throw Error(publicErrorMessage(error))}
  })
  if(process.env.ELECTRON_RENDERER_URL)await panel.loadURL(process.env.ELECTRON_RENDERER_URL);else await panel.loadFile(join(here,'../renderer/index.html'))
  if(quitting||quitApproved)return
  const floatingState=await botPreferences.read();if(floatingState.kind==='available'&&floatingState.current.kind==='ready'&&floatingState.current.floatingVisible)await openFloatingCompanion();else panel.show();if(!testNoGlobalInput)shortcutRegistered=globalShortcut.register(shortcut,()=>void activateShortcut())
  if(!testNoGlobalInput)await modifierShortcut.start()
  if(quitting||quitApproved)return
  const trayImage=nativeImage.createFromDataURL(trayImageDataUrl).resize({width:18,height:18});if(process.platform==='darwin')trayImage.setTemplateImage(true)
  if(!testNoGlobalInput){tray=new Tray(trayImage);tray.setToolTip('Glint');tray.setContextMenu(Menu.buildFromTemplate([{label:'Use screen context',click:()=>void activateContext()},{label:'Open Glint',click:()=>void expand('workspace')},{label:'Show floating companion',click:()=>void openFloatingCompanion().catch(error=>dialog.showMessageBox(panel,{type:'info',message:publicErrorMessage(error)}))},{label:'Hide floating companion',click:()=>void hideFloatingCompanion().catch(()=>{})},{type:'separator'},{label:'Follow selected window this session…',click:()=>void command({type:'source.follow.enable'}).catch(error=>dialog.showMessageBox(panel,{type:'info',message:'Document following is paused',detail:publicErrorMessage(error)}))},{label:'Stop document following',click:()=>{retireDocumentFollow('Stopped by you. Use a new gesture to choose a window.');}},{label:'Document follow status…',click:()=>{const state=documentFollow.read();void dialog.showMessageBox(panel,{type:'info',message:state.kind==='off'?'Document following is off':state.automaticSnapshots==='on'?'Selected-window snapshots are on':state.automaticSnapshots==='paused'?'Selected-window snapshots are paused':'Document metadata only',detail:state.reason});}},{type:'separator'},{label:'Quit Glint',click:()=>app.quit()}]));tray.on('click',()=>void expand())}
  monitor=setInterval(()=>{void monitorAttached().catch(()=>{})},2000)
  taskNotifications.start()
  recurringWorkRunner.start()
}).catch(error=>{if(quitting||quitApproved)return;console.error('Companion startup failed:',error.message);dialog.showErrorBox('Glint could not open',publicErrorMessage(error));app.quit()})
let quitEpoch=0,quitting=false,quitApproved=false,quitInProgress=false,finalizingQuit=false,exitPending:{id:string;captureStarted:boolean}|undefined,exitTimeout:ReturnType<typeof setTimeout>|undefined
const quitDrafts=createQuitDraftBarrier({
 send:quitId=>emit({type:'draft.flush',quitId}),
 confirmDiscard:async reason=>{const options={type:'warning',message:'Quit without saving unfinished work?',detail:reason+'\n\nKeep the app open to retain your unsent messages and practice edits, or quit without saving the unconfirmed edits.',buttons:['Keep app open','Quit without saving'],defaultId:0,cancelId:0} as const;const result=await (panel&&!panel.isDestroyed()?dialog.showMessageBox(panel,{...options,buttons:[...options.buttons]}):dialog.showMessageBox({...options,buttons:[...options.buttons]}));return result.response===1;},
})
async function stopForQuit(){
 await floatingSave;
 await taskNotifications.close();await notificationToast.close();
 await pdfPageImports.close();
 publicGithub.cancel();
 await documentSpeech.close();
 sourceDrag?.cancel();sourceDragPreview?.clear();sourceContextEpoch++
 retireDocumentFollow('App closing. A new user gesture is required after restart.');quitting=true;quitEpoch++;keyEpoch++;contextIntake=undefined;modifierShortcut.stop();globalShortcut.unregisterAll();shortcutRegistered=false;if(monitor){clearInterval(monitor);monitor=undefined;}
 await retireRecurringGrants();
 await recurringWorkRunner.stop();
 capturePrivacyAbort.abort();captures.clear();metaProvider.reset();codexProvider.close();browserCodexProvider.close();browserInspectionAttempts.close();browserService?.close();browserService=undefined;
 try{await viewSelectionQueue;if(core)for(const task of await core.listTasks())for(const request of task.requests)if(request.status==='running')await core.cancelRequest(task.id,request.id);}catch{return 'The local task store could not confirm pending message saves.';}
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
 const exitId=randomUUID();exitPending={id:exitId,captureStarted:false};
 // The animation deadline does not bypass the preceding durable draft barrier.
 exitTimeout=setTimeout(()=>void finishQuit(),3500);
 emit({type:'presentation.prepare',exitId,purpose:'quit'});
}
async function beginQuit(){
 const stopFailure=await stopForQuit();
 if(panel&&!panel.isDestroyed()||stopFailure){
  const decision=await quitDrafts.request(stopFailure);
  if(!decision.allowQuit){
   // Retired work keeps its old signal and quit epoch; later gestures get a fresh cancellation scope.
   capturePrivacyAbort=new AbortController();browserInspectionAttempts.resume();
   quitting=false;quitInProgress=false;notificationToast.resume();taskNotifications.resume();emit({type:'draft.resume',quitId:decision.id});
   if(!testNoGlobalInput){shortcutRegistered=globalShortcut.register(shortcut,()=>void activateShortcut());await modifierShortcut.start();}
   monitor=setInterval(()=>{void monitorAttached().catch(()=>{})},2000);recurringWorkRunner.start();return;
  }
 }
 drawQuit();
}

const contentBackupDrafts=createQuitDraftBarrier({send:quitId=>emit({type:'draft.flush',quitId}),confirmDiscard:async()=>false})
function createContentBackups(){return new ContentBackups({
 directory:dataDir,appVersion:app.getVersion(),snapshot:()=>core.contentSnapshot(),
 chooseSave:async()=>{const selected=await dialog.showSaveDialog(panel,{title:'Save Glint content backup',defaultPath:`glint-content-${new Date().toISOString().slice(0,10)}.glint-backup.json`,filters:[{name:'Glint content backup',extensions:['json']}],properties:['createDirectory','dontAddToRecent']});return selected.canceled?undefined:selected.filePath;},
 chooseOpen:async()=>{const selected=await dialog.showOpenDialog(panel,{title:'Choose Glint content backup to restore',properties:['openFile','dontAddToRecent'],filters:[{name:'Glint content backup',extensions:['json']}]});return selected.canceled?undefined:selected.filePaths[0];},
 maintain:operation=>contentBackupGate.maintain(operation,{
  before:async()=>{
   publicGithub.cancel();
   if((await core.listTasks()).some(task=>task.requests.some(request=>request.status==='running')))throw Error('Content backup: Stop active responses before backing up or restoring.');
   await recurringWorkRunner.stop();
   // The integrated condition-watch owner adds its awaited suspend() here before capture.
   sourceDrag?.cancel();sourceDragPreview?.clear();sourceContextEpoch++;contextIntake=undefined;captures.clear();retireDocumentFollow('Content backup retired document following. Choose a window again explicitly.');
   if(monitor){clearInterval(monitor);monitor=undefined;}
  },
  freeze:async()=>{const decision=await contentBackupDrafts.request();if(!decision.saved){emit({type:'draft.resume',quitId:decision.id});throw Error('Content backup: Unfinished input could not be confirmed. Nothing was exported or restored. Keep Glint open and retry saving drafts.');}return decision.id;},
  resume:quitId=>{if(quitId)emit({type:'draft.resume',quitId});if(!quitting){if(!monitor)monitor=setInterval(()=>{void monitorAttached().catch(()=>{})},2000);recurringWorkRunner.start();}},
 }),
 restoreUnderOwnership:async transaction=>{contentBackupGate.seal();await documentSpeech.close();ordinaryTransmissionConsent=undefined;keyEpoch++;quitEpoch++;capturePrivacyAbort.abort();modifierShortcut.stop();globalShortcut.unregisterAll();shortcutRegistered=false;metaProvider.reset();codexProvider.close();browserCodexProvider.close();browserInspectionAttempts.close();browserService?.close();browserService=undefined;return core.closeForContentRestore(transaction);},
 restart:()=>{setTimeout(()=>{quitApproved=true;app.relaunch();app.exit(0);},200);},
})}

app.on('before-quit',event=>{
 cliPreview.close();
 if(quitApproved)return;
 if(contentBackupGate.busy){event.preventDefault();return;}
 event.preventDefault();if(quitInProgress)return;quitInProgress=true;quitting=true;
 void beginQuit().catch(()=>{quitInProgress=false;quitting=false;notificationToast.resume();taskNotifications.resume();recurringWorkRunner.start();dialog.showErrorBox('Messages could not be saved','The app stayed open. Keep a copy of your message before trying again.');});
})
app.on('window-all-closed',()=>app.quit())
