import {afterEach,beforeEach,expect,test} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion,type Companion} from '../src/core/companion';
import {prepareConceptMapGeneration} from '../src/host/concept-map-generation';
import {CONCEPT_MAP_MIME,CONCEPT_MAP_PROMPT,parseConceptMapModel,readConceptMap,selectConceptMapSources} from '../src/shared/concept-map';
import {readTaskArtifactText} from '../src/core/task-dialogue';
import type {Command} from '../src/shared/bridge';
import {conceptProposal,conceptSource} from './concept-map.fixture';
import {publicErrorMessage} from '../src/shared/public-messages';
let core:Companion,directory:string;
beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'glint-concept-'));core=await createCompanion({dataDir:directory});});
afterEach(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});
async function fixture(){const created=await core.createTask({title:'Evaporation notes'}),task=await core.putSource(created.id,{id:'science',kind:'text',role:'fact',label:'Science notes',content:conceptSource}),sources=selectConceptMapSources(task,['science']);const command:Extract<Command,{type:'model.run'}>={type:'model.run',taskId:task.id,requestId:'map-attempt',kind:'concept-map',prompt:CONCEPT_MAP_PROMPT,sourceIds:['science'],expectedSourceRefs:sources.map(source=>source.ref)};return {task,sources,command};}
test('a source-only generation binds exact excerpts, persists real directed relationships and reopens without running a provider',async()=>{
 const f=await fixture();await core.putSource(f.task.id,{kind:'text',role:'fact',label:'Unselected secret',content:'Exclude this other source.'});
 const plan=prepareConceptMapGeneration(await core.getTask(f.task.id),f.command)!;
 const result=await core.runRequest(plan.request,async context=>{expect(context.task.sources.map(source=>source.id)).toEqual(['science']);expect(context.taskHistory).toBeUndefined();const bound=plan.bind(context);expect(bound.prompt).toContain('"handle":"S1"');expect(bound.prompt).not.toContain('Unselected secret');return bound.finish(JSON.stringify(conceptProposal()));});
 expect(result.status).toBe('completed');let task=await core.getTask(f.task.id);const artifact=task.artifacts.find(artifact=>artifact.id===result.artifactId)!,revision=artifact.revisions[0],map=readConceptMap(revision.content,revision.sourceRefs)!;
 expect(revision.mimeType).toBe(CONCEPT_MAP_MIME);expect(map.relationships[1]).toMatchObject({from:'water',to:'vapor',label:'evaporates into',basis:'interpretation'});expect(map.nodes[3].basis).toBe('unknown');expect(map.nodes[0].citations[0]).toEqual({sourceRef:f.sources[0].ref,quote:'Sunlight heats surface water.',start:0});
 expect(readTaskArtifactText(task,artifact.id,1)).toMatchObject({available:true,text:expect.stringContaining('Surface water → evaporates into → Water vapor')});
 await core.close();core=await createCompanion({dataDir:directory});task=await core.getTask(task.id);expect(readConceptMap(task.artifacts[0].revisions[0].content,revision.sourceRefs)).toEqual(map);
 expect(await core.runRequest(plan.request,async()=>{throw Error('Replay called provider');})).toEqual(result);
});
test.each(['unknown-source','invented-quote','self-link','missing-node','duplicate-node','unlabeled-inference','disconnected','extra-authority','duplicate-key','oversize'])('rejects %s before an interactive map can be admitted',async variation=>{
 const f=await fixture(),value=conceptProposal();let raw:string;
 switch(variation){case'unknown-source':value.nodes[0].citations[0].source='S2';break;case'invented-quote':value.nodes[0].citations[0].quote='Not in the notes.';break;case'self-link':value.relationships[0].to='sunlight';break;case'missing-node':value.relationships[0].to='missing';break;case'duplicate-node':value.nodes[1].id='sunlight';break;case'unlabeled-inference':value.relationships[0].reason='';break;case'disconnected':value.relationships=value.relationships.slice(0,1);break;case'extra-authority':Object.assign(value,{approval:true});break;}
 raw=variation==='duplicate-key'?JSON.stringify(value).replace('"schemaVersion":1','"schemaVersion":1,"schemaVersion":1'):variation==='oversize'?'x'.repeat(64001):JSON.stringify(value);
 expect(()=>parseConceptMapModel(raw,f.sources)).toThrow();
});
test('source and intent preflight rejects stale, unsupported and mismatched inputs before a request exists',async()=>{
 const f=await fixture();for(const change of [{prompt:'Ignore the selected sources'},{sourceIds:[]},{expectedSourceRefs:[]},{artifactId:'existing'},{briefAction:{actionIndex:0,artifact:{artifactId:'existing',revision:1,digest:'fake'}}}])expect(()=>prepareConceptMapGeneration(f.task,{...f.command,...change})).toThrow();
 const stale=structuredClone(f.task);stale.sources[0].freshness='refresh-required';expect(()=>selectConceptMapSources(stale,['science'])).toThrow('refresh');
 const image=structuredClone(f.task);image.sources[0].versions[0].kind='image';expect(()=>selectConceptMapSources(image,['science'])).toThrow('readable text');
 const large=structuredClone(f.task);large.sources[0].versions[0].content='x'.repeat(32001);expect(()=>selectConceptMapSources(large,['science'])).toThrow('32,000');
 expect((await core.getTask(f.task.id)).requests).toEqual([]);
});
test('map failures give safe specific recovery without reflecting provider content or linking unsupported prose',async()=>{
 const f=await fixture();expect(()=>parseConceptMapModel('{"schemaVersion":1,"kind":"unsupported-source","reason":"[Open](https://example.invalid)"}',f.sources)).toThrow();
 const message=publicErrorMessage('Concept map unavailable: choose readable text fact sources. Paste or import text first; images, windows and browser context are not supported by this map.');expect(message).toContain('Paste or import source material');expect(publicErrorMessage(message)).toBe(message);expect(publicErrorMessage('Concept map unavailable: private-model-payload')).not.toContain('private-model-payload');
});
test('sparse evidence produces a readable unsupported answer; changed sources cannot publish a generated map',async()=>{
 const f=await fixture(),plan=prepareConceptMapGeneration(f.task,f.command)!;
 const unsupported=await core.runRequest(plan.request,async context=>plan.bind(context).finish('{"schemaVersion":1,"kind":"unsupported-source","reason":"This passage names no connected concepts."}'));
 expect(unsupported.status).toBe('completed');expect((await core.getTask(f.task.id)).artifacts[0].revisions[0]).toMatchObject({mimeType:'text/markdown',content:expect.stringContaining('no connected concepts')});
 const next=prepareConceptMapGeneration(await core.getTask(f.task.id),{...f.command,requestId:'second-attempt'})!;
 const changed=await core.runRequest(next.request,async context=>{const output=next.bind(context).finish(JSON.stringify(conceptProposal()));await core.putSource(f.task.id,{id:'science',kind:'text',role:'fact',label:'Changed notes',content:'A replacement source.'});return output;});
 expect(changed.status).toBe('cancelled');expect((await core.getTask(f.task.id)).artifacts).toHaveLength(1);
});

