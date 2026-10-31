import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test} from 'vitest';
import {RequestContext} from '../src/renderer/src/components/RequestContext';
import type {Task} from '../src/core/types';

const source=(id:string,label:string)=>({id,currentVersion:1,freshness:'fresh',versions:[{id,version:1,digest:id,kind:'text',label,role:'fact',content:'Never display source content inline.',capturedAt:''}]});
const task={title:'Synthetic context',sources:[source('a','Alpha brief'),source('b','Beta brief'),source('c','Third brief')]} as Task;
test('inline context names the actual selected sources and makes details optional',()=>{
 const html=renderToStaticMarkup(createElement(RequestContext,{task,selectedSourceIds:['b'],connection:{configured:true,provider:'Meta'} as any,onReview:()=>{}}));
 expect(html).toContain('<summary>Context · Beta brief · task history</summary>');expect(html).toContain('To Meta');expect(html).toContain('Review or change context');expect(html).not.toContain('Alpha brief');expect(html).not.toContain('Never display source content inline.');expect(html).not.toContain('<details open');
});
test('empty and default source scope still disclose task history and browser work keeps its own review',()=>{
 const empty=renderToStaticMarkup(createElement(RequestContext,{task,selectedSourceIds:[]}));expect(empty).toContain('No sources selected');expect(empty).toContain('task history');expect(empty).toContain('copied or derived content from earlier sources even when they are now deselected');expect(empty).not.toContain('Alpha brief');
 const all=renderToStaticMarkup(createElement(RequestContext,{task}));expect(all).toContain('Alpha brief, Beta brief +1 more');expect(all).toContain('Third brief');
 const structured=renderToStaticMarkup(createElement(RequestContext,{task,kind:'experiment'}));expect(structured).not.toContain('task history');expect(structured).toContain('Your message and the selected source content');
 expect(renderToStaticMarkup(createElement(RequestContext,{task:{...task,session:{browserContext:{url:'https://synthetic.invalid'}}} as Task}))).toBe('');
});
