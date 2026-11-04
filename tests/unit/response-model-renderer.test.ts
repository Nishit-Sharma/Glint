import {expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ResponseModelDetails} from '../../src/renderer/src/components/ResponseModelDetails';
import {Conversation} from '../../src/renderer/src/components/Conversation';
import {emptyTaskSession} from '../../src/core/task-session';
import type {RequestRecord,Task} from '../../src/core/types';

const answer={artifactId:'answer',revision:1,digest:'b'.repeat(64)},record:RequestRecord={id:'owner',kind:'explain',prompt:'Synthetic only.',digest:'a'.repeat(64),status:'completed',sourceRefs:[],startedAt:'2026-11-01T00:00:00Z',answer,inference:{provider:'codex',model:'gpt-6.1-sol',effort:'high',tier:'default'}};
const render=(request:RequestRecord)=>renderToStaticMarkup(createElement(ResponseModelDetails,{request}));
it('shows only the exact answer-bound provider receipt, with the logical-model qualification',()=>{
 const receipt={requestId:'owner',provider:'codex' as const,model:'gpt-6.1-sol',effort:'high',tier:'default' as const,confirmation:'accepted-thread-and-completed-turn' as const,answer};
 const html=render({...record,responseModel:receipt});expect(html).toContain('Response model · gpt-6.1-sol');expect(html).toContain('logical model');expect(html).toContain('Physical backend weights are not identified');
 for(const request of [record,{...record,status:'failed' as const,responseModel:receipt},{...record,responseModel:{...receipt,requestId:'different'}},{...record,responseModel:{...receipt,answer:{...answer,revision:2}}}]){
  const unavailable=render(request);expect(unavailable).toContain('Response model · unavailable');expect(unavailable).not.toContain('gpt-6.1-sol');
 }
});

it('exposes the saved receipt in the actual response UI despite a newer task model choice',()=>{
 const responseModel={requestId:'owner',provider:'codex' as const,model:'gpt-6.1-sol',effort:'high',tier:'default' as const,confirmation:'accepted-thread-and-completed-turn' as const,answer};
 const task:Task={id:'task',title:'Synthetic owner',goal:'',status:'active',createdAt:record.startedAt,updatedAt:record.startedAt,sources:[],artifacts:[{id:'answer',revisions:[{revision:1,title:'Answer',content:'Synthetic saved response.',mimeType:'text/markdown',sourceRefs:[],digest:answer.digest,createdAt:record.startedAt}]}],requests:[{...record,responseModel}],procedures:[],checkpoints:[],actions:[],memory:{enabled:false},session:{...emptyTaskSession(),requestInference:{revision:4,selection:{provider:'codex',model:'gpt-6-luna',effort:'low',tier:'priority'}}}};
 const html=renderToStaticMarkup(createElement(Conversation,{task,active:false,renderBrief:()=>null,onArtifact:()=>{},onConnection:()=>{}}));expect(html).toContain('Response model · gpt-6.1-sol');expect(html).not.toContain('gpt-6-luna');
});
