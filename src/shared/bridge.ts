import type {MemoryChange} from './user-memory';
import type {DocumentImportOwner,DocumentImportAdd} from './document-import';
import type {BrowserContinuationInput} from './browser-continuation';
import type {TargetPracticeInput,TargetPracticeSubmission} from '../learning/experiment-target-practice';
import type {SourceFormulaInput,SourceFormulaCommand} from '../learning/source-formula';
import type {DocumentRecipeRequest,DocumentRecipeSave,DocumentRecipeInspection} from './document-recipe';
import type {HelperSourceBatchRequest,HelperSourceBatchSave,HelperSourceBatchInspection} from './helper-source-batch';
import type {RecordedTextRequest} from '../core/recorded-text-helper-host';
import type {LearningDraftOwner,LearningDraftValue} from './learning-drafts'
import type {ResponseBranchInput} from '../core/response-branch'
import type {LocalTaskStartInput} from './local-task-start'
import type {WorkflowReview} from '../learning/workflow-review'
import type {BotCommand} from './bot-catalog'
import type {CharacterProfile} from './character-catalog'
import type {ExportCommand,ExportReply,OtherCommand} from './export-contract'
import type { Task, SourceInput, SourceRef, ArtifactRef, ArtifactInput, ProcedureInput, ExperimentSpec, ExperimentResult } from '../core/types'
import type {ModuleAction} from '../core/interactive-modules'
import type {ComposerDraft} from '../core/task-session'
import type {SourceDragState} from './source-drag'
import type {SourceTextExpected} from './source-text-draft'
import type {SourceTextSaveInspectionInput} from './source-text-save'
import type {TaskHandoffSave} from './task-handoff';
import type {TaskArchiveChange} from './task-archive';
import type {SavedDocumentSourceInput} from './saved-document-source';
import type {ProjectCommand} from './projects';

