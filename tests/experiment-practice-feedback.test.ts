import {expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {createExperimentPractice,inspectExperimentPractice} from '../src/core/experiment-practice-host';
import {ReadableText} from '../src/renderer/src/components/ReadableText';

const model={schemaVersion:1,kind:'experiment',title:'Cost',explanation:'Suggested cost.',spec:{title:'Cost',expression:{op:'add',left:{op:'multiply',left:{op:'variable',name:'rate'},right:{op:'variable',name:'time'}},right:{op:'variable',name:'fee'}},variables:[{name:'rate',unit:'USD/s',min:0,max:100},{name:'time',unit:'s',min:0,max:100},{name:'fee',unit:'USD',min:0,max:100}],assumptions:['Constant rate; one fee.']},inputs:{rate:3,time:4,fee:2}};
const paragraph='The practice inputs differ from these examples and the saved defaults. Earlier exposure remains unknown.';

it('renders comparison examples as a list followed by a separate feedback paragraph initially and with the saved title',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'experiment-feedback-'));let core=await createCompanion({dataDir:dir});try{
  const owner=await core.createTask({title:'Cost'}),source=await core.putSource(owner.id,{kind:'text',role:'fact',label:'Note',content:'Cost = rate × time + fee.'}),version=source.sources[0].versions[0],refs=[{sourceId:version.id,version:1,digest:version.digest}],saved=await core.saveArtifact(owner.id,{title:model.title,content:JSON.stringify(model),mimeType:'application/json',sourceRefs:refs}),basis={taskId:owner.id,basis:{artifactId:saved.artifactId,revision:1,digest:saved.revision.digest},expectedSourceRefs:refs};
  for(const count of [1,2]){
   const demonstratedInputs=[{rate:3,time:4,fee:2},{rate:4,time:3,fee:2}].slice(0,count),inputs={rate:4+count,time:3,fee:2},input={...basis,inputs,demonstratedInputs},created=await createExperimentPractice(core,{...input,prediction:15,reasoning:'I forgot the fee.'}),task=await core.getTask(owner.id),artifact=task.artifacts.find(a=>a.id===created.artifactId)!,revision=artifact.revisions[0];
   for(const leadingTitle of [undefined,revision.title]){
    const html=renderToStaticMarkup(createElement(ReadableText,{text:revision.content,leadingTitle})),list=html.match(/<ol\b[^>]*>[\s\S]*?<\/ol>/)?.[0];expect(list).toBeDefined();expect(list!.match(/<li\b/g)).toHaveLength(count);expect(list).not.toContain(paragraph);expect(html).toMatch(/<\/ol>\s*<p class="markdown-paragraph">The practice inputs differ from these examples and the saved defaults\. Earlier exposure remains unknown\.<\/p>/);expect(html).toContain('Your first prediction: 15 USD');expect(html).toContain('I forgot the fee.');
   }
   const again=await createExperimentPractice(core,{...input,prediction:999,reasoning:'Replace the first answer.'});expect(again).toEqual(created);expect((await core.getTask(owner.id)).artifacts.find(a=>a.id===created.artifactId)).toEqual(artifact);
  }
  const before=await core.getTask(owner.id);await core.close();core=await createCompanion({dataDir:dir});expect((await core.getTask(owner.id)).artifacts).toEqual(before.artifacts);await core.putSource(owner.id,{id:version.id,kind:'text',role:'fact',label:'Note',content:'Changed.'});await expect(inspectExperimentPractice(core,{...basis,inputs:{rate:5,time:3,fee:2},demonstratedInputs:[model.inputs]})).rejects.toThrow(/source changed/i);expect((await core.getTask(owner.id)).artifacts).toEqual(before.artifacts);
 }finally{await core.close();await rm(dir,{recursive:true,force:true});}
});
