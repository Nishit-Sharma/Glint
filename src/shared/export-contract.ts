import type {ExportAction} from '../core/types';
import type {Command} from './bridge';

export type ExportCommand=Extract<Command,{type:`export.${string}`}>;
export type OtherCommand=Exclude<Command,ExportCommand>;
type ExportReplies={
 'export.propose':ExportAction|null;
 'export.approve':ExportAction;
 'export.inspect':ExportAction;
};
export type ExportReply<C extends ExportCommand>=ExportReplies[C['type']];
export type ExportHandlers={
 [K in ExportCommand['type']]:(command:Extract<ExportCommand,{type:K}>)=>Promise<ExportReplies[K]>;
};
export function isExportCommand(command:Command):command is ExportCommand{return command.type.startsWith('export.');}

function assertExportAction(value:unknown):asserts value is ExportAction{
 if(!value||typeof value!=='object'||!('proposal' in value)||!value.proposal||typeof value.proposal!=='object'||!('status' in value)||typeof value.status!=='string')throw new Error('Invalid export response.');
 const proposal=value.proposal;
 if(!('id' in proposal)||typeof proposal.id!=='string'||!('taskId' in proposal)||typeof proposal.taskId!=='string'||!('artifactId' in proposal)||typeof proposal.artifactId!=='string'||!('revision' in proposal)||typeof proposal.revision!=='number')throw new Error('Invalid export response.');
}
export function readExportReply<C extends ExportCommand>(command:C,value:unknown):ExportReply<C>;
export function readExportReply(command:ExportCommand,value:unknown):ExportAction|null{
 if(value===null&&command.type==='export.propose')return null;
 assertExportAction(value);
 const proposal=value.proposal;
 if(proposal.taskId!==command.taskId||(command.type==='export.propose'?(proposal.artifactId!==command.artifactId||proposal.revision!==command.revision):proposal.id!==command.actionId))throw new Error('Invalid export response.');
 return value;
}
