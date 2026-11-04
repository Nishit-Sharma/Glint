import {afterEach,expect,test} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createCompanion} from '../../src/core/companion';
import {privateRecordedHelpers,privateText} from '../support/recorded-text-privacy.fixture';
import {readTaskArtifactText,projectTaskDialogue} from '../../src/core/task-dialogue';
import {moduleHistoryText,moduleText,initialModuleState,parseModuleAnswer} from '../../src/core/interactive-modules';
import {taskContext} from '../../src/host/browser/coordinator';
import {buildMetaMessages} from '../../src/host/provider';
import {buildCodexInput} from '../../src/host/codex-provider';
import {taskHistoryReview} from '../../src/host/request-review';
import {saveModuleDocument} from '../../src/core/module-state';
import {responseBranchSnapshot} from '../../src/core/response-branch';
const cleanups:Array<()=>Promise<void>>=[];afterEach(async()=>{for(const close of cleanups.splice(0))await close();});
async function fixture(){const directory=await mkdtemp(join(tmpdir(),'recorded-text-privacy-')),core=await createCompanion({dataDir:directory});cleanups.push(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});return {core,...await privateRecordedHelpers(core)};}
function excludes(value:unknown){const encoded=typeof value==='string'?value:JSON.stringify(value);for(const sentinel of Object.values(privateText))expect(encoded).not.toContain(sentinel);return encoded;}

test('implicit model, browser, planner, branch and no-state artifact projections exclude all helper free text while retaining non-helper work',async()=>{
 const f=await fixture(),task=await f.core.getTask(f.taskId),before=structuredClone(task);
 expect(task.session?.moduleStates.some(item=>item.artifactId===f.derived.artifactId)).toBe(false);
 for(const artifact of task.artifacts.filter(item=>item.revisions[0].mimeType.includes('modules'))){const projection=readTaskArtifactText(task,artifact.id,1);expect(projection.available).toBe(true);excludes(projection);excludes(moduleHistoryText(artifact.revisions[0].content,id=>task.session?.moduleStates.find(item=>item.artifactId===artifact.id&&item.moduleId===id)?.state));}
 const model=excludes(projectTaskDialogue(task,'next',[])),browser=excludes(taskContext(task,'next'));expect(model).toContain('PUBLIC_DOCUMENT_BODY');expect(model).toContain('PUBLIC_QUESTION');expect(model).toContain('PUBLIC_PLAN_ITEM');expect(browser).toContain('PUBLIC_DOCUMENT_BODY');expect(browser).toContain('PUBLIC_PLAN_ITEM');expect(model).toContain('local-text');expect(model).toContain('recorded-text');expect(browser).toContain('Local helper metadata');
 const review=excludes(taskHistoryReview(model));expect(review).toContain('Local helper names, operations, inputs, results, checks and reasons are excluded');expect(review).toContain('selected sources or saved notes can still be shared');
 const branch=responseBranchSnapshot(task,{taskId:task.id,requestId:task.requests.at(-1)!.id,answer:task.requests.at(-1)!.answer!});excludes(branch);expect(JSON.stringify(branch)).toContain('PUBLIC_DOCUMENT_BODY');
 expect(await f.core.getTask(f.taskId)).toEqual(before);
});

test('actual core follow-up and both provider builders receive only helper metadata; explicit local notes and selected sources remain intact',async()=>{
 const f=await fixture();let history='';await f.core.runRequest({taskId:f.taskId,requestId:'model-followup',kind:'explain',prompt:'Review the public plan',sourceIds:[]},async context=>{history=context.taskHistory!;excludes(context.taskHistory);expect(context.task.sources).toEqual([]);excludes(buildMetaMessages('Review public work',[],history));excludes(buildCodexInput({prompt:'Review public work',taskContext:history,sources:[]}));return {title:'Public answer',content:'Public safe answer'};});
 const task=await f.core.getTask(f.taskId),original=task.artifacts.find(item=>item.id===f.owner.artifactId)!,derived=task.artifacts.find(item=>item.id===f.derived.artifactId)!,state=initialModuleState(f.derivedData);expect(moduleText(f.data,f.originalState)).toContain(privateText.input);expect(moduleText(f.derivedData,state)).toContain(privateText.replacement);expect(derived.revisions[0].content).toContain(privateText.input);expect(original.revisions[0].content).not.toContain(privateText.input);
 const notes=await saveModuleDocument(f.core,{taskId:f.taskId,artifactId:f.derived.artifactId,artifactRevision:1,sessionRevision:task.session!.revision}),notesRevision=(await f.core.getTask(f.taskId)).artifacts.find(item=>item.id===notes.artifactId)!.revisions.at(-1)!;expect(notesRevision.content).toContain(privateText.input);expect(notesRevision.content).toContain(privateText.replacement);
 // Explicitly selecting a source is an independent transmission choice; this fix does not erase it.
 const selected=await f.core.putSource(f.taskId,{kind:'text',role:'fact',label:'Explicit source',content:privateText.input}),source=selected.sources[0];await f.core.runRequest({taskId:f.taskId,requestId:'explicit-selection',kind:'explain',prompt:'Use my selected source',sourceIds:[source.id]},async context=>{expect(context.task.sources[0].versions[0].content).toBe(privateText.input);excludes(context.taskHistory);return {title:'Selected source response',content:'Public response'};});
 expect(readTaskArtifactText(await f.core.getTask(f.taskId),notes.artifactId,notesRevision.revision)).toMatchObject({available:true,text:notesRevision.content});
});
