import {sourceHelperBatchFixture} from './source-helper-batch.fixture';
import {editModule} from '../../src/core/module-state';
import {sourceHelperLearningContext,sourceHelperPracticeAction} from '../../src/shared/helper-source-learning';
export async function sourceHelperLearningFixture(){
 const f=await sourceHelperBatchFixture(),lesson={activeVersion:1,sourceRef:f.request.sourceRef,bindings:f.request.bindings,recordNumber:2},context=sourceHelperLearningContext(f.task,f.owner,f.state.revision,lesson),action=sourceHelperPracticeAction(lesson,f.state.revision,{changedInput:{label:'  PRIVATE BOX  ',quantity:5,size:4},practiceInput:{label:' PRIVATE PRACTICE ',quantity:7,size:4},prediction:{status:'completed',output:{clean:'PRIVATE PRACTICE',total:999,labelCopy:'PRIVATE PRACTICE'}},reasoning:'  PRIVATE first reasoning — keep these exact spaces.  '});
 const submit=(value:typeof action=action)=>editModule(f.core,{...f.owner,action:value});
 return {...f,lesson,context,action,submit};
}
