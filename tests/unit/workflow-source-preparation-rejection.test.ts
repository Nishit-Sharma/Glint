import {expect,test} from 'vitest';
import {workflowSourcePreparationHeld} from '../../src/renderer/src/workflow-source-review-form';
test('a live rejection retires a pre-dispatch preparation even while every older preparation field stays ready',()=>{
 const live={held:false,rejected:false,intentReady:true,stale:false,confirmationScope:'owned continuation',continuationScope:'owned continuation'};expect(workflowSourcePreparationHeld(live)).toBe(false);
 expect(workflowSourcePreparationHeld({...live,rejected:true})).toBe(true);
 expect(workflowSourcePreparationHeld({...live,confirmationScope:undefined})).toBe(true);
 expect(workflowSourcePreparationHeld({...live,held:true})).toBe(true);expect(workflowSourcePreparationHeld({...live,intentReady:false})).toBe(true);expect(workflowSourcePreparationHeld({...live,stale:true})).toBe(true);
});
