import {createServer,type Server} from 'node:http';
import {expect,it,vi} from 'vitest';
import {LocalBrowser,BrowserRedirectError} from '../src/host/browser/local-browser';
import {installLoopbackTestEngine} from './loopback-browser.fixture';
installLoopbackTestEngine();

async function listen(server:Server){await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();if(!address||typeof address==='string')throw Error('Missing owned test port');return `http://127.0.0.1:${address.port}`;}
async function close(server:Server){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}

it('never follows an authorized GET redirect to an unapproved origin',async()=>{
 let outside=0;const second=createServer((_req,res)=>{outside++;res.end('<h1>Unapproved destination</h1>');}),destination=await listen(second);
 const first=createServer((_req,res)=>{res.writeHead(302,{location:destination+'/outside'});res.end();}),origin=await listen(first);
 let browser:LocalBrowser|undefined;
 try{await expect(LocalBrowser.open({taskId:'get-redirect',origin,url:origin}).then(value=>{browser=value;})).rejects.toBeInstanceOf(BrowserRedirectError);expect(outside).toBe(0);}
 finally{await browser?.close();await close(first);await close(second);}
});

it('rejects sign-in details in the exact initial URL before launching a browser or contacting the site',async()=>{
 let contacted=0,registered=0;const server=createServer((_req,res)=>{contacted++;res.end('<h1>Owned site</h1>');}),origin=await listen(server);
 let browser:LocalBrowser|undefined;
 try{
  const url=origin.replace('http://','http://synthetic:synthetic@');
  await expect(LocalBrowser.open({taskId:'credential-url',origin,url,onWindowOwner:()=>{registered++;return()=>{};}}).then(value=>{browser=value;})).rejects.toThrow('sign-in details');
  expect(registered).toBe(0);expect(contacted).toBe(0);
 }finally{await browser?.close();await close(server);}
});

for(const code of [307,308])for(const crossOrigin of [false,true])it(`does not repeat an approved POST through ${code} to an unapproved ${crossOrigin?'origin':'URL'}`,async()=>{
 let approvedPosts=0,outsidePosts=0;const bodies:string[]=[],approvedBodies:string[]=[];
 const second=createServer((req,res)=>{if(req.method==='POST'){outsidePosts++;req.on('data',chunk=>bodies.push(chunk.toString()));}res.end('<h1>Unexpected destination</h1>');}),destination=await listen(second);
 let origin='';const first=createServer((req,res)=>{
  if(req.url==='/commit'&&req.method==='POST'){approvedPosts++;let body='';req.on('data',chunk=>body+=chunk.toString());req.on('end',()=>{approvedBodies.push(body);res.writeHead(code,{location:(crossOrigin?destination:origin)+'/unapproved'});res.end();});return;}
  if(req.url==='/unapproved'&&req.method==='POST'){outsidePosts++;req.on('data',chunk=>bodies.push(chunk.toString()));res.end('<h1>Unexpected destination</h1>');return;}
  res.setHeader('content-type','text/html');res.end('<h1>Owned form</h1><form action="/commit" method="post"><input type="hidden" name="choice" value="Creek"><button>Save choice</button></form>');
 });origin=await listen(first);let browser:LocalBrowser|undefined;
 try{
  browser=await LocalBrowser.open({taskId:'post-redirect',origin,url:origin});const snapshot=await browser.observe(),target=snapshot.targets.find(target=>target.label==='Save choice');if(!target)throw Error('Missing owned button');
  const proposal=await browser.propose({kind:'click',snapshotId:snapshot.id,targetId:target.id});
  await browser.execute(proposal.id,browser.approve(proposal.id,{method:'POST',url:origin+'/commit',body:'choice=Creek'})).catch(()=>undefined);
  expect(approvedPosts).toBe(1);expect(approvedBodies).toEqual(['choice=Creek']);expect(outsidePosts).toBe(0);expect(bodies).toEqual([]);expect(browser.proposal(proposal.id)?.status).toBe('uncertain');
  await expect(browser.execute(proposal.id,'replay')).rejects.toThrow('already');expect(approvedPosts).toBe(1);
 }finally{await browser?.close();await close(first);await close(second);}
});

for(const kind of ['script','worker','frame'] as const)it(`blocks a redirected ${kind} request before the unapproved server is contacted`,async()=>{
 let outside=0;const second=createServer((_req,res)=>{outside++;res.setHeader('access-control-allow-origin','*');res.setHeader('content-type','application/javascript');res.end('');}),destination=await listen(second);
 const first=createServer((req,res)=>{
  if(req.url==='/hop'){res.writeHead(302,{location:destination+'/outside'});res.end();return;}
  if(req.url==='/worker.js'){res.setHeader('content-type','application/javascript');res.end("fetch('/hop').then(()=>postMessage('done'),()=>postMessage('done'))");return;}
  res.setHeader('content-type','text/html');
  res.end('<h1>Owned request test</h1>'+ (kind==='worker'?"<script>const worker=new Worker('/worker.js');worker.onmessage=()=>document.body.append('Request finished');</script>":kind==='script'?'<script src="/hop" onload="document.body.append(\'Request finished\')" onerror="document.body.append(\'Request finished\')"></script>':'<iframe src="/hop" onload="document.body.append(\'Request finished\')"></iframe>'));
 }),origin=await listen(first);let browser:LocalBrowser|undefined;
 try{
  browser=await LocalBrowser.open({taskId:'subresource-redirect',origin,url:origin});
  await expect.poll(async()=>(await browser!.observe()).text).toContain('Request finished');expect(outside).toBe(0);
 }finally{await browser?.close();await close(first);await close(second);}
});
