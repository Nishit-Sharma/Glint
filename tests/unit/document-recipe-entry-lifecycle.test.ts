import {legacyDocumentRecipeSave} from '../support/legacy-helper-report-publication.fixture';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
const probe=vi.hoisted(()=>({effects:[] as Array<{cleanup:()=>void;setup:()=>void}>}));
// Replay the effect lifecycle deterministically; React scheduling and DOM layout are substituted.
vi.mock('react',async original=>{const fixture=await import('../support/controlled-renderer.fixture');return {...await original<typeof import('react')>(),...fixture.hooks,useEffect(fn:()=>void|(()=>void),deps:readonly unknown[]){fixture.hooks.useEffect(()=>{let cleanup=fn();if(typeof cleanup==='function')cleanup();cleanup=fn();const lifetime={cleanup:()=>{if(typeof cleanup==='function')cleanup();},setup:()=>{cleanup=fn();}};probe.effects.push(lifetime);return lifetime.cleanup;},deps);}};});
vi.mock('../../src/renderer/src/components/ReadableText',async()=>{const {createElement}=await import('react');return {ReadableText:({text}:{text:string})=>createElement('pre',{},text)};});
import {createElement} from 'react';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';
import {documentRecipeFixture} from '../support/document-recipe.fixture';
import {createDocumentRecipe,saveDocumentRecipe,inspectDocumentRecipeSave} from '../../src/core/document-recipe-host';
import {previewDocumentRecipe} from '../../src/shared/document-recipe';
import type {Command} from '../../src/shared/bridge';
import {DocumentRecipeCreateButton} from '../../src/renderer/src/components/DocumentRecipeCreateButton';
import {DocumentRecipeStudio} from '../../src/renderer/src/components/DocumentRecipeStudio';
import {LearningDraftStore} from '../../src/host/learning-drafts';
import {createLearningDrafts} from '../../src/renderer/src/learning-drafts';
import {LearningDraftProvider,LearningDraftScope} from '../../src/renderer/src/learning-draft-context';
type R=ReturnType<typeof createControlledRenderer>;type Host=ReturnType<R['nodes']>[number];
const text=(node:Host):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
const button=(r:R,label:string)=>r.find(node=>node.type==='button'&&text(node)===label);
const close:Array<()=>Promise<void>>=[];
beforeEach(()=>{probe.effects=[];});
afterEach(async()=>{for(const effect of probe.effects)effect.cleanup();for(const dispose of close.splice(0))await dispose();vi.unstubAllGlobals();});
async function fixture(){const f=await documentRecipeFixture();close.push(f.close);return f;}

test('effect setup-cleanup-setup delivers one create completion for the intended owner despite repeated clicks',async()=>{
 const f=await fixture(),onCreated=vi.fn(),pending:Promise<unknown>[]=[],invoke=vi.fn((command:Command)=>{if(command.type!=='helper.document.create')throw Error('Unexpected operation');const {type,...input}=command,promise=createDocumentRecipe(f.core,input);pending.push(promise);return promise;});vi.stubGlobal('window',{companion:{invoke}});
 const r=createControlledRenderer(()=>createElement(DocumentRecipeCreateButton,{taskId:f.owner.taskId,disabled:false,onCreated}));r.render();
 button(r,'Document recipe').props.onClick();button(r,'Document recipe').props.onClick();expect(invoke).toHaveBeenCalledTimes(1);await Promise.all(pending);await new Promise<void>(resolve=>setImmediate(resolve));r.render();
 const task=await f.core.getTask(f.owner.taskId),created=task.artifacts.find(item=>item.id!==f.owner.artifactId)!;expect(created).toBeDefined();expect(task.artifacts).toHaveLength(2);expect(onCreated).toHaveBeenCalledTimes(1);expect(onCreated).toHaveBeenCalledWith(task,created.id);expect(button(r,'Document recipe').props.disabled).toBe(false);
});

