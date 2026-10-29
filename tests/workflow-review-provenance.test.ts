import {expect,test} from 'vitest';
import {workflowExample} from '../src/learning/workflow-example';
import {workflowLab} from '../src/learning/workflow-lab';

test('a local sample cannot acquire reviewed-source classification without an admitted quote',()=>{
 expect(workflowLab.parse(workflowExample).basis.kind).toBe('local-sample');
 for(const interpretation of ['source-stated','user-interpreted']){
  const claim={...workflowExample,ruleOrigins:workflowExample.ruleOrigins.map((rule,index)=>index?rule:{...rule,interpretation})};
  expect(()=>workflowLab.parse(claim)).toThrow(/reviewed source citation/i);
 }
});
