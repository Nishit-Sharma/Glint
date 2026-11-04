import {afterEach,expect,it,vi} from 'vitest';
import * as fs from 'node:fs/promises';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {sourceFormulaFixture} from '../support/source-formula.fixture';
import {createCompanion} from '../../src/core/companion';
import {saveSourceFormula} from '../../src/core/source-formula-host';
import {inspectFormulaComparison,previewFormulaComparison} from '../../src/core/formula-comparison-host';
import {inspectExperimentPractice} from '../../src/core/experiment-practice-host';
import {inspectTargetPractice} from '../../src/core/experiment-target-practice-host';
vi.mock('node:fs/promises',{spy:true});
const cleanups:Array<()=>Promise<void>>=[];afterEach(async()=>{vi.restoreAllMocks();for(const close of cleanups.splice(0).reverse())await close();});
async function fixture(excluded=true){
 const f=await sourceFormulaFixture();let core=f.core;cleanups.push(async()=>{await core.close();await f.close();});
 const saved=await saveSourceFormula(core,{input:f.input}),basis={artifactId:saved.artifactId,revision:saved.revision,digest:saved.digest},base={taskId:f.task.id,basis,expectedSourceRefs:[f.input.sourceRef]},practice={...base,inputs:{rate:5,time:3,fee:2},prediction:15,reasoning:'First exact prediction.'},comparison={...base,formula:'rate * time - fee',variable:'time',minimum:0,maximum:16,prediction:'none' as const,reasoning:'First exact comparison.',freshPrediction:'0',shareWithTask:true as const},target={...base,variable:'time',demonstratedInputs:[],answer:25,reasoning:'First exact target.',shareWithTask:true as const},sourceCommand={input:{...f.input,title:'A separately reviewed transcription'}};
 if(excluded)await core.setSourceSelection({type:'source-selection.set',taskId:f.task.id,expectedRevision:0,sourceIds:[]});
 const entries=()=>[
  {name:'practice',raw:practice,save:(raw:unknown,guard?:()=>void)=>core.saveExperimentPractice(raw,guard)},
  {name:'comparison',raw:comparison,save:(raw:unknown,guard?:()=>void)=>core.saveFormulaComparison(raw,guard)},
  {name:'target',raw:target,save:(raw:unknown,guard?:()=>void)=>core.saveTargetPractice(raw,guard)},
  {name:'source',raw:sourceCommand,save:(raw:unknown,guard?:()=>void)=>core.saveSourceFormula(raw,guard)},
 ];
 return {...f,get core(){return core},entries,practice,comparison,target,sourceCommand,base,async reopen(){await core.close();core=await createCompanion({dataDir:f.directory});}};
}
it.each([true,false])('four concrete local saves work with excluded=%s, persist once and leave all outgoing kinds fenced',async excluded=>{
 const f=await fixture(excluded),before=await f.core.getTask(f.task.id),results=[];for(const entry of f.entries()){const saved=await entry.save(entry.raw);results.push(saved);expect(await entry.save(entry.raw)).toMatchObject({artifactId:saved.artifactId,digest:saved.digest});}
 await f.reopen();for(const [index,entry] of f.entries().entries())expect(await entry.save(entry.raw)).toMatchObject({artifactId:results[index].artifactId,digest:results[index].digest});
 const task=await f.core.getTask(f.task.id);expect(task.artifacts).toHaveLength(5);expect(task.requests).toHaveLength(5);expect(task.actions).toEqual(before.actions);expect(task.artifacts[0]).toEqual(before.artifacts[0]);expect(task.session?.sourceSelection).toEqual(before.session?.sourceSelection);
 await f.core.setSourceSelection({type:'source-selection.set',taskId:task.id,expectedRevision:excluded?1:0,sourceIds:[]});const callback=vi.fn(async()=>({title:'Forbidden',content:'Forbidden output'}));for(const kind of ['explain','create','revise','experiment','procedure','brief','concept-map','design-canvas','browser'])await expect(f.core.runRequest({taskId:task.id,requestId:'blocked-'+kind,kind,prompt:'Excluded sources',sourceIds:[f.source.id]},callback)).rejects.toThrow('Source selection changed');expect(callback).not.toHaveBeenCalled();
 await f.core.runRequest({taskId:task.id,requestId:'empty-projection',kind:'explain',prompt:'Empty selection',sourceIds:[]},async context=>{expect(context.task.artifacts).toEqual([]);expect(context.taskHistory).not.toContain('First exact');return {title:'Empty',content:'No excluded local history'};});
});
it('strict concrete commands reject getters and forged content/runner/selection flags without mutation; prediction range is retained',async()=>{
 const f=await fixture(),before=await readFile(join(f.directory,'tasks.json'),'utf8');for(const entry of f.entries()){for(const extra of [{content:'Forged'},{output:'Forged'},{runner:()=>({})},{skipSourceSelection:true}])await expect(entry.save({...entry.raw,...extra})).rejects.toThrow();}
 let reads=0;const getter={...f.practice};Object.defineProperty(getter,'reasoning',{enumerable:true,get(){reads++;return 'Getter';}});await expect(f.core.saveExperimentPractice(getter)).rejects.toThrow();expect(reads).toBe(0);expect(await readFile(join(f.directory,'tasks.json'),'utf8')).toBe(before);
 const saved=await f.core.saveExperimentPractice({...f.practice,prediction:1e15});expect((await f.core.getTask(f.task.id)).artifacts.find(a=>a.id===saved.artifactId)!.revisions[0].content).toContain('Your first prediction: 1000000000000000 USD');
});
it.each(['wrong-source','stale','revoked','paused'] as const)('four new saves reject %s without publication',async change=>{
 const f=await fixture();let entries:Array<{name:string;raw:Record<string,unknown>;save:(raw:unknown,guard?:()=>void)=>Promise<unknown>}>=f.entries();if(change==='wrong-source')entries=entries.map(entry=>({...entry,raw:entry.name==='source'?{input:{...f.sourceCommand.input,sourceRef:{...f.input.sourceRef,digest:'bad'}}}:{...entry.raw,expectedSourceRefs:[{...f.input.sourceRef,digest:'bad'}]}}));
 if(change==='stale')await f.core.invalidateSource(f.task.id,f.source.id,'Owned stale evidence');if(change==='revoked')await f.core.revokeSource(f.task.id,f.source.id);if(change==='paused')await f.core.pause(f.task.id);
 const before=await readFile(join(f.directory,'tasks.json'),'utf8');for(const entry of entries)await expect(entry.save(entry.raw)).rejects.toThrow();expect(await readFile(join(f.directory,'tasks.json'),'utf8')).toBe(before);
});
it('concrete commits recheck owner guard and exact cloned raw fields; no partial journal on precommit retirement',async()=>{
 const f=await fixture();for(const entry of f.entries()){let checks=0;await expect(entry.save(entry.raw,()=>{if(++checks===2)throw Error('Retired before commit');})).rejects.toThrow('Retired before commit');}
 expect((await f.core.getTask(f.task.id)).requests).toHaveLength(1);
 const raw={...f.practice,inputs:{...f.practice.inputs}},pending=f.core.saveExperimentPractice(raw);raw.reasoning='Changed after dispatch';raw.inputs.rate=99;const result=await pending;expect((await f.core.getTask(f.task.id)).artifacts.find(a=>a.id===result.artifactId)!.revisions[0].content).toContain('First exact prediction.');
});
it('atomic failure has no receipt after reopen; retired acknowledgement after durable save remains inspectable without replay',async()=>{
 const f=await fixture(),before=await readFile(join(f.directory,'tasks.json'),'utf8'),failure=vi.spyOn(fs,'rename').mockRejectedValueOnce(Error('Owned teaching disk failure'));await expect(f.core.saveExperimentPractice(f.practice)).rejects.toThrow();failure.mockRestore();expect(await readFile(join(f.directory,'tasks.json'),'utf8')).toBe(before);await f.reopen();const {prediction,reasoning,...input}=f.practice;expect(await inspectExperimentPractice(f.core,input)).toMatchObject({kind:'not-started'});
 let enter!:()=>void,release!:()=>void,current=true;const entered=new Promise<void>(resolve=>enter=resolve),gate=new Promise<void>(resolve=>release=resolve),rename=fs.rename,held=vi.spyOn(fs,'rename').mockImplementationOnce(async(...args)=>{enter();await gate;return rename(...args);});
 const pending=f.core.saveFormulaComparison(f.comparison,()=>{if(!current)throw Error('Retired after durable write');}),rejected=expect(pending).rejects.toThrow('Retired after durable write');await entered;current=false;release();await rejected;held.mockRestore();await f.reopen();const saved=await inspectFormulaComparison(f.core,f.comparison);expect(saved.kind).toBe('completed');expect(await f.core.saveFormulaComparison(f.comparison)).toEqual(saved);expect((await f.core.getTask(f.task.id)).artifacts).toHaveLength(2);
});
it('normal practice inherits indirect source and exact selected skill; withdrawn skill or inherited source blocks new publication',async()=>{
 const f=await fixture(false),task=await f.core.putSource(f.task.id,{id:'context',kind:'text',role:'fact',label:'Inherited',content:'Inherited private evidence'}),refs=task.sources.map(s=>({sourceId:s.id,version:s.currentVersion,digest:s.versions.at(-1)!.digest})),skill=await f.core.saveInstructionSkill({taskId:task.id,intentId:'teaching-skill',name:'Teaching',description:'Owned',instructions:'Preserve evidence.',resources:[]});await f.core.setInstructionSkill(task.id,0,skill.reference);
 const draft={schemaVersion:1,kind:'experiment',title:'Skilled cost',explanation:'Hypothetical.',spec:f.preview.draft.spec,inputs:f.preview.draft.inputs},seed=await f.core.runRequest({taskId:task.id,requestId:'skilled-seed',kind:'create',prompt:'Synthetic',sourceIds:refs.map(r=>r.sourceId),instructionSkill:skill.reference,instructionSkillRevision:1},async()=>({title:draft.title,content:JSON.stringify(draft),mimeType:'application/json',sourceRefs:[f.input.sourceRef]}));
 const edited=await f.core.saveArtifact(task.id,{artifactId:seed.artifactId!,expectedRevision:1,title:draft.title,content:JSON.stringify(draft),mimeType:'application/json',sourceRefs:[f.input.sourceRef]}),value={...f.practice,basis:{artifactId:seed.artifactId!,revision:edited.revision.revision,digest:edited.revision.digest}};await f.core.setSourceSelection({type:'source-selection.set',taskId:task.id,expectedRevision:0,sourceIds:[]});const saved=await f.core.saveExperimentPractice(value),after=await f.core.getTask(task.id),record=after.artifacts.find(a=>a.id===saved.artifactId)!.revisions[0],receipt=after.requests.find(r=>r.artifactId===saved.artifactId)!;expect(record.contextSourceRefs).toEqual(refs);expect(receipt.contextSourceRefs).toEqual(refs);expect(record.contextSkillRefs).toEqual([skill.reference]);expect(receipt.contextSkillRefs).toEqual([skill.reference]);
 await f.core.setInstructionSkill(task.id,1,null);await expect(f.core.saveExperimentPractice({...value,inputs:{rate:6,time:3,fee:2}})).rejects.toThrow(/selected skill changed/);await f.core.setInstructionSkill(task.id,2,skill.reference);await f.core.revokeSource(task.id,'context');await expect(f.core.saveExperimentPractice({...value,inputs:{rate:6,time:3,fee:2}})).rejects.toThrow(/Source changed/);
});
it.each(['same-owner','other-owner'] as const)('preserves exclusive publication admission during a held ordinary response on %s, but completed replay stays read-only',async location=>{
 const f=await fixture(),ordinaryOwner=location==='same-owner'?f.task:await f.core.createTask({title:'Independent ordinary owner'});
 async function ordinary(id:string){let entered!:()=>void,release!:()=>void;const started=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve),pending=f.core.runRequest({taskId:ordinaryOwner.id,requestId:id,kind:'explain',prompt:'Held inert ordinary response',sourceIds:[]},async()=>{entered();await gate;return {title:'Ordinary inert response',content:'No provider was called.'};});await started;return {pending,release};}
 const first=await ordinary('publication-admission-first');try{const before=await readFile(join(f.directory,'tasks.json'),'utf8');for(const entry of f.entries())await expect(entry.save(entry.raw)).rejects.toThrow(/Wait for the current task response|Finish active work/);expect(await readFile(join(f.directory,'tasks.json'),'utf8')).toBe(before);}finally{first.release();await first.pending;}
 const saved=[];for(const entry of f.entries())saved.push(await entry.save(entry.raw));
 const second=await ordinary('publication-admission-replay');try{const before=await readFile(join(f.directory,'tasks.json'),'utf8');for(const [index,entry] of f.entries().entries())expect(await entry.save(entry.raw)).toMatchObject({artifactId:saved[index].artifactId,digest:saved[index].digest});expect(await readFile(join(f.directory,'tasks.json'),'utf8')).toBe(before);}finally{second.release();await second.pending;}
});