test('a true create-button unmount suppresses a late completion',async()=>{
 const f=await fixture(),onCreated=vi.fn();let release!:(value:unknown)=>void;const response=new Promise<unknown>(resolve=>{release=resolve;}),invoke=vi.fn(()=>response);vi.stubGlobal('window',{companion:{invoke}});
 const r=createControlledRenderer(()=>createElement(DocumentRecipeCreateButton,{taskId:f.owner.taskId,disabled:false,onCreated}));r.render();button(r,'Document recipe').props.onClick();expect(invoke).toHaveBeenCalledTimes(1);probe.effects[0].cleanup();release({task:await f.core.getTask(f.owner.taskId),artifactId:f.owner.artifactId,revision:1});await response;await new Promise<void>(resolve=>setImmediate(resolve));expect(onCreated).not.toHaveBeenCalled();
});

test('effect replay preserves selected-source preview and lost-save status inspection using real local host functions',async()=>{
 const f=await fixture();await f.teach();const request=await f.source(),state=await f.read();let task=await f.core.getTask(f.owner.taskId);
 const store=new LearningDraftStore({directory:f.directory,lookupTask:async id=>(await f.core.listTasks()).find(item=>item.id===id)}),cache=createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)});await cache.load();
 const commands:Command[]=[],pending:Promise<unknown>[]=[],invoke=(command:Command)=>{commands.push(command);const promise=(async()=>{
  if(command.type==='helper.document.preview'){const {type,...input}=command;return previewDocumentRecipe(await f.core.getTask(command.taskId),input);}
  if(command.type==='helper.document.save'){const {type,...input}=command;await saveDocumentRecipe(f.core,input);task=await f.core.getTask(command.taskId);throw Error('Owned lost document acknowledgement.');}
  if(command.type==='helper.document.inspect'){const {type,...input}=command;return inspectDocumentRecipeSave(f.core,input);}
  throw Error('Unexpected operation');})();pending.push(promise);return promise;};vi.stubGlobal('window',{companion:{invoke}});
 const r=createControlledRenderer(()=>createElement(LearningDraftProvider,{cache,children:createElement(LearningDraftScope,{owner:f.owner,children:createElement(DocumentRecipeStudio,{state,task,draftOwner:f.owner,onAction:()=>{throw Error('Preview must not edit the recipe.');}})})}));
 const settle=async()=>{await Promise.allSettled(pending.splice(0));await new Promise<void>(resolve=>setImmediate(resolve));r.render();await cache.flush();};
 r.render();r.find(node=>node.type==='label'&&node.children.some(child=>child.type==='#text'&&text(child)==='Saved text source')).children.find(node=>node.type==='select')!.props.onChange({target:{value:JSON.stringify(request.sourceRef)}});r.render();button(r,'Preview selected notes locally').props.onClick();await settle();
 const preview=r.find(node=>node.props['aria-label']==='Reviewed document preview');expect(text(preview)).toContain('Owner: Rowan\nNext: Inspect stock');expect(button(r,'Preview selected notes locally').props.disabled).toBe(false);expect(task.artifacts).toHaveLength(1);
 button(r,'Save reviewed new document').props.onClick();await settle();expect(text(r.find(node=>node.props.role==='alert'))).toBe('This action could not be completed. Review the task before continuing.');expect(r.nodes().some(node=>node.type==='p'&&text(node)==='The original save outcome needs checking before another save.')).toBe(true);expect(task.artifacts).toHaveLength(2);expect(button(r,'Check original document save').props.disabled).toBe(false);
 button(r,'Check original document save').props.onClick();await settle();expect(r.nodes().some(node=>node.type==='p'&&text(node)==='That original document is saved. Open it from Files.')).toBe(true);expect(commands.map(command=>command.type)).toEqual(['helper.document.preview','helper.document.save','helper.document.inspect']);expect(await f.read()).toEqual(state);
});

