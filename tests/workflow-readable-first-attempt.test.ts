import {expect,test} from 'vitest';
import {workflowLab,type WorkflowAction,type WorkflowState} from '../src/learning/workflow-lab';
import {workflowExample} from '../src/learning/workflow-example';

type InputAction={[Kind in WorkflowAction['kind']]:Omit<Extract<WorkflowAction,{kind:Kind}>,'expectedRevision'>}[WorkflowAction['kind']];
function apply(state:WorkflowState,action:InputAction){
 return workflowLab.update(workflowExample,state,{...action,expectedRevision:state.revision});
}

test('readable notes keep the exact first transfer answer and its original practice after returning to changed practice',()=>{
 let state=workflowLab.initial(workflowExample);
 state=apply(state,{kind:'set-rule',ruleId:'ready-edit',toStateId:'review',enabled:true,reason:'Try review again after editing.'});
 state=apply(state,{kind:'predict',finalStateId:'ready',blockedCount:0,reasoning:'  Original practice reasoning.  '});
 state=apply(state,{kind:'start-transfer'});
 state=apply(state,{kind:'predict',finalStateId:'reserved',blockedCount:1,reasoning:'  My original first answer.\nKeep this exact whitespace.  '});
 state=apply(state,{kind:'return-practice'});
 state=apply(state,{kind:'set-rule',ruleId:'ready-edit',toStateId:'draft',enabled:true,reason:'A later edit must not replace the saved first attempt.'});
 const before=JSON.stringify({data:workflowExample,state});
 const notes=workflowLab.text(workflowExample,JSON.parse(JSON.stringify(state)));
 expect(notes).toContain('My original first answer.\nKeep this exact whitespace.  ');
 expect(notes).toContain('Original practice reasoning.  ');
 expect(notes).toContain('Saved first transfer attempt');
 expect(notes).toContain('Reserved; 1 blocked event');
 expect(notes).toContain('Practice at transfer start');
 expect(JSON.stringify({data:workflowExample,state})).toBe(before);
});