export type Command =
  | {type:'memory.get'} | ({type:'memory.change'} & MemoryChange)
  | ProjectCommand
  | ({type:'experiment.source.save'} & SourceFormulaCommand)
  | {type:'experiment.source.inspect';input:SourceFormulaInput}
  | {type:'capture.settings.get'} | {type:'capture.settings.revoke';expectedRevision:number}
  | {type:'capture.settings.private';expectedRevision:number;keep:number[];windowIds:string[]}
  | {type:'bots.get'} | {type:'bots.change';change:BotCommand}
  | {type:'bots.assign';taskId:string;botId:string;expectedBotId:string}
  | {type:'response-preferences.get'} | {type:'response-preferences.update';expectedRevision:number;enabled:boolean;text:string}
  | {type:'preferences.get'} | {type:'preferences.update';expectedRevision:number;profile:CharacterProfile}
  | {type:'tasks.list'} | {type:'tasks.create';title:string;goal?:string}
  | ({type:'tasks.start-local'} & LocalTaskStartInput)
  | ({type:'tasks.branch'} & ResponseBranchInput)
  | {type:'tasks.update';taskId:string;title:string;goal?:string}
  | {type:'tasks.get';taskId:string} | {type:'tasks.delete';taskId:string}
  | {type:'tasks.pause'|'tasks.resume';taskId:string}
  | ({type:'tasks.archive'} & TaskArchiveChange)
  | {type:'tasks.checkpoint';taskId:string;note:string}
  | {type:'task-pins.get'} | {type:'task-pins.set';taskId:string;pinned:boolean}
  | {type:'draft.save';taskId:string;expectedRevision:number;draft:Pick<ComposerDraft,'text'|'kind'>}
  | {type:'draft.flushed';quitId:string;error?:string}
  | {type:'learning-drafts.read'}
  | {type:'learning-drafts.recover';recoveryToken:string}
  | {type:'learning-drafts.cleanup'}
  | {type:'learning-drafts.save';owner:LearningDraftOwner;slot:string;expectedEpoch:string;expectedRevision:number;value:LearningDraftValue|null}
  | {type:'source.text';taskId:string;source:SourceInput;expectedSource?:SourceTextExpected;edit?:{intentId:string;binding:string}}
  | ({type:'source.text.inspect'} & SourceTextSaveInspectionInput)
  | ({type:'source.document'} & SavedDocumentSourceInput)
  | ({type:'source.import.choose'} & DocumentImportOwner)
  | ({type:'source.import.cancel'} & DocumentImportOwner)
  | ({type:'source.import.add'} & DocumentImportAdd)
  | {type:'source.image';taskId:string;role:SourceInput['role'];sourceId?:string}
  | {type:'source.follow.get'|'source.follow.enable'|'source.follow.stop'}
  | {type:'source.drag.cancel'} | {type:'source.choose'}
  | {type:'source.invalidate';taskId:string;sourceId:string}
  | {type:'source.preview';taskId:string;sourceId:string;reference?:SourceRef}
  | {type:'windows.list'} | {type:'windows.capture';taskId:string;windowId:string;sourceId?:string}
  | {type:'context.start';newTask?:boolean;source?:SourceRef&{taskId:string};requestId?:string;ownerTaskId?:string} | {type:'context.cancel';activationId:string}
  | {type:'context.view';taskId?:string} | {type:'task-view.get'} | {type:'context.pending'}
  | {type:'context.capture';activationId:string;windowId:string;taskId?:string}
  | {type:'artifact.save';taskId:string;artifact:ArtifactInput}
  | ({type:'artifact.handoff'} & TaskHandoffSave)
  | {type:'module.edit';taskId:string;artifactId:string;artifactRevision:number;moduleId:string;action:ModuleAction}
  | {type:'module.document';taskId:string;artifactId:string;artifactRevision:number;sessionRevision:number}
  | {type:'workflow.window.review';taskId:string;requestId:string;candidate:ArtifactRef;review:unknown}
  | {type:'workflow.example';taskId:string;requestId:string}
  | {type:'helper.create';taskId:string;requestId:string}
  | {type:'helper.document.create';taskId:string;requestId:string}
  | ({type:'helper.document.preview'} & DocumentRecipeRequest)
  | ({type:'helper.document.save'} & DocumentRecipeSave)
  | ({type:'helper.document.inspect'} & DocumentRecipeInspection)
  | ({type:'helper.source-batch.preview'} & HelperSourceBatchRequest)
  | ({type:'helper.source-batch.save'} & HelperSourceBatchSave)
  | ({type:'helper.source-batch.inspect'} & HelperSourceBatchInspection)
  | ({type:'helper.recorded.inspect'} & RecordedTextRequest)
  | ({type:'helper.recorded.create';binding:string;confirmed:'create-separate-inactive-draft'} & RecordedTextRequest)
  | {type:'workflow.prepare';taskId:string;basis:ArtifactRef}
  | {type:'truth.review';taskId:string;basis:ArtifactRef;expectedSourceRefs:readonly SourceRef[];sourceId:string;start:number;end:number;quote:string;confirmed:true;mode?:'table'|'prediction';retryOf?:string}
  | {type:'truth.inspect';taskId:string;basis:ArtifactRef;expectedSourceRefs:readonly SourceRef[];sourceId:string;start:number;end:number;quote:string;confirmed:true;mode?:'table'|'prediction'}
  | ({type:'experiment.target.inspect'} & TargetPracticeInput)
  | ({type:'experiment.target.submit'} & TargetPracticeSubmission)
  | ({type:'experiment.target.inspect-original'} & TargetPracticeSubmission)
  | {type:'experiment.practice';taskId:string;basis:ArtifactRef;expectedSourceRefs:readonly SourceRef[];inputs:Record<string,number>;demonstratedInputs?:Record<string,number>[];prediction:number;reasoning:string;retryOf?:string}
  | {type:'experiment.practice.inspect';taskId:string;basis:ArtifactRef;expectedSourceRefs:readonly SourceRef[];inputs:Record<string,number>;demonstratedInputs?:Record<string,number>[]}
  | {type:'packing.practice';taskId:string;basis:ArtifactRef;expectedSourceRefs:readonly SourceRef[];sourceId:string;start:number;end:number;quote:string;confirmed:true;previewCount:number;preview:ArtifactRef;count:number;prediction:number;retryOf?:string}
  | {type:'packing.practice.inspect';taskId:string;basis:ArtifactRef;expectedSourceRefs:readonly SourceRef[];sourceId:string;start:number;end:number;quote:string;confirmed:true;previewCount:number;preview:ArtifactRef;count:number}
  | {type:'packing.review';taskId:string;basis:ArtifactRef;expectedSourceRefs:readonly SourceRef[];sourceId:string;start:number;end:number;quote:string;confirmed:true;count:number;retryOf?:string}
  | {type:'packing.inspect';taskId:string;basis:ArtifactRef;expectedSourceRefs:readonly SourceRef[];sourceId:string;start:number;end:number;quote:string;confirmed:true;count:number}
  | {type:'signal.review';taskId:string;basis:ArtifactRef;expectedSourceRefs:readonly SourceRef[];sourceId:string;start:number;end:number;quote:string;confirmed:true;example?:{target:0|1;value:0|1};retryOf?:string}
  | {type:'signal.inspect';taskId:string;basis:ArtifactRef;expectedSourceRefs:readonly SourceRef[];sourceId:string;start:number;end:number;quote:string;confirmed:true;example?:{target:0|1;value:0|1}}
  | {type:'signal.practice';taskId:string;basis:ArtifactRef;expectedSourceRefs:readonly SourceRef[];sourceId:string;start:number;end:number;quote:string;confirmed:true;answer:0|1;reasoning:string;retryOf?:string}
  | {type:'signal.practice.inspect';taskId:string;basis:ArtifactRef;expectedSourceRefs:readonly SourceRef[];sourceId:string;start:number;end:number;quote:string;confirmed:true}
  | ({type:'signal.overwrite';taskId:string;basis:ArtifactRef;expectedSourceRefs:readonly SourceRef[];sourceId:string;start:number;end:number;quote:string;confirmed:true;retryOf?:string} & ({mode:'lesson';secondEnabled:boolean}|{mode:'practice';answer:'00'|'01'|'10'|'11'}))
  | ({type:'signal.overwrite.inspect';taskId:string;basis:ArtifactRef;expectedSourceRefs:readonly SourceRef[];sourceId:string;start:number;end:number;quote:string;confirmed:true} & ({mode:'lesson';secondEnabled:boolean}|{mode:'practice'}))
  | {type:'workflow.review';taskId:string;requestId:string;basis:ArtifactRef;expectedSourceRefs:readonly SourceRef[];review:WorkflowReview}
  | {type:'workflow.contextual.review';taskId:string;requestId:string;basis:ArtifactRef;expectedSourceRefs:readonly SourceRef[];review:WorkflowReview}
  | ({type:'browser.continue.prepare'|'browser.continue.release'} & BrowserContinuationInput)
  | ({type:'browser.continue'} & BrowserContinuationInput)
  | {type:'browser.run';taskId:string;requestId:string;prompt:string;url:string;submittedDraft?:ComposerDraft}
  | {type:'browser.control.status';taskId:string;requestId:string}
  | {type:'browser.control';taskId:string;requestId:string;id:string;action:'take'|'return'}
  | {type:'browser.inspect';taskId:string;runId:string;operationId:string;url:string;attemptId?:string}
  | {type:'browser.inspect.cancel';taskId:string;runId:string;operationId:string;attemptId:string}
  | {type:'browser.review.notes';taskId:string;runId:string;operationId:string;binding:string;confirmed:'shown-review-notes'}
  | {type:'browser.detach';taskId:string}
  | {type:'procedure.save';taskId:string;procedure:ProcedureInput}
  | {type:'procedure.check';taskId:string;procedureId:string;context:Record<string,string>}
  | {type:'experiment.evaluate';spec:ExperimentSpec;inputs:Record<string,number>}
  | {type:'export.propose';taskId:string;artifactId:string;revision:number}
  | {type:'export.approve';taskId:string;actionId:string;digest:string;requestId:string}
  | {type:'export.inspect';taskId:string;actionId:string}
  | {type:'model.run';taskId:string;requestId:string;prompt:string;kind:'explain'|'create'|'revise'|'experiment'|'procedure'|'brief'|'concept-map';artifactId?:string;sourceIds?:string[];expectedSourceRefs?:SourceRef[];revisionBasis?:string;submittedDraft?:ComposerDraft;briefAction?:{artifact:ArtifactRef;actionIndex:number}|{kind:'review-state-transitions';artifact:ArtifactRef}}
  | {type:'model.cancel';taskId:string;requestId:string}
  | {type:'connection.status'} | {type:'connection.configure'} | {type:'connection.disconnect'}
  | {type:'connection.select';provider:'meta'|'codex'}
  | {type:'surface.collapse'} | {type:'surface.expand'} | {type:'surface.companion'} | {type:'surface.workspace'} | {type:'surface.standalone'} | {type:'surface.attach';windowId:string}
  | {type:'surface.fit';fitId:string;height:number;phase:'preparing'|'running'|'settled'}
  | {type:'shortcut.set';accelerator:string}
  | {type:'presentation.finish';exitId:string}
  | {type:'presentation.capture';exitId:string}
  | {type:'presentation.reveal';exitId:string}
  | {type:'presentation.show';entranceId:string}

