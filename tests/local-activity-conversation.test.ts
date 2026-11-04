import {afterEach,expect,test,vi} from 'vitest';
vi.mock('lucide-react',()=>({ArrowUpRight:()=>null}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('./controlled-renderer.fixture')).hooks}));
vi.mock('../src/renderer/src/components/ReadableText',async()=>{const {createElement}=await import('react');return {ReadableText:({text}:{text:string})=>createElement('pre',{},text)};});
vi.mock('../src/renderer/src/components/ReadyArtifact',async()=>{const {createElement}=await import('react');return {ReadyArtifact:({children}:{children:unknown})=>createElement('div',{},children as any)};});
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {createElement} from 'react';
import {saveSourceFormula} from '../src/core/source-formula-host';
import {Conversation} from '../src/renderer/src/components/Conversation';
import {taskSidebarPreview} from '../src/renderer/src/components/task-preview';
import {LOCAL_ACTIONS,localActivityLabel} from '../src/renderer/src/local-activity';
import type {ArtifactRevision,RequestRecord,Task} from '../src/core/types';
import {createControlledRenderer} from './controlled-renderer.fixture';
import {sourceFormulaFixture} from './source-formula.fixture';

const close:Array<()=>Promise<void>>=[];afterEach(async()=>{for(const f of close.splice(0))await f();});
function render(task:Task){const r=createControlledRenderer(()=>createElement(Conversation,{task,active:true,renderBrief:()=>null,onArtifact:()=>{},onConnection:()=>{},onAttemptConversation:()=>{},onPrepareFollowup:()=>{}}));r.render();return {r,text:r.nodes().filter(node=>node.type==='#text').map(node=>node.props.text).join(' ')};}
const time='2026-11-04T12:00:00.000Z';
function syntheticTask(requests:RequestRecord[],revisions:Record<string,ArtifactRevision>):Task{return {id:'owned-task',title:'Owned local actions',goal:'',status:'active',createdAt:time,updatedAt:time,sources:[],artifacts:Object.entries(revisions).map(([id,revision])=>({id,revisions:[revision]})),requests,procedures:[],checkpoints:[],actions:[],memory:{enabled:false}};}
const text=(title:string):ArtifactRevision=>({revision:1,title,mimeType:'text/plain',content:'Owned readable local result for '+title+'.',sourceRefs:[],digest:'owned-digest-'+title,createdAt:time});

test('every registered local action prompt is the exact fixed prompt a core host records',()=>{
 const files=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(join(dir,entry.name)):entry.name.endsWith('.ts')?[join(dir,entry.name)]:[]);
 const sources=[...files('src/core'),...files('src/learning')].map(path=>readFileSync(path,'utf8')).join('\n');
 for(const action of LOCAL_ACTIONS)expect(sources,action.prompt).toContain(action.prompt);
 expect(new Set(LOCAL_ACTIONS.map(action=>action.kind+'\n'+action.prompt)).size).toBe(LOCAL_ACTIONS.length);
});

test('a real saved source formula shows a readable activity line instead of a user bubble, and keeps its card and record',async()=>{
 const f=await sourceFormulaFixture();close.push(f.close);await saveSourceFormula(f.core,{input:f.input});
 const task=await f.core.getTask(f.task.id),request=task.requests[0],before=JSON.stringify(task);
 expect(request.prompt).toBe('Save the explicitly reviewed local source formula transcription.');
 const {r,text}=render(task);
 expect(text).toContain('Saved source formula');expect(text).not.toContain('Saved source formula · ');expect(text).not.toContain(request.prompt);expect(text).not.toContain('Response model');
 expect(r.nodes().some(node=>node.props.className==='conversation-question')).toBe(false);expect(r.nodes().some(node=>node.props['aria-label']==='Saved source formula')).toBe(true);
 expect(r.nodes().some(node=>node.type==='button'&&JSON.stringify(node).includes('Explore inputs and calculate'))).toBe(true);
 expect(taskSidebarPreview(task)).toBe('Saved source formula · Cost from a reviewed formula');expect(JSON.stringify(task)).toBe(before);
});

test('each registered action renders as an activity line; unfinished ones name the action; user text with the same kind stays a user bubble',()=>{
 const requests:RequestRecord[]=LOCAL_ACTIONS.map((action,index)=>({id:'local-'+index,kind:action.kind,prompt:action.prompt,digest:'d'+index,status:'completed',sourceRefs:[],startedAt:time,finishedAt:time,artifactId:'artifact-'+index,answer:{artifactId:'artifact-'+index,revision:1,digest:'owned-digest-Owned result '+index}}));
 const revisions=Object.fromEntries(LOCAL_ACTIONS.map((_,index)=>['artifact-'+index,text('Owned result '+index)]));
 const failed:RequestRecord={id:'failed-local',kind:'experiment',prompt:LOCAL_ACTIONS[0].prompt,digest:'df',status:'failed',sourceRefs:[],startedAt:time,finishedAt:time,error:'Synthetic local failure'};
 const user:RequestRecord={id:'user-create',kind:'create',prompt:'Create a local text helper for my own notes, please.',digest:'du',status:'completed',sourceRefs:[],startedAt:time,finishedAt:time,artifactId:'user-artifact',answer:{artifactId:'user-artifact',revision:1,digest:'owned-digest-User answer'}};
 const task=syntheticTask([...requests,failed,user],{...revisions,'user-artifact':text('User answer')}),before=JSON.stringify(task),{r,text:visible}=render(task);
 for(const [index,action] of LOCAL_ACTIONS.entries()){expect(visible,action.prompt).not.toContain(action.prompt);expect(localActivityLabel(task,requests[index])).toBe(`${action.verb.past} ${action.object}`);expect(localActivityLabel(task,requests[index],true)).toBe(`${action.verb.past} ${action.object} · Owned result ${index}`);expect(r.nodes().some(node=>node.type==='article'&&node.props['aria-label']===`${action.verb.past} ${action.object}`)).toBe(true);}
 expect(localActivityLabel(task,failed)).toBe('Save source formula');expect(visible).toContain('Save source formula');expect(localActivityLabel(task,{...failed,status:'running'})).toBe('Saving source formula…');
 expect(localActivityLabel(task,{...requests[0],responseModel:{} as RequestRecord['responseModel']})).toBeUndefined();
 const bubbles=r.nodes().filter(node=>node.props.className==='conversation-question');expect(bubbles).toHaveLength(1);expect(JSON.stringify(bubbles[0])).toContain(user.prompt);
 expect(r.nodes().filter(node=>node.type==='button'&&JSON.stringify(node).includes('Edit and ask again'))).toHaveLength(1);
 expect(localActivityLabel(task,user)).toBeUndefined();expect(localActivityLabel(task,{...requests[0],kind:'explain'})).toBeUndefined();expect(JSON.stringify(task)).toBe(before);
});
