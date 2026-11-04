import {legacyDocumentRecipeSave} from '../support/legacy-helper-report-publication.fixture';
import {afterEach,expect,test,vi} from 'vitest';
import {createCompanion} from '../../src/core/companion';
import {createLearningDrafts} from '../../src/renderer/src/learning-drafts';
import {SOURCE_FORMULA_DRAFT_SLOT,sourceFormulaDraftOwner,sourceFormulaDraftBasis,emptySourceFormulaDraft} from '../../src/shared/source-formula-draft';
import {documentRecipeFixture} from '../support/document-recipe.fixture';
import {createDocumentRecipe,saveDocumentRecipe,inspectDocumentRecipeSave} from '../../src/core/document-recipe-host';
import {previewDocumentRecipe,readDocumentRecipeRequest,readDocumentRecipeSave} from '../../src/shared/document-recipe';
import {moduleHistoryText,parseModelModule} from '../../src/core/interactive-modules';
import {savedHelpers} from '../../src/shared/saved-helpers';
import {LearningDraftStore} from '../../src/host/learning-drafts';
import {documentRecipeFormBasis} from '../../src/shared/document-recipe-raw';
import {navigationFormBasis} from '../../src/renderer/src/learning-draft-basis';
import {serializeLearningDraftJson} from '../../src/shared/learning-drafts';
import {projectTaskDialogue} from '../../src/core/task-dialogue';
import {taskContext} from '../../src/host/browser/coordinator';
const close:Array<()=>Promise<void>>=[];afterEach(async()=>{vi.restoreAllMocks();for(const dispose of close.splice(0))await dispose();});
async function fixture(){const f=await documentRecipeFixture();close.push(f.close);return f;}

test('host-created document recipe records real local edits, stays private and requires checked activation',async()=>{
 const f=await fixture(),before=await f.core.getTask(f.owner.taskId);await f.core.putSource(before.id,{kind:'text',role:'fact',label:'PRIVATE_UNSELECTED',content:'PRIVATE_NO_AUTOMATIC_ACCESS'});
 const again=await createDocumentRecipe(f.core,{taskId:before.id,requestId:'create-document-recipe'});expect(again.artifactId).toBe(f.owner.artifactId);expect(again.task.requests).toHaveLength(1);expect(again.task.artifacts[0].revisions[0].sourceRefs).toEqual([]);
 expect(()=>parseModelModule(f.data)).toThrow(/may only/);await f.teach();const task=await f.core.getTask(before.id),state=await f.read();
 expect(state.draft.observation?.steps).toHaveLength(4);expect(state.versions).toHaveLength(1);expect(savedHelpers([task])).toMatchObject([{name:'Handoff note',invocation:'Local document recipe',activeVersion:1}]);
 const text=moduleHistoryText(task.artifacts[0].revisions[0].content,()=>state);for(const privateText of ['Mira','Jules','PRIVATE','Handoff note','{{Owner}}'])expect(text).not.toContain(privateText);
});

