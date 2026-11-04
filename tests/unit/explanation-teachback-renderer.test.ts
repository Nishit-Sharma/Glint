import {afterEach,expect,it,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('../support/controlled-renderer.fixture')).hooks}));
vi.mock('../../src/renderer/src/components/ReadableText',async()=>{const {createElement}=await import('react');return {ReadableText:({text}:{text:string})=>createElement('div',{},text)};});
import {createElement} from 'react';
import {readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';
import {teachbackFixture} from '../support/explanation-teachback.fixture';
import {createLearningDrafts} from '../../src/renderer/src/learning-drafts';
import {LearningDraftStore} from '../../src/host/learning-drafts';
import {LearningDraftProvider} from '../../src/renderer/src/learning-draft-context';
import {ExplanationView} from '../../src/renderer/src/components/ExplanationView';
import {emptyTeachbackDraft,teachbackDraftBasis,teachbackSlot,type TeachbackOwner} from '../../src/shared/explanation-teachback';
const fixtures:Awaited<ReturnType<typeof teachbackFixture>>[]=[];afterEach(async()=>{for(const f of fixtures.splice(0)){await f.core.close();await rm(f.directory,{recursive:true,force:true});}});
const text=(node:any):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
function gate(){let enter!:()=>void,release!:()=>void;return {entered:new Promise<void>(done=>enter=done),waiting:new Promise<void>(done=>release=done),enter:()=>enter(),release:()=>release()};}
async function fixture(){
 const f=await teachbackFixture();fixtures.push(f);let cacheState:Partial<ReturnType<ReturnType<typeof createLearningDrafts>['getSnapshot']>>={};let task=await f.core.getTask(f.taskId),scope=0,current=true,lose=false,noDispatch=false,calls=0,stopIds:string[]=[],pause:ReturnType<typeof gate>|undefined,rawGate:ReturnType<typeof gate>|undefined;const store=new LearningDraftStore({directory:f.directory,lookupTask:async id=>(await f.core.listTasks()).find(task=>task.id===id)}),actualCache=createLearningDrafts({read:()=>store.read(),save:async(...args)=>{if(rawGate){rawGate.enter();await rawGate.waiting;}return store.save(...args);}}),cache={...actualCache,getSnapshot:()=>({...actualCache.getSnapshot(),...cacheState})};await cache.load();
 const owner:TeachbackOwner={kind:'explanation-teachback',taskId:task.id,artifactId:f.basis.artifactId,artifactRevision:f.basis.revision,artifactDigest:f.basis.digest},actions={isCurrent:()=>current,scope:()=>String(scope),runningRequestId:undefined as string|undefined,submit:async(requestId:string,input:any)=>{
  calls++;const persisted=JSON.parse(await readFile(join(f.directory,'learning-drafts.json'),'utf8'));expect(persisted.records.some((record:any)=>record.value&&JSON.parse(record.value.value).requestId===requestId&&JSON.parse(record.value.value).text===input.answer)).toBe(true);
  if(noDispatch){noDispatch=false;throw Error('Synthetic pre-dispatch rejection');}actions.runningRequestId=requestId;if(pause){pause.enter();await pause.waiting;}const result=await f.submit(requestId,input);actions.runningRequestId=undefined;if(lose){lose=false;return;}task=result.task;return task;
 },inspect:async()=>{task=await f.core.getTask(f.taskId);return task;},stop:(requestId:string)=>{stopIds.push(requestId);}};
 const render=createControlledRenderer(()=>{const artifact=task.artifacts.find(artifact=>artifact.id===f.basis.artifactId)!;return createElement(LearningDraftProvider,{cache,children:createElement(ExplanationView,{task,artifact,revision:artifact.revisions.at(-1)!,teachbackActions:actions})});});
 const button=(label:string)=>{render.render();return render.find(node=>node.type==='button'&&text(node)===label);},textarea=()=>{render.render();return render.find(node=>node.type==='textarea');};
 return {holdCache:(state:typeof cacheState)=>{cacheState=state;},f,cache,owner,render,button,textarea,actions,get task(){return task},get calls(){return calls},get stopIds(){return stopIds},raw:(slot=teachbackSlot())=>cache.readForm(owner,slot,emptyTeachbackDraft,teachbackDraftBasis(owner,slot)).value,changeScope:()=>{scope++;},leave:()=>{current=false;},return:()=>{current=true;scope++;},lose:()=>{lose=true;},noDispatch:()=>{noDispatch=true;},hold:()=>{pause=gate();return pause;},holdRaw:()=>{rawGate=gate();return rawGate;}};
}
it('keeps the existing check/answer, saves exact learner text before send, and supports one explicit second turn',async()=>{
 const f=await fixture();f.render.render();expect(f.render.nodes().some(node=>node.type==='summary'&&text(node)==='Show answer')).toBe(true);expect(f.calls).toBe(0);const input='  I predicted 10 but the water disappears.\n';f.textarea().props.onChange({target:{value:input}});await f.button('Get tentative feedback').props.onClick();expect(f.calls).toBe(1);expect(f.raw().text).toBe(input);expect(f.raw().requestId).not.toBe('');expect(f.task.artifacts.find(artifact=>artifact.id===f.f.basis.artifactId)!.revisions).toHaveLength(1);
 f.render.render();expect(f.render.nodes().some(node=>node.props['aria-label']==='Saved teach-back feedback')).toBe(true);expect(f.render.nodes().some(node=>node.type==='blockquote'&&text(node)===input)).toBe(true);f.textarea().props.onChange({target:{value:'Vapor is still water, so it was not destroyed.'}});await f.button('Get follow-up feedback').props.onClick();expect(f.calls).toBe(2);f.render.render();expect(f.render.nodes().filter(node=>node.type==='textarea')).toHaveLength(0);expect(f.render.nodes().some(node=>node.props['aria-label']==='Saved follow-up feedback')).toBe(true);
});
it('keeps a pre-dispatch retained intent recoverable by explicit same-ID retry without replacing input',async()=>{
 const f=await fixture();f.noDispatch();f.textarea().props.onChange({target:{value:'Water changes phase.'}});await f.button('Get tentative feedback').props.onClick();const retained=f.raw();expect(f.calls).toBe(1);await f.button('Check saved feedback').props.onClick();expect(f.calls).toBe(1);expect(f.raw()).toEqual(retained);await f.button('Retry exact feedback request').props.onClick();expect(f.calls).toBe(2);expect(f.raw()).toEqual(retained);expect(f.f.runnerCalls).toBe(1);
});
it('inspects lost completion without resend and same-ID duplicate dispatch cannot produce a second feedback',async()=>{
 const f=await fixture();f.lose();f.textarea().props.onChange({target:{value:'Water changes phase.'}});await f.button('Get tentative feedback').props.onClick();expect(f.f.runnerCalls).toBe(1);expect(f.calls).toBe(1);const retained=f.raw();await f.button('Retry exact feedback request').props.onClick();expect(f.f.runnerCalls).toBe(1);expect(f.raw()).toEqual(retained);expect(f.calls).toBe(2);
});
it('locks repeated submissions, binds Stop to the exact retained request, and retires captured callbacks',async()=>{
 const f=await fixture(),pause=f.hold();f.textarea().props.onChange({target:{value:'Water changes phase.'}});const send=f.button('Get tentative feedback'),pending=send.props.onClick();await pause.entered;await send.props.onClick();expect(f.calls).toBe(1);await f.button('Stop feedback').props.onClick();expect(f.stopIds).toEqual([f.raw().requestId]);const stop=f.button('Stop feedback');f.changeScope();await stop.props.onClick();expect(f.stopIds).toHaveLength(1);pause.release();await pending;f.render.render();expect(f.raw().text).toBe('Water changes phase.');
});
it('releases local operation state after a surface retires during raw flush, and retries only explicitly',async()=>{
 const f=await fixture();f.textarea().props.onChange({target:{value:'Water changes phase.'}});await f.cache.flushForm(f.owner,teachbackSlot());const rawGate=f.holdRaw(),pending=f.button('Get tentative feedback').props.onClick();await rawGate.entered;f.changeScope();rawGate.release();await pending;expect(f.calls).toBe(0);expect(f.button('Check saved feedback').props.disabled).toBe(false);const retained=f.raw();expect(retained.requestId).not.toBe('');await f.button('Retry exact feedback request').props.onClick();expect(f.calls).toBe(1);expect(f.raw()).toEqual(retained);
});
it('blocks old callbacks after navigation and keeps raw drafts visible after cache reload',async()=>{
 const f=await fixture();f.textarea().props.onChange({target:{value:'Unsure where the water went.\n'}});await f.cache.flushForm(f.owner,teachbackSlot());const send=f.button('Get tentative feedback');f.leave();await send.props.onClick();expect(f.calls).toBe(0);f.return();const store=new LearningDraftStore({directory:f.f.directory,lookupTask:async()=>f.task}),reloaded=createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)});await reloaded.load();expect(reloaded.readForm(f.owner,teachbackSlot(),emptyTeachbackDraft,teachbackDraftBasis(f.owner,teachbackSlot())).value.text).toBe('Unsure where the water went.\n');expect(f.calls).toBe(0);
});