export interface WindowChoice {id:string;title:string;owner:{name:string};bounds:{x:number;y:number;width:number;height:number}}
export interface ConnectionStatus {
  provider:'Meta'|'Codex (temporary)'; configured:boolean; endpoint:string; model:string;
  tier?:string;reasoning?:string;verified?:boolean;
  state:'unconfigured'|'ready'|'offline'|'streaming'|'stalled'|'error';
  detail:string; specialized:{sam:string;computer:string};
}
export interface HostStatus {
  platform:string;screenPermission:string;accessibilityPermission:string;shortcut:string;
  shortcutStatus?:'registered'|'unavailable';
  modifierShortcutStatus?:'stopped'|'starting'|'ready'|'permission-required'|'unsupported'|'unavailable';
  fallbackShortcut?:string;fallbackShortcutStatus?:'registered'|'unavailable';
  captureMode:'explicit-frozen';memoryEnabled:boolean;dataDir:string;
}
export interface AttachedWindow {id:string;title:string;ownerName:string}
export interface CompactFit {id:string;maxHeight:number}
export interface CompactFitBounds {height:number;maxHeight:number}
export type BrowserInspectionStopResult={kind:'stopped'|'finishing'|'not-active'}
export interface ContextActivation {activationId:string;tucked:boolean;target?:WindowChoice;choices:WindowChoice[];trigger?:'shortcut';origin?:'user-drop'|'source-picker';intent?:'attach';newTask?:boolean;analyze?:boolean;source?:SourceRef&{taskId:string};requestId?:string;ownerTaskId?:string}
/** Read-only recovery of a live host gesture; absent after expiry, retirement or restart. */
export type ContextPending={kind:'none'}|{kind:'ready';activation:ContextActivation}|{kind:'busy'}
export type ContextCapture = {activationId:string;tucked:boolean}&({state:'captured';task:Task;sourceId:string}|{state:'no-room';task?:Task})
export type CompanionEvent =
  | {type:'source.drag';state:SourceDragState}
  | {type:'capture.retired'}
  | {type:'changed';taskId?:string}
  | {type:'stream';taskId:string;requestId:string;text:string}
  | {type:'connection';connection:ConnectionStatus}
  | {type:'surface';mode:'panel'|'anchor'|'companion'|'workspace';placement?:string;attachedWindow?:AttachedWindow;compactFit?:CompactFit}
  | {type:'presentation.exit';exitId:string;dataUrl:string;purpose?:'quit'|'collapse'}
  | {type:'presentation.prepare';exitId:string;purpose:'quit'|'collapse'}
  | {type:'presentation.cancel';exitId:string}
  | {type:'presentation.enter';entranceId:string;mode:'companion'|'workspace'}
  | {type:'context.activate';activation:ContextActivation}
  | {type:'context.error';message:string}
  | {type:'draft.flush';quitId:string}
  | {type:'draft.resume';quitId:string}

export interface CompanionBridge {
  invoke<C extends ExportCommand>(command:C):Promise<ExportReply<C>>;
  invoke<T=unknown>(command:OtherCommand):Promise<T>;
  subscribe(listener:(event:CompanionEvent)=>void):()=>void;
}
export type TaskList = Task[]
export type {Task,SourceInput,ArtifactInput,ProcedureInput,ExperimentSpec,ExperimentResult}
declare global {interface Window {companion:CompanionBridge}}