test('full task and browser context projections exclude private document recording and saved-version values',async()=>{
 const f=await fixture(),privateText='PRIVATE_RECIPE_SENTINEL_703',field=`${privateText} field`,literal=`${privateText} layout: `;
 await f.act({kind:'document-recipe-start',name:`${privateText} name`,intent:`${privateText} intent`,input:`${field}: ${privateText} first`});
 await f.act({kind:'document-recipe-add',step:{kind:'text',text:literal}});await f.act({kind:'document-recipe-add',step:{kind:'field',name:field}});
 const assertContexts=async()=>{
  const task=await f.core.getTask(f.owner.taskId),state=await f.read(),dialogue=projectTaskDialogue(task,'next-context-request',[]),browser=taskContext(task,'next-context-request');
  // Prove a real owned state is present before checking its complete automatic-context projections.
  expect(JSON.stringify(state)).toContain(privateText);
  for(const projection of [dialogue,browser]){expect(projection).not.toContain(privateText);expect(projection).toContain('excluded');}
  expect(JSON.parse(dialogue)).toMatchObject({title:task.title,previousTurns:[{requestId:'create-document-recipe',status:'completed',answer:{available:true,content:{representation:'state-aware-readable-modules',text:expect.stringContaining('Local document recipe.')}}}],savedUserModuleChoices:[{artifactId:f.owner.artifactId,moduleId:f.owner.moduleId,state:{kind:'document-recipe',revision:state.revision},readable:{text:expect.stringContaining('Local document recipe.')}}]});
  expect(JSON.parse(browser)).toMatchObject({title:task.title,previousTurns:[{status:'completed',answerExcerpt:expect.stringContaining('Local document recipe.')}],currentUserModuleChoices:[{artifactId:f.owner.artifactId,moduleId:f.owner.moduleId,userStateRevision:state.revision,userEditedContent:expect.stringContaining('Local document recipe.')}]});
  return {state,dialogue,browser};
 };
 const recording=await assertContexts();expect(recording.state.recording).toMatchObject({input:`${field}: ${privateText} first`,steps:[{after:literal},{before:literal,after:`${literal}${privateText} first`}]});
 await f.act({kind:'document-recipe-finish'});await f.act({kind:'document-recipe-exception',contains:`${privateText} stop`,reason:`${privateText} reason`});
 await f.act({kind:'document-recipe-check',input:`${field}: ${privateText} second`,expected:{kind:'output',text:`${literal}${privateText} second`}});
 await f.act({kind:'document-recipe-check',input:`${privateText} stop\n${field}: ${privateText} second`,expected:{kind:'stopped'}});
 await f.act({kind:'document-recipe-save-version'});await f.act({kind:'document-recipe-activate',version:1});
 const saved=await assertContexts();expect(saved.state).toMatchObject({recording:null,activeVersion:1,versions:[{version:1,definition:{name:`${privateText} name`,intent:`${privateText} intent`,template:`${literal}{{${field}}}`,observation:{input:`${field}: ${privateText} first`},exceptions:[{contains:`${privateText} stop`,reason:`${privateText} reason`}],checks:[{expected:{text:`${literal}${privateText} first`}},{input:`${field}: ${privateText} second`,expected:{text:`${literal}${privateText} second`}},{expected:{kind:'stopped'}}]}}]});
 for(const projection of [saved.dialogue,saved.browser])expect(projection).toContain('active version 1');
 let requestHistory='';const result=await f.core.runRequest({taskId:f.owner.taskId,requestId:'next-context-request',kind:'explain',prompt:'Continue this task.',sourceIds:[]},async context=>{requestHistory=context.taskHistory??'';return {title:'Local projection check',content:'Synthetic local answer.'};});
 expect(result.status).toBe('completed');expect(requestHistory).toBe(saved.dialogue);expect(requestHistory).not.toContain(privateText);
});

test('preview is read-only and saving exactly one reviewed ordinary document binds source and helper identities',async()=>{
 const f=await fixture();await f.teach();const request=await f.source(),before=await f.core.getTask(request.taskId),preview=previewDocumentRecipe(before,request);expect(preview.result).toEqual({kind:'output',text:'Owner: Rowan\nNext: Inspect stock'});expect(await f.core.getTask(request.taskId)).toEqual(before);
 const acceptance={...request,binding:preview.binding,confirmed:'save-reviewed-new-document' as const},saved=await saveDocumentRecipe(f.core,acceptance),again=await saveDocumentRecipe(f.core,acceptance);expect(again).toEqual(saved);expect(saved.kind).toBe('saved');
 const task=await f.core.getTask(request.taskId);expect(task.artifacts).toHaveLength(2);const output=task.artifacts.find(item=>item.id!==request.artifactId)!.revisions[0];expect(output.content).toBe('Owner: Rowan\nNext: Inspect stock');expect(output.sourceRefs).toEqual([request.sourceRef]);expect(task.session?.moduleStates).toEqual(before.session?.moduleStates);
 expect(await inspectDocumentRecipeSave(f.core,{...request,binding:preview.binding})).toEqual(saved);expect(task.actions).toEqual([]);expect(task.requests).toHaveLength(2);
});

