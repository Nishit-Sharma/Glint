import {afterEach,expect,test,vi} from 'vitest';
vi.mock('lucide-react',()=>({ArrowUpRight:()=>null}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('./controlled-renderer.fixture')).hooks}));
vi.mock('../src/renderer/src/components/ReadableText',async()=>{const {createElement}=await import('react');return {ReadableText:({text}:{text:string})=>createElement('pre',{},text)};});
vi.mock('../src/renderer/src/components/ReadyArtifact',async()=>{const {createElement}=await import('react');return {ReadyArtifact:({children}:{children:unknown})=>createElement('div',{},children as any)};});
import {createElement} from 'react';
import {saveSourceFormula} from '../src/core/source-formula-host';
import {EXPERIMENT_RUN_MIME,savedExperimentRunActivity,reviewedExperimentRun} from '../src/learning/experiment-runs';
import {Conversation} from '../src/renderer/src/components/Conversation';
import {taskSidebarPreview} from '../src/renderer/src/components/task-preview';
import type {Task} from '../src/core/types';
import {createControlledRenderer} from './controlled-renderer.fixture';
import {savedRunFixture,leaked} from './experiment-run-conversation.fixture';

const close:Array<()=>Promise<void>>=[];afterEach(async()=>{for(const f of close.splice(0))await f();});
const savedRun=()=>savedRunFixture(close);
const visible=(r:ReturnType<typeof createControlledRenderer>)=>r.nodes().filter(node=>node.type==='#text').map(node=>node.props.text).join(' ');
function renderConversation(task:Task,onArtifact=vi.fn()){const r=createControlledRenderer(()=>createElement(Conversation,{task,active:true,renderBrief:()=>null,onArtifact,onConnection:()=>{}}));r.render();return r;}

test('a real saved run is a readable activity line, not a user turn with its JSON packet, and opens the exact saved record',async()=>{
 const {task,request,artifact}=await savedRun(),stored=artifact.revisions[0].content,before=JSON.stringify(task),onArtifact=vi.fn();
 expect(JSON.parse(stored)).toMatchObject({format:'experiment-run-v1',requestId:request.id});expect(request.prompt).toBe('Save an explicitly requested deterministic experiment run.');
 const r=renderConversation(task,onArtifact),text=visible(r);
 expect(leaked(text)).toEqual([]);
 expect(text).toContain('Saved calculation run · 22 USD');expect(text).toContain('Cost from a reviewed formula · compared with 14 USD');
 expect(r.nodes().some(node=>node.props['aria-label']==='Saved calculation run · 22 USD')).toBe(true);
 expect(r.nodes().some(node=>typeof node.props.className==='string'&&node.props.className.includes('conversation-question')&&JSON.stringify(node).includes('experiment run'))).toBe(false);
 r.find(node=>node.type==='button'&&node.props['data-view-focus']==='artifact:'+artifact.id).props.onClick();
 expect(onArtifact).toHaveBeenCalledTimes(1);expect(onArtifact.mock.calls[0][0].revisions).toEqual([artifact.revisions[0]]);
 expect(reviewedExperimentRun(task,artifact.id,artifact.revisions[0]).result).toMatchObject({value:22,unit:'USD'});
 expect(taskSidebarPreview(task)).toBe('Saved calculation run · 22 USD');
 expect(JSON.stringify(task)).toBe(before);expect(artifact.revisions[0].content).toBe(stored);
});

test('stored runs that no longer verify render a short inspection line without their bytes; records stay unchanged',async()=>{
 const {task,request,artifact}=await savedRun(),revision=artifact.revisions[0];revision.content=revision.content.replace('"value":22','"value":99');
 const before=JSON.stringify(task),activity=savedExperimentRunActivity(task,request);
 expect(activity).toMatchObject({reviewed:false,label:'Saved calculation run',artifactId:artifact.id});
 const text=visible(renderConversation(task));expect(leaked(text)).toEqual([]);expect(text).toContain('This record needs inspection. Its original content is kept.');expect(text).not.toContain('99 USD');
 expect(JSON.stringify(task)).toBe(before);
});

test('only the saved-run format becomes a run card; another format under the fixed run prompt keeps its answer under a plain activity line',async()=>{
 const {task,request,artifact}=await savedRun(),revision=artifact.revisions[0];
 const plain={...task,artifacts:task.artifacts.map(item=>item.id===artifact.id?{...item,revisions:[{...revision,mimeType:'text/plain',content:'Ordinary readable answer.'}]}:item)};
 expect(savedExperimentRunActivity(plain,request)).toBeUndefined();
 const r=renderConversation(plain),text=visible(r);expect(text).toContain('Ordinary readable answer.');expect(r.nodes().some(node=>node.props.className==='conversation-artifact conversation-activity')).toBe(false);expect(text).toContain('Saved calculation run');expect(text).not.toContain('Saved calculation run · '+revision.title);expect(text).not.toContain(request.prompt);
 expect(savedExperimentRunActivity(task,{...request,kind:'explain'})).toBeUndefined();expect(EXPERIMENT_RUN_MIME).toBe(revision.mimeType);
});
