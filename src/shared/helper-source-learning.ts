import type {Task} from '../core/types';
import {semanticHelper,type SemanticHelperState} from '../learning/semantic-helper';
import {helperSourceBatchPreview} from './helper-source-batch';
import {pickingCanonical} from './picking-digest';
import {readSourceHelperLesson,readSourceHelperPracticeAction,sourceHelperLearningRun,sourceHelperPracticeIdentity,sameSourceHelperInput,validateSourceHelperPracticeReceipt,type SourceHelperLesson,type SourceHelperPracticeAction,type SourceHelperPracticeReceipt,type SourceHelperLearningOwner} from '../learning/source-helper-learning';

/** Exact current source admission; no source body or result enters a request/model. */
export function sourceHelperLearningContext(task:Task,owner:SourceHelperLearningOwner,stateRevision:number,rawLesson:unknown){
 const lesson=readSourceHelperLesson(rawLesson),{recordNumber,...selection}=lesson;
 const preview=helperSourceBatchPreview(task,{...owner,stateRevision,...selection});
 const saved=task.session!.moduleStates.filter(item=>item.artifactId===owner.artifactId&&item.artifactRevision===owner.artifactRevision&&(item.moduleId===owner.moduleId||item.moduleId===undefined));
 if(saved.length!==1)throw Error('The saved helper owner needs review.');
 const state=semanticHelper.parseState(owner.helperId,saved[0].state),procedure=state.versions.find(item=>item.version===lesson.activeVersion)!.candidate.procedure;
 const row=preview.rows.find(item=>item.recordNumber===recordNumber);if(!row?.input||row.outcome.status==='invalid')throw Error('Choose a valid mapped source record; invalid rows cannot provide a worked computation.');
 const result=sourceHelperLearningRun(procedure,row.input);
 return {lesson,preview,state,procedure,row,input:row.input,result};
}
/** Receipt reconciliation happens before current source/version admission. It can only
 * return the byte-exact original submitted answer, never replace it. */
export function sourceHelperPracticeDuplicate(owner:SourceHelperLearningOwner,state:SemanticHelperState,rawAction:unknown):SourceHelperPracticeReceipt|null{
 const action=readSourceHelperPracticeAction(rawAction),id=sourceHelperPracticeIdentity(owner,action.lesson),existing=state.sourcePractices?.find(item=>item.id===id);
 if(!existing)return null;
 if(pickingCanonical(existing.owner)!==pickingCanonical(owner)||pickingCanonical(existing.submitted)!==pickingCanonical(action))throw Error('This source record and helper version already have a first answer. It cannot be replaced.');
 return existing;
}
export function admitSourceHelperPractice(task:Task,owner:SourceHelperLearningOwner,state:SemanticHelperState,rawAction:unknown):SourceHelperPracticeReceipt{
 const action=readSourceHelperPracticeAction(rawAction);
 if(sourceHelperPracticeDuplicate(owner,state,action))throw Error('The first answer is already recorded.');
 if(action.expectedRevision!==state.revision)throw Error('The helper changed. Review the current source and helper before submitting.');
 const context=sourceHelperLearningContext(task,owner,state.revision,action.lesson);
 sourceHelperLearningRun(context.procedure,action.changedInput);sourceHelperLearningRun(context.procedure,action.practiceInput);
 const known=[...context.preview.rows.flatMap(row=>row.input?[row.input]:[]),...state.recordings.map(item=>item.input),...state.examples.map(item=>item.input),...state.evidenceHistory.flatMap(item=>item.candidate.examples.map(example=>example.input)),...state.versions.flatMap(item=>item.candidate.examples.map(example=>example.input)),...(state.lastRun?[state.lastRun.input]:[]),...(state.lastBatchRun?.rows.map(row=>row.input)??[]),...(state.sourcePractices??[]).flatMap(item=>[item.exampleInput,item.submitted.changedInput,item.submitted.practiceInput]),action.changedInput];
 if(known.some(input=>sameSourceHelperInput(input,action.practiceInput)))throw Error('Choose practice inputs different from every mapped source record, saved helper example/run, earlier practice and this hypothetical comparison. Earlier exposure is still unknown.');
 return validateSourceHelperPracticeReceipt(context.procedure,{id:sourceHelperPracticeIdentity(owner,action.lesson),owner,atRevision:state.revision+1,submitted:action,sourceValues:context.row.sourceValues,exampleInput:context.input,excludedInputCount:new Set(known.map(pickingCanonical)).size,exposure:'unknown'});
}
export const sourceHelperPracticeAction=(lesson:SourceHelperLesson,expectedRevision:number,values:Pick<SourceHelperPracticeAction,'changedInput'|'practiceInput'|'prediction'|'reasoning'>):SourceHelperPracticeAction=>readSourceHelperPracticeAction({kind:'submit-source-helper-practice',lesson,expectedRevision,...values});
