import type {Plugin} from 'vite';
import {Schema} from 'effect';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createCompanion,type Companion} from '../src/core/companion';
import {createGroundedJoinArtifact} from '../src/core/grounded-join-host';
import {parseModuleAnswer,parseModuleAction} from '../src/core/interactive-modules';
import {editModule} from '../src/core/module-state';
import {extractionFixture} from './grounded-join-fixture';
const Id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200));
const parse=<A,I>(schema:Schema.Schema<A,I>,value:unknown)=>Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(value);
/** Disposable loopback-only test host. It never opens a native window or a provider. */
export function groundedJoinTestHost():Plugin{
 let core:Companion|undefined,root:string|undefined;
 return {name:'owned-grounded-join-test-host',async configureServer(server){
  root=await mkdtemp(join(tmpdir(),'grounded-join-browser-'));const host=core=await createCompanion({dataDir:root});
  server.middlewares.use('/__grounded',async(req,res)=>{
   res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store');
   try{
    const url=new URL(req.url??'/', 'http://127.0.0.1');let body:unknown={};
    if(req.method==='POST'){let raw='';for await(const chunk of req){raw+=chunk.toString();if(raw.length>128_000)throw Error('Test request too large.');}body=JSON.parse(raw||'{}');}
    if(req.method==='POST'&&url.pathname==='/new'){
     const {ambiguous,cited}=parse(Schema.Struct({ambiguous:Schema.Boolean,cited:Schema.optional(Schema.Boolean)}),body),f=extractionFixture(ambiguous,cited),task=await host.createTask({title:'Owned synthetic source journey'});
     await host.putSource(task.id,{kind:'text',label:'Owned synthetic source; no screen inference',role:'fact',content:f.content});
     const basis=await host.saveArtifact(task.id,{title:'Owned source brief',content:'The small supplied tables are the only source for this fixture.'});
     const request=await createGroundedJoinArtifact(host,{taskId:task.id,requestId:randomUUID(),id:'source-join',title:'Work with the cited table data',version:1,basis:{artifactId:basis.artifactId,revision:1,digest:basis.revision.digest},proposal:f.proposal,transfer:f.transfer});
     if(request.status!=='completed')throw Error(request.error??'Fixture admission failed.');
     res.end(JSON.stringify({task:await host.getTask(task.id),artifactId:request.artifactId}));return;
    }
    if(req.method==='GET'&&url.pathname==='/state'){
     const task=await host.getTask(parse(Id,url.searchParams.get('task'))),artifact=task.artifacts.find(a=>a.revisions.at(-1)?.mimeType==='application/vnd.window-companion.modules+json');
     res.end(JSON.stringify({task,artifactId:artifact?.id}));return;
    }
    if(req.method==='POST'&&url.pathname==='/edit'){
     const input=parse(Schema.Struct({taskId:Id,artifactId:Id,artifactRevision:Schema.Int,moduleId:Id,action:Schema.Unknown}),body),task=await host.getTask(input.taskId),artifact=task.artifacts.find(a=>a.id===input.artifactId),current=artifact?.revisions.at(-1);
     if(!current)throw Error('Fixture artifact unavailable.');
     const module=parseModuleAnswer(JSON.parse(current.content)).modules.find(m=>m.id===input.moduleId);if(!module)throw Error('Fixture module unavailable.');
     await editModule(host,{...input,action:parseModuleAction(input.action,module.data)});
     res.end(JSON.stringify({task:await host.getTask(input.taskId),artifactId:input.artifactId}));return;
    }
    if(req.method==='POST'&&(url.pathname==='/change-source'||url.pathname==='/change-basis')){
     const input=parse(Schema.Struct({taskId:Id,artifactId:Id}),body),task=await host.getTask(input.taskId),artifact=task.artifacts.find(a=>a.id===input.artifactId),current=artifact?.revisions.at(-1);
     if(!current)throw Error('Fixture artifact unavailable.');
     const data=parseModuleAnswer(JSON.parse(current.content)).modules[0].data;
     if(data.kind!=='grounded-join'||data.basis.kind!=='observed-source')throw Error('Fixture context unavailable.');
     if(url.pathname==='/change-source'){
      const source=task.sources[0],v=source.versions.at(-1);if(!v)throw Error('Fixture source unavailable.');
      await host.putSource(task.id,{id:v.id,kind:v.kind,label:v.label,role:v.role,content:v.content+'\nChanged source version'});
     }else await host.saveArtifact(task.id,{artifactId:data.basis.artifact.artifactId,expectedRevision:data.basis.artifact.revision,title:'Changed source brief',content:'A correction changed the basis artifact.'});
     res.end(JSON.stringify({task:await host.getTask(task.id),artifactId:artifact!.id}));return;
    }
    res.statusCode=404;res.end(JSON.stringify({error:'Unknown synthetic fixture route.'}));
   }catch(error){res.statusCode=409;res.end(JSON.stringify({error:error instanceof Error?error.message:'Synthetic host request failed.'}));}
  });
 },async closeBundle(){await core?.close();if(root)await rm(root,{recursive:true,force:true});}};
}
