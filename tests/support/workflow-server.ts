import type {Plugin} from 'vite';
import {Schema} from 'effect';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createCompanion,type Companion} from '../../src/core/companion';
import {createWorkflowArtifact} from '../../src/core/workflow-lab-host';
import {parseModuleAnswer,parseModuleAction} from '../../src/core/interactive-modules';
import {editModule,saveModuleDocument} from '../../src/core/module-state';
import {workflowExample} from '../../src/learning/workflow-example';
import {reviewedWorkflowDefinition,workflowRuleCitations,workflowSourceText} from './workflow-source-fixture';
const Id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200));
const parse=<A,I>(schema:Schema.Schema<A,I>,value:unknown)=>Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(value);
/** Disposable loopback-only real store. No native windows, captures or providers. */
export function workflowTestHost():Plugin{
 let core:Companion,root:string;
 return {name:'owned-finite-workflow-test-host',async configureServer(server){
  root=await mkdtemp(join(tmpdir(),'workflow-browser-'));core=await createCompanion({dataDir:root});
  server.middlewares.use('/__workflow',async(req,res)=>{
   res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store');
   try{
    const url=new URL(req.url??'/', 'http://127.0.0.1');let body:unknown={};
    if(req.method==='POST'){let raw='';for await(const chunk of req){raw+=chunk.toString();if(raw.length>128_000)throw Error('Test request too large.');}body=JSON.parse(raw||'{}');}
    if(req.method==='POST'&&url.pathname==='/new'){
     const {source}=parse(Schema.Struct({source:Schema.Boolean}),body),task=await core.createTask({title:'Owned synthetic workflow experiment'});
     let review;
     if(source){
      const t=await core.putSource(task.id,{kind:'text',label:'Owned synthetic text rules',role:'fact',content:workflowSourceText});
      const basis=await core.saveArtifact(task.id,{title:'Owned rule source basis',content:'Explicit synthetic rule interpretations; no real procedure.'});
      review={basis:{artifactId:basis.artifactId,revision:1,digest:basis.revision.digest},acknowledgement:'reviewed-rules' as const,ruleCitations:workflowRuleCitations(t.sources[0].id)};
     }
     const created=await createWorkflowArtifact(core,{taskId:task.id,requestId:randomUUID(),definition:source?reviewedWorkflowDefinition:workflowExample,...(review?{review}:{})});
     if(created.status!=='completed')throw Error(created.error??'Workflow fixture creation failed.');
     res.end(JSON.stringify({task:await core.getTask(task.id),artifactId:created.artifactId}));return;
    }
    if(req.method==='GET'&&url.pathname==='/state'){
     const task=await core.getTask(parse(Id,url.searchParams.get('task'))),artifact=task.artifacts.find(a=>a.revisions.at(-1)?.mimeType==='application/vnd.window-companion.modules+json');
     res.end(JSON.stringify({task,artifactId:artifact?.id}));return;
    }
    const input=parse(Schema.Struct({taskId:Id,artifactId:Id,artifactRevision:Schema.optional(Schema.Int),moduleId:Schema.optional(Id),action:Schema.optional(Schema.Unknown)}),body);
    const task=await core.getTask(input.taskId),artifact=task.artifacts.find(a=>a.id===input.artifactId),revision=artifact?.revisions.at(-1);
    if(!artifact||!revision)throw Error('Workflow fixture unavailable.');
    const module=parseModuleAnswer(JSON.parse(revision.content)).modules[0];
    if(module.data.kind!=='workflow-lab')throw Error('Workflow fixture kind unavailable.');
    let notes:string|undefined;
    if(req.method==='POST'&&url.pathname==='/edit'){
     if(input.artifactRevision===undefined||input.moduleId===undefined)throw Error('Exact workflow artifact/module required.');
     await editModule(core,{...input,artifactRevision:input.artifactRevision,moduleId:input.moduleId,action:parseModuleAction(input.action,module.data)});
    }else if(req.method==='POST'&&url.pathname==='/notes'){
     const saved=await saveModuleDocument(core,{taskId:task.id,artifactId:artifact.id,artifactRevision:revision.revision,sessionRevision:task.session?.revision??0});
     notes=(await core.getTask(task.id)).artifacts.find(a=>a.id===saved.artifactId)?.revisions.at(-1)?.content;
    }else if(req.method==='POST'&&url.pathname==='/restart'){
     await core.close();core=await createCompanion({dataDir:root});
    }else if(req.method==='POST'&&url.pathname==='/change-source'&&module.data.basis.kind==='reviewed-source'){
     const source=task.sources[0],v=source.versions.at(-1)!;
     await core.putSource(task.id,{id:v.id,kind:'text',label:v.label,role:'fact',content:v.content+'\nChanged owned source'});
    }else if(req.method==='POST'&&url.pathname==='/change-basis'&&module.data.basis.kind==='reviewed-source'){
     await core.saveArtifact(task.id,{artifactId:module.data.basis.artifact.artifactId,expectedRevision:module.data.basis.artifact.revision,title:'Changed owned basis',content:'Review this changed source basis.'});
    }else{res.statusCode=404;res.end(JSON.stringify({error:'Unknown workflow fixture route.'}));return;}
    res.end(JSON.stringify({task:await core.getTask(task.id),artifactId:artifact.id,...(notes?{notes}:{})}));
   }catch(error){res.statusCode=409;res.end(JSON.stringify({error:error instanceof Error?error.message:'Owned workflow request failed.'}));}
  });
 },async closeBundle(){await core?.close();if(root)await rm(root,{recursive:true,force:true});}};
}
