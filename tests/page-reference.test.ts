import {afterEach,expect,it} from 'vitest';
import {mkdir,mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createCompanion} from '../src/core/companion';
import {LearningDraftStore} from '../src/host/learning-drafts';
import {createLearningDrafts} from '../src/renderer/src/learning-drafts';
import {createSavedDocumentDraftController} from '../src/renderer/src/saved-document-draft-controller';
import {requestSavedDocument} from '../src/renderer/src/saved-document-save-request';
import {savePageReference} from '../src/renderer/src/page-reference-save';
import {requestPageReferenceNavigation} from '../src/renderer/src/page-reference-navigation';
import {ReadableText} from '../src/renderer/src/components/ReadableText';
import {StreamingText} from '../src/renderer/src/components/StreamingText';
import {prependPageReference,pageReferenceHref,parsePageReferenceHref,readPageReference,resolvePageReference,type PageReferenceSource} from '../src/shared/page-reference';
import {canEditRichText} from '../src/renderer/src/document-format';
import type {Task} from '../src/core/types';
import {learningDraftTaskId} from '../src/shared/learning-drafts';

const cleanup:Array<()=>Promise<void>>=[];afterEach(async()=>{for(const close of cleanup.splice(0))await close();});
const tick=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
async function fixture(content='# Existing source page\n\nExact original body.  \nKeep spacing.',mimeType:'text/markdown'|'text/plain'='text/markdown'){
 await mkdir(join(process.cwd(),'evidence'),{recursive:true});const directory=await mkdtemp(join(process.cwd(),'evidence/page-ref-core-'));let core=await createCompanion({dataDir:directory});cleanup.push(()=>core.close());
 const source=await core.createTask({title:'Arbitrary existing source owner'}),sourceSaved=await core.saveArtifact(source.id,{title:'Existing source page',content,mimeType,sourceRefs:[]});
 const targetOwner=await core.createTask({title:'Another owned task'}),first=await core.saveArtifact(targetOwner.id,{title:'Target [alpha] *local*',content:'First actual saved target body',mimeType:'text/plain',sourceRefs:[]}),second=await core.saveArtifact(targetOwner.id,{title:'Distinct beta target',content:'Second arbitrary target content',mimeType:'text/markdown',sourceRefs:[]});
 await core.saveComposerDraft(source.id,0,{text:'Keep source unsent message',kind:'explain'});await core.saveComposerDraft(targetOwner.id,0,{text:'Keep target unsent message',kind:'create'});
 let task=await core.getTask(source.id),base=sourceSaved.revision;const target=await core.getTask(targetOwner.id),store=new LearningDraftStore({directory,lookupTask:id=>core.getTask(id)}),cache=createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)});await cache.load();
 const lock={current:false},commands:unknown[]=[];
 const controller=createSavedDocumentDraftController({cache,artifactId:sourceSaved.artifactId,task:()=>task,base:()=>base,isCurrent:()=>true,send:input=>requestSavedDocument(source.id,input,{lock,setBusy:()=>{},invoke:async command=>{commands.push(command);await core.saveArtifact(command.taskId,command.artifact);return core.getTask(command.taskId);},refresh:async()=>{task=await core.getTask(source.id);return task;}}),onSaved:revision=>{base=revision;}});
 const targetController=createSavedDocumentDraftController({cache,artifactId:first.artifactId,task:()=>target,base:()=>first.revision,isCurrent:()=>true,send:async()=>{throw Error('Target draft cannot save during linking');},onSaved:()=>{}});targetController.edit({content:'PRIVATE target raw draft, exact bytes\n'});await cache.flush();
 return {directory,get core(){return core;},get task(){return task;},get base(){return base;},sourceSaved,target,first,second,cache,store,controller,targetController,commands,source:():PageReferenceSource=>({taskId:task.id,artifact:{artifactId:sourceSaved.artifactId,revision:base.revision,digest:base.digest}}),restart:async()=>{await core.close();core=await createCompanion({dataDir:directory});task=await core.getTask(source.id);base=task.artifacts[0].revisions.at(-1)!;}};
}

