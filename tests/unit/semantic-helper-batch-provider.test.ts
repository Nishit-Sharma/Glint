import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('../support/controlled-renderer.fixture')).hooks}));
import {createElement} from 'react';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';
import {createCompanion} from '../../src/core/companion';
import {createTextHelper} from '../../src/core/text-helper-host';
import {editModule} from '../../src/core/module-state';
import {parseModuleAnswer} from '../../src/core/interactive-modules';
import {semanticHelper} from '../../src/learning/semantic-helper';
import {LearningDraftStore} from '../../src/host/learning-drafts';
import {createLearningDrafts} from '../../src/renderer/src/learning-drafts';
import {LearningDraftProvider,LearningDraftScope,LearningDraftReview} from '../../src/renderer/src/learning-draft-context';
import {TypedSemanticHelperStudio} from '../../src/renderer/src/components/TypedSemanticHelperStudio';
import {semanticHelperDraftBasis} from '../../src/renderer/src/semantic-helper-draft-basis';
import {navigationFormBasis} from '../../src/renderer/src/learning-draft-basis';
import {typedInputDefaults} from '../../src/renderer/src/typed-semantic-procedure';
import {batchInput,batchProcedure,batchEvidence} from '../support/semantic-helper-batch.fixture';
type Host=ReturnType<ReturnType<typeof createControlledRenderer>['nodes']>[number];
const text=(node:Host):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0))await close();});
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'batch-provider-')),core=await createCompanion({dataDir:directory});cleanup.push(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});const task=await core.createTask({title:'Owned batch provider'}),created=await createTextHelper(core,{taskId:task.id,requestId:'batch-provider'}),artifact=created.task.artifacts.find(item=>item.id===created.artifactId)!,revision=artifact.revisions[0],module=parseModuleAnswer(JSON.parse(revision.content)).modules[0];if(module.data.kind!=='helper-studio')throw Error('Expected helper');const helperId=module.data.id,target={taskId:task.id,artifactId:artifact.id,artifactRevision:1,moduleId:module.id},owner={...target,artifactDigest:revision.digest,moduleVersion:module.version};const read=async()=>semanticHelper.parseState(helperId,(await core.getTask(task.id)).session!.moduleStates[0].state),act=async(action:Record<string,unknown>)=>{const task=await core.getTask(target.taskId);await editModule(core,{...target,action:{...action,expectedRevision:task.session?.moduleStates[0]?.state.revision??0} as never});return read();};
 await act({kind:'begin-semantic-helper'});await act({kind:'set-semantic-procedure',procedure:batchProcedure()});await act({kind:'record-semantic-input',input:batchInput('TRAIN',{days:12})});await act({kind:'set-semantic-evidence',...batchEvidence((await read()).recordings[0].recordingId)});await act({kind:'save-semantic-version',changeNote:'Checked provider batch.'});let state=await act({kind:'activate-semantic-version',version:1});const store=new LearningDraftStore({directory,lookupTask:async id=>(await core.listTasks()).find(task=>task.id===id)}),makeCache=()=>createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)}),cache=makeCache();await cache.load();const actions:unknown[]=[],render=(cache:ReturnType<typeof makeCache>)=>createControlledRenderer(()=>createElement(LearningDraftProvider,{cache,children:createElement(LearningDraftScope,{owner,children:createElement(TypedSemanticHelperStudio,{data:module.data as never,state,onAction:action=>{actions.push(action);return act(action as never).then(next=>{state=next;return true;});}})})}));return {core,store,cache,makeCache,render,owner,state,actions};
}
async function observed(name:string,value:unknown){const directory=process.env.BATCH_PROVIDER_EVIDENCE??'evidence/batch-provider';await mkdir(directory,{recursive:true});await writeFile(join(directory,name+'.json'),JSON.stringify(value,null,2)+'\n');}

test('actual owner cache/provider accepts batch Add/Remove and restores variable rows without helper actions',async()=>{
 const f=await fixture(),r=f.render(f.cache);r.render();const button=(name:string)=>r.find(node=>node.type==='button'&&text(node)===name),rowCount=()=>r.nodes().filter(node=>node.type==='fieldset'&&/^Batch record /.test(node.props['aria-label']??'')).length;expect(rowCount()).toBe(1);button('Add batch record').props.onClick();r.render();await observed('live-add',{rowsAfterAdd:rowCount(),editRejections:f.cache.getSnapshot().editRejections,scope:'Real owner/cache/provider/store and controlled React scheduling; no DOM/native runtime.'});expect(rowCount()).toBe(2);
 for(let i=2;i<8;i++){button('Add batch record').props.onClick();r.render();}expect(rowCount()).toBe(8);expect(button('Add batch record').props.disabled).toBe(true);button('Remove batch record 8').props.onClick();r.render();expect(rowCount()).toBe(7);await f.cache.flush();const raw=await f.store.read();expect(raw.kind).toBe('available');if(raw.kind!=='available')throw Error('Draft unavailable');const saved=raw.records.find(record=>record.slot==='helper:semantic:typedbatch')!;expect(JSON.parse(saved.value!.value).rows).toHaveLength(7);const next=f.makeCache();await next.load();const reopened=f.render(next);reopened.render();expect(reopened.nodes().filter(node=>node.type==='fieldset'&&/^Batch record /.test(node.props['aria-label']??'')).length).toBe(7);expect(Object.values(next.getSnapshot().editRejections??{})).toEqual([]);expect(f.actions).toEqual([]);
});
test('Unfinished practice recognizes the exact typedbatch variable-row basis as current',async()=>{
 const f=await fixture(),fields=f.state.versions[0].candidate.procedure.input.fields,initial={rows:[{values:typedInputDefaults(fields)}]},slot='helper:semantic:typedbatch',basis=navigationFormBasis(initial,{slot,basisMode:'explicit',basis:semanticHelperDraftBasis(f.state,'typedbatch'),variableArrays:['rows']});expect(f.cache.tryEdit(f.owner,slot,initial,basis,()=>({rows:[initial.rows[0],initial.rows[0]]}),['rows'])).toMatchObject({kind:'accepted'});await f.cache.flush();const task=await f.core.getTask(f.owner.taskId),r=createControlledRenderer(()=>createElement(LearningDraftReview,{task,cache:f.cache}));r.render();const copy=r.nodes().filter(node=>node.type==='p').map(text).join('\n');await observed('unfinished-basis',{copy,basis,scope:'Actual current helper task/cache/sidecar rendered through existing LearningDraftReview.'});expect(copy).toContain('Review the applied inputs before continuing.');expect(copy).not.toContain('The original answer or module changed.');
});
