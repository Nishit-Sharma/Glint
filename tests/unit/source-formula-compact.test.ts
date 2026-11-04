import {expect,test,vi} from 'vitest';
vi.mock('../../src/renderer/src/components/GeneratedSurface',async()=>{const {createElement}=await import('react');return {GeneratedSurface:({children}:{children:unknown})=>createElement('div',{},children as any)};});
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readScreenBrief} from '../../src/core/screen-brief';
import {saveSourceFormula} from '../../src/core/source-formula-host';
import {CompactCompanion} from '../../src/renderer/src/components/CompactCompanion';
import type {Task} from '../../src/core/types';
import {sourceFormulaFixture} from '../support/source-formula.fixture';

function render(task:Task,renderBrief?:()=>ReturnType<typeof createElement>){return renderToStaticMarkup(createElement(CompactCompanion,{task,active:false,loaded:true,busy:false,running:false,anyRunning:false,error:'',notice:'',character:null,composer:null,onWorkspace:()=>{},onReviewSource:()=>{},onArtifact:()=>{},onRefresh:()=>{},onCaptureAttached:()=>{},onCollapse:()=>{},onStop:()=>{},onDismissError:()=>{},onStartContext:()=>{},onSourceSelection:()=>{},renderBrief}));}

test('compact saved formula shows its original experiment card without the structured payload',async()=>{
 const f=await sourceFormulaFixture();try{
  const saved=await saveSourceFormula(f.core,{input:f.input}),task=await f.core.getTask(f.task.id),artifact=task.artifacts.find(item=>item.id===saved.artifactId)!,first=artifact.revisions[0],before=first.content;
  artifact.revisions.push({...first,revision:2,title:'Later revision',content:'LATER_PRIVATE_SENTINEL',digest:'later-digest'});const snapshot=JSON.stringify(task),html=render(task);
  expect(html).toContain('compact-structured');expect(html).toContain(f.input.title);expect(html).toContain('Review and edit');expect(html).not.toContain('source-formula-v1');expect(html).not.toContain('LATER_PRIVATE_SENTINEL');expect(first.content).toBe(before);expect(JSON.stringify(task)).toBe(snapshot);
 }finally{await f.close();}
});

test('compact malformed source formula never renders or opens its raw bytes',async()=>{
 const f=await sourceFormulaFixture();try{
  const saved=await saveSourceFormula(f.core,{input:f.input}),task=await f.core.getTask(f.task.id);task.artifacts.find(item=>item.id===saved.artifactId)!.revisions[0].content='MALFORMED_PRIVATE_SENTINEL';const before=JSON.stringify(task),html=render(task);
  expect(html).toContain('This saved source formula needs inspection.');expect(html).not.toContain('MALFORMED_PRIVATE_SENTINEL');expect(html).not.toContain('compact-structured');expect(html).not.toContain('compact-open-result');expect(JSON.stringify(task)).toBe(before);
 }finally{await f.close();}
});

test('compact ordinary text and JSON keep their existing presentation',async()=>{
 const f=await sourceFormulaFixture();try{
  const saved=await saveSourceFormula(f.core,{input:f.input}),task=await f.core.getTask(f.task.id),revision=task.artifacts.find(item=>item.id===saved.artifactId)!.revisions[0];
  revision.mimeType='text/plain';revision.content='Ordinary user note';let html=render(task);expect(html).toContain('Ordinary user note');expect(html).toContain('compact-open-result');
  revision.mimeType='application/json';revision.content='{"ordinary":"value"}';html=render(task);expect(html).toContain('compact-structured');expect(html).not.toContain('compact-open-result');
 }finally{await f.close();}
});


test('compact formula MIME suppresses unrelated screen-brief interpretation',async()=>{
 const f=await sourceFormulaFixture();try{
  const saved=await saveSourceFormula(f.core,{input:f.input}),task=await f.core.getTask(f.task.id),revision=task.artifacts.find(item=>item.id===saved.artifactId)!.revisions[0];revision.content=JSON.stringify({schemaVersion:1,kind:'screen-brief',insight:'UNRELATED_BRIEF_SENTINEL',actions:[]});expect(readScreenBrief(revision.content,revision.sourceRefs)).toBeDefined();const renderBrief=vi.fn(()=>createElement('p',{},'UNRELATED_BRIEF_SENTINEL'));const html=render(task,renderBrief);expect(renderBrief).not.toHaveBeenCalled();expect(html).toContain('This saved source formula needs inspection.');expect(html).not.toContain('UNRELATED_BRIEF_SENTINEL');
 }finally{await f.close();}
});

test('compact inherited context warns even when no direct citation controls exist, without exposing hidden source bodies',async()=>{
 const f=await sourceFormulaFixture();try{
  const saved=await saveSourceFormula(f.core,{input:f.input});let task=await f.core.getTask(f.task.id);const artifact=task.artifacts.find(item=>item.id===saved.artifactId)!,original=artifact.revisions.at(-1)!,source=task.sources[0];
  Object.assign(original,{mimeType:'text/plain',content:'Saved authored result',sourceRefs:[],contextSourceRefs:[{sourceId:source.id,version:source.currentVersion,digest:source.versions.at(-1)!.digest}]});task.sources[0]={...source,freshness:'refresh-required'};
  const before=JSON.stringify(task),html=render(task);expect(html).toContain('Inherited source context needs review:');expect(html).not.toContain('compact-citations');expect(html).not.toContain(source.versions[0].content);expect(JSON.stringify(task)).toBe(before);
 }finally{await f.close();}
});