it('real controller saves two arbitrary cross-owner references in canonical content and ordinary reopen preserves both pages/drafts/history',async()=>{
 const f=await fixture(),before=f.task,targetBefore=await f.core.getTask(f.target.id),targetRaw=f.targetController.snapshot().raw;
 for(const saved of [f.first,f.second]){
  const preview=resolvePageReference(await f.core.getTask(f.target.id),{taskId:f.target.id,artifactId:saved.artifactId});
  expect(await savePageReference(f.controller,f.source(),preview,{current:()=>true,load:id=>f.core.getTask(id),staged:()=>{}})).toBe(true);
 }
 const source=await f.core.getTask(f.task.id),current=source.artifacts[0].revisions.at(-1)!;expect(source.artifacts).toHaveLength(1);expect(current.content.endsWith(f.sourceSaved.revision.content)).toBe(true);
 expect(current.content).toContain(pageReferenceHref({taskId:f.target.id,artifactId:f.first.artifactId}));expect(current.content).toContain(pageReferenceHref({taskId:f.target.id,artifactId:f.second.artifactId}));expect(source.artifacts[0].revisions[0]).toEqual(f.sourceSaved.revision);expect(current.sourceRefs).toEqual(f.sourceSaved.revision.sourceRefs);expect(source.requests).toEqual(before.requests);expect(source.session).toEqual(before.session);expect(source.actions).toEqual(before.actions);
 expect(await f.core.getTask(f.target.id)).toEqual(targetBefore);expect(f.targetController.snapshot().raw).toEqual(targetRaw);expect(f.commands).toHaveLength(2);expect(canEditRichText(current.content)).toBe(false);
 const html=renderToStaticMarkup(createElement(ReadableText,{text:current.content,onPageReference:()=>{}}));expect(html.match(/class="markdown-page-reference"/g)).toHaveLength(2);expect(html).not.toContain('<a ');
 await f.restart();expect((await f.core.getTask(f.task.id)).artifacts).toEqual(source.artifacts);expect((await f.core.getTask(f.target.id)).artifacts).toEqual(targetBefore.artifacts);
 const reopened=new LearningDraftStore({directory:f.directory,lookupTask:id=>f.core.getTask(id)}),raw=await reopened.read();expect(raw.kind).toBe('available');if(raw.kind==='available')expect(raw.records.some(record=>learningDraftTaskId(record.owner)===f.target.id&&record.value?.value.includes('PRIVATE target raw draft'))).toBe(true);
 // Subsequent ordinary editing/saving keeps the exact reference bytes in the text fallback.
 expect(f.controller.edit({content:current.content+'\nOrdinary later edit.'}).kind).toBe('accepted');expect(await f.controller.save()).toBe(true);expect((await f.core.getTask(f.task.id)).artifacts[0].revisions.at(-1)!.content).toBe(current.content+'\nOrdinary later edit.');
});

it('dirty source, changed preview and late source input refuse insertion without changing canonical or exact raw',async()=>{
 const f=await fixture(),preview=resolvePageReference(f.target,{taskId:f.target.id,artifactId:f.first.artifactId});f.controller.edit({content:'Existing source raw bytes\n'});await f.cache.flush();const raw=f.controller.snapshot().raw,before=await f.core.getTask(f.task.id);
 await expect(savePageReference(f.controller,f.source(),preview,{current:()=>true,load:id=>f.core.getTask(id),staged:()=>{throw Error('Must not stage');}})).rejects.toThrow(/existing document edits/);expect(f.controller.snapshot().raw).toEqual(raw);expect(await f.core.getTask(f.task.id)).toEqual(before);
 await f.controller.discard();await f.core.saveArtifact(f.target.id,{artifactId:f.first.artifactId,expectedRevision:1,title:'Changed target',content:'Changed target body',mimeType:'text/plain',sourceRefs:[]});await expect(savePageReference(f.controller,f.source(),preview,{current:()=>true,load:id=>f.core.getTask(id),staged:()=>{}})).rejects.toThrow(/selected page changed/);expect(f.controller.snapshot().raw.present).toBe(false);
 const fresh=resolvePageReference(await f.core.getTask(f.target.id),preview.reference);let release!:(owner:Task)=>void;const held=new Promise<Task>(resolve=>{release=resolve;});const saving=savePageReference(f.controller,f.source(),fresh,{current:()=>true,load:()=>held,staged:()=>{throw Error('Late input must not stage');}});f.controller.edit({content:'New input during target read'});const later=f.controller.snapshot().raw;release(await f.core.getTask(f.target.id));await expect(saving).rejects.toThrow(/source document changed/);expect(f.controller.snapshot().raw).toEqual(later);expect(await f.core.getTask(f.task.id)).toEqual(before);
});

it('strict local encoding survives actual sanitization while remote, script, malformed and unscoped references stay inert',()=>{
 const reference={taskId:'owned-task',artifactId:'owned-page'},href=pageReferenceHref(reference);expect(parsePageReferenceHref(href)).toEqual(reference);expect(()=>readPageReference({...reference,url:'javascript:bad'})).toThrow();
 for(const value of ['javascript:alert(1)','https://invalid.test/'+href,href+'/extra',href+'?x=1',href+'#more','#glint-page/../page','#glint-page/task/%70age'])expect(parsePageReferenceHref(value)).toBeUndefined();
 const preview={reference,artifact:{artifactId:reference.artifactId,revision:1,digest:'a'.repeat(64)},title:'Label [x] *y* <script>\nnext',content:'not copied',taskTitle:'Owned'},body=prependPageReference('Original bytes\n',preview)+'\n\n[Remote](https://invalid.test/)\n\n[Script](javascript:alert%281%29)';
 const active=renderToStaticMarkup(createElement(ReadableText,{text:body,onPageReference:()=>{}}));expect(active.match(/class="markdown-page-reference"/g)).toHaveLength(1);expect(active).toContain('Label [x] *y* &lt;script&gt; next');expect(active).not.toMatch(/<(?:a|script|iframe|img)\b/);expect(active).not.toMatch(/<[^>]+\s(?:href|src|onclick)=/i);
 for(const html of [renderToStaticMarkup(createElement(ReadableText,{text:body})),renderToStaticMarkup(createElement(StreamingText,{text:body,streaming:true}))])expect(html).not.toContain('class="markdown-page-reference"');
});