test('editing name then purpose preserves notes and submits the exact cached demonstration after rerenders',async()=>{
 const f=await fixture();let state=await f.read();const task=await f.core.getTask(f.owner.taskId),store=new LearningDraftStore({directory:f.directory,lookupTask:async id=>(await f.core.listTasks()).find(item=>item.id===id)}),cache=createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)});await cache.load();
 const actions:unknown[]=[],pending:Promise<unknown>[]=[],r=createControlledRenderer(()=>createElement(LearningDraftProvider,{cache,children:createElement(LearningDraftScope,{owner:f.owner,children:createElement(DocumentRecipeStudio,{state,task,draftOwner:f.owner,onAction:action=>{actions.push(action);const promise=f.act({...action}).then(next=>{state=next;return true;});pending.push(promise);return promise;}})})}));
 const control=(label:string)=>r.find(node=>node.type==='label'&&node.children.some(child=>child.type==='#text'&&text(child)===label)).children.find(node=>node.type==='input'||node.type==='textarea')!;
 r.render();control('Demonstration recipe name').props.onChange({target:{value:'Handoff note'}});r.render();await cache.flush();
 control('Demonstration purpose').props.onChange({target:{value:'Create a handoff from local notes.'}});r.render();await cache.flush();
 expect(control('Demonstration notes').props.value).toBe('Owner: Mira\nStatus: Ready\nNext: Ship samples');expect(control('Demonstration notes').props.disabled).not.toBe(true);
 control('Demonstration notes').props.onChange({target:{value:'Owner: Mira\nNext: Ship samples'}});r.render();await cache.flush();
 expect(control('Demonstration recipe name').props.value).toBe('Handoff note');expect(control('Demonstration purpose').props.value).toBe('Create a handoff from local notes.');expect(control('Demonstration notes').props.value).toBe('Owner: Mira\nNext: Ship samples');expect(actions).toEqual([]);expect((await f.read()).revision).toBe(0);
 const stored=await store.read();if(stored.kind!=='available')throw Error('Owned draft store unavailable');expect(JSON.parse(stored.records.find(record=>record.slot==='document-recipe:sample')!.value!.value)).toEqual({name:'Handoff note',intent:'Create a handoff from local notes.',input:'Owner: Mira\nNext: Ship samples'});
 button(r,'Start local document demonstration').props.onClick();await vi.waitFor(()=>expect(actions).toHaveLength(1));await Promise.all(pending);await new Promise<void>(resolve=>setImmediate(resolve));r.render();
 expect(actions).toEqual([{kind:'document-recipe-start',name:'Handoff note',intent:'Create a handoff from local notes.',input:'Owner: Mira\nNext: Ship samples',expectedRevision:0}]);expect(state.recording).toMatchObject({name:'Handoff note',intent:'Create a handoff from local notes.',input:'Owner: Mira\nNext: Ship samples'});expect(button(r,'Insert literal text')).toBeDefined();
});

