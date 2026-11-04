import {expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('../support/controlled-renderer.fixture')).hooks}));
import {createElement} from 'react';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';
import {WorkflowLab} from '../../src/renderer/src/components/WorkflowLab';
import {workflowLab,type WorkflowAction} from '../../src/learning/workflow-lab';
import {workflowExample} from '../../src/learning/workflow-example';
type Host=ReturnType<ReturnType<typeof createControlledRenderer>['nodes']>[number];
const text=(node:Host):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
test('explanation action dispatches the existing mode save; a failed save stays on Quick, retry is durable, and pending blocks it',async()=>{
 let state=workflowLab.initial(workflowExample);state=workflowLab.update(workflowExample,state,{kind:'set-rule',ruleId:'ready-edit',toStateId:'review',enabled:true,reason:'Compare changed rule.',expectedRevision:0});state=workflowLab.update(workflowExample,state,{kind:'predict',finalStateId:'ready',blockedCount:0,reasoning:'Compare.',expectedRevision:1});let fail=true,pending=false;const actions:WorkflowAction[]=[];
 const renderer=createControlledRenderer(()=>createElement(WorkflowLab,{data:workflowExample,state,pending,onAction:async action=>{actions.push(action);if(fail)return false;state=workflowLab.update(workflowExample,state,action);return true;}}));renderer.render();const findButton=()=>renderer.find(node=>node.type==='button'&&text(node)==='Explain this comparison');expect(findButton().props.disabled).toBe(false);await findButton().props.onClick();renderer.render();expect(state.mode).toBe('quick');expect(findButton()).toBeTruthy();pending=true;renderer.render();expect(findButton().props.disabled).toBe(true);pending=false;fail=false;renderer.render();await findButton().props.onClick();renderer.render();expect(actions).toEqual([{kind:'set-mode',mode:'deep',expectedRevision:2},{kind:'set-mode',mode:'deep',expectedRevision:2}]);expect(state.mode).toBe('deep');expect(renderer.nodes().some(node=>node.props['aria-label']==='Computed workflow explanation')).toBe(true);const reopened=workflowLab.parseState(workflowExample,JSON.parse(JSON.stringify(state)));expect(reopened.mode).toBe('deep');
});