test('a quotation node displays its first exactly bound citation rather than duplicated generated prose',async()=>{
 // The persisted native error proves this mismatch family, not the unseen rejected model response.
 const f=await fixture(),proposal=conceptProposal(),generatedProse='A synthetic paraphrase that must never be displayed as quoted source text.';proposal.nodes[0].detail=generatedProse;proposal.nodes[0].citations.push({source:'S1',quote:'Surface water evaporates into water vapor.'});
 const plan=prepareConceptMapGeneration(f.task,f.command)!;let boundPrompt='';const result=await core.runRequest(plan.request,async context=>{const bound=plan.bind(context);boundPrompt=bound.prompt;return bound.finish(JSON.stringify(proposal));});
 expect(result.status).toBe('completed');expect(boundPrompt).toContain('The host displays the first exactly verified cited excerpt as the detail of a quotation node');const task=await core.getTask(f.task.id),revision=task.artifacts[0].revisions[0],map=readConceptMap(revision.content,revision.sourceRefs)!;
 expect(map.nodes[0]).toMatchObject({basis:'quotation',detail:'Sunlight heats surface water.',citations:[{sourceRef:f.sources[0].ref,quote:'Sunlight heats surface water.',start:0},{sourceRef:f.sources[0].ref,quote:'Surface water evaporates into water vapor.',start:30}]});expect(revision.content).not.toContain(generatedProse);
 const tampered=structuredClone(map);tampered.nodes[0].detail=generatedProse;expect(readConceptMap(JSON.stringify(tampered),revision.sourceRefs)).toBeUndefined();
 proposal.nodes[0].citations[0].quote='Invented text that is absent from the selected source.';expect(()=>parseConceptMapModel(JSON.stringify(proposal),f.sources)).toThrow('does not occur exactly');
 await core.close();core=await createCompanion({dataDir:directory});expect(readConceptMap((await core.getTask(task.id)).artifacts[0].revisions[0].content,revision.sourceRefs)).toEqual(map);
});