test('freshness, changed source, recipe edits and paused tasks refuse stale previews without changing outputs',async()=>{
 const f=await fixture();await f.teach();const request=await f.source(),preview=previewDocumentRecipe(await f.core.getTask(request.taskId),request),acceptance={...request,binding:preview.binding,confirmed:'save-reviewed-new-document' as const};
 await f.source('Owner: Rowan\nNext: Changed after preview');await expect(saveDocumentRecipe(f.core,acceptance)).rejects.toThrow(/source changed/);expect((await f.core.getTask(request.taskId)).artifacts).toHaveLength(1);
 const current=await f.source(),task=await f.core.getTask(current.taskId);await f.act({kind:'document-recipe-edit',name:'Changed draft',intent:'Explicit correction.',template:'{{Owner}}'});expect(()=>previewDocumentRecipe(task,{...current,stateRevision:999})).toThrow();const changed=await f.core.getTask(current.taskId);expect(()=>previewDocumentRecipe(changed,current)).toThrow(/active recipe changed/);
 await f.core.pause(current.taskId);expect(()=>previewDocumentRecipe({...task,status:'paused'},current)).toThrow(/resume/);await expect(f.act({kind:'document-recipe-activate',version:1})).rejects.toThrow(/Resume/);
});

test('stopped inputs have no savable output and uncertain-save inspection does not rerun a recipe',async()=>{
 const f=await fixture();await f.teach();const request=await f.source('PRIVATE\nOwner: Rowan\nNext: Inspect stock'),task=await f.core.getTask(request.taskId),preview=previewDocumentRecipe(task,request);
 expect(preview.result).toEqual({kind:'stopped',reason:'Keep private notes for review.'});await expect(saveDocumentRecipe(f.core,{...request,binding:preview.binding,confirmed:'save-reviewed-new-document'})).rejects.toThrow(/did not produce/);
 expect(await inspectDocumentRecipeSave(f.core,{...request,binding:preview.binding})).toEqual({kind:'not-saved',taskId:task.id,binding:preview.binding});expect(await f.core.getTask(task.id)).toEqual(task);
});

test('named module raw drafts admit exact complete forms and cannot cross into another module family',async()=>{
 const f=await fixture(),store=new LearningDraftStore({directory:f.directory,lookupTask:async id=>(await f.core.listTasks()).find(item=>item.id===id)}),read=await store.read();if(read.kind!=='available')throw Error('Owned store unavailable');
 const state=await f.read(),initial={input:'',expected:'',kind:'output'},current={input:'\0'.repeat(8000),expected:'\0'.repeat(20000),kind:'output'},policy='document-recipe-form' as const,value={initial:serializeLearningDraftJson(initial,policy),value:serializeLearningDraftJson(current,policy),basis:navigationFormBasis(null,{slot:'document-recipe:check',basisMode:'explicit',basis:documentRecipeFormBasis(state,'check')})};
 expect(await store.save(f.owner,'document-recipe:check',read.epoch,0,value)).toMatchObject({kind:'saved'});
 expect(()=>store.save(f.owner,'document-recipe:unknown',read.epoch,0,value)).toThrow();
 const again=await store.read();if(again.kind!=='available')throw Error();expect(JSON.parse(again.records[0].value!.value)).toEqual(current);
});

test('strict request schemas reject authority, output and unrelated-source additions',()=>{
 expect(()=>readDocumentRecipeRequest({})).toThrow();expect(()=>readDocumentRecipeSave({confirmed:true,output:'invented'})).toThrow();
});

test('an unrelated request using the same public save ID cannot masquerade as the reviewed document receipt',async()=>{
 const f=await fixture();await f.teach();const request=await f.source(),preview=previewDocumentRecipe(await f.core.getTask(request.taskId),request);
 await f.core.runRequest({taskId:request.taskId,requestId:`document-recipe-${preview.binding}`,kind:'create',prompt:'A different operation.',sourceIds:[]},async()=>({title:'Other output',content:'This is not the reviewed document.'}));
 await expect(inspectDocumentRecipeSave(f.core,{...request,binding:preview.binding})).rejects.toThrow(/different local operation/);
 await expect(saveDocumentRecipe(f.core,{...request,binding:preview.binding,confirmed:'save-reviewed-new-document'})).rejects.toThrow(/different local operation/);
});

