import {expectPinnedReaderRefusal} from '../support/pinned-reader-refusal.fixture';
import {oldTaskLookup} from '../support/pinned-old-task-lookup';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('../support/controlled-renderer.fixture')).hooks}));
import {createElement} from 'react';
import {Effect} from 'effect';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';
import {createCompanion} from '../../src/core/companion';
import {createTextHelper} from '../../src/core/text-helper-host';
import {editModule} from '../../src/core/module-state';
import {parseModuleAnswer} from '../../src/core/interactive-modules';
import {semanticHelper} from '../../src/learning/semantic-helper';
import {LearningDraftStore} from '../../src/host/learning-drafts';
import {createLearningDrafts} from '../../src/renderer/src/learning-drafts';
import {LearningDraftProvider,LearningDraftScope} from '../../src/renderer/src/learning-draft-context';
import {TypedSemanticHelperStudio} from '../../src/renderer/src/components/TypedSemanticHelperStudio';
import {workflowStepsProcedure,workflowInput,workflowEvidence} from '../support/typed-helper-workflow-steps.fixture';
import {semanticHelper as priorHelper} from '../fixtures/workflow-steps-prior/src/learning/semantic-helper';
import {parseTypedProcedureDraft as priorDraft} from '../fixtures/workflow-steps-prior/src/renderer/src/typed-semantic-procedure';
import {LearningDraftStore as OldDraftStore} from '../fixtures/a91/src/host/learning-drafts';
import {readState as oldRead} from '../fixtures/a91/src/core/store';
import {exampleLesson} from '../../src/learning/example';
import {MODULE_MIME} from '../../src/shared/module-contract';

type Node=ReturnType<ReturnType<typeof createControlledRenderer>['nodes']>[number];
const text=(node:Node):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
const cleanup:Array<()=>Promise<void>>=[];afterEach(async()=>{for(const close of cleanup.splice(0))await close();});
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'workflow-steps-'));let core=await createCompanion({dataDir:directory});cleanup.push(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});
 const task=await core.createTask({title:'Owned local workflow'}),created=await createTextHelper(core,{taskId:task.id,requestId:'local-workflow'}),artifact=created.task.artifacts.find(item=>item.id===created.artifactId)!,revision=artifact.revisions[0],module=parseModuleAnswer(JSON.parse(revision.content)).modules[0];if(module.data.kind!=='helper-studio')throw Error('Helper');const data=module.data,owner={taskId:task.id,artifactId:artifact.id,artifactRevision:1,artifactDigest:revision.digest,moduleId:module.id,moduleVersion:module.version};
 const read=async()=>semanticHelper.parseState(data.id,(await core.getTask(task.id)).session!.moduleStates[0].state),act=async(action:Record<string,unknown>)=>{const state=(await core.getTask(task.id)).session?.moduleStates[0]?.state;await editModule(core,{...owner,action:{...action,expectedRevision:state?.revision??0} as never});return read();};
 await act({kind:'begin-semantic-helper'});await act({kind:'set-semantic-procedure',procedure:workflowStepsProcedure()});await act({kind:'record-semantic-input',input:workflowInput});await act({kind:'set-semantic-evidence',...workflowEvidence((await read()).recordings[0].recordingId)});await act({kind:'save-semantic-version',changeNote:'Reviewed dependent workflow.'});let state=await act({kind:'activate-semantic-version',version:1});
 const store=new LearningDraftStore({directory,lookupTask:async id=>(await core.listTasks()).find(task=>task.id===id)}),makeCache=()=>createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)}),cache=makeCache();await cache.load();const actions:unknown[]=[],render=(cache:ReturnType<typeof makeCache>)=>createControlledRenderer(()=>createElement(LearningDraftProvider,{cache,children:createElement(LearningDraftScope,{owner,children:createElement(TypedSemanticHelperStudio,{data,state,onAction:action=>{actions.push(action);return act(action).then(next=>{state=next;return true;});}})})}));
 return {get core(){return core;},directory,owner,data,store,cache,makeCache,render,actions,read,act,async restart(){await core.close();core=await createCompanion({dataDir:directory});state=await read();}};
}
function field(r:ReturnType<typeof createControlledRenderer>,name:string){return r.find(node=>['select','input'].includes(node.type)&&node.props['aria-label']===name);}
function edit(r:ReturnType<typeof createControlledRenderer>,name:string,value:string){field(r,name).props.onChange({currentTarget:{value},target:{value}});r.render();}

