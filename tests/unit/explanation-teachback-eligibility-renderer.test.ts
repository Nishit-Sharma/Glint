import {expect,it,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('../support/controlled-renderer.fixture')).hooks}));
vi.mock('../../src/renderer/src/components/ReadableText',async()=>{const {createElement}=await import('react');return {ReadableText:({text}:{text:string})=>createElement('div',{},text)};});
import {createElement} from 'react';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../../src/core/companion';
import {EXPLANATION_MIME,parseExplanationModel} from '../../src/shared/explanation-modes';
import {TEACHBACK_TEXT_REQUIRED,emptyTeachbackDraft,teachbackSlot,teachbackDraftBasis,type TeachbackOwner} from '../../src/shared/explanation-teachback';
import {explanationProposal,explanationSource} from '../support/explanation.fixture';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';
import {LearningDraftStore} from '../../src/host/learning-drafts';
import {createLearningDrafts} from '../../src/renderer/src/learning-drafts';
import {LearningDraftProvider} from '../../src/renderer/src/learning-draft-context';
import {ExplanationView} from '../../src/renderer/src/components/ExplanationView';
const text=(node:any):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
it.each(['none','image','mixed'] as const)('explains %s eligibility before feedback, keeping retained raw answers and inspect available',async kind=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-teachback-eligibility-')),core=await createCompanion({dataDir:directory});
 try{
  const created=await core.createTask({title:'Deep explanation feedback'});
  if(kind!=='none')await core.putSource(created.id,{id:'visual',kind:'image',role:'fact',label:'Water image',content:'data:image/png;base64,aA=='});
  if(kind==='mixed')await core.putSource(created.id,{id:'science',kind:'text',role:'fact',label:'Water notes',content:explanationSource});
  const sourced=await core.getTask(created.id),versions=sourced.sources.map(source=>source.versions.at(-1)!),proposal=explanationProposal('deep',kind==='mixed'?'science':'visual'),explanation=parseExplanationModel(JSON.stringify({...proposal,...(kind==='none'?{answer:'Water becomes vapor.',citations:[]}:{})}),{depth:'deep',sources:versions,fallbackTitle:'Explanation'});
  const original=await core.runRequest({taskId:created.id,requestId:'deep',kind:'explain',prompt:'Explain evaporation.',sourceIds:versions.map(source=>source.id),explainDepth:'deep'},async()=>({title:explanation.title,content:JSON.stringify(explanation),mimeType:EXPLANATION_MIME}));expect(original.status).toBe('completed');
  const basis=original.answer!,task=await core.getTask(created.id),store=new LearningDraftStore({directory,lookupTask:id=>core.getTask(id)}),cache=createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)});await cache.load();
  const owner:TeachbackOwner={kind:'explanation-teachback',taskId:task.id,artifactId:basis.artifactId,artifactRevision:basis.revision,artifactDigest:basis.digest},slot=teachbackSlot(),draftBasis=teachbackDraftBasis(owner,slot),submit=vi.fn(),inspect=vi.fn(async()=>task),actions={isCurrent:()=>true,scope:()=>'',submit,inspect,stop:()=>{}};
  const render=createControlledRenderer(()=>{const artifact=task.artifacts.find(artifact=>artifact.id===basis.artifactId)!;return createElement(LearningDraftProvider,{cache,children:createElement(ExplanationView,{task,artifact,revision:artifact.revisions.at(-1)!,teachbackActions:actions})});});
  const button=(label:string)=>{render.render();return render.find(node=>node.type==='button'&&text(node)===label);};render.render();
  expect(cache.tryEdit(owner,slot,emptyTeachbackDraft,draftBasis,()=>({text:'  My exact unsure answer.\n',requestId:''})).kind).toBe('accepted');await cache.flushForm(owner,slot);
  const get=button('Get tentative feedback');expect(get.props.disabled).toBe(kind!=='mixed');
  if(kind==='mixed'){expect(render.nodes().some(node=>text(node)===TEACHBACK_TEXT_REQUIRED)).toBe(false);return;}
  expect(render.nodes().some(node=>node.props.role==='status'&&text(node)===TEACHBACK_TEXT_REQUIRED)).toBe(true);await get.props.onClick();expect(submit).not.toHaveBeenCalled();
  expect(cache.tryEdit(owner,slot,emptyTeachbackDraft,draftBasis,()=>({text:'  My exact unsure answer.\n',requestId:'retained-unconfirmed'})).kind).toBe('accepted');await cache.flushForm(owner,slot);
  const retry=button('Retry exact feedback request');expect(retry.props.disabled).toBe(true);await retry.props.onClick();expect(submit).not.toHaveBeenCalled();
  const check=button('Check saved feedback');expect(check.props.disabled).toBe(false);await check.props.onClick();expect(inspect).toHaveBeenCalledOnce();
  const reloaded=createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)});await reloaded.load();expect(reloaded.readForm(owner,slot,emptyTeachbackDraft,draftBasis).value).toEqual({text:'  My exact unsure answer.\n',requestId:'retained-unconfirmed'});expect(await core.getTask(task.id)).toEqual(task);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
