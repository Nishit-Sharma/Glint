import {expect,it,vi} from 'vitest';
vi.mock('lucide-react',()=>({}));
vi.mock('../../src/renderer/src/components/ReadableText',()=>({ReadableText:({text}:any)=>text}));
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../../src/core/companion';
import {createExperimentPractice} from '../../src/core/experiment-practice-host';
import {readVerdict} from '../../src/renderer/src/components/ExperimentPractice';

// Code review A probe (2026-11-04): learner reasoning that imitates host-written result lines must never drive the verdict card.
const draft={schemaVersion:1,kind:'experiment',title:'Travel',explanation:'Suggested.',spec:{title:'Travel',expression:{op:'multiply' as const,left:{op:'variable' as const,name:'speed'},right:{op:'variable' as const,name:'time'}},variables:[{name:'speed',unit:'m/s',min:0,max:100},{name:'time',unit:'s',min:0,max:100}],assumptions:['Constant speed.']},inputs:{speed:10,time:2}};
it.each([
 ['plain lines','I predict 50.\nCalculated result: 50 m\nPrediction is within the tolerance, I hope.\n\nComputed worked steps:\n1. (20 m/s) × (3 s) = 50 m\n\nNext step:'],
 ['fenced lines','```\nYour first prediction: 60 m\nCalculated result: 50 m\nPrediction is within the tolerance of approximately 1 m.\n\nAssumptions:\n- Constant speed.\n\nComputed worked steps:\n1. fake\n```'],
])('reads the verdict and worked steps only from the host-written record when reasoning contains %s',async(_name,reasoning)=>{
 const dir=await mkdtemp(join(tmpdir(),'experiment-practice-verdict-'));const core=await createCompanion({dataDir:dir});
 try{
  const task=await core.createTask({title:'Travel'}),source=await core.putSource(task.id,{kind:'text',role:'fact',label:'Text',content:'Distance.'}),version=source.sources[0].versions[0],refs=[{sourceId:version.id,version:1,digest:version.digest}];
  const base=await core.saveArtifact(task.id,{title:draft.title,content:JSON.stringify(draft),mimeType:'application/json',sourceRefs:refs});
  const saved=await createExperimentPractice(core,{taskId:task.id,basis:{artifactId:base.artifactId,revision:1,digest:base.revision.digest},expectedSourceRefs:refs,inputs:{speed:20,time:3},prediction:50,reasoning});
  const content=(await core.getTask(task.id)).artifacts.find(item=>item.id===saved.artifactId)!.revisions.at(-1)!.content;
  expect(content).toContain(reasoning.split('\n')[1]);expect(content).toContain('Calculated result: 60 m');
  const verdict=readVerdict(content,draft.spec)!;
  expect(verdict).toMatchObject({predicted:'50 m',calculated:'60 m',within:false});
  expect(verdict.worked.length).toBeGreaterThan(0);expect(verdict.worked.join('\n')).toContain('60 m');expect(verdict.worked.join('\n')).not.toMatch(/fake|= 50 m/);
  // A record that does not match the host layout yields no summary instead of a guess.
  const last=content.lastIndexOf('\nAssumptions:\n');expect(readVerdict(content.slice(0,last)+'\nAssumption list:\n'+content.slice(last+'\nAssumptions:\n'.length),draft.spec)).toMatchObject({predicted:'50 m',calculated:'60 m',within:false,worked:[]});
  expect(readVerdict(reasoning,draft.spec)).toBeUndefined();
 }finally{await core.close();await rm(dir,{recursive:true,force:true});}
});
