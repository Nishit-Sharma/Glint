import {expect,test} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {Task} from '../src/core/types';
import {Conversation} from '../src/renderer/src/components/Conversation';
import {ResponseBranchReview} from '../src/renderer/src/components/ResponseBranchReview';
import {responseBranchSnapshot} from '../src/core/response-branch';
const time='2026-10-29T09:00:00.000Z',digest='a'.repeat(64),answer={artifactId:'answer',revision:1,digest};
const task:Task={id:'original',title:'Original work',goal:'',status:'active',createdAt:time,updatedAt:time,sources:[],artifacts:[{id:'answer',revisions:[{revision:1,digest,title:'A saved answer',content:'Saved text with <untrusted> markup',mimeType:'text/markdown',sourceRefs:[],createdAt:time}]}],requests:[{id:'request',kind:'explain',prompt:'A saved question',status:'completed',digest:'request-digest',answer,artifactId:'answer',sourceRefs:[],startedAt:time,finishedAt:time}],procedures:[],checkpoints:[],actions:[],memory:{enabled:false}};
const render=(value:Task)=>renderToStaticMarkup(createElement(Conversation,{task:value,active:true,renderBrief:()=>null,onArtifact:()=>{},onConnection:()=>{},onBranchResponse:()=>{}}));
test('only an exact completed ordinary text answer exposes the reviewed branch entry',()=>{
 expect(render(task)).toContain('Start a new task from this answer');
 for(const mutate of [(t:Task)=>{t.requests[0].answer=undefined;},(t:Task)=>{t.requests[0].answer!.digest='b'.repeat(64);},(t:Task)=>{t.requests[0].status='failed';},(t:Task)=>{t.artifacts[0].revisions[0].mimeType='application/json';},(t:Task)=>{t.artifacts[0].revisions[0].encoding='base64';}]){const changed=structuredClone(task);mutate(changed);expect(render(changed)).not.toContain('Start a new task from this answer');}
});
test('the review exposes snapshot contents and omissions as read-only text before any create action',()=>{
 const snapshot=responseBranchSnapshot(task,{taskId:task.id,requestId:'request',answer}),html=renderToStaticMarkup(createElement(ResponseBranchReview,{task,snapshot,isCurrent:()=>true,onCreate:async()=>undefined,onCreated:()=>{},onClose:()=>{}}));
 expect(html).toContain('Nothing is sent to an AI service.');expect(html).toContain('Browser sessions, action receipts, pending operations, approvals and live window access are not copied.');expect(html).toContain('readOnly=""');expect(html).toContain('Saved text with &lt;untrusted&gt; markup');expect(html).toContain('Conversation text to copy (1 turn)');expect(html).toContain('Create new task');expect(html).not.toContain('<untrusted>');
});
