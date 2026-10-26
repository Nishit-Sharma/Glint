import type {ExportCommand,ExportReply,OtherCommand} from './export-contract'
import type { Task, SourceInput, SourceRef, ArtifactInput, ProcedureInput, ExperimentSpec, ExperimentResult } from '../core/types'
import type {ModuleAction} from '../core/interactive-modules'
import type {ComposerDraft} from '../core/task-session'

export type Command =
  | {type:'tasks.list'} | {type:'tasks.create';title:string;goal?:string}
  | {type:'tasks.update';taskId:string;title:string;goal?:string}
  | {type:'tasks.get';taskId:string} | {type:'tasks.delete';taskId:string}
  | {type:'tasks.pause'|'tasks.resume';taskId:string}
  | {type:'tasks.checkpoint';taskId:string;note:string}
  | {type:'draft.save';taskId:string;expectedRevision:number;draft:Pick<ComposerDraft,'text'|'kind'>}
  | {type:'draft.flushed';quitId:string;error?:string}
  | {type:'source.text';taskId:string;source:SourceInput}
  | {type:'source.image';taskId:string;role:SourceInput['role'];sourceId?:string}
  | {type:'source.invalidate';taskId:string;sourceId:string}
  | {type:'source.preview';taskId:string;sourceId:string;reference?:SourceRef}
  | {type:'windows.list'} | {type:'windows.capture';taskId:string;windowId:string;sourceId?:string}
  | {type:'context.start';newTask?:boolean;source?:SourceRef&{taskId:string};requestId?:string;ownerTaskId?:string} | {type:'context.cancel';activationId:string}
  | {type:'context.view';taskId?:string}
  | {type:'context.capture';activationId:string;windowId:string;taskId?:string}
  | {type:'artifact.save';taskId:string;artifact:ArtifactInput}
  | {type:'module.edit';taskId:string;artifactId:string;artifactRevision:number;moduleId:string;action:ModuleAction}
  | {type:'module.document';taskId:string;artifactId:string;artifactRevision:number;sessionRevision:number}
  | {type:'browser.run';taskId:string;requestId:string;prompt:string;url:string;submittedDraft?:ComposerDraft}
  | {type:'browser.inspect';taskId:string;runId:string;operationId:string;url:string}
  | {type:'browser.detach';taskId:string}
  | {type:'procedure.save';taskId:string;procedure:ProcedureInput}
  | {type:'procedure.check';taskId:string;procedureId:string;context:Record<string,string>}
  | {type:'experiment.evaluate';spec:ExperimentSpec;inputs:Record<string,number>}
  | {type:'export.propose';taskId:string;artifactId:string;revision:number}
  | {type:'export.approve';taskId:string;actionId:string;digest:string;requestId:string}
  | {type:'export.inspect';taskId:string;actionId:string}
  | {type:'model.run';taskId:string;requestId:string;prompt:string;kind:'explain'|'create'|'revise'|'experiment'|'procedure'|'brief';artifactId?:string;sourceIds?:string[];expectedSourceRefs?:SourceRef[];submittedDraft?:ComposerDraft}
  | {type:'model.cancel';taskId:string;requestId:string}
  | {type:'connection.status'} | {type:'connection.configure'} | {type:'connection.disconnect'}
  | {type:'connection.select';provider:'meta'|'codex'}
  | {type:'surface.collapse'} | {type:'surface.expand'} | {type:'surface.companion'} | {type:'surface.workspace'} | {type:'surface.standalone'} | {type:'surface.attach';windowId:string}
  | {type:'surface.fit';fitId:string;height:number;phase:'preparing'|'running'|'settled'}
  | {type:'shortcut.set';accelerator:string}
  | {type:'presentation.finish';exitId:string}
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
  captureMode:'explicit-frozen';memoryEnabled:false;dataDir:string;
}
export interface AttachedWindow {id:string;title:string;ownerName:string}
export interface CompactFit {id:string;maxHeight:number}
export interface CompactFitBounds {height:number;maxHeight:number}
export interface ContextActivation {activationId:string;tucked:boolean;target?:WindowChoice;choices:WindowChoice[];trigger?:'shortcut';newTask?:boolean;analyze?:boolean;source?:SourceRef&{taskId:string};requestId?:string;ownerTaskId?:string}
export type ContextCapture = {activationId:string;tucked:boolean}&({state:'captured';task:Task;sourceId:string}|{state:'no-room';task?:Task})
export type CompanionEvent =
  | {type:'changed';taskId?:string}
  | {type:'stream';taskId:string;requestId:string;text:string}
  | {type:'connection';connection:ConnectionStatus}
  | {type:'surface';mode:'panel'|'anchor'|'companion'|'workspace';placement?:string;attachedWindow?:AttachedWindow;compactFit?:CompactFit}
  | {type:'presentation.exit';exitId:string;dataUrl:string;purpose?:'quit'|'collapse'}
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
