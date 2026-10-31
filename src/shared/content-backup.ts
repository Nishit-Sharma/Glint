import {Schema} from 'effect';

export const CONTENT_BACKUP_LIMIT=64*1024*1024;
export const CONTENT_BACKUP_FORMAT='glint-local-content';
export const CONTENT_BACKUP_FILES=['tasks.json','learning-drafts.json','bot-catalog.json','character-preferences.json','response-preferences.json','task-view.json','task-pins.json','task-attention.json'] as const;
export type ContentBackupName=typeof CONTENT_BACKUP_FILES[number];
export const CONTENT_BACKUP_EXCLUSIONS=['Provider credentials and connection selection','Browser profiles, cookies and browser caches','OS permissions, capture privacy exclusions and shortcut settings','Folder access bindings and external files','Generated audio caches','Earlier backup and recovery files','Live approvals, pending execution grants and active window-follow authority'] as const;
export const CONTENT_BACKUP_ERROR='Content backup: This operation could not be confirmed. Your current content is kept. Check Storage before trying again.';
const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0')));
const checksum=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/));
const command=Schema.Union(
 Schema.Struct({type:Schema.Literal('content-backup.export')}),
 Schema.Struct({type:Schema.Literal('content-backup.choose')}),
 Schema.Struct({type:Schema.Literal('content-backup.restart')}),
 Schema.Struct({type:Schema.Literal('content-backup.status')}),
 Schema.Struct({type:Schema.Literal('content-backup.restore'),reviewId:id,checksum,currentChecksum:checksum,confirmed:Schema.Literal('replace-reviewed-local-content-and-restart')}),
);
export type ContentBackupCommand=typeof command.Type;
export const readContentBackupCommand=(value:unknown):ContentBackupCommand=>{try{return Schema.decodeUnknownSync(command,{onExcessProperty:'error'})(value);}catch{throw Error(CONTENT_BACKUP_ERROR);}};
export const isContentBackupCommand=(value:{type:string}):value is ContentBackupCommand=>value.type.startsWith('content-backup.');
export type ContentBackupCounts={tasks:number;sources:number;sourceVersions:number;artifacts:number;artifactVersions:number;unsentMessages:number;unfinishedForms:number;memoryFacts:number;projects:number;schedules:number};
export type ContentBackupFileSummary={name:ContentBackupName;present:boolean;byteLength:number;sha256:string|null};
export type ContentBackupSummary={createdAt:string;appVersion:string;checksum:string;contentChecksum:string;files:ContentBackupFileSummary[];counts:ContentBackupCounts};
export type ContentBackupReview={kind:'review';reviewId:string;filename:string;incoming:ContentBackupSummary;current:ContentBackupSummary;retiredAuthority:string[]};
export type ContentBackupExported={kind:'exported';path:string;byteLength:number;sha256:string;summary:ContentBackupSummary};
export type ContentBackupRestored={kind:'restored';priorCopyPath:string;checksum:string;restartRequired:true};
export type ContentBackupCancelled={kind:'cancelled'};
export type ContentBackupStatus={kind:'status';restartRequired:boolean;lastRestore?:{outcome:'restored'|'recovered-prior-content';priorCopyPath:string;at:string}};
export type ContentBackupReply=ContentBackupReview|ContentBackupExported|ContentBackupRestored|ContentBackupCancelled|ContentBackupStatus|{kind:'restore-failed';priorCopyPath:string;restartRequired:true}|{kind:'restarting'};
