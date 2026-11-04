import {afterEach,expect,it,vi} from 'vitest';
vi.mock('../src/renderer/src/components/GeneratedSurface',async()=>{const {createElement}=await import('react');return {GeneratedSurface:({children}:{children:unknown})=>createElement('div',{},children as any)};});
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createCompanion,type Companion} from '../src/core/companion';
import {Conversation} from '../src/renderer/src/components/Conversation';
import {savedDocumentDraftBasis} from '../src/shared/saved-document-draft';
import {DOCUMENT_SUGGESTIONS_MIME,finishDocumentSuggestions} from '../src/shared/document-edit-suggestions';
import {TEACHBACK_MIME} from '../src/shared/explanation-teachback';
import type {Task} from '../src/core/types';
import {teachbackFixture} from './explanation-teachback.fixture';
import {CompactCompanion} from '../src/renderer/src/components/CompactCompanion';
import {structuredAnswerAction} from '../src/renderer/src/answer-summary';
import {localActivityLabel} from '../src/renderer/src/local-activity';

/** Model answers whose saved form is a host-owned JSON packet: the conversation shows readable text, never the packet. */
const cleanups:Array<()=>Promise<void>>=[];afterEach(async()=>{for(const f of cleanups.splice(0))await f();});
const compact=(task:Task)=>renderToStaticMarkup(createElement(CompactCompanion,{task,active:false,loaded:true,busy:false,running:false,anyRunning:false,error:'',notice:'',character:null,composer:null,onWorkspace:()=>{},onReviewSource:()=>{},onArtifact:()=>{},onRefresh:()=>{},onCaptureAttached:()=>{},onCollapse:()=>{},onStop:()=>{},onDismissError:()=>{},onStartContext:()=>{},onSourceSelection:()=>{}}));
const render=(task:Task)=>renderToStaticMarkup(createElement(Conversation,{task,active:true,renderBrief:()=>null,onArtifact:()=>{},onConnection:()=>{}}));
const packet=(html:string)=>['{&quot;','&quot;kind&quot;','explanation-teachback','document-edit-suggestions','schemaVersion','&quot;requestId&quot;'].filter(fragment=>html.includes(fragment));

it('a real completed teach-back turn shows the learner answer and readable feedback, never its JSON record',async()=>{
 const f=await teachbackFixture();cleanups.push(async()=>{await f.core.close();await rm(f.directory,{recursive:true,force:true});});
 const parent=await f.readyParent(),task=await f.core.getTask(f.taskId),request=task.requests.find(item=>item.id==='first-teachback')!,artifact=task.artifacts.find(item=>item.id===request.artifactId)!,saved=artifact.revisions.at(-1)!,before=JSON.stringify(task);
 expect(saved.mimeType).toBe(TEACHBACK_MIME);const body=JSON.parse(saved.content);
 const html=render(task);expect(packet(html)).toEqual([]);expect(html).toContain(parent.input.answer);expect(html).toContain(body.feedback.feedback.slice(0,40).replace(/&/g,'&amp;').replace(/'/g,'&#x27;').replace(/"/g,'&quot;').replace(/</g,'&lt;'));
 expect(html).toContain(`data-view-focus="artifact:${artifact.id}"`);expect(html).toContain('Open teach-back');expect(structuredAnswerAction(task,artifact,saved)).toEqual({label:'Open teach-back',artifact});
 const small=compact(task);expect(packet(small)).toEqual([]);expect(small).toContain('Open teach-back');
 const broken={...task,artifacts:task.artifacts.map(item=>item.id===artifact.id?{...item,revisions:item.revisions.map(revision=>revision.revision===saved.revision?{...revision,content:revision.content.replace('"phase":"ready"','"phase":"unknown"')}:revision)}:item)};
 const brokenHtml=render(broken);expect(packet(brokenHtml)).toEqual([]);expect(brokenHtml).toContain('This teach-back feedback needs inspection. Its original content is kept.');expect(brokenHtml).toContain('Open teach-back');
 expect(packet(compact(broken))).toEqual([]);
 expect(JSON.stringify(task)).toBe(before);
});

it('a real completed suggestion turn shows a readable summary, never its JSON record',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'suggestion-conversation-')),core:Companion=await createCompanion({dataDir:directory});cleanups.push(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});
 const task=await core.createTask({title:'Owned suggestion conversation'}),generated=await core.runRequest({taskId:task.id,requestId:'owned-original',kind:'create',prompt:'Write the original document.',sourceIds:[]},async()=>({title:'Owned document',content:'old\nkeep\nold\n',mimeType:'text/markdown'}));
 const original=(await core.getTask(task.id)).artifacts.find(item=>item.id===generated.artifactId)!,basis=savedDocumentDraftBasis(await core.getTask(task.id),original.id,original.revisions[0]);
 const prepared=await core.beginDocumentEditSuggestions({taskId:task.id,artifactId:original.id,basis,requestId:'owned-proposal',prompt:'Change first and last lines'});
 const result=await core.runRequest({taskId:task.id,requestId:'owned-proposal',kind:'revise',prompt:'Change first and last lines',artifactId:prepared.artifactId,expectedRevision:1,expectedArtifacts:[{artifactId:original.id,revision:1,digest:original.revisions[0].digest}],sourceIds:[]},async()=>({title:'Suggestions for Owned document',content:JSON.stringify(finishDocumentSuggestions(prepared.body,'first\nkeep\nlast\n')),mimeType:DOCUMENT_SUGGESTIONS_MIME}));
 expect(result.status,result.error).toBe('completed');
 const current=await core.getTask(task.id),before=JSON.stringify(current),html=render(current);
 expect(packet(html)).toEqual([]);expect(html).toContain('Change first and last lines');expect(html).toContain('2 suggested changes to Owned document');
 const record=current.artifacts.find(item=>item.id===prepared.artifactId)!;
 expect(html).toContain('Review suggestions');expect(html).toContain(`data-view-focus="artifact:${original.id}"`);expect(html).not.toContain(`data-view-focus="artifact:${record.id}"`);
 expect(structuredAnswerAction(current,record,record.revisions.at(-1)!)?.artifact.id).toBe(original.id);
 const small=compact(current);expect(packet(small)).toEqual([]);expect(small).toContain('Review suggestions');expect(small).not.toContain('Open Suggestions for');
 expect(JSON.stringify(current)).toBe(before);
});

it('a model create request that fails before its receipt keeps its question and retry, even with a fixed local sentence',()=>{
 const time='2026-11-04T12:00:00.000Z',prompt='Create a local text helper to teach, check and save.';
 const task={id:'t',title:'T',goal:'',status:'active',createdAt:time,updatedAt:time,sources:[],artifacts:[],requests:[{id:'r',kind:'create',prompt,digest:'d',status:'failed',sourceRefs:[],startedAt:time,finishedAt:time,error:'Synthetic provider failure'}],procedures:[],checkpoints:[],actions:[],memory:{enabled:false}} as Task;
 expect(localActivityLabel(task,task.requests[0])).toBeUndefined();
 const html=renderToStaticMarkup(createElement(Conversation,{task,active:true,renderBrief:()=>null,onArtifact:()=>{},onConnection:()=>{},onPrepareFollowup:()=>{}}));
 expect(html).toContain('conversation-question');expect(html).toContain(prompt);expect(html).toContain('Retry question');
});
