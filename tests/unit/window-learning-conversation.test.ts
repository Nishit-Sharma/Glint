import {expect,test} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {Task,ArtifactRevision} from '../../src/core/types';
import {Conversation} from '../../src/renderer/src/components/Conversation';
import {WINDOW_WORKFLOW_MIME} from '../../src/shared/window-workflow-artifact';
import {syntheticCandidate} from '../support/window-learning.fixture';

/** Public renderer fixture only: inert synthetic saved bytes, no provider/capture/admission. */
function conversationTask(mimeType:string,content:string,title='Review state transitions'):Task{
 const time='2026-10-27T12:00:00.000Z',revision:ArtifactRevision={revision:1,title,mimeType,content,sourceRefs:[],digest:'owned-renderer-fixture-digest',createdAt:time};
 return {id:'owned-task',title:'Owned synthetic image FSM',goal:'',status:'active',createdAt:time,updatedAt:time,sources:[],artifacts:[{id:'owned-artifact',revisions:[revision]}],requests:[{id:'owned-request',kind:'experiment',prompt:'Review the owned synthetic diagram.',digest:'owned-request-digest',status:'completed',sourceRefs:[],startedAt:time,finishedAt:time,artifactId:'owned-artifact'}],procedures:[],checkpoints:[],actions:[],memory:{enabled:false}};
}
const render=(task:Task)=>renderToStaticMarkup(createElement(Conversation,{task,active:true,renderBrief:()=>null,onArtifact:()=>{},onConnection:()=>{}}));

test('a saved image-review result shows a readable correction summary and open action while keeping exact candidate bytes',()=>{
 const task=conversationTask(WINDOW_WORKFLOW_MIME,JSON.stringify(syntheticCandidate())),before=JSON.stringify(task),html=render(task);
 expect(html).toContain('Image transcription and state transitions are ready for correction.');
 expect(html).toContain('Open Review state transitions');expect(html).toContain('data-view-focus="artifact:owned-artifact"');
 expect(html).not.toContain('window-workflow-review-candidate');expect(html).not.toContain('previewExpiresAt');expect(html).not.toContain('imageSha256');expect(JSON.stringify(task)).toBe(before);
});


test.each(['text/markdown','application/vnd.owned.study-notes+json'])('ordinary %s content keeps JSON-looking user text and its open action',(mimeType)=>{
 const content='Owned note: {"schemaVersion":7,"kind":"window-workflow-review-candidate","detail":"keep my words"}',task=conversationTask(mimeType,content,'Owned study note'),before=JSON.stringify(task),html=render(task);
 expect(html).toContain('window-workflow-review-candidate');expect(html).toContain('keep my words');expect(html).toContain('Open Owned study note');expect(html).not.toContain('Image transcription and state transitions are ready for correction.');expect(JSON.stringify(task)).toBe(before);
});

test('ordinary application JSON retains its existing generic saved-file affordance',()=>{
 const task=conversationTask('application/json','{"ownedRawValue":"kept in the artifact"}','Owned data'),before=JSON.stringify(task),html=render(task);
 expect(html).toContain('This saved file is available in your work.');expect(html).toContain('Open Owned data');expect(html).not.toContain('ownedRawValue');expect(JSON.stringify(task)).toBe(before);
});

test('a completed candidate request projects its original revision without substituting a later document',()=>{
 const task=conversationTask(WINDOW_WORKFLOW_MIME,JSON.stringify(syntheticCandidate())),first=task.artifacts[0].revisions[0];
 task.artifacts[0].revisions.push({...first,revision:2,title:'Later document',mimeType:'text/markdown',content:'Owned later document content.',digest:'later-owned-digest'});const before=JSON.stringify(task),html=render(task);
 expect(html).toContain('Image transcription and state transitions are ready for correction.');expect(html).toContain('Open Review state transitions');expect(html).not.toContain('Owned later document content.');expect(html).not.toContain('Later document');expect(JSON.stringify(task)).toBe(before);
});
