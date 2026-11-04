import {afterEach,expect,test,vi} from 'vitest';
vi.mock('../../src/renderer/src/components/GeneratedSurface',async()=>{const {createElement}=await import('react');return {GeneratedSurface:({children}:{children:unknown})=>createElement('div',{},children as any)};});
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {CompactCompanion} from '../../src/renderer/src/components/CompactCompanion';
import type {Task} from '../../src/core/types';
import {savedRunFixture,leaked} from '../support/experiment-run-conversation.fixture';

const close:Array<()=>Promise<void>>=[];afterEach(async()=>{for(const f of close.splice(0))await f();});
function render(task:Task){return renderToStaticMarkup(createElement(CompactCompanion,{task,active:false,loaded:true,busy:false,running:false,anyRunning:false,error:'',notice:'',character:null,composer:null,onWorkspace:()=>{},onReviewSource:()=>{},onArtifact:()=>{},onRefresh:()=>{},onCaptureAttached:()=>{},onCollapse:()=>{},onStop:()=>{},onDismissError:()=>{},onStartContext:()=>{},onSourceSelection:()=>{}}));}

test('compact latest result shows a saved run as one readable line, never its packet',async()=>{
 const {task,artifact}=await savedRunFixture(close),before=JSON.stringify(task),html=render(task);
 expect(leaked(html)).toEqual([]);expect(html).toContain('Saved calculation run · 22 USD');expect(html).toContain('compared with 14 USD');expect(JSON.stringify(task)).toBe(before);
 artifact.revisions[0].content=artifact.revisions[0].content.replace('"value":22','"value":99');const tampered=render(task);
 expect(leaked(tampered)).toEqual([]);expect(tampered).toContain('This record needs inspection. Its original content is kept.');expect(tampered).not.toContain('99 USD');
});

