import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test} from 'vitest';
import {RequestContext} from '../src/renderer/src/components/RequestContext';
import type {Task} from '../src/core/types';

const source=(id:string,label:string)=>({id,currentVersion:1,freshness:'fresh',versions:[{id,version:1,digest:id,kind:'text',label,role:'fact',content:'Never display source content inline.',capturedAt:''}]});
const inline=(html:string)=>html.slice(0,html.indexOf('</details>')+10);
const task={title:'Synthetic context',sources:[source('a','Alpha brief'),source('b','Beta brief'),source('c','Third brief')]} as Task;
test('inline context names the actual selected sources and makes details optional',()=>{
 const html=renderToStaticMarkup(createElement(RequestContext,{task,selectedSourceIds:['b'],connection:{configured:true,provider:'Meta'} as any,onReview:()=>{}}));
 expect(html).toContain('<summary>Context · Beta brief + task history</summary>');expect(html).toContain('To Meta');expect(html).toContain('Review or change context');expect(inline(html)).not.toContain('Alpha brief');expect(html).not.toContain('Never display source content inline.');expect(html).not.toContain('<details open');expect(inline(html)).toContain('Inspect task history for this question');
});
test('empty and default source scope still disclose task history and browser work keeps its own review',()=>{
 const empty=renderToStaticMarkup(createElement(RequestContext,{task,selectedSourceIds:[]}));expect(empty).toContain('No sources selected');expect(empty).toContain('task history');expect(empty).toContain('Source-derived history is included only for selected current sources');expect(inline(empty)).not.toContain('Alpha brief');
 const all=renderToStaticMarkup(createElement(RequestContext,{task}));expect(all).toContain('Alpha brief, Beta brief +1 more');expect(all).toContain('Third brief');
 const structured=renderToStaticMarkup(createElement(RequestContext,{task,kind:'experiment'}));expect(structured).not.toContain('task history');expect(structured).not.toContain('Task history inspection');expect(structured).toContain('Your message and the selected source content');
 expect(renderToStaticMarkup(createElement(RequestContext,{task:{...task,session:{browserContext:{url:'https://synthetic.invalid'}}} as Task}))).toBe('');
});
test('project snapshots disclose pinned origins and actual selection without expanding an explicit empty scope',()=>{
 const inherited={...source('inherited','Pinned guide'),projectOrigin:{projectId:'project-a',sourceKey:'shared-a',taskId:'owner-a',reference:{sourceId:'original-a',version:3,digest:'original-digest'},copiedVersion:1,copiedDigest:'inherited'}},owner={...task,sources:[inherited]} as Task;
 const selected=renderToStaticMarkup(createElement(RequestContext,{task:owner}));expect(selected).toContain('1 saved project snapshot · 1 selected');expect(selected).toContain('project snapshot of shared saved version 3');expect(selected).toContain('pinned copy');
 const none=renderToStaticMarkup(createElement(RequestContext,{task:owner,selectedSourceIds:[]}));expect(none).toContain('1 saved project snapshot · 0 selected');expect(none).toContain('No sources selected');expect(inline(none)).not.toContain('Pinned guide');
 const edited={...owner,sources:[{...inherited,currentVersion:2,versions:[...inherited.versions,{...inherited.versions[0],version:2,digest:'edited'}]}]} as Task;
 expect(renderToStaticMarkup(createElement(RequestContext,{task:edited}))).toContain('locally changed copy');
});
test('included context stays visible beside the message and the destination names the actual route',()=>{
 const pinned={...task,id:'owner',artifacts:[{id:'skill-a',revisions:[{title:'Evidence first'}]}],session:{instructionSkill:{revision:1,selection:{ownerTaskId:'owner',artifactId:'skill-a',revision:1,digest:'d'}}}} as unknown as Task;
 const html=renderToStaticMarkup(createElement(RequestContext,{task:pinned,flag:'Plan mode',chips:['Memory · 2','Project instructions'],connection:{configured:true,provider:'Meta',metaProfile:'baseten-hackathon',endpoint:'https://inference.baseten.co/v1'} as any}));
 for(const chip of ['Plan mode','Memory · 2','Project instructions'])expect(html).toContain('>'+chip+'</button>');expect(html).toContain('aria-label="Skill · Evidence first"');expect(html).toContain('class="request-chip-name" aria-hidden="true">Evidence first</span>');expect(html).toContain('aria-expanded="false"');
 expect(html).toContain('To Meta · Baseten');expect(html).toContain('aria-label="Included with your next message"');expect(html).toContain('hidden=""');
 expect(renderToStaticMarkup(createElement(RequestContext,{task,connection:{configured:true,provider:'Meta',metaProfile:'meta-direct',endpoint:'https://api.meta.ai/v1'} as any}))).toContain('>To Meta</span>');
 expect(renderToStaticMarkup(createElement(RequestContext,{task}))).not.toContain('request-chips');
});