test.each(['failed','cancelled','interrupted'] as const)('an exact admitted %s save can be inspected then explicitly retried once for the same valid preview',async status=>{
 const f=await fixture();await f.teach();const request=await f.source(),preview=previewDocumentRecipe(await f.core.getTask(request.taskId),request),inspection={...request,binding:preview.binding},acceptance={...inspection,confirmed:'save-reviewed-new-document' as const},run=f.core.runRequest.bind(f.core);let entered!:()=>void,release!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;}),held=new Promise<void>(resolve=>{release=resolve;});
 vi.spyOn(f.core,'runRequest').mockImplementationOnce((input,_runner,assertCurrent)=>run(input,async()=>{entered();if(status==='failed')throw Error('Owned admitted document failure.');await held;return {title:'Late ignored output',content:'Must not be committed.'};},assertCurrent));
 const saving=legacyDocumentRecipeSave(f.core,acceptance);const rejected=saving.catch(error=>error);await started;let reopened:Awaited<ReturnType<typeof createCompanion>>|undefined;
 try{
  if(status==='cancelled')await f.core.cancelRequest(request.taskId,`document-recipe-${preview.binding}`);
  if(status==='interrupted'){await f.core.close();reopened=await createCompanion({dataDir:f.directory});}
  release();expect(await rejected).toBeInstanceOf(Error);const core=reopened??f.core,task=await core.getTask(request.taskId),original=task.requests.find(item=>item.id===`document-recipe-${preview.binding}`)!;
  expect(original.status).toBe(status);expect(original.answer).toBeUndefined();expect(original.artifactId).toBeUndefined();expect(task.artifacts).toHaveLength(1);
  await expect(inspectDocumentRecipeSave(core,inspection)).resolves.toEqual({kind:'not-saved',taskId:request.taskId,binding:preview.binding,terminalStatus:status});expect(await core.getTask(request.taskId)).toEqual(task);
  // Two concurrent explicit retries choose one successor ID; a completed series never creates another output.
  const retries=await Promise.allSettled([saveDocumentRecipe(core,acceptance),saveDocumentRecipe(core,acceptance)]);expect(retries.some(item=>item.status==='fulfilled')).toBe(true);
  const after=await core.getTask(request.taskId);expect(after.artifacts).toHaveLength(2);expect(after.requests).toHaveLength(3);expect(after.requests.find(item=>item.id===original.id)).toEqual(original);expect(after.requests.at(-1)).toMatchObject({id:`document-recipe-${preview.binding}-retry-1`,status:'completed'});expect(after.artifacts.at(-1)?.revisions[0].content).toBe('Owner: Rowan\nNext: Inspect stock');expect(after.artifacts.at(-1)?.revisions[0].sourceRefs).toEqual([request.sourceRef]);
  const saved=await inspectDocumentRecipeSave(core,inspection);expect(saved.kind).toBe('saved');expect(await saveDocumentRecipe(core,acceptance)).toEqual(saved);expect(await core.getTask(request.taskId)).toEqual(after);
 }finally{release();await rejected;await reopened?.close();}
});

test('an admitted running document save remains unconfirmed until a real terminal outcome',async()=>{
 const f=await fixture();await f.teach();const request=await f.source(),preview=previewDocumentRecipe(await f.core.getTask(request.taskId),request),inspection={...request,binding:preview.binding},run=f.core.runRequest.bind(f.core);let entered!:()=>void,release!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;}),held=new Promise<void>(resolve=>{release=resolve;});
 vi.spyOn(f.core,'runRequest').mockImplementationOnce((input,_runner,assertCurrent)=>run(input,async()=>{entered();await held;return {title:'Cancelled late output',content:'Must not be committed.'};},assertCurrent));
 const saving=legacyDocumentRecipeSave(f.core,{...inspection,confirmed:'save-reviewed-new-document'}),rejected=saving.catch(error=>error);await started;
 try{const before=await f.core.getTask(request.taskId);expect(before.requests.at(-1)?.status).toBe('running');await expect(inspectDocumentRecipeSave(f.core,inspection)).rejects.toThrow(/not confirmed/);await expect(saveDocumentRecipe(f.core,{...inspection,confirmed:'save-reviewed-new-document'})).rejects.toThrow(/not confirmed/);expect(await f.core.getTask(request.taskId)).toEqual(before);}
 finally{await f.core.cancelRequest(request.taskId,`document-recipe-${preview.binding}`);release();await rejected;}
});

