import type {RequestInferenceSelection} from '../shared/request-inference';
import type {InstructionSkillReference,InstructionSkillSnapshot,InstructionSkillAvailability} from '../shared/instruction-skill';
import type {ConversationAttemptReceipt} from '../shared/conversation-attempt';
import type {MemoryUse} from '../shared/user-memory';
import type {BrowserContinuationReceipt} from '../shared/browser-continuation';
import type {DocumentStamp,DocumentChange} from '../shared/document-source';
import type { TaskSession,ComposerDraft,BrowserStartReceipt } from './task-session';
/** Local task data. Source and provider text is inert content, never instructions to tools. */
export interface SourceInput {
  pdfPage?:import('../shared/pdf-page-import').PdfPageProvenance;
  publicGithub?: import('../shared/public-github').PublicGithubSnapshot;
  id?: string;
  kind: 'text' | 'image' | 'window';
  label: string;
  content: string;
  role: 'fact' | 'style' | 'inspiration';
  windowId?: string;
  documentToken?: string;
  windowProcessId?: number;
  documentStamp?: DocumentStamp;
  title?: string;
  boundsToken?: string;
}
export interface SourceRef { sourceId: string; version: number; digest: string }
export interface SourceVersion extends SourceInput {
  id: string; version: number; digest: string; capturedAt: string;
}
export interface Source {
  id: string; currentVersion: number; versions: SourceVersion[];
  projectOrigin?: {projectId:string;sourceKey:string;taskId:string;reference:SourceRef;copiedVersion:number;copiedDigest:string};
  freshness: 'fresh' | 'refresh-required'; staleReason?: string;
  documentChange?: DocumentChange;
}
export interface ArtifactRevision {
  revision: number; title: string; content: string; mimeType: string;
  encoding?: 'utf8' | 'base64';
  sourceRefs: SourceRef[]; digest: string; createdAt: string;
}
export interface Artifact { id: string; revisions: ArtifactRevision[];skillAvailability?:InstructionSkillAvailability }
export interface ArtifactRef { artifactId: string; revision: number; digest: string }
export interface ModuleStateRef { artifactId: string; artifactRevision: number; moduleId: string; stateRevision: number }
/** Host-owned read dependencies, checked inside the atomic session commit. */
export interface SessionCommitGuard { sourceRefs: SourceRef[]; artifactRefs: ArtifactRef[]; requireActive?:boolean }
export type RequestStatus = 'running' | 'completed' | 'cancelled' | 'interrupted' | 'failed';
export interface RequestRecord {
  responseModel?:import('../shared/response-model').ResponseModelReceipt;
  instructionSkill?:InstructionSkillReference;
  inference?:RequestInferenceSelection;
  id: string; kind: string; prompt: string; digest: string; status: RequestStatus;
  sourceRefs: SourceRef[]; startedAt: string; finishedAt?: string;
  answer?: { artifactId: string; revision: number; digest: string };
  artifactId?: string; targetArtifactId?: string; expectedRevision?: number; error?: string;
  memory?:MemoryUse;
  conversationAttempt?:ConversationAttemptReceipt;
  browserStart?:BrowserStartReceipt;
  browserContinuation?:BrowserContinuationReceipt;
}
export interface ProcedurePrecondition { key: string; equals: string }
export interface ProcedureStep {
  intent: string; target: string; preconditions: ProcedurePrecondition[]; expectedResult: string;
}
export interface ProcedureRevision {
  revision: number; title: string; scope: { taskId: string; project?: string };
  steps: ProcedureStep[]; sourceRefs: SourceRef[]; createdAt: string;
  observation?: { artifactId: string; revision: number; digest: string; summary: string; limitations: string[] };
}
export interface Procedure { id: string; revisions: ProcedureRevision[] }
export interface Checkpoint {
  id: string; note: string; createdAt: string; sourceRefs: SourceRef[];
  artifacts: { artifactId: string; revision: number }[];
}
export interface ExportProposal {
  id: string; taskId: string; artifactId: string; revision: number; path: string;
  parentRealPath: string; parentDevice: string; parentInode: string;
  artifactDigest: string; sourceRefs: SourceRef[]; byteLength: number;
  digest: string; createdAt: string;
}
export interface ExportEvidence {
  path: string; byteLength: number; digest: string; verifiedAt: string;
}
export interface ExportAction {
  proposal: ExportProposal;
  status: 'proposed' | 'approved' | 'executing' | 'verified' | 'failed' | 'uncertain' | 'retired';
  approvalId?: string; approvalRetiredAt?: string; requestId?: string;
  evidence?: ExportEvidence; error?: string;
}
export interface Task {
  publicGithub?: import('../shared/public-github').PublicGithubConnection;
  id: string; title: string; goal: string; status: 'active' | 'paused';
  projectId?: string;
  archive?: import('../shared/task-archive').TaskArchive;
  assignedBotId?: string;
  provenance?: 'local-example';
  createdAt: string; updatedAt: string;
  sources: Source[]; artifacts: Artifact[]; requests: RequestRecord[];
  procedures: Procedure[]; checkpoints: Checkpoint[]; actions: ExportAction[];
  memory: { enabled: false };
  session?: TaskSession;
}
export interface ArtifactInput {
  artifactId?: string; expectedRevision?: number; title: string; content: string;
  mimeType?: string; encoding?: 'utf8' | 'base64'; sourceRefs?: SourceRef[];
  /** Optional host-owned snapshot dependencies, checked atomically before saving. */
  expectedArtifacts?:ArtifactRef[];expectedModuleStates?:ModuleStateRef[];
}
export interface ProcedureInput {
  id?: string; expectedRevision?: number; title: string; project?: string;
  steps: ProcedureStep[]; sourceRefs?: SourceRef[];
  originArtifact?: { artifactId: string; revision: number };
}
/** The detached task's sources contain only the request's selected current versions. */
export interface RequestContext { task: Task; sourceRefs: SourceRef[]; taskHistory?: string; projectInstructions?:import('../shared/projects').ProjectInstructions; instructionSkill?:InstructionSkillSnapshot; signal: AbortSignal }
export interface RequestInput {
  instructionSkill?:InstructionSkillReference|null;
  instructionSkillRevision?:number;
  inference?:RequestInferenceSelection;
  inferenceRevision?:number;
  conversationAttempt?:ConversationAttemptReceipt;
  queuedFollowup?:{id:string;revision:number;basis:string;scope:string};
  browserContinuation?:BrowserContinuationReceipt;
  /** Host-selected user-authored memory, validated against the current ledger. */
  memory?:MemoryUse;
  taskId: string; requestId: string; kind: string; prompt: string;
  submittedDraft?:ComposerDraft;
  /** Host-owned endpoint/tool-scope binding, included in durable request identity. */
  executionScope?: string;
  /** Omit to use all sources; [] explicitly requests prompt-only. At most 64 unique existing IDs. */
  sourceIds?: string[];
  expectedSourceRefs?: SourceRef[];
  /** Host-only basis artifacts; source and artifact guards are rechecked at commit. */
  expectedArtifacts?: ArtifactRef[];
  /** Host-only exact module observations for follow-up explanations. */
  expectedModuleStates?: ModuleStateRef[];
  artifactId?: string; expectedRevision?: number;
}
export interface RequestOutput { title: string; content: string; mimeType?: string; encoding?: 'utf8' | 'base64';modelReceipt?:import('../shared/response-model').ProviderModelReceipt }
export interface ResumeResult {
  task: Task; staleSourceIds: string[]; affectedArtifacts: { artifactId: string; revisions: number[] }[];
  interruptedRequestIds: string[];
  sourceContext: ReturnType<typeof import('./source-resume').sourceResumeContext>;
}
export interface CompanionOptions { dataDir: string; now?: () => Date; beforeReadState?:()=>Promise<void> }
export type Expression =
  | { op: 'constant'; value: number; unit?: string }
  | { op: 'variable'; name: string }
  | { op: 'add' | 'subtract' | 'multiply' | 'divide'; left: Expression; right: Expression }
  | { op: 'power'; base: Expression; exponent: number };
export interface ExperimentSpec {
  title: string; expression: Expression;
  variables: { name: string; unit: string; min: number; max: number; integer?: true }[];
  assumptions: string[];
}
export interface ExperimentResult { value: number; unit: string; assumptions: string[] }
