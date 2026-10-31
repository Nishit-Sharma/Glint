import {projectTaskDialogue,readTaskArtifactText} from '../src/core/task-dialogue';
import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {saveBrowserWorkflow} from '../src/core/browser-workflow-host';
import {browserWorkflowStarter,readBrowserWorkflow,workflowInvocation,workflowTarget,workflowCheck,currentBrowserWorkflow} from '../src/shared/browser-workflow';

const cleanups:(()=>Promise<unknown>)[]=[];afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
it('rejects executable extensions, unknown inputs, duplicate slots and broader authority',()=>{
 for(const change of [{script:'document.cookie'},{origin:'http://external.invalid'},{origin:'https://owned.invalid/path'},{pathPrefix:'//other.invalid/'},{pathPrefix:'/requests/../'},{pathPrefix:'/requests'},{inputs:[{key:'title',label:'A'},{key:'title',label:'B'}]}])expect(()=>readBrowserWorkflow({...browserWorkflowStarter,...change})).toThrow();
 const bad=JSON.parse(JSON.stringify(browserWorkflowStarter));if(bad.steps[0].action.kind!=='fill')throw Error('Expected fill');bad.steps[0].action.value='{{unknown}}';expect(()=>readBrowserWorkflow(bad)).toThrow('unknown input');
 expect(()=>readBrowserWorkflow({...browserWorkflowStarter,steps:[]})).toThrow();
});
it('binds fresh targets and exact inputs to the saved origin and normalized path',()=>{
 const workflow=readBrowserWorkflow(browserWorkflowStarter),inputs={title:'Sierra',delivery:'courier'};
 expect(workflowInvocation(workflow,workflow.origin+'/requests/fresh',inputs)).toEqual({url:workflow.origin+'/requests/fresh',inputs});
 for(const url of ['https://other.invalid/requests/fresh',workflow.origin+'/elsewhere/',workflow.origin+'/requests/../outside/',workflow.origin+'/requests/fresh#token'])expect(()=>workflowInvocation(workflow,url,inputs)).toThrow();
 expect(()=>workflowInvocation(workflow,workflow.origin+'/requests/fresh',{...inputs,extra:'unreviewed'})).toThrow();
 expect(()=>workflowInvocation(workflow,workflow.origin+'/requests/fresh',{title:'',delivery:'courier'})).toThrow();
});
it('resolves one exact current label and refuses ambiguous or failed visible checks',()=>{
 const observation={id:'one',taskId:'task',browserId:'browser',documentId:'doc',url:browserWorkflowStarter.origin+'/requests/one',title:'Request draft',text:'Request draft',digest:'digest',targets:[{id:'fresh',role:'text',label:'Request title',value:'New title'}]},target={role:'text' as const,label:'Request title'};
 expect(workflowTarget(observation,target).id).toBe('fresh');expect(workflowCheck({kind:'value',target,equals:'{{title}}'},observation,{title:'New title'})).toContain('New title');
 expect(()=>workflowTarget({...observation,targets:[...observation.targets,...observation.targets]},target)).toThrow('found 2');expect(()=>workflowCheck({kind:'text',contains:'Saved'},observation,{})).toThrow('check failed');
});
it('saves exact authored versions, replays a save without duplication and reopens from the durable store',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-authored-workflow-'));cleanups.push(()=>rm(directory,{recursive:true,force:true}));let core=await createCompanion({dataDir:directory});cleanups.push(()=>core.close());const task=await core.createTask({title:'Authored workflow'});
 const input={taskId:task.id,requestId:'authored-one',definition:browserWorkflowStarter},saved=await saveBrowserWorkflow(core,input),replay=await saveBrowserWorkflow(core,input);expect(replay.artifactId).toBe(saved.artifactId);expect(replay.task.artifacts).toHaveLength(1);
 const original=saved.task.artifacts[0].revisions[0],ref={artifactId:saved.artifactId,revision:original.revision,digest:original.digest};
 const updated=await saveBrowserWorkflow(core,{...input,requestId:'authored-two',artifact:ref,definition:{...browserWorkflowStarter,name:'Reviewed browser draft'}});expect(updated.revision).toBe(2);expect((await saveBrowserWorkflow(core,{...input,requestId:'authored-two',artifact:ref,definition:{...browserWorkflowStarter,name:'Reviewed browser draft'}})).revision).toBe(2);
 expect(()=>currentBrowserWorkflow(updated.task,ref)).toThrow('changed');await core.close();core=await createCompanion({dataDir:directory});const restored=await core.getTask(task.id),latest=restored.artifacts[0].revisions.at(-1)!;expect(currentBrowserWorkflow(restored,{artifactId:saved.artifactId,revision:latest.revision,digest:latest.digest}).name).toBe('Reviewed browser draft');expect(restored.requests).toHaveLength(2);const projection=readTaskArtifactText(restored,saved.artifactId,latest.revision);expect(projection.available&&projection.localHelperContentsExcluded).toBe(true);const history=projectTaskDialogue(restored,'future-question',[]);expect(history).not.toContain('pathPrefix');expect(history).not.toContain('127.0.0.1:4300');
});
