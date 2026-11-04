import {afterEach,beforeEach,expect,test} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion,type Companion} from '../src/core/companion';
import {readTaskArtifactText} from '../src/core/task-dialogue';
import {prepareExplanationMode} from '../src/host/explanation-modes';
import {EXPLANATION_ERROR,EXPLANATION_MIME,citationDisplay,parseExplanationModel,readExplanation,type ExplainDepth} from '../src/shared/explanation-modes';
import {layoutDiagram,validateDiagram} from '../src/shared/explanation-diagram';
import type {Command} from '../src/shared/bridge';
import {explanationProposal,explanationSource} from './explanation.fixture';
let core:Companion,directory:string;
beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'glint-explanation-'));core=await createCompanion({dataDir:directory});});
afterEach(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});
async function fixture(depth:ExplainDepth='quick'){
 const created=await core.createTask({title:'Evaporation'}),task=await core.putSource(created.id,{id:'science',kind:'text',role:'fact',label:'Science notes',content:explanationSource}),source=task.sources[0].versions[0],ref={sourceId:source.id,version:source.version,digest:source.digest};
 const command:Extract<Command,{type:'model.run'}>={type:'model.run',taskId:task.id,requestId:'explain-'+depth,kind:'explain',prompt:'Explain evaporation',explainDepth:depth,sourceIds:['science'],expectedSourceRefs:[ref]};
 return {task,source,ref,command,mode:prepareExplanationMode(task,command)!};
}
async function generate(depth:ExplainDepth){const f=await fixture(depth);const result=await core.runRequest({...f.command},async context=>f.mode.finish(JSON.stringify(explanationProposal(depth)),context.task.sources.map(source=>source.versions[0])));return {...f,result,task:await core.getTask(f.task.id)};}
test.each(['quick','deep','visual'] as const)('%s binds exact quotes, output and durable request identity, survives restart without replay',async depth=>{
 const f=await generate(depth);expect(f.result.status).toBe('completed');const revision=f.task.artifacts[0].revisions[0],value=readExplanation(revision.content)!;expect(revision.mimeType).toBe(EXPLANATION_MIME);expect(value.citations[0]).toMatchObject({status:'verified',start:17,end:45,digest:f.source.digest});expect(citationDisplay(f.task,value.citations[0]).state).toBe('verified');expect(f.task.requests[0].explainDepth).toBe(depth);
 const readable=readTaskArtifactText(f.task,f.task.artifacts[0].id,1);expect(readable).toMatchObject({available:true});expect(JSON.stringify(readable)).not.toContain('Water evaporates into vapor.');expect(JSON.stringify(readable)).not.toContain('citations');
 if(depth==='visual'&&readable.available)expect(readable.text).toContain('Water → evaporates → Vapor');
 await core.close();core=await createCompanion({dataDir:directory});expect(readExplanation((await core.getTask(f.task.id)).artifacts[0].revisions[0].content)).toEqual(value);expect(await core.runRequest({...f.command},async()=>{throw Error('Replay called provider');})).toEqual(f.result);await expect(core.runRequest({...f.command,explainDepth:depth==='deep'?'quick':'deep'},async()=>({title:'Wrong',content:'Wrong'}))).rejects.toThrow('different payload');
});
test.each(['prose','fence','unknown-field','duplicate-key','missing-deep','invalid-diagram','quote','whitespace','unknown-source','wrong-version','citation-index','oversize','nesting'])('rejects malformed %s without publishing arbitrary model bytes',async variant=>{
 const f=await fixture(variant==='missing-deep'?'deep':variant==='invalid-diagram'?'visual':'quick'),proposal:any=explanationProposal(f.command.explainDepth!);let raw='';
 switch(variant){case'unknown-field':proposal.authority='approved';break;case'missing-deep':delete proposal.deep;break;case'invalid-diagram':proposal.diagram.nodes[0].citation=2;break;case'quote':proposal.citations[0].quote='Invented source';break;case'whitespace':proposal.citations[0].quote='Water  evaporates into vapor.';break;case'unknown-source':proposal.citations[0].sourceId='private-unselected';break;case'wrong-version':proposal.citations[0].version=2;break;case'citation-index':proposal.answer='Water [2]';break;}
 raw=JSON.stringify(proposal);if(variant==='prose')raw='PRIVATE MODEL TEXT '+raw;if(variant==='fence')raw='```json\n'+raw+'\n```';if(variant==='duplicate-key')raw=raw.replace('"title":','"title":"other","title":');if(variant==='oversize')raw='x'.repeat(200001);if(variant==='nesting')raw='['.repeat(13)+']'.repeat(13);
 expect(()=>parseExplanationModel(raw,{depth:f.command.explainDepth!,sources:[f.source],fallbackTitle:'Explanation'})).toThrow(EXPLANATION_ERROR);
 const result=await core.runRequest({...f.command},async()=>f.mode.finish(raw,[f.source]));expect(result.status).toBe('failed');expect(result.error).toBe(EXPLANATION_ERROR);expect((await core.getTask(f.task.id)).artifacts).toHaveLength(0);
});
test('core refuses forged structured output and renders quotes only from their exact historical revision',async()=>{
 const f=await generate('quick'),value=readExplanation(f.task.artifacts[0].revisions[0].content)!;const forged={...value,citations:[{...value.citations[0],start:0}]};
 const rejected=await core.runRequest({...f.command,requestId:'forged-output'},async()=>({title:'Forged',mimeType:EXPLANATION_MIME,content:JSON.stringify(forged)}));expect(rejected.status).toBe('failed');
 const original=readExplanation(f.task.artifacts[0].revisions[0].content)!;await core.putSource(f.task.id,{id:'science',kind:'text',role:'fact',label:'Later notes',content:'A new source revision.'});const current=await core.getTask(f.task.id);expect(citationDisplay(current,original.citations[0]).state).toBe('stale');expect(current.sources[0].versions[0].content.slice(original.citations[0].start,original.citations[0].end)).toBe(original.citations[0].quote);
 const partial=structuredClone(current);partial.sources[0].versions[0].content='Water evaporates into vapor. extra';expect(citationDisplay(partial,original.citations[0]).state).toBe('not-found');
});
test.each(['cancel','source','restart'] as const)('late results after %s never publish or replace the saved answer',async action=>{
 const f=await fixture('visual');let entered!:()=>void,release!:()=>void;const started=new Promise<void>(done=>entered=done),waiting=new Promise<void>(done=>release=done);
 const pending=core.runRequest({...f.command},async context=>{entered();await waiting;return f.mode.finish(JSON.stringify(explanationProposal('visual')),context.task.sources.map(source=>source.versions[0]));});await started;
 if(action==='cancel')await core.cancelRequest(f.task.id,f.command.requestId);if(action==='source')await core.putSource(f.task.id,{id:'science',kind:'text',role:'fact',label:'Changed',content:'Changed during generation.'});if(action==='restart'){await core.close();core=await createCompanion({dataDir:directory});}
 release();if(action==='restart')await expect(pending).rejects.toThrow('closed');else expect((await pending).status).not.toBe('completed');const task=await core.getTask(f.task.id);expect(task.artifacts).toHaveLength(0);expect(task.requests[0].status).not.toBe('running');
});
test('diagram layout handles cycles, maximal width, groups and literal markup with deterministic finite geometry',()=>{
 const spec={direction:'down' as const,nodes:Array.from({length:24},(_,i)=>({id:'n'+i,kind:'concept' as const,label:i?'N'+i:'<script>alert(1)</script>',group:'g'})),edges:[{from:'n0',to:'n1'},{from:'n1',to:'n0'}],groups:[{id:'g',label:'Examples'}]};expect(validateDiagram(spec,0).ok).toBe(true);const layout=layoutDiagram(spec);expect(layout).toEqual(layoutDiagram(spec));expect(layout.edges.some(edge=>edge.back)).toBe(true);expect(JSON.stringify(layout)).not.toMatch(/NaN|Infinity/);expect(validateDiagram({...spec,html:'<svg/>'},0).ok).toBe(false);expect(validateDiagram({...spec,nodes:[...spec.nodes,spec.nodes[0]]},0).ok).toBe(false);
});
test('prompt-only answers invent no citation authority, and image citations remain explicitly unverified',async()=>{
 const empty=parseExplanationModel(JSON.stringify({title:'General idea',answer:'A general explanation.',citations:[]}),{depth:'quick',sources:[],fallbackTitle:'Explanation'});expect(empty.citations).toEqual([]);
 const f=await fixture(),image={...f.source,kind:'image' as const,content:'data:image/png;base64,aA=='},value=parseExplanationModel(JSON.stringify(explanationProposal('quick')),{depth:'quick',sources:[image],fallbackTitle:'Explanation'});expect(value.citations[0].status).toBe('image-unverified');expect(value.citations[0].start).toBeUndefined();expect(()=>parseExplanationModel(JSON.stringify(explanationProposal('quick')),{depth:'quick',sources:[],fallbackTitle:'Explanation'})).toThrow(EXPLANATION_ERROR);
});
test('depth revision resolves earlier questions only from the projected request context',async()=>{
 const f=await generate('quick'),artifact=f.task.artifacts[0],revision=artifact.revisions[0],mode=prepareExplanationMode(f.task,{...f.command,kind:'revise',artifactId:artifact.id,prompt:'Go deeper',explainDepth:'deep',explanationBasis:{artifactId:artifact.id,revision:revision.revision,digest:revision.digest}})!;
 const context={...f.task,requests:[],sources:[]};expect(mode.prompt('Go deeper',[],context)).not.toContain('Explain evaporation');expect(mode.prompt('Go deeper',[],context)).not.toContain('Science notes');expect(mode.prompt('Go deeper',[],context)).toContain('No sources are attached');
});
