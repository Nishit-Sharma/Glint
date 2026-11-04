import {describe,it,expect,expectTypeOf} from 'vitest';
import type {ExportAction,Task} from '../../src/core/types';
import type {CompanionBridge} from '../../src/shared/bridge';
import type {Run} from '../../src/renderer/src/ui';
import {readExportReply,type ExportCommand,type ExportHandlers,type ExportReply,type OtherCommand} from '../../src/shared/export-contract';

const action:ExportAction={proposal:{id:'proposal-a',taskId:'task-a',artifactId:'artifact-a',revision:2,path:'/tmp/exported.txt',parentRealPath:'/tmp',parentDevice:'1',parentInode:'2',artifactDigest:'artifact-digest',sourceRefs:[],byteLength:11,digest:'proposal-digest',createdAt:'2026-10-24T00:00:00Z'},status:'proposed'};
const propose={type:'export.propose',taskId:'task-a',artifactId:'artifact-a',revision:2} satisfies ExportCommand;

describe('export command result contract',()=>{
 it('returns the exact action and preserves native chooser cancellation',()=>{expect(readExportReply(propose,action)).toBe(action);expect(readExportReply(propose,null)).toBeNull();});
 it('rejects a task-shaped response at the transport seam',()=>{expect(()=>readExportReply(propose,{id:'task-a',actions:[action]})).toThrow('Invalid export response');});
 it('rejects an action belonging to a different request identity',()=>{
  expect(()=>readExportReply(propose,{...action,proposal:{...action.proposal,taskId:'task-b'}})).toThrow('Invalid export response');
  expect(()=>readExportReply(propose,{...action,proposal:{...action.proposal,revision:1}})).toThrow('Invalid export response');
  expect(()=>readExportReply({type:'export.approve',taskId:'task-a',actionId:'proposal-b',digest:'x',requestId:'request-a'},action)).toThrow('Invalid export response');
  expect(()=>readExportReply({type:'export.inspect',taskId:'task-a',actionId:'proposal-a'},null)).toThrow('Invalid export response');
 });
 it('does not reinterpret core lifecycle outcomes',()=>{for(const status of ['proposed','approved','executing','verified','failed','uncertain','retired'] as const){const result={...action,status};expect(readExportReply({type:'export.inspect',taskId:'task-a',actionId:'proposal-a'},result)).toBe(result);}});
});

function compileContract(run:Run,bridge:CompanionBridge,task:Task){
 expectTypeOf(run(propose)).toEqualTypeOf<Promise<ExportAction|null|undefined>>();
 expectTypeOf(bridge.invoke(propose)).toEqualTypeOf<Promise<ExportAction|null>>();
 expectTypeOf(run({type:'export.inspect',taskId:'task-a',actionId:'proposal-a'})).toEqualTypeOf<Promise<ExportAction|undefined>>();
 expectTypeOf<Extract<OtherCommand,ExportCommand>>().toEqualTypeOf<never>();
 expectTypeOf<ExportReply<ExportCommand>>().toEqualTypeOf<ExportAction|null>();
 // @ts-expect-error Export replies cannot be selected by the caller.
 run<Task>(propose);
 // @ts-expect-error The generic transport fallback excludes every export command.
 bridge.invoke<Task>(propose);
 // @ts-expect-error Export handlers must return an action, never a task.
 const invalid:ExportHandlers['export.propose']=async()=>task;
 const handlers:ExportHandlers={
  'export.propose':async()=>null,
  'export.approve':async()=>action,
  'export.inspect':async()=>action,
 };
 return {invalid,handlers};
}
void compileContract;
