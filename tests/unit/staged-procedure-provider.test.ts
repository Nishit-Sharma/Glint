import {mkdtemp,rm} from 'node:fs/promises';
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
import {semanticHelper,type SemanticHelperState} from '../../src/learning/semantic-helper';
import {LearningDraftStore} from '../../src/host/learning-drafts';
import {createLearningDrafts} from '../../src/renderer/src/learning-drafts';
import {LearningDraftProvider,LearningDraftScope} from '../../src/renderer/src/learning-draft-context';
import {SemanticHelperStudio} from '../../src/renderer/src/components/SemanticHelperStudio';
import {stagedInput} from '../support/staged-procedure.fixture';

type Renderer=ReturnType<typeof createControlledRenderer>;
type Node=ReturnType<Renderer['nodes']>[number];
const text=(node:Node):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
const cleanup:Array<()=>Promise<void>>=[];afterEach(async()=>{for(const close of cleanup.splice(0))await close();});
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'staged-procedure-'));let core=await createCompanion({dataDir:directory});cleanup.push(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});
 const task=await core.createTask({title:'Owned staged teaching'}),created=await createTextHelper(core,{taskId:task.id,requestId:'staged-helper'}),artifact=created.task.artifacts.find(item=>item.id===created.artifactId)!,revision=artifact.revisions[0],module=parseModuleAnswer(JSON.parse(revision.content)).modules[0];if(module.data.kind!=='helper-studio')throw Error('Helper');const data=module.data,owner={taskId:task.id,artifactId:artifact.id,artifactRevision:1,artifactDigest:revision.digest,moduleId:module.id,moduleVersion:module.version};
 const act=async(action:Record<string,unknown>)=>{const state=(await core.getTask(task.id)).session?.moduleStates[0]?.state;await editModule(core,{...owner,action:{...action,expectedRevision:state?.revision??0} as never});return read();},read=async()=>semanticHelper.parseState(data.id,(await core.getTask(task.id)).session!.moduleStates[0].state);
 await act({kind:'begin-semantic-helper'});let state:SemanticHelperState=await read();
 const store=new LearningDraftStore({directory,lookupTask:async id=>(await core.listTasks()).find(task=>task.id===id)}),makeCache=()=>createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)}),cache=makeCache();await cache.load();const pending:Promise<unknown>[]=[],actions:unknown[]=[];
 const render=(cache:ReturnType<typeof makeCache>)=>createControlledRenderer(()=>createElement(LearningDraftProvider,{cache,children:createElement(LearningDraftScope,{owner,children:createElement(SemanticHelperStudio,{data,state,onAction:action=>{actions.push(action);const operation=act(action).then(next=>{state=next;return true;});pending.push(operation);return operation;}})})}));
 return {get core(){return core;},owner,data,cache,makeCache,store,render,read,act,actions,async settle(r:Renderer){await cache.flush();await new Promise<void>(resolve=>setImmediate(resolve));await Promise.all(pending.splice(0));await new Promise<void>(resolve=>setImmediate(resolve));r.render();},async restart(){await core.close();core=await createCompanion({dataDir:directory});state=await read();}};
}
function edit(r:Renderer,label:string,value:string){r.find(node=>['input','select'].includes(node.type)&&node.props['aria-label']===label).props.onChange({currentTarget:{value}});r.render();}
function button(r:Renderer,label:string){return r.find(node=>node.type==='button'&&text(node)===label);}
function click(r:Renderer,label:string){const node=button(r,label);expect(node.props.disabled).not.toBe(true);node.props.onClick();r.render();}
function values(r:Renderer,prefix:string,input:Record<string,string|number|boolean>){for(const [name,value] of Object.entries(input))edit(r,`${prefix} ${name}`,String(value));}