test.each(['gap','wrong-digest','after-completed'] as const)('a %s retry history cannot admit another recipe output',async history=>{
 const f=await fixture();await f.teach();const request=await f.source(),preview=previewDocumentRecipe(await f.core.getTask(request.taskId),request),inspection={...request,binding:preview.binding},acceptance={...inspection,confirmed:'save-reviewed-new-document' as const};
 if(history==='wrong-digest'){const run=f.core.runRequest.bind(f.core);vi.spyOn(f.core,'runRequest').mockImplementationOnce((input,_runner,assertCurrent)=>run(input,async()=>{throw Error('Owned terminal predecessor.');},assertCurrent));await expect(legacyDocumentRecipeSave(f.core,acceptance)).rejects.toThrow();}
 if(history==='after-completed')await saveDocumentRecipe(f.core,acceptance);
 await f.core.runRequest({taskId:request.taskId,requestId:`document-recipe-${preview.binding}-retry-1`,kind:'create',prompt:'Different local operation.',sourceIds:[]},async()=>({title:'Unrelated output',content:'This does not belong to the reviewed recipe.'}));
 const before=await f.core.getTask(request.taskId);await expect(inspectDocumentRecipeSave(f.core,inspection)).rejects.toThrow(/save history|different local operation/);await expect(saveDocumentRecipe(f.core,acceptance)).rejects.toThrow(/save history|different local operation/);expect(await f.core.getTask(request.taskId)).toEqual(before);
});

test('two successive verified terminal attempts admit one deterministic retry-2 output and completed replay',async()=>{
 const f=await fixture();await f.teach();const request=await f.source(),preview=previewDocumentRecipe(await f.core.getTask(request.taskId),request),inspection={...request,binding:preview.binding},acceptance={...inspection,confirmed:'save-reviewed-new-document' as const},base=`document-recipe-${preview.binding}`,run=f.core.runRequest.bind(f.core),admission=vi.spyOn(f.core,'runRequest');
 for(let attempt=0;attempt<2;attempt++){
  admission.mockImplementationOnce((input,_runner,assertCurrent)=>run(input,async()=>{throw Error(`Owned terminal attempt ${attempt}.`);},assertCurrent));await expect(legacyDocumentRecipeSave(f.core,acceptance)).rejects.toThrow();const failed=await f.core.getTask(request.taskId);
  expect(failed.artifacts).toHaveLength(1);expect(failed.requests.at(-1)).toMatchObject({id:attempt===0?base:base+'-retry-1',status:'failed'});expect(failed.requests.at(-1)?.answer).toBeUndefined();expect(failed.requests.at(-1)?.artifactId).toBeUndefined();
  await expect(inspectDocumentRecipeSave(f.core,inspection)).resolves.toEqual({kind:'not-saved',taskId:request.taskId,binding:preview.binding,terminalStatus:'failed'});expect(await f.core.getTask(request.taskId)).toEqual(failed);
 }
 const terminals=(await f.core.getTask(request.taskId)).requests.filter(item=>item.id.startsWith(base)),saved=await saveDocumentRecipe(f.core,acceptance),after=await f.core.getTask(request.taskId);expect(saved.kind).toBe('saved');expect(after.artifacts).toHaveLength(2);expect(after.requests).toHaveLength(4);expect(after.requests.filter(item=>item.id.startsWith(base)).map(item=>({id:item.id,status:item.status}))).toEqual([{id:base,status:'failed'},{id:base+'-retry-1',status:'failed'},{id:base+'-retry-2',status:'completed'}]);
 expect(after.requests.filter(item=>terminals.some(original=>original.id===item.id))).toEqual(terminals);expect(after.artifacts.at(-1)?.revisions[0].content).toBe('Owner: Rowan\nNext: Inspect stock');expect(after.artifacts.at(-1)?.revisions[0].sourceRefs).toEqual([request.sourceRef]);
 expect(await inspectDocumentRecipeSave(f.core,inspection)).toEqual(saved);expect(await saveDocumentRecipe(f.core,acceptance)).toEqual(saved);expect(await f.core.getTask(request.taskId)).toEqual(after);
});

