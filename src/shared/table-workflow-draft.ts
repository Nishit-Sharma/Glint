import {Schema} from 'effect';
import {pickingDigest} from './picking-digest';
import type {TableWorkflowState} from '../learning/table-workflow';
const text=(n:number)=>Schema.String.pipe(Schema.maxLength(n));
const forms={setup:Schema.Struct({name:text(500),intent:text(500),source:text(1000)}),step:Schema.Struct({stepText:text(12000)}),edit:Schema.Struct({name:text(500),intent:text(500),stepsText:text(12000)}),exception:Schema.Struct({contains:text(160),reason:text(500)}),check:Schema.Struct({input:text(32000),expected:text(32000),kind:Schema.Literal('output','stopped')}),run:Schema.Struct({source:text(1000)})};
export type TableWorkflowForm=keyof typeof forms;
export const TABLE_WORKFLOW_RAW_BYTES=448*1024;
export function tableWorkflowForm(slot:string):TableWorkflowForm|undefined{return (['setup','step','edit','exception','check','run']as const).find(name=>slot===`table-workflow:${name}`);}
const parsers={setup:Schema.decodeUnknownSync(forms.setup,{onExcessProperty:'error'}),step:Schema.decodeUnknownSync(forms.step,{onExcessProperty:'error'}),edit:Schema.decodeUnknownSync(forms.edit,{onExcessProperty:'error'}),exception:Schema.decodeUnknownSync(forms.exception,{onExcessProperty:'error'}),check:Schema.decodeUnknownSync(forms.check,{onExcessProperty:'error'}),run:Schema.decodeUnknownSync(forms.run,{onExcessProperty:'error'})};
export function validateTableWorkflowRaw(value:unknown,slot?:string){const family=slot?tableWorkflowForm(slot):undefined;if(slot&&!family)throw Error('Unknown local table workflow form.');return family?parsers[family](value):Schema.decodeUnknownSync(Schema.Union(forms.setup,forms.step,forms.edit,forms.exception,forms.check,forms.run),{onExcessProperty:'error'})(value);}
export function tableWorkflowFormBasis(state:TableWorkflowState,family:TableWorkflowForm){
 const basis=family==='setup'?{name:state.draft.name,intent:state.draft.intent,demonstrations:state.demonstrations.length}:family==='step'?{started:state.workspace?.startedAtRevision??null,count:state.workspace?.actions.length??0,failure:state.workspace?.failure?.atRevision??null}:family==='edit'?{name:state.draft.name,intent:state.draft.intent,steps:state.draft.steps}:family==='exception'||family==='check'?{observation:state.draft.observation?.startedAtRevision??null,steps:state.draft.steps,exceptions:state.draft.exceptions}: {activeVersion:state.activeVersion};
 return pickingDigest({format:'table-workflow-form-v1',helperId:state.helperId,family,basis});
}