test('ordinary helper entry teaches a staged procedure, checks exceptions, reuses fresh parameters and reopens from the same store',async()=>{
 const f=await fixture(),r=f.render(f.cache);r.render();click(r,'Teach a staged procedure');expect(r.nodes().some(node=>node.type==='h3'&&text(node)==='Staged procedure helper')).toBe(true);click(r,'Save staged procedure');await f.settle(r);
 expect((await f.read()).definitions[0].procedure.root.kind).toBe('assign');values(r,'Example',stagedInput);click(r,'Record typed example');await f.settle(r);const recording=structuredClone((await f.read()).recordings[0]);
 const add=async(role:string,input:Record<string,string|number|boolean>,outcome:string,expected?:Record<string,string|number|boolean>,stop?:string)=>{edit(r,'Case role',role);values(r,'Case',input);edit(r,'Expected outcome',outcome);if(expected)values(r,'Expected',expected);if(stop)edit(r,'Expected stop',stop);click(r,'Add expected case');await f.settle(r);};
 await add('held-out',{stock:24,reserved:3,requested:14,approved:true},'completed',{available:21,remaining:7,route:'ready'});
 await add('held-out',{stock:12,reserved:3,requested:14,approved:true},'completed',{available:9,remaining:-5,route:'review'});
 expect(button(r,'Save checked procedure version').props.disabled).toBe(true);
 await add('counterexample',{...stagedInput,approved:false},'abstained',undefined,'staged-required-1');
 await add('exception',{...stagedInput,reserved:31},'abstained',undefined,'stage-2-stop');
 expect(semanticHelper.check(await f.read()).passed).toBe(true);click(r,'Save checked procedure version');await f.settle(r);expect((await f.read()).activeVersion).toBeNull();click(r,'Activate version 1');await f.settle(r);
 values(r,'Fresh',{...stagedInput,stock:42});click(r,'Run active typed procedure');await f.settle(r);expect((await f.read()).lastRun?.result).toMatchObject({status:'completed',output:{available:36,remaining:24,route:'ready'},effectAuthority:'none'});
 const first=structuredClone((await f.read()).versions[0]);edit(r,'Stage 4 when true value','dispatch');click(r,'Save revised staged procedure');await f.settle(r);expect((await f.read()).activeVersion).toBe(1);expect(button(r,'Save checked procedure version').props.disabled).toBe(true);
 values(r,'Corrected expected',{available:24,remaining:12,route:'dispatch'});edit(r,'Recorded expectation correction reason','Use the reviewed dispatch wording for later versions.');click(r,'Save declared expectation correction');await f.settle(r);
 await add('held-out',{stock:24,reserved:3,requested:14,approved:true},'completed',{available:21,remaining:7,route:'dispatch'});
 await add('held-out',{stock:12,reserved:3,requested:14,approved:true},'completed',{available:9,remaining:-5,route:'review'});
 await add('counterexample',{...stagedInput,approved:false},'abstained',undefined,'staged-required-1');
 await add('exception',{...stagedInput,reserved:31},'abstained',undefined,'stage-2-stop');
 edit(r,'Procedure version note','Reviewed dispatch wording.');click(r,'Save checked procedure version');await f.settle(r);expect((await f.read()).activeVersion).toBe(1);click(r,'Activate version 2');await f.settle(r);values(r,'Fresh',{...stagedInput,stock:42});click(r,'Run active typed procedure');await f.settle(r);expect((await f.read()).lastRun?.result).toMatchObject({output:{route:'dispatch'}});
 click(r,'Roll back to version 1');await f.settle(r);values(r,'Fresh',{...stagedInput,stock:42});click(r,'Run active typed procedure');await f.settle(r);expect((await f.read()).lastRun?.result).toMatchObject({output:{route:'ready'}});expect((await f.read()).versions[0]).toEqual(first);
 const before=await f.read();await f.cache.flush();await f.restart();const cache=f.makeCache();await cache.load();const reopened=f.render(cache);reopened.render();expect(reopened.nodes().some(node=>node.type==='h3'&&text(node)==='Staged procedure helper')).toBe(true);expect(await f.read()).toEqual(before);expect((await f.read()).recordings[0]).toEqual(recording);expect(f.actions.every(action=>(action as {kind:string}).kind!=='browser-action')).toBe(true);
});

test('staged raw edits persist under their separate slot and refuse a dependency-breaking stage move',async()=>{
 const f=await fixture(),r=f.render(f.cache);r.render();click(r,'Teach a staged procedure');click(r,'Save staged procedure');await f.settle(r);edit(r,'Stage 1 result name','remaining');expect(r.find(node=>node.type==='input'&&node.props['aria-label']==='Stage 1 result name').props.value).toBe('available');expect(r.nodes().some(node=>node.props.role==='alert'&&text(node).includes('already used'))).toBe(true);edit(r,'Parameter 1 name','reserved');expect(r.find(node=>node.type==='input'&&node.props['aria-label']==='Parameter 1 name').props.value).toBe('stock');edit(r,'Parameter 1 name','inventory');edit(r,'Stage 1 result name','usable');expect(r.find(node=>node.type==='select'&&node.props['aria-label']==='Stage 2 condition field').props.value).toBe('usable');
 click(r,'Move stage 1 later');expect(r.nodes().some(node=>node.props.role==='alert'&&text(node).includes('before a result it uses'))).toBe(true);click(r,'Add checkpoint');expect(r.find(node=>node.type==='input'&&node.props['aria-label']==='Stage 4 stop reason').props.value).toBe('Review this input.');click(r,'Move stage 4 later');expect(r.nodes().some(node=>node.props.role==='alert'&&text(node).includes('Place checkpoints before the first decision'))).toBe(true);expect((await f.read()).definitions[0].procedure.output.fields[0].name).toBe('available');await f.cache.flush();await f.restart();const cache=f.makeCache();await cache.load();const reopened=f.render(cache);reopened.render();expect(reopened.find(node=>node.type==='input'&&node.props['aria-label']==='Stage 1 result name').props.value).toBe('usable');expect(reopened.find(node=>node.type==='input'&&node.props['aria-label']==='Parameter 1 name').props.value).toBe('inventory');expect(reopened.find(node=>node.type==='input'&&node.props['aria-label']==='Stage 4 stop reason').props.value).toBe('Review this input.');const sidecar=await f.store.read();if(sidecar.kind!=='available')throw Error('Sidecar');expect(sidecar.records.some(record=>record.slot==='helper:semantic:stagedsteps'&&record.value?.value.includes('usable'))).toBe(true);
});