test('an earlier saved document remains explicitly bound to its own preview when a different source stops',async()=>{
 const f=await fixture();await f.teach();const request=await f.source(),state=await f.read();let task=await f.core.putSource(f.owner.taskId,{id:'protected-notes',kind:'text',role:'fact',label:'Protected local notes',content:'PRIVATE\nOwner: Rowan\nNext: Inspect stock'});const protectedVersion=task.sources.find(source=>source.id==='protected-notes')!.versions[0],protectedRef={sourceId:'protected-notes',version:protectedVersion.version,digest:protectedVersion.digest};
 const store=new LearningDraftStore({directory:f.directory,lookupTask:async id=>(await f.core.listTasks()).find(item=>item.id===id)}),cache=createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)});await cache.load();
 const commands:Command[]=[],pending:Promise<unknown>[]=[],invoke=(command:Command)=>{commands.push(command);const promise=(async()=>{
  if(command.type==='helper.document.preview'){const {type,...input}=command;return previewDocumentRecipe(await f.core.getTask(command.taskId),input);}
  if(command.type==='helper.document.save'){const {type,...input}=command,saved=await saveDocumentRecipe(f.core,input);task=await f.core.getTask(command.taskId);return saved;}
  if(command.type==='helper.document.inspect'){const {type,...input}=command;return inspectDocumentRecipeSave(f.core,input);}
  throw Error('Unexpected operation');})();pending.push(promise);return promise;};vi.stubGlobal('window',{companion:{invoke}});
 const r=createControlledRenderer(()=>createElement(LearningDraftProvider,{cache,children:createElement(LearningDraftScope,{owner:f.owner,children:createElement(DocumentRecipeStudio,{state,task,draftOwner:f.owner,onAction:()=>{throw Error('Preview must not edit the recipe.');}})})}));
 const settle=async()=>{await Promise.allSettled(pending.splice(0));await new Promise<void>(resolve=>setImmediate(resolve));r.render();await cache.flush();};
 const select=(value:typeof request.sourceRef)=>{r.find(node=>node.type==='label'&&node.children.some(child=>child.type==='#text'&&text(child)==='Saved text source')).children.find(node=>node.type==='select')!.props.onChange({target:{value:JSON.stringify(value)}});r.render();};
 r.render();select(request.sourceRef);button(r,'Preview selected notes locally').props.onClick();await settle();button(r,'Save reviewed new document').props.onClick();await settle();const savedOutput=structuredClone(task.artifacts.find(artifact=>artifact.id!==f.owner.artifactId));
 select(protectedRef);button(r,'Preview selected notes locally').props.onClick();await settle();expect(text(r.find(node=>node.props['aria-label']==='Reviewed document preview'))).toContain('Stopped: Keep private notes for review.');expect(button(r,'Save reviewed new document').props.disabled).toBe(true);
 expect(r.nodes().some(node=>node.type==='p'&&text(node)==='The reviewed document is saved. Open it from Files.')).toBe(false);
 const original=r.find(node=>node.props['aria-label']==='Original document save');expect(text(original)).toContain('Handoff note');expect(text(original)).toContain('Fresh local notes · source version 1 · helper version 1');expect(text(original)).not.toContain('Protected local notes');expect(text(original)).toContain('That original document is saved. Open it from Files.');
 button(r,'Check original document save').props.onClick();await settle();const inspected=commands.at(-1);expect(inspected).toMatchObject({type:'helper.document.inspect',sourceRef:request.sourceRef});expect(commands.filter(command=>command.type==='helper.document.save')).toHaveLength(1);expect(task.artifacts).toHaveLength(2);expect(task.artifacts.find(artifact=>artifact.id!==f.owner.artifactId)).toEqual(savedOutput);expect(savedOutput?.revisions[0].sourceRefs).toEqual([request.sourceRef]);
});