test('formula and document-recipe owners in one task restore and acknowledge independently in the same sidecar',async()=>{
 const f=await fixture(),before=await f.core.getTask(f.owner.taskId),state=await f.read(),store=new LearningDraftStore({directory:f.directory,lookupTask:async id=>(await f.core.listTasks()).find(item=>item.id===id)}),makeCache=()=>createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)}),formulaOwner=sourceFormulaDraftOwner(f.owner.taskId),formulaInitial={...emptySourceFormulaDraft},formulaBasis=sourceFormulaDraftBasis(SOURCE_FORMULA_DRAFT_SLOT),formulaRaw={...formulaInitial,formula:'cost = rate *',correctionReason:'  Keep this unfinished formula review.\n  '},slot='document-recipe:sample',initial={name:state.draft.name,intent:state.draft.intent,input:'Owner: Mira\nStatus: Ready\nNext: Ship samples'},basis=navigationFormBasis(null,{slot,basisMode:'explicit',basis:documentRecipeFormBasis(state,'sample')}),raw={...initial,name:'Unapplied document layout',input:'Owner: Mira\nNext: Keep these notes'};
 const first=makeCache();await first.load();expect(first.tryEdit(formulaOwner,SOURCE_FORMULA_DRAFT_SLOT,formulaInitial,formulaBasis,()=>formulaRaw)).toMatchObject({kind:'accepted'});expect(first.tryEdit(f.owner,slot,initial,basis,()=>raw)).toMatchObject({kind:'accepted'});await first.flush();
 const restored=makeCache();await restored.load();expect(restored.readForm(formulaOwner,SOURCE_FORMULA_DRAFT_SLOT,formulaInitial,formulaBasis)).toMatchObject({status:'ready',value:formulaRaw});expect(restored.readForm(f.owner,slot,initial,basis)).toMatchObject({status:'ready',value:raw});const documentToken=restored.capture(f.owner,slot);if(!documentToken)throw Error('Missing owned document token');expect(restored.acknowledge(documentToken)).toBe(true);await restored.flush();
 const afterDocument=await store.read();if(afterDocument.kind!=='available')throw Error('Owned sidecar unavailable');expect(afterDocument.records).toHaveLength(2);expect(afterDocument.records.find(record=>record.slot===SOURCE_FORMULA_DRAFT_SLOT)?.value?.value).toBe(serializeLearningDraftJson(formulaRaw));expect(afterDocument.records.find(record=>record.slot===slot)?.value).toBeNull();expect(restored.readForm(formulaOwner,SOURCE_FORMULA_DRAFT_SLOT,formulaInitial,formulaBasis)).toMatchObject({status:'ready',value:formulaRaw});
 const newer={...raw,input:'Owner: Jules\nNext: Keep the newer document notes'};expect(restored.tryEdit(f.owner,slot,initial,basis,()=>newer)).toMatchObject({kind:'accepted'});await restored.flush();const again=makeCache();await again.load();expect(again.readForm(f.owner,slot,initial,basis)).toMatchObject({status:'ready',value:newer});expect(again.readForm(formulaOwner,SOURCE_FORMULA_DRAFT_SLOT,formulaInitial,formulaBasis)).toMatchObject({status:'ready',value:formulaRaw});const formulaToken=again.capture(formulaOwner,SOURCE_FORMULA_DRAFT_SLOT);if(!formulaToken)throw Error('Missing owned formula token');expect(again.acknowledge(formulaToken)).toBe(true);await again.flush();
 const final=makeCache();await final.load();expect(final.readForm(formulaOwner,SOURCE_FORMULA_DRAFT_SLOT,formulaInitial,formulaBasis)).toMatchObject({status:'ready',value:formulaInitial});expect(final.readForm(f.owner,slot,initial,basis)).toMatchObject({status:'ready',value:newer});const saved=await store.read();if(saved.kind!=='available')throw Error('Owned sidecar unavailable');expect(saved.records.find(record=>record.slot===SOURCE_FORMULA_DRAFT_SLOT)?.value).toBeNull();expect(saved.records.find(record=>record.slot===slot)?.value?.value).toBe(serializeLearningDraftJson(newer,'document-recipe-form'));expect(await f.core.getTask(f.owner.taskId)).toEqual(before);
});
