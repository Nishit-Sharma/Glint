import {createServer} from 'node:http';
import {expect,it,vi} from 'vitest';
import {LocalBrowser} from '../src/host/browser/local-browser';
import {installLoopbackTestEngine} from './loopback-browser.fixture';
installLoopbackTestEngine();

it('enforces the workflow path on initial URLs, assets, GET/HEAD requests and exact form writes',async()=>{
 const received:string[]=[],server=createServer((request,response)=>{
  received.push(request.method+' '+request.url);
  response.setHeader('content-type','text/html');
  if(request.url==='/requests/start')response.end(`<h1>Scoped workflow</h1><img src="/requests/pixel"><img src="/outside/image"><script>Promise.all([fetch('/outside/get').catch(()=>{}),fetch('/outside/head',{method:'HEAD'}).catch(()=>{}),fetch('/requests-neighbor/get').catch(()=>{})]);</script><form action="/outside/submit" method="post"><button>Save outside</button></form><button type="button" onclick="fetch('/outside/click').catch(()=>{})">Try outside request</button>`);
  else response.end('Owned disposable response');
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();if(!address||typeof address==='string')throw Error('Missing disposable port');const origin='http://127.0.0.1:'+address.port;
 let browser:LocalBrowser|undefined;
 try{
  let windows=0;
  await expect(LocalBrowser.open({taskId:'scoped',origin,url:origin+'/outside/start',pathPrefix:'/requests/',onWindowOwner:()=>{windows++;return()=>{};}})).rejects.toThrow('outside the authorized path');
  expect(windows).toBe(0);expect(received).toEqual([]);
  browser=await LocalBrowser.open({taskId:'scoped',origin,url:origin+'/requests/start',pathPrefix:'/requests/'});
  await expect.poll(()=>browser!.diagnostics.blockedRequests).toBeGreaterThanOrEqual(4);
  await expect.poll(()=>received).toContain('GET /requests/pixel');
  let observation=await browser.observe(),target=observation.targets.find(target=>target.label==='Save outside')!,proposal=await browser.propose({kind:'click',snapshotId:observation.id,targetId:target.id});
  await expect(browser.review(proposal.id)).rejects.toThrow('path outside this workflow');
  expect(()=>browser!.approve(proposal.id,{method:'POST',url:origin+'/outside/submit',body:''})).toThrow('outside this browser authority');
  observation=await browser.observe();target=observation.targets.find(target=>target.label==='Try outside request')!;proposal=await browser.propose({kind:'click',snapshotId:observation.id,targetId:target.id});
  const token=browser.approve(proposal.id);await browser.execute(proposal.id,token);
  // The click's page-initiated request reaches the route asynchronously (later in Helium); it must still be blocked.
  await expect.poll(()=>browser!.diagnostics.blockedRequests).toBeGreaterThanOrEqual(5);
  expect(received.filter(request=>!request.split(' ')[1].startsWith('/requests/'))).toEqual([]);
 }finally{await browser?.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