test.each(['committed','not-committed','terminal-failed'] as const)('an unknown %s save keeps its original intent through a changed output and requires confirmation plus explicit clear before another save',async outcome=>{
 const f=await fixture();await f.teach();const request=await f.source(),state=await f.read();let task=await f.core.getTask(f.owner.taskId),loseFirst=true;
 const store=new LearningDraftStore({directory:f.directory,lookupTask:async id=>(await f.core.listTasks()).find(item=>item.id===id)}),cache=createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)});await cache.load();
 const commands:Command[]=[],pending:Promise<unknown>[]=[],invoke=(command:Command)=>{commands.push(structuredClone(command));const promise=(async()=>{
  if(command.type==='helper.document.preview'){const {type,...input}=command;return previewDocumentRecipe(await f.core.getTask(command.taskId),input);}
  if(command.type==='helper.document.save'){const {type,...input}=command;if(loseFirst){loseFirst=false;if(outcome==='terminal-failed'){const run=f.core.runRequest.bind(f.core),failure=vi.spyOn(f.core,'runRequest').mockImplementationOnce((request,_runner,assertCurrent)=>run(request,async()=>{throw Error('Owned admitted document failure.');},assertCurrent));try{await legacyDocumentRecipeSave(f.core,input);}finally{failure.mockRestore();task=await f.core.getTask(command.taskId);}}if(outcome==='committed')await saveDocumentRecipe(f.core,input);task=await f.core.getTask(command.taskId);throw Error('Owned unknown save outcome.');}const saved=await saveDocumentRecipe(f.core,input);task=await f.core.getTask(command.taskId);return saved;}
  if(command.type==='helper.document.inspect'){const {type,...input}=command;return inspectDocumentRecipeSave(f.core,input);}
  throw Error('Unexpected operation');})();pending.push(promise);return promise;};vi.stubGlobal('window',{companion:{invoke}});
 const r=createControlledRenderer(()=>createElement(LearningDraftProvider,{cache,children:createElement(LearningDraftScope,{owner:f.owner,children:createElement(DocumentRecipeStudio,{state,task,draftOwner:f.owner,onAction:()=>{throw Error('Preview must not edit the recipe.');}})})}));
 const settle=async()=>{await Promise.allSettled(pending.splice(0));await new Promise<void>(resolve=>setImmediate(resolve));r.render();await cache.flush();};
 const select=(value:typeof request.sourceRef)=>{r.find(node=>node.type==='label'&&node.children.some(child=>child.type==='#text'&&text(child)==='Saved text source')).children.find(node=>node.type==='select')!.props.onChange({target:{value:JSON.stringify(value)}});r.render();};
 r.render();select(request.sourceRef);button(r,'Preview selected notes locally').props.onClick();await settle();button(r,'Save reviewed new document').props.onClick();await settle();const original=commands.find(command=>command.type==='helper.document.save')!;
 task=await f.core.putSource(f.owner.taskId,{id:request.sourceRef.sourceId,kind:'text',role:'fact',label:'Changed local notes',content:'Owner: Rowan\nNext: Changed valid output'});const source=task.sources.find(item=>item.id===request.sourceRef.sourceId)!,version=source.versions.at(-1)!;r.render();select({sourceId:source.id,version:version.version,digest:version.digest});button(r,'Preview selected notes locally').props.onClick();await settle();expect(text(r.find(node=>node.props['aria-label']==='Reviewed document preview'))).toContain('Next: Changed valid output');
 // Invoke the real handler even if the rendered button is disabled: the attempt fence must also guard dispatch.
 button(r,'Save reviewed new document').props.onClick();await settle();expect(task.artifacts.length).toBe(outcome==='committed'?2:1);expect(commands.filter(command=>command.type==='helper.document.save')).toHaveLength(1);expect(button(r,'Save reviewed new document').props.disabled).toBe(true);expect(r.nodes().some(node=>node.type==='button'&&text(node)==='Clear confirmed document save')).toBe(false);
 const originalStatus=r.find(node=>node.props['aria-label']==='Original document save');expect(text(originalStatus)).toContain('Fresh local notes · source version 1 · helper version 1');expect(text(originalStatus)).not.toContain('Changed local notes');
 button(r,'Check original document save').props.onClick();await settle();const inspected=commands.at(-1);if(original.type!=='helper.document.save')throw Error('Expected original save');const {type:_type,confirmed:_confirmed,...originalInspection}=original;expect(inspected).toEqual({type:'helper.document.inspect',...originalInspection});expect(button(r,'Save reviewed new document').props.disabled).toBe(true);expect(button(r,'Clear confirmed document save').props.disabled).toBe(false);
 expect(text(r.find(node=>node.props['aria-label']==='Original document save'))).toContain(outcome==='committed'?'That original document is saved.':outcome==='terminal-failed'?'Original save result: failed. No document was saved.':'No document was saved for that original preview.');button(r,'Clear confirmed document save').props.onClick();r.render();expect(r.nodes().some(node=>node.props['aria-label']==='Original document save')).toBe(false);expect(button(r,'Save reviewed new document').props.disabled).toBe(false);
 button(r,'Save reviewed new document').props.onClick();await settle();expect(commands.filter(command=>command.type==='helper.document.save')).toHaveLength(2);expect(task.artifacts).toHaveLength(outcome==='committed'?3:2);expect(task.artifacts.at(-1)?.revisions[0].content).toBe('Owner: Rowan\nNext: Changed valid output');expect(task.artifacts.at(-1)?.revisions[0].sourceRefs).toEqual([{sourceId:source.id,version:version.version,digest:version.digest}]);
});

