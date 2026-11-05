import {expect,test,vi} from 'vitest';
vi.mock('lucide-react',()=>({ArrowUpRight:()=>null}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('../support/controlled-renderer.fixture')).hooks}));
vi.mock('../../src/renderer/src/components/ReadyArtifact',async()=>{const {createElement}=await import('react');return {ReadyArtifact:({children}:{children:unknown})=>createElement('div',{},children as any)};});
import {createElement} from 'react';
import {readScreenBrief} from '../../src/core/screen-brief';
import {saveSourceFormula} from '../../src/core/source-formula-host';
import {Conversation} from '../../src/renderer/src/components/Conversation';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';
import {sourceFormulaFixture} from '../support/source-formula.fixture';
const renderText=(element:ReturnType<typeof createElement>)=>{const r=createControlledRenderer(()=>element);r.render();return r.nodes().filter(node=>node.type==='#text').map(node=>node.props.text).join(' ');};

test('real saved formula appears as an experiment card bound to its original request revision',async()=>{
 const f=await sourceFormulaFixture();
 try{
  const saved=await saveSourceFormula(f.core,{input:f.input}),task=await f.core.getTask(f.task.id),artifact=task.artifacts.find(item=>item.id===saved.artifactId)!,original=artifact.revisions[0];
  const bytes=original.content;artifact.revisions.push({...original,revision:2,title:'Later revision',content:'LATER_PRIVATE_SENTINEL',digest:'later-digest'});
  const before=JSON.stringify(task),onArtifact=vi.fn(),r=createControlledRenderer(()=>createElement(Conversation,{task,active:true,renderBrief:()=>null,onArtifact,onConnection:()=>{}}));r.render();
  const card=r.find(node=>node.type==='button'&&node.props['data-view-focus']==='artifact:'+artifact.id);expect(JSON.stringify(card)).toContain(f.input.title);expect(JSON.stringify(card)).toContain('Explore inputs and calculate');const visible=r.nodes().filter(node=>node.type==='#text').map(node=>node.props.text).join(' ');expect(visible).not.toContain('source-formula-v1');expect(visible).not.toContain('LATER_PRIVATE_SENTINEL');
  card.props.onClick();expect(onArtifact).toHaveBeenCalledTimes(1);expect(onArtifact.mock.calls[0][0].revisions).toEqual([original]);expect(original.content).toBe(bytes);expect(JSON.stringify(task)).toBe(before);
 }finally{await f.close();}
});

test('malformed source-formula bytes are not rendered as conversation text',async()=>{
 const f=await sourceFormulaFixture();
 try{
  const saved=await saveSourceFormula(f.core,{input:f.input}),task=await f.core.getTask(f.task.id),revision=task.artifacts.find(item=>item.id===saved.artifactId)!.revisions[0];revision.content='MALFORMED_PRIVATE_SENTINEL';
  const before=JSON.stringify(task),html=renderText(createElement(Conversation,{task,active:true,renderBrief:()=>null,onArtifact:()=>{},onConnection:()=>{}}));
  expect(html).toContain('This saved formula needs a check.');expect(html).toContain('Nothing in it was changed.');expect(html).not.toContain('Open '+f.input.title);expect(html).not.toContain('MALFORMED_PRIVATE_SENTINEL');expect(JSON.stringify(task)).toBe(before);
 }finally{await f.close();}
});


test('formula MIME takes precedence over a valid but unrelated screen-brief envelope',async()=>{
 const f=await sourceFormulaFixture();try{
  const saved=await saveSourceFormula(f.core,{input:f.input}),task=await f.core.getTask(f.task.id),revision=task.artifacts.find(item=>item.id===saved.artifactId)!.revisions[0];revision.content=JSON.stringify({schemaVersion:1,kind:'screen-brief',insight:'UNRELATED_BRIEF_SENTINEL',actions:[]});expect(readScreenBrief(revision.content,revision.sourceRefs)).toBeDefined();const renderBrief=vi.fn(()=>createElement('p',{},'UNRELATED_BRIEF_SENTINEL'));const html=renderText(createElement(Conversation,{task,active:true,renderBrief,onArtifact:()=>{},onConnection:()=>{}}));expect(renderBrief).not.toHaveBeenCalled();expect(html).toContain('This saved formula needs a check.');expect(html).not.toContain('UNRELATED_BRIEF_SENTINEL');
 }finally{await f.close();}
});
