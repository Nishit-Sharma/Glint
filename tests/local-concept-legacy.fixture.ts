/** Seed real pre-migration running/terminal journals. New publications are atomic and never invoke arbitrary async runners. */
import {vi} from 'vitest';
import type {Companion} from '../src/core/companion';
import type {Task,RequestInput,RequestOutput,RequestRecord} from '../src/core/types';
import {readPackingConceptSubmission,packingConceptPublication,packingConceptResult} from '../src/core/packing-concept-host';
import {readPackingPracticeSubmission,packingPracticePublication,packingPracticeResult} from '../src/core/packing-practice-host';
import {readSignalConceptSubmission,signalConceptPublication,signalConceptResult} from '../src/core/signal-concept-host';
import {readSignalPracticeSubmission,signalPracticePublication,signalPracticeResult} from '../src/core/signal-sequential-practice-host';
import {readSignalOverwriteSubmission,signalOverwritePublication,signalOverwriteResult} from '../src/core/signal-overwrite-host';
import {readTruthTableSubmission,truthTablePublication,truthTableResult} from '../src/core/truth-table-host';
export const conceptBuilders:Record<string,{read:(raw:unknown)=>any;publication:(task:Task,value:any)=>{request:RequestInput;artifact:RequestOutput};result:(task:Task,value:any,record:RequestRecord)=>any}>={
 savePackingConcept:{read:readPackingConceptSubmission,publication:packingConceptPublication,result:packingConceptResult},savePackingPractice:{read:readPackingPracticeSubmission,publication:packingPracticePublication,result:packingPracticeResult},saveSignalConcept:{read:readSignalConceptSubmission,publication:signalConceptPublication,result:signalConceptResult},saveSignalPractice:{read:readSignalPracticeSubmission,publication:signalPracticePublication,result:signalPracticeResult},saveSignalOverwrite:{read:readSignalOverwriteSubmission,publication:signalOverwritePublication,result:signalOverwriteResult},saveTruthTable:{read:readTruthTableSubmission,publication:truthTablePublication,result:truthTableResult}};
export function legacyConceptRunSpy(core:Companion,name:keyof typeof conceptBuilders){
 const builder=conceptBuilders[name];vi.spyOn(core,name as any).mockImplementationOnce(async(raw:any,guard:any)=>{const value=builder.read(raw),{request,artifact}=builder.publication(await core.getTask(value.taskId),value),record=await core.runRequest(request,async()=>artifact,guard);return builder.result(await core.getTask(value.taskId),value,record);});return vi.spyOn(core,'runRequest');
}