test('a confirmed terminal failure offers an explicit same-preview retry and duplicate clicks create one output',async()=>{
 const f=await fixture();await f.teach();const request=await f.source(),state=await f.read();let task=await f.core.getTask(f.owner.taskId),failFirst=true;
 const store=new LearningDraftStore({directory:f.directory,lookupTask:async id=>(await f.core.listTasks()).find(item=>item.id===id)}),cache=createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)});await cache.load();
 const commands:Command[]=[],pending:Promise<unknown>[]=[],invoke=(command:Command)=>{commands.push(structuredClone(command));const promise=(async()=>{
  if(command.type==='helper.document.preview'){const {type,...input}=command;return previewDocumentRecipe(await f.core.getTask(command.taskId),input);}
  if(command.type==='helper.document.save'){const {type,...input}=command;if(failFirst){failFirst=false;const run=f.core.runRequest.bind(f.core),failure=vi.spyOn(f.core,'runRequest').mockImplementationOnce((request,_runner,assertCurrent)=>run(request,async()=>{throw Error('Owned admitted terminal failure.');},assertCurrent));try{return await legacyDocumentRecipeSave(f.core,input);}finally{failure.mockRestore();task=await f.core.getTask(command.taskId);}}const saved=await saveDocumentRecipe(f.core,input);task=await f.core.getTask(command.taskId);return saved;}
  if(command.type==='helper.document.inspect'){const {type,...input}=command;return inspectDocumentRecipeSave(f.core,input);}
  throw Error('Unexpected operation');})();pending.push(promise);return promise;};vi.stubGlobal('window',{companion:{invoke}});
 const r=createControlledRenderer(()=>createElement(LearningDraftProvider,{cache,children:createElement(LearningDraftScope,{owner:f.owner,children:createElement(DocumentRecipeStudio,{state,task,draftOwner:f.owner,onAction:()=>{throw Error('Retry must not edit the recipe.');}})})}));
 const settle=async()=>{await Promise.allSettled(pending.splice(0));await new Promise<void>(resolve=>setImmediate(resolve));r.render();await cache.flush();};
 r.render();r.find(node=>node.type==='label'&&node.children.some(child=>child.type==='#text'&&text(child)==='Saved text source')).children.find(node=>node.type==='select')!.props.onChange({target:{value:JSON.stringify(request.sourceRef)}});r.render();button(r,'Preview selected notes locally').props.onClick();await settle();button(r,'Save reviewed new document').props.onClick();await settle();
 expect(button(r,'Save reviewed new document').props.disabled).toBe(true);expect(r.nodes().some(node=>node.type==='button'&&text(node)==='Retry original document save')).toBe(false);button(r,'Check original document save').props.onClick();await settle();expect(text(r.find(node=>node.props['aria-label']==='Original document save'))).toContain('Original save result: failed. No document was saved.');
 expect(button(r,'Clear confirmed document save').props.disabled).toBe(true);button(r,'Clear confirmed document save').props.onClick();r.render();expect(r.find(node=>node.props['aria-label']==='Original document save')).toBeDefined();const retry=button(r,'Retry original document save');expect(retry.props.disabled).toBe(false);retry.props.onClick();retry.props.onClick();await settle();
 expect(commands.filter(command=>command.type==='helper.document.save')).toHaveLength(2);expect(commands.filter(command=>command.type==='helper.document.save')[1]).toEqual(commands.find(command=>command.type==='helper.document.save'));expect(task.artifacts).toHaveLength(2);expect(task.requests).toHaveLength(3);expect(task.requests.at(-1)).toMatchObject({id:expect.stringMatching(/-retry-1$/),status:'completed'});expect(task.artifacts.at(-1)?.revisions[0].content).toBe('Owner: Rowan\nNext: Inspect stock');expect(text(r.find(node=>node.props['aria-label']==='Original document save'))).toContain('That original document is saved.');
 button(r,'Clear confirmed document save').props.onClick();r.render();button(r,'Save reviewed new document').props.onClick();await settle();expect(task.artifacts).toHaveLength(2);expect(task.requests).toHaveLength(3);expect(await f.read()).toEqual(state);
});