it('rechecks cache readiness at dispatch after an initially ready callback awaited raw persistence',async()=>{
 const f=await fixture();f.textarea().props.onChange({target:{value:'Water changes phase.'}});await f.cache.flushForm(f.owner,teachbackSlot());const gate=f.holdRaw(),pending=f.button('Get tentative feedback').props.onClick();await gate.entered;f.holdCache({ready:false});gate.release();await pending;expect(f.calls).toBe(0);const retained=f.raw();f.holdCache({});await f.button('Retry exact feedback request').props.onClick();expect(f.calls).toBe(1);expect(f.raw()).toEqual(retained);
});

it.each([{frozen:true},{error:'Synthetic sidecar failure'},{ready:false}])('keeps exact Stop outside an effective disabled ancestry while sends remain held: %j',async state=>{
 const f=await fixture(),pause=f.hold();f.textarea().props.onChange({target:{value:'Water changes phase.'}});const sending=f.button('Get tentative feedback').props.onClick();await pause.entered;f.holdCache(state);const tree=f.render.render(),effective:Array<{label:string;disabled:boolean}>=[];
 const visit=(nodes:any[],ancestor=false)=>{for(const node of nodes){const inherited=ancestor||node.type==='fieldset'&&!!node.props.disabled;if(node.type==='button')effective.push({label:text(node),disabled:inherited||!!node.props.disabled});visit(node.children,inherited);}};visit(tree);
 expect(effective.find(button=>button.label==='Stop feedback')?.disabled).toBe(false);expect(effective.find(button=>button.label==='Get tentative feedback')?.disabled).toBe(true);const textarea=f.textarea();expect(textarea.props.disabled).toBe(true);textarea.props.onChange({target:{value:'Replacement while held'}});expect(f.raw().text).toBe('Water changes phase.');await f.button('Stop feedback').props.onClick();expect(f.stopIds).toEqual([f.raw().requestId]);expect(f.calls).toBe(1);f.holdCache({});pause.release();await sending;
});
