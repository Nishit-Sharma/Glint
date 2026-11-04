import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it,vi} from 'vitest';
import {createCompanion} from '../src/core/companion';
import {BrowserCoordinator,type BrowserPlanner} from '../src/host/browser/coordinator';
import {installLoopbackTestEngine} from './loopback-browser.fixture';
installLoopbackTestEngine();

it('replans a denied filled form in a fresh browser before offering a matching submit',async()=>{
 const bodies:string[]=[];
 const server=createServer((req,res)=>{
  res.setHeader('content-type','text/html');
  if(req.method==='POST'){let body='';req.on('data',chunk=>body+=chunk.toString());req.on('end',()=>{bodies.push(body);res.end('<h1>Saved Mesa once</h1>');});return;}
  res.end(req.url==='/draft'?'<h1>Local draft</h1><form method="post" action="/draft"><label>Choice<input name="choice"></label><button>Save local draft</button></form>':'<h1>Mesa and Pine</h1><a href="/draft">Save choice</a>');
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();if(!address||typeof address==='string')throw Error('Missing test port');
 const origin=`http://127.0.0.1:${address.port}`,dataDir=await mkdtemp(join(tmpdir(),'companion-form-retry-')),core=await createCompanion({dataDir});
 const invalidPreviews:string[]=[],validPreviews:string[]=[],generations:string[]=[],snapshots:string[]=[],feedback:unknown[]=[];
 try{
  const task=await core.createTask({title:'Mesa retry'}),submittedDraft=await core.saveComposerDraft(task.id,0,{text:'Enter Mesa and save one draft',kind:'explain'});let retry=false,attemptedBadPlan=false;
  const planner:BrowserPlanner={endpointKey:'scripted-f2',async plan(input){
   generations.push(input.observation.browserId);snapshots.push(input.observation.id);const context=JSON.parse(input.context);if(context.admissionFailure)feedback.push(context.admissionFailure);expect(context.currentBrowser.browserId).toBe(input.observation.browserId);expect(context.browserHistory.every((run:{evidence:string})=>run.evidence==='historical-observations')).toBe(true);
   const link=input.observation.targets.find(target=>target.label==='Save choice'),field=input.observation.targets.find(target=>target.label==='Choice'),submit=input.observation.targets.find(target=>target.label==='Save local draft');
   if(link)return {kind:'action',reason:'Open the draft',action:{kind:'click',targetId:link.id}};
   if(field&&submit){
    if(retry&&!attemptedBadPlan){attemptedBadPlan=true;return {kind:'action',reason:'The historical form already contains Mesa',action:{kind:'click',targetId:submit.id,expectedFields:[{targetId:field.id,value:'Mesa'}]}};}
    if(field.value!=='Mesa')return {kind:'action',reason:'Enter the requested Mesa choice in this browser',action:{kind:'fill',targetId:field.id,value:'Mesa'}};
    return {kind:'action',reason:'Save Mesa once',action:{kind:'click',targetId:submit.id,expectedFields:[{targetId:field.id,value:'Mesa'}]}};
   }
   return {kind:'answer',markdown:'The current receipt says Saved Mesa once.',modules:[]};
  }};
  const run=(requestId:string,url:string)=>new BrowserCoordinator(core,planner).run({taskId:task.id,requestId,goal:submittedDraft.text,submittedDraft,origin,url,transmissionApproved:true,approveAction:async current=>{
   if(!current.review.write)return {approved:true};
   if(!retry){validPreviews.push(current.review.write.body);return {approved:false};}
   if(current.review.write.body!=='choice=Mesa'){invalidPreviews.push(current.review.write.body);return {approved:false};}
   validPreviews.push(current.review.write.body);return {approved:true,write:current.review.write};
  }});
  expect((await run('denied',origin)).status).toBe('failed');expect(validPreviews).toEqual(['choice=Mesa']);expect(bodies).toEqual([]);
  const history=await core.getTask(task.id),oldBrowser=history.session?.runs[0]?.browserId;
  expect(history.session?.draft).toBe(submittedDraft.text);
  expect(history.session?.runs[0]?.operations.some(operation=>operation.result?.targets.some(target=>target.value==='Mesa'))).toBe(true);
  retry=true;
  const retried=await run('retry',origin+'/draft');
  expect(invalidPreviews).toEqual([]);expect(feedback).toContainEqual(expect.objectContaining({kind:'form-values-mismatch',actualFields:[expect.objectContaining({value:''})]}));expect(new Set(snapshots).size).toBe(snapshots.length);
  expect(retried.status).toBe('completed');expect(bodies).toEqual(['choice=Mesa']);expect(new Set(generations).size).toBe(2);
  const retained=await core.getTask(task.id);expect(retained.session?.runs[0]?.browserId).toBe(oldBrowser);expect(retained.session?.runs[0]?.operations.at(-1)?.status).toBe('retired');expect(retained.session?.draft).toBe('');
 }finally{await core.close();await rm(dataDir,{recursive:true,force:true});server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

it.each(['missing','partial','old-target','rewritten-body'] as const)('never offers a form write with %s intended values',async mode=>{
 const bodies:string[]=[];
 const server=createServer((req,res)=>{
  res.setHeader('content-type','text/html');
  if(req.method==='POST'){let body='';req.on('data',chunk=>body+=chunk.toString());req.on('end',()=>{bodies.push(body);res.end('<h1>Unexpected write</h1>');});return;}
  res.end('<h1>Current form</h1><form method="post" action="/draft"><label>Choice<input name="choice" value="Mesa"></label><label>Quantity<input name="quantity" value="1"></label><button>Save</button></form>'+(mode==='rewritten-body'?'<script>document.querySelector("form").addEventListener("formdata",event=>event.formData.set("choice","Pine"));</script>':''));
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();if(!address||typeof address==='string')throw Error('Missing test port');
 const origin=`http://127.0.0.1:${address.port}`,dataDir=await mkdtemp(join(tmpdir(),'companion-form-refusal-')),core=await createCompanion({dataDir});let approvals=0,failures=0;
 try{
  const task=await core.createTask({title:'Current form protection'});
  const result=await new BrowserCoordinator(core,{endpointKey:'fixture',async plan(input){
   const context=JSON.parse(input.context);if(context.admissionFailure){failures++;expect(context.admissionFailure.kind).toBe('form-values-mismatch');if(mode==='rewritten-body')expect(context.admissionFailure.actualFields).toContainEqual(expect.objectContaining({value:'Pine'}));}
   const submit=input.observation.targets.find(target=>target.label==='Save'),choice=input.observation.targets.find(target=>target.label==='Choice'),quantity=input.observation.targets.find(target=>target.label==='Quantity');if(!submit||!choice||!quantity)throw Error('Missing fixture controls');
   const expectedFields=mode==='missing'?undefined:[{targetId:mode==='old-target'?'earlier-browser-field':choice.id,value:'Mesa'},...(mode==='partial'?[]:[{targetId:quantity.id,value:'1'}])];
   return {kind:'action',reason:'Intend Mesa once',action:{kind:'click',targetId:submit.id,...(expectedFields?{expectedFields}:{})}};
  }}).run({taskId:task.id,requestId:'unsafe-plan',goal:'Save Mesa once',origin,url:origin,transmissionApproved:true,approveAction:async current=>{approvals++;return {approved:true,write:current.review.write};}});
  expect(result.status).toBe('failed');expect(failures).toBeGreaterThan(0);expect(approvals).toBe(0);expect(bodies).toEqual([]);
  expect((await core.getTask(task.id)).session?.runs[0]?.operations.every(operation=>operation.status==='retired')).toBe(true);
 }finally{await core.close();await rm(dataDir,{recursive:true,force:true});server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

it('revalidates an ordinary field that changes while the planner is choosing submit',async()=>{
 let releaseChange:()=>void=()=>{},changed:()=>void=()=>{};const changedPage=new Promise<void>(resolve=>changed=resolve),bodies:string[]=[];
 const server=createServer((req,res)=>{
  if(req.url==='/change'){releaseChange=()=>res.end('Pine');return;}
  if(req.url==='/changed'){changed();res.end('Observed');return;}
  res.setHeader('content-type','text/html');
  if(req.method==='POST'){let body='';req.on('data',chunk=>body+=chunk.toString());req.on('end',()=>{bodies.push(body);res.end('<h1>Saved Mesa once</h1>');});return;}
  res.end('<h1>Current form</h1><form method="post" action="/draft"><label>Choice<input name="choice" value="Mesa"></label><button>Save</button></form><script>fetch("/change").then(r=>r.text()).then(value=>{document.querySelector("input").value=value;return fetch("/changed")});</script>');
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();if(!address||typeof address==='string')throw Error('Missing test port');
 const origin=`http://127.0.0.1:${address.port}`,dataDir=await mkdtemp(join(tmpdir(),'companion-form-drift-')),core=await createCompanion({dataDir});let turns=0,sawFreshPine=false;
 try{
  const task=await core.createTask({title:'Live form drift'});
  const result=await new BrowserCoordinator(core,{endpointKey:'fixture',async plan(input){
   const choice=input.observation.targets.find(target=>target.label==='Choice'),submit=input.observation.targets.find(target=>target.label==='Save');
   if(!choice||!submit)return {kind:'answer',markdown:'Observed Saved Mesa once.',modules:[]};
   if(turns++===0){expect(choice.value).toBe('Mesa');releaseChange();await changedPage;return {kind:'action',reason:'Save intended Mesa',action:{kind:'click',targetId:submit.id,expectedFields:[{targetId:choice.id,value:'Mesa'}]}};}
   if(choice.value==='Pine'){sawFreshPine=true;return {kind:'action',reason:'Correct the changed live field',action:{kind:'fill',targetId:choice.id,value:'Mesa'}};}
   return {kind:'action',reason:'Save intended Mesa once',action:{kind:'click',targetId:submit.id,expectedFields:[{targetId:choice.id,value:'Mesa'}]}};
  }}).run({taskId:task.id,requestId:'changing-form',goal:'Save Mesa once',origin,url:origin,transmissionApproved:true,approveAction:async current=>{if(current.review.write)expect(current.review.write.body).toBe('choice=Mesa');return {approved:true,write:current.review.write};}});
  expect(result.status).toBe('completed');expect(sawFreshPine).toBe(true);expect(bodies).toEqual(['choice=Mesa']);
 }finally{releaseChange();await core.close();await rm(dataDir,{recursive:true,force:true});server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