test('real cached controls retain exact dependency edits, restrict choices and refuse an invalid reorder',async()=>{
 const f=await fixture(),r=f.render(f.cache);r.render();expect(field(r,'Otherwise result unpacked left source').props.value).toBe('output');expect(field(r,'Otherwise result unpacked left earlier result').children.map(text)).toEqual(['usable']);
 const remove=r.find(node=>node.type==='button'&&text(node)==='Remove result field 1');expect(remove.props.disabled).toBe(true);r.find(node=>node.type==='button'&&text(node)==='Move result step 1 later').props.onClick();r.render();expect(r.nodes().some(node=>node.props.role==='alert'&&text(node).includes('before a step it uses'))).toBe(true);
 edit(r,'outputs field 1 name','available');expect(field(r,'Otherwise result unpacked left earlier result').props.value).toBe('available');expect(f.actions).toEqual([]);await f.cache.flush();const cache=f.makeCache();await cache.load();const reopened=f.render(cache);reopened.render();expect(field(reopened,'outputs field 1 name').props.value).toBe('available');expect(field(reopened,'Otherwise result unpacked left earlier result').props.value).toBe('available');expect((await f.read()).versions[0].candidate.procedure.output.fields[0].name).toBe('usable');
});

test('same-store run and partial refusal reopen without changing the immutable checked version',async()=>{
 const f=await fixture(),before=await f.read();await f.act({kind:'run-semantic-active',input:{...workflowInput,requested:1000000,damaged:-1}});await f.restart();const after=await f.read();expect(after.versions).toEqual(before.versions);expect(after.lastRun?.result).toMatchObject({status:'abstained',haltedStepId:'otherwise-output-1',output:{}});expect(after.lastRun?.result.trace.map(step=>step.stepId)).toEqual(['required-1','rule-1','otherwise-output-1']);await f.act({kind:'run-semantic-active',input:{...workflowInput,requested:16,packed:2,boxSize:4}});await f.restart();expect((await f.read()).lastRun?.result).toMatchObject({status:'completed',output:{usable:14,unpacked:12,perBox:3},effectAuthority:'none'});
});

test('pinned prior readers refuse dependent editing and the provenance-bearing store unchanged while current reopen preserves the workflow',async()=>{
 const f=await fixture(),r=f.render(f.cache);r.render();edit(r,'outputs field 1 name','available');await f.cache.flush();const state=await f.read();expect(()=>priorHelper.parseState(state.helperId,state)).toThrow();
 const sidecar=await f.store.read();if(sidecar.kind!=='available')throw Error('Sidecar');const entry=sidecar.records.find(record=>record.slot==='helper:semantic:typedsteps')!;const draftText=JSON.parse(entry.value!.value).definitionText;expect(JSON.parse(draftText).fallback.values[1].left).toEqual({source:'output',value:'available'});expect(()=>priorDraft(draftText)).toThrow();
 const other=await f.core.createTask({title:'Unrelated old-reader work'}),artifact=await f.core.saveArtifact(other.id,{title:'Join',mimeType:MODULE_MIME,content:JSON.stringify({schemaVersion:1,markdown:'Unrelated join.',modules:[{id:'join',version:1,data:exampleLesson,provenance:[]}]})}),owner={taskId:other.id,artifactId:artifact.artifactId,artifactRevision:1,artifactDigest:artifact.revision.digest,moduleId:'join',moduleVersion:1};await f.store.save(owner,'prediction','initial',0,{initial:'""',value:'"1"',basis:'join'});const before=await readFile(join(f.directory,'learning-drafts.json')),task=await f.core.getTask(f.owner.taskId);
 // Refusal contract: replaces the unrelated old-reader task write, the old sidecar raw read and its unrelated join-form save; each fails closed with tasks.json and sidecar bytes unchanged.
 await expectPinnedReaderRefusal(f.directory,()=>Effect.runPromise(oldRead(f.directory)));expect(await readFile(join(f.directory,'learning-drafts.json'))).toEqual(before);await f.restart();
 const older=new OldDraftStore({directory:f.directory,lookupTask:oldTaskLookup(f.directory)}),loaded=await older.read();expect(loaded).toEqual({kind:'unavailable',message:expect.stringMatching(/preserved/)});await expect(older.save(f.owner,entry.slot,'initial',entry.revision,entry.value!)).rejects.toThrow(/unreadable or incompatible/);await expect(older.save(owner,'prediction','initial',1,{initial:'""',value:'"2"',basis:'join'})).rejects.toThrow(/unreadable or incompatible/);expect(await readFile(join(f.directory,'learning-drafts.json'))).toEqual(before);const reopened=await f.core.getTask(f.owner.taskId);expect(reopened.artifacts).toEqual(task.artifacts);expect(reopened.requests).toEqual(task.requests);expect(reopened.session!.moduleStates).toEqual(task.session!.moduleStates);const current=await f.store.read();if(current.kind!=='available')throw Error('Current sidecar');expect(current.records.find(record=>record.slot===entry.slot)?.value).toEqual(entry.value);expect(current.records.find(record=>record.slot==='prediction')?.value?.value).toBe('"1"');expect((await f.core.getTask(other.id)).goal).toBe(other.goal);expect(await f.read()).toEqual(state);
});
