import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,beforeEach,expect,test} from 'vitest';
import {createCompanion,type Companion} from '../src/core/companion';
import {createGroundedJoinArtifact,localGroundedJoin,stageSafeModuleHistory} from '../src/core/grounded-join-host';
import {editModule,saveModuleDocument} from '../src/core/module-state';
import {readTaskArtifactText} from '../src/core/task-dialogue';
import {parseModuleAnswer} from '../src/core/interactive-modules';
import {groundedJoin,type GroundedJoinData,type GroundedJoinState} from '../src/learning/grounded-join';
import {extractionFixture} from './grounded-join-fixture';
import {exampleLesson} from '../src/learning/example';
import {MODULE_MIME} from '../src/shared/module-contract';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {GroundedJoin} from '../src/renderer/src/components/GroundedJoin';
import {moduleHistoryText,moduleText} from '../src/core/interactive-modules';

let root:string,core:Companion;
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'grounded-notes-'));core=await createCompanion({dataDir:root});});
afterEach(async()=>{await core.close();await rm(root,{recursive:true,force:true});});
async function fixture(cited=false,ambiguous=true){
 const f=extractionFixture(ambiguous,cited),task=await core.createTask({title:'Readable source notes'});
 await core.putSource(task.id,{kind:'text',role:'fact',label:'Synthetic member tables',content:f.content});
 const basis=await core.saveArtifact(task.id,{title:'Source brief',content:'Review the two supplied tables.'});
 const created=await createGroundedJoinArtifact(core,{taskId:task.id,requestId:'readable-notes',id:'readable-join',title:'Review the cited tables',version:1,basis:{artifactId:basis.artifactId,revision:1,digest:basis.revision.digest},proposal:f.proposal,transfer:f.transfer});
 const current=await core.getTask(task.id),artifact=current.artifacts.find(a=>a.id===created.artifactId)!;
 const data=parseModuleAnswer(JSON.parse(artifact.revisions[0].content)).modules[0].data as GroundedJoinData;
 return {taskId:task.id,data,target:{taskId:task.id,artifactId:artifact.id,artifactRevision:1,moduleId:'readable-join'}};
}
function assertHuman(text:string,data:GroundedJoinData){
 expect(text).toContain('Source 1 (cited text), version 1');
 expect(text).not.toContain('JSON.stringify');expect(text).not.toContain('sourceId');expect(text).not.toContain('contextDigest');
 expect(text).not.toContain('p-key');expect(text).not.toContain('practice-b');expect(text).not.toContain('citation-1');
 if(data.basis.kind==='observed-source'){
  for(const value of [data.basis.taskId,data.basis.artifact.artifactId,data.basis.artifact.digest,data.basis.contextDigest,...data.basis.sourceRefs.flatMap(r=>[r.sourceId,r.digest])])expect(text).not.toContain(value);
 }
}
test.each([false,true])('canonical notes/history keep readable mapping provenance, corrections and computed changes (cited=%s)',async cited=>{
 const f=await fixture(cited),reason='I supplied x; preserve my literal note {"sourceId":"user-note"}.';
 await editModule(core,{...f.target,action:{kind:'correct-cell',side:'left',rowId:'practice-b',columnId:'p-key',value:'x',reason,expectedRevision:0}});
 await editModule(core,{...f.target,action:{kind:'correct-keys',keys:{mode:'INNER',leftColumnId:'p-key',rightColumnId:'p-rkey'},reason:'I confirm equality on Team.',expectedRevision:1}});
 await editModule(core,{...f.target,action:{kind:'accept-extraction',expectedRevision:2}});
 await editModule(core,{...f.target,action:{kind:'lab',action:{kind:'set-mode',mode:'LEFT',expectedRevision:0},expectedRevision:3}});
 await editModule(core,{...f.target,action:{kind:'lab',action:{kind:'predict',count:4,reasoning:'Two duplicate matches per member.',expectedRevision:1},expectedRevision:4}});
 const task=await core.getTask(f.taskId),state=task.session!.moduleStates[0].state as GroundedJoinState;
 const text=groundedJoin.text(f.data,state);
 // User-authored JSON-looking text is preserved, never stripped by a generic ID/JSON regex.
 expect(text).toContain(reason);assertHuman(text.replace(reason,''),f.data);
 expect(text).toContain(cited?'Source-cited mapping':'Proposed assumption (no source citation)');
 expect(text).toContain(f.data.extraction.join.reason);expect(text).toContain('Your join correction: INNER equality on Members.Team = Invitations.Team');
 expect(text).toContain('Members row 2, Team');expect(text).toContain('Current join: LEFT equality on Members.Team = Invitations.Team');expect(text).toContain('5 output rows');expect(text).toContain('4 → 5 rows');
 expect(text).toContain('Members row 3 → Unmatched');expect(text).not.toContain('Shipments');
 const safe=readTaskArtifactText(task,f.target.artifactId,1);expect(safe.available).toBe(true);if(safe.available)expect(safe.text).toContain(text);
 expect(stageSafeModuleHistory(task,f.target.artifactId,1)).toContain(text);
 const saved=await saveModuleDocument(core,{...f.target,sessionRevision:task.session!.revision});
 const before=await core.getTask(f.taskId),notes=before.artifacts.find(a=>a.id===saved.artifactId)!.revisions[0];
 expect(notes.content).toContain(text);expect(notes.sourceRefs).toEqual(before.artifacts.find(a=>a.id===f.target.artifactId)!.revisions[0].sourceRefs);
 const originalDefinition=before.artifacts.find(a=>a.id===f.target.artifactId)!.revisions[0].content;
 await core.close();core=await createCompanion({dataDir:root});
 const restored=await core.getTask(f.taskId);expect(restored.artifacts.find(a=>a.id===f.target.artifactId)!.revisions[0].content).toBe(originalDefinition);
 const reopened=readTaskArtifactText(restored,saved.artifactId,1);expect(reopened.available).toBe(true);if(reopened.available)expect(reopened.text).toContain(text);
});
test('unresolved, transfer prediction and reviewed transfer notes disclose only their current stage',async()=>{
 const f=await fixture(),initial=groundedJoin.initial(f.data),pending=groundedJoin.text(f.data,initial);assertHuman(pending,f.data);
 expect(pending).toContain('Members row 2, Team: The key is unreadable');expect(pending).not.toContain('Shipments');expect(pending).not.toContain('output rows');
 let state=groundedJoin.update(f.data,initial,{kind:'correct-cell',side:'left',rowId:'practice-b',columnId:'p-key',value:'x',reason:'I supply x.',expectedRevision:0});
 state=groundedJoin.update(f.data,state,{kind:'accept-extraction',expectedRevision:1});
 state=groundedJoin.update(f.data,state,{kind:'lab',action:{kind:'set-mode',mode:'LEFT',expectedRevision:0},expectedRevision:2});
 state=groundedJoin.update(f.data,state,{kind:'lab',action:{kind:'predict',count:4,reasoning:'I forgot the unmatched member.',expectedRevision:1},expectedRevision:3});
 state=groundedJoin.update(f.data,state,{kind:'lab',action:{kind:'start-transfer',expectedRevision:2},expectedRevision:4});
 const transfer=groundedJoin.text(f.data,state);assertHuman(transfer,f.data);
 expect(transfer).toContain('Unseen synthetic transfer');expect(transfer).toContain('Shipments');expect(transfer).toContain('Predict the output row count');
 expect(transfer).toContain('Current join: LEFT equality on Shipments.Dock = Scans.Dock');
 expect(transfer).not.toContain('6 output rows');expect(transfer).not.toContain('Transfer score:');expect(transfer).not.toContain('transfer-a');
 expect(transfer).toContain('Prior practice prediction: 4; computed result: 5 rows. Incorrect.');expect(transfer).toContain('I forgot the unmatched member.');
 state=groundedJoin.update(f.data,state,{kind:'lab',action:{kind:'predict',count:5,reasoning:'My first attempt.',expectedRevision:3},expectedRevision:5});
 const reviewed=groundedJoin.text(f.data,state);assertHuman(reviewed,f.data);
 expect(reviewed).toContain('6 output rows');expect(reviewed).toContain('Transfer score: 0 / 1');expect(reviewed).toContain('My first attempt.');
 expect(reviewed).toContain('Prior practice prediction: 4; computed result: 5 rows. Incorrect.');expect(reviewed).toContain('I forgot the unmatched member.');
});
test('changed practice keys name the applied columns while preserving the original premise',async()=>{
 const f=await fixture();let state=groundedJoin.initial(f.data);
 state=groundedJoin.update(f.data,state,{kind:'correct-cell',side:'left',rowId:'practice-b',columnId:'p-key',value:'x',reason:'I supply x.',expectedRevision:0});
 state=groundedJoin.update(f.data,state,{kind:'accept-extraction',expectedRevision:1});
 state=groundedJoin.update(f.data,state,{kind:'lab',action:{kind:'set-keys',leftColumnId:'p-alt',rightColumnId:'p-ralt',expectedRevision:0},expectedRevision:2});
 const pending=groundedJoin.text(f.data,state);assertHuman(pending,f.data);
 expect(pending).toContain('Current join: INNER equality on Members.Color = Invitations.Color');
 expect(pending).toContain('Original join mapping: Proposed assumption (no source citation). INNER equality on Members.Team = Invitations.Team');
 expect(pending).not.toContain('6 output rows');expect(pending).not.toContain('Computed pairs:');
 state=groundedJoin.update(f.data,state,{kind:'lab',action:{kind:'predict',count:6,reasoning:'Compare the Color columns.',expectedRevision:1},expectedRevision:3});
 const revealed=groundedJoin.text(f.data,state);assertHuman(revealed,f.data);expect(revealed).toContain('6 output rows');
});
test('saved notes and reopened module keep the last applied5→4 cause distinct from reviewed practice4→4 and a changed source',async()=>{
 const f=await fixture();
 const actions=[
  {kind:'correct-cell',side:'left',rowId:'practice-b',columnId:'p-key',value:'x',reason:'User supplied x for the unreadable key.',expectedRevision:0},
  {kind:'accept-extraction',expectedRevision:1},
  {kind:'lab',action:{kind:'predict',count:4,reasoning:'Both reviewed x keys match twice.',expectedRevision:0},expectedRevision:2},
  {kind:'lab',action:{kind:'set-mode',mode:'LEFT',expectedRevision:1},expectedRevision:3},
  {kind:'lab',action:{kind:'predict',count:4,reasoning:'Forgot the NULL-key left row.',expectedRevision:2},expectedRevision:4},
  {kind:'lab',action:{kind:'edit-row',side:'left',rowId:'practice-b',values:['y','blue'],expectedRevision:3},expectedRevision:5},
  {kind:'lab',action:{kind:'predict',count:5,reasoning:'My last prediction before seeing the causal comparison.',expectedRevision:4},expectedRevision:6},
 ] as const;
 for(const action of actions)await editModule(core,{...f.target,action});
 const task=await core.getTask(f.taskId),state=task.session!.moduleStates[0].state as GroundedJoinState,view=groundedJoin.observe(f.data,state);
 expect(view.lab?.change).toMatchObject({originalCount:4,currentCount:4});expect(view.lab?.lastChange).toMatchObject({beforeCount:5,afterCount:4});
 const snapshot=await saveModuleDocument(core,{...f.target,sessionRevision:task.session!.revision}),saved=await core.getTask(f.taskId),notes=saved.artifacts.find(artifact=>artifact.id===snapshot.artifactId)!.revisions[0];
 expect(notes.content).toContain('Compared with reviewed practice: 4 → 4 rows');expect(notes.content).toContain('Last applied practice change: 5 → 4 output rows.');expect(notes.content).toContain('Members row 2, Team: "x" → "y".');expect(notes.content).toContain('before "x" matches Invitations row 1, Invitations row 2; 2 output row(s); after "y" has no equal non-NULL right key; 1 output row(s) because LEFT preserves');expect(notes.content).toContain('Unchanged output contributions: Members row 1, Members row 3.');expect(notes.content).toContain('Removed: Members row 2 → Invitations row 1.');expect(notes.content).toContain('Added: Members row 2 → No matching right row (NULL-extended).');expect(notes.content).toContain('Hypothetical local practice edits');expect(notes.content).not.toContain('Shipments');assertHuman(notes.content,f.data);
 const definition=saved.artifacts.find(artifact=>artifact.id===f.target.artifactId)!.revisions[0].content;
 await core.close();core=await createCompanion({dataDir:root});const reopened=await core.getTask(f.taskId);expect(reopened.session!.moduleStates).toEqual(saved.session!.moduleStates);expect(reopened.artifacts.find(artifact=>artifact.id===f.target.artifactId)!.revisions[0].content).toBe(definition);expect(reopened.artifacts.find(artifact=>artifact.id===snapshot.artifactId)!.revisions[0].content).toBe(notes.content);
 const readable=readTaskArtifactText(reopened,f.target.artifactId,1);expect(readable.available).toBe(true);if(readable.available)expect(readable.text).toContain('Last applied practice change: 5 → 4 output rows.');
 const sourceId=reopened.sources[0].id;await core.invalidateSource(f.taskId,sourceId,'Owned source changed after the saved comparison.');const stale=await core.getTask(f.taskId);await expect(editModule(core,{...f.target,action:{kind:'explanation-mode',mode:'deep',expectedRevision:state.revision}})).rejects.toThrow(/source changed|fresh capture/i);expect((await core.getTask(f.taskId)).session!.moduleStates).toEqual(stale.session!.moduleStates);expect((await core.getTask(f.taskId)).artifacts.find(artifact=>artifact.id===snapshot.artifactId)!.revisions[0].content).toBe(notes.content);
});
test('grounded saved notes distinguish an unmatched input edit from unchanged output and preserve genuine citations',async()=>{
 const f=await fixture();
 for(const action of [
  {kind:'correct-cell',side:'left',rowId:'practice-b',columnId:'p-key',value:'x',reason:'I supply the unreadable key.',expectedRevision:0},
  {kind:'accept-extraction',expectedRevision:1},
  {kind:'lab',action:{kind:'edit-row',side:'left',rowId:'practice-null',values:[null,'purple'],expectedRevision:0},expectedRevision:2},
  {kind:'lab',action:{kind:'predict',count:4,reasoning:'NULL remains unmatched under INNER.',expectedRevision:1},expectedRevision:3},
 ] as const)await editModule(core,{...f.target,action});
 const task=await core.getTask(f.taskId),saved=await saveModuleDocument(core,{...f.target,sessionRevision:task.session!.revision}),after=await core.getTask(f.taskId),notes=after.artifacts.find(artifact=>artifact.id===saved.artifactId)!.revisions[0].content;
 expect(notes).toContain('Members row 3, Color:');expect(notes).toContain('purple');expect(notes).toContain('Unchanged output contributions: Members row 1, Members row 2, Members row 3.');expect(notes).not.toContain('Unchanged left rows:');
 expect(notes).toContain('reviewed transcription and its citations are unchanged');expect(notes).toContain('Cited excerpts:');expect(notes).toContain('Source 1 (cited text), version 1');
});
type JoinOrigin='local-demo'|'observed-source'|'user-corrected';
async function originFixture(origin:JoinOrigin){
 let f:Awaited<ReturnType<typeof fixture>>;
 if(origin==='local-demo'){
  const data=localGroundedJoin(exampleLesson),task=await core.createTask({title:'Local worked join notes'});
  const artifact=await core.saveArtifact(task.id,{title:'Supplied local join',mimeType:MODULE_MIME,sourceRefs:[],content:JSON.stringify({schemaVersion:1,markdown:'Supplied local worked example.',modules:[{id:data.id,version:data.version,data,provenance:[]}]})});
  f={taskId:task.id,data,target:{taskId:task.id,artifactId:artifact.artifactId,artifactRevision:1,moduleId:data.id}};
 }else f=await fixture(true,origin==='user-corrected');
 return f;
}
test.each(['local-demo','observed-source','user-corrected'] as const)('actual %s saved notes use only the provenance supplied by their basis',async origin=>{
 const f=await originFixture(origin);
 const offset=origin==='user-corrected'?1:0;
 if(offset)await editModule(core,{...f.target,action:{kind:'correct-cell',side:'left',rowId:'practice-b',columnId:'p-key',value:'x',reason:'User supplies the unreadable key.',expectedRevision:0}});
 for(const action of [
  {kind:'accept-extraction',expectedRevision:offset},
  {kind:'lab',action:{kind:'set-mode',mode:'LEFT',expectedRevision:0},expectedRevision:offset+1},
  {kind:'lab',action:{kind:'predict',count:offset?5:4,reasoning:'LEFT retains unmatched rows.',expectedRevision:1},expectedRevision:offset+2},
 ] as const)await editModule(core,{...f.target,action});
 const task=await core.getTask(f.taskId),state=task.session!.moduleStates[0].state as GroundedJoinState;
 expect(groundedJoin.observe(f.data,state).origin).toBe(origin);
 const saved=await saveModuleDocument(core,{...f.target,sessionRevision:task.session!.revision}),after=await core.getTask(f.taskId),notes=after.artifacts.find(artifact=>artifact.id===saved.artifactId)!.revisions[0];
 const pending=groundedJoin.update(f.data,state,{kind:'lab',action:{kind:'start-transfer',expectedRevision:2},expectedRevision:state.revision});
 for(const text of [groundedJoin.text(f.data,state),notes.content,groundedJoin.text(f.data,pending)]){
  expect(text).toContain('Last applied practice change:');
  if(origin==='local-demo'){expect(text).not.toMatch(/the cited source|source transcription|reviewed transcription|Reviewed source practice|Review the cited transcription/i);expect(text).toContain('original supplied practice data is unchanged');expect(text).toContain('Local example; no source citations.');expect(text).not.toContain('reviewed transcription and its citations');}
  else{expect(text).toContain('reviewed transcription and its citations are unchanged');expect(text).toContain('Source 1 (cited text), version 1');expect(text).not.toContain('Local example; no source citations.');}
 }
 expect(notes.sourceRefs).toEqual(task.artifacts.find(artifact=>artifact.id===f.target.artifactId)!.revisions[0].sourceRefs);
 expect(f.data.citations.length===0).toBe(origin==='local-demo');
});
function stagedStates(data:GroundedJoinData,origin:JoinOrigin){
 let state=groundedJoin.initial(data);
 if(origin==='user-corrected')state=groundedJoin.update(data,state,{kind:'correct-cell',side:'left',rowId:'practice-b',columnId:'p-key',value:'x',reason:'User supplies the unreadable key.',expectedRevision:state.revision});
 const initial=state;
 state=groundedJoin.update(data,state,{kind:'accept-extraction',expectedRevision:state.revision});const accepted=state;
 state=groundedJoin.update(data,state,{kind:'lab',action:{kind:'set-mode',mode:'LEFT',expectedRevision:state.lab!.revision},expectedRevision:state.revision});const applied=state;
 state=groundedJoin.update(data,state,{kind:'lab',action:{kind:'predict',count:origin==='user-corrected'?5:4,reasoning:'LEFT preserves unmatched supplied rows.',expectedRevision:state.lab!.revision},expectedRevision:state.revision});const reviewed=state;
 state=groundedJoin.update(data,state,{kind:'lab',action:{kind:'start-transfer',expectedRevision:state.lab!.revision},expectedRevision:state.revision});const transferPending=state;
 state=groundedJoin.update(data,state,{kind:'lab',action:{kind:'predict',count:5,reasoning:'My first unseen attempt.',expectedRevision:state.lab!.revision},expectedRevision:state.revision});
 return {initial,accepted,applied,reviewed,transferPending,transferReviewed:state};
}
function renderGrounded(data:GroundedJoinData,state:GroundedJoinState){return renderToStaticMarkup(createElement(GroundedJoin,{data,state,status:{kind:'current'},onAction:()=>{throw Error('Rendering must not dispatch.');}}));}
test('actual edited local-grounded component does not claim a cited source or reviewed transcription',async()=>{
 const {data}=await originFixture('local-demo'),{reviewed}=stagedStates(data,'local-demo'),html=renderGrounded(data,reviewed);
 expect(html).toContain('These are hypothetical local experiment edits. The original supplied practice data is unchanged.');expect(html).not.toContain('The cited source and reviewed transcription are unchanged.');
});
test('actual edited local-grounded text does not call supplied practice a source transcription',async()=>{
 const {data}=await originFixture('local-demo'),{reviewed}=stagedStates(data,'local-demo'),text=groundedJoin.text(data,reviewed);
 expect(text).toContain('Hypothetical local experiment. These edits do not change the original supplied practice data.');expect(text).not.toContain('These edits do not change the source transcription.');
});
test.each(['local-demo','observed-source','user-corrected'] as const)('all %s stages keep actual component/text/history provenance consistent with the basis',async origin=>{
 const {data}=await originFixture(origin),states=stagedStates(data,origin),definition=JSON.stringify({schemaVersion:1,markdown:origin==='local-demo'?'Supplied local worked example.':'Supplied source review.',modules:[{id:data.id,version:data.version,data,provenance:[]}]});
 for(const [stage,state] of Object.entries(states)){
  expect(groundedJoin.observe(data,state).origin).toBe(origin);
  const projections=[groundedJoin.text(data,state),moduleText(data,state),moduleHistoryText(definition,()=>state)];
  for(const mode of ['quick','deep','visual'] as const)projections.push(renderGrounded(data,{...state,mode}));
  for(const text of projections){
   if(origin==='local-demo'){
    expect(text).not.toMatch(/the cited source|source transcription|reviewed transcription|Reviewed source practice|Review the cited transcription|Source-grounded join|Review table transcription|Later source corrections|Extracted Members|Accept reviewed extraction/i);
    expect(text).toContain(stage==='initial'?'supplied practice':stage==='accepted'?'practice':'practice');
   }else{
    expect(text).toMatch(/source|Source/);
    if(text.startsWith('<'))expect(text).toContain('A citation binds a transcription to that snapshot');
    else expect(text).toContain('Source 1 (cited text), version 1');
   }
   if(stage==='transferPending'){expect(text).not.toContain('6 output rows');expect(text).not.toContain('Transfer score:');}
   if(stage==='transferReviewed'){expect(text).toContain('6 output rows');expect(text).toContain('Transfer score: 0 / 1');}
  }
 }
});
