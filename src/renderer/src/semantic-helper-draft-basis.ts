import {serializeLearningDraftJson} from '../../shared/learning-drafts';
import type {SemanticHelperState} from '../../learning/semantic-helper';

export type SemanticHelperDraftFamily='steps'|'record'|'checks'|'correction'|'run'|'typedsteps'|'typedrecord'|'typedcase'|'typedreason'|'typedversion'|'typedrun'|'typedexpectation'|'typedbatch';

/** Small exact identities; the cache independently compares all initial bytes. */
export function semanticHelperDraftBasis(state:SemanticHelperState,family:SemanticHelperDraftFamily):string{
 const recording=[...state.recordings].reverse().find(item=>item.result.trace.some(step=>step.stepId==='threshold'));
 const evidence=state.rationales.length>0||state.corrections.length>0||state.examples.length>0;
 const common=['semantic-record-v1',family] as const;
 switch(family){
  case 'typedsteps':case 'typedrecord':return serializeLearningDraftJson(['typed-record-editor-v1',family,state.draftVersion]);
  case 'typedcase':return serializeLearningDraftJson(['typed-record-editor-v1',family,state.draftVersion,state.examples.length,state.recordings.length,...(state.recordingCorrections?.length?[state.recordingCorrections.length]:[])]);
  case 'typedreason':return serializeLearningDraftJson(['typed-record-editor-v1',family,state.draftVersion,state.corrections.length,state.rationales.length]);
  case 'typedversion':return serializeLearningDraftJson(['typed-record-editor-v1',family,state.draftVersion,state.versions.length,...(state.recordingCorrections?.length?[state.recordingCorrections.length]:[])]);
  case 'typedexpectation':return serializeLearningDraftJson(['typed-record-editor-v1',family,state.draftVersion,state.recordings.length,state.recordingCorrections?.length??0]);
  case 'typedbatch':case 'typedrun':return serializeLearningDraftJson(['typed-record-editor-v1',family,state.activeVersion]);
  case 'steps':case 'record':return serializeLearningDraftJson([...common,state.draftVersion]);
  case 'checks':return serializeLearningDraftJson([...common,state.draftVersion,state.evidenceHistory.length,evidence,state.recordings.length,recording?.recordingId??null]);
  case 'correction':{
   const proposal=state.rationales.find(item=>item.id==='route-reason'),corrections=state.corrections.filter(item=>item.proposalId===proposal?.id);
   return serializeLearningDraftJson([...common,state.draftVersion,state.evidenceHistory.length,evidence,proposal?.id??null,corrections.at(-1)?.after??proposal?.reason??null]);
  }
  case 'run':return serializeLearningDraftJson([...common,state.activeVersion]);
 }
}