it.each([
 {name:'unfinished backtick fence',mimeType:'text/markdown' as const,content:'Before the code.\n\n```text\nExact unfinished code  \r\n'},
 {name:'unfinished tilde fence',mimeType:'text/markdown' as const,content:'~~~text\nUnclosed code remains exact\n'},
 {name:'unfinished HTML comment',mimeType:'text/markdown' as const,content:'<!-- exact unfinished comment\n'},
 {name:'plain text BOM, CRLF and indentation',mimeType:'text/plain' as const,content:'\uFEFFPlain source\r\n  Preserve indentation and trailing spaces  \r\n'},
])('places a real rendered reference before $name without normalizing original saved bytes',async sample=>{
 const f=await fixture(sample.content,sample.mimeType),preview=resolvePageReference(f.target,{taskId:f.target.id,artifactId:f.first.artifactId}),original=f.sourceSaved.revision,targetRaw=f.targetController.snapshot().raw;
 expect(await savePageReference(f.controller,f.source(),preview,{current:()=>true,load:id=>f.core.getTask(id),staged:()=>{}})).toBe(true);
 const saved=(await f.core.getTask(f.task.id)).artifacts[0],current=saved.revisions.at(-1)!,prefix=prependPageReference('',preview);
 expect(current.content).toBe(prefix+sample.content);expect(Buffer.from(current.content).subarray(Buffer.byteLength(prefix))).toEqual(Buffer.from(sample.content));expect(current.mimeType).toBe(sample.mimeType);expect(saved.revisions[0]).toEqual(original);expect(f.targetController.snapshot().raw).toEqual(targetRaw);
 const rendered=renderToStaticMarkup(createElement(ReadableText,{text:current.content,onPageReference:()=>{}}));expect(rendered.match(/class="markdown-page-reference"/g)).toHaveLength(1);
 await f.restart();const reopened=(await f.core.getTask(f.task.id)).artifacts[0];expect(reopened.revisions).toEqual(saved.revisions);expect(renderToStaticMarkup(createElement(ReadableText,{text:reopened.revisions.at(-1)!.content,onPageReference:()=>{}}))).toContain('class="markdown-page-reference"');
});

it('exact cross-owner navigation uses the main guard, preserves target raw, rereads after a delayed decision and cancels stale completions',async()=>{
 const f=await fixture(),target={taskId:f.target.id,artifactId:f.first.artifactId};let scope='source-view',applied=0,flushes=0,error='',queued:(()=>void)|undefined;
 const effects={scope:()=>scope,sourceCurrent:()=>true,guard:(action:()=>void)=>(action(),true),flush:async()=>{flushes++;},load:(id:string)=>f.core.getTask(id),apply:(owner:Task,id:string)=>{expect(owner.id).toBe(target.taskId);expect(id).toBe(target.artifactId);applied++;},error:(value:string)=>{error=value;}};
 requestPageReferenceNavigation(f.source(),target,{...effects,guard:()=>false});await tick();expect(applied).toBe(0);expect(flushes).toBe(0);
 let reads=0,guards=0;requestPageReferenceNavigation(f.source(),target,{...effects,guard:action=>{if(++guards===2){queued=action;return false;}action();return true;},load:async id=>{reads++;return f.core.getTask(id);}});for(let i=0;i<20&&!queued;i++)await tick();expect(queued).toBeDefined();queued!();for(let i=0;i<20&&!applied;i++)await tick();expect(reads).toBe(2);expect(applied).toBe(1);expect(f.targetController.snapshot().raw.content).toBe('PRIVATE target raw draft, exact bytes\n');
 let release!:(owner:Task)=>void;const held=new Promise<Task>(resolve=>{release=resolve;});requestPageReferenceNavigation(f.source(),target,{...effects,load:()=>held});await tick();scope='another-owner';release(f.target);await tick();expect(applied).toBe(1);
 requestPageReferenceNavigation(f.source(),{...target,artifactId:'missing'},effects);for(let i=0;i<20&&!error;i++)await tick();expect(error).toContain('unavailable');expect(applied).toBe(1);
 const ambiguous={...f.target,artifacts:[f.target.artifacts[0],f.target.artifacts[0]]};expect(()=>resolvePageReference(ambiguous,target)).toThrow(/unavailable/);
});
