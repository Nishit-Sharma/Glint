import {serializeLearningDraftJson} from '../../shared/learning-drafts';
import type {HelperState} from '../../learning/reusable-helper';

/** A selected legacy check has no per-check revision; use the exact module revision conservatively. */
export function legacyHelperDraftBasis(state:HelperState,family:'details'|'demonstration'|'operation'|'exception'|'check'|'version'|'run'|'examples'|'versiontrial'):string{
 const common=['text-helper-v1',family];
 switch(family){
  case 'details':return serializeLearningDraftJson(common);
  case 'demonstration':return serializeLearningDraftJson([...common,!!state.recording,state.recording?.steps.length??0]);
  case 'operation':return serializeLearningDraftJson([...common,state.recording?'recording':'draft',state.recording?state.recording.steps.map(step=>step.operation):state.draft.operations]);
  case 'exception':return serializeLearningDraftJson([...common,state.draft.exceptions]);
  case 'examples':case 'check':case 'version':return serializeLearningDraftJson([...common,state.revision]);
  case 'versiontrial':return serializeLearningDraftJson([...common,state.versions.map(saved=>[saved.version,saved.savedAtRevision])]);
  case 'run':return serializeLearningDraftJson([...common,state.activeVersion]);
 }
}
