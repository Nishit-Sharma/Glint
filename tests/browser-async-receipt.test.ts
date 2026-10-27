import {createServer,type ServerResponse} from 'node:http';
import {it,expect} from 'vitest';
import {LocalBrowser} from '../src/host/browser/local-browser';

async function fixture(mode:'static'|'async'|'no-write'){
 const writes:string[]=[];let received!:()=>void,held:ServerResponse|undefined;
 const committed=new Promise<void>(resolve=>received=resolve);
 const server=createServer((req,res)=>{
  res.setHeader('content-type','text/html');
  if(req.url==='/commit'&&req.method==='POST'){
   let body='';req.on('data',part=>body+=part);req.on('end',()=>{writes.push(body);held=res;received();if(mode==='static')res.end('<title>Receipt</title><h1>Saved Creek draft once</h1>');});return;
  }
  const script=mode==='static'?'':`<script>document.querySelector('form').addEventListener('submit',event=>{event.preventDefault();${mode==='async'?`fetch('/commit',{method:'POST',body:new URLSearchParams(new FormData(event.target))}).then(response=>response.text()).then(text=>document.querySelector('output').textContent=text).catch(()=>{});`:''}});</script>`;
  res.end('<title>Owned synthetic form</title><form method="post" action="/commit"><label>Filter choice<input name="choice" value="Creek"></label><button>Save draft</button></form><output>Not saved</output>'+script);
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('Missing local test port');
 const origin=`http://127.0.0.1:${address.port}`,controller=new AbortController();
 const browser=await LocalBrowser.open({taskId:'async-receipt-proof',origin,url:origin,signal:controller.signal});
 const snapshot=await browser.observe(),target=snapshot.targets.find(target=>target.label==='Save draft');if(!target)throw Error('Missing owned form button');
 const proposal=await browser.propose({kind:'click',snapshotId:snapshot.id,targetId:target.id}),review=await browser.review(proposal.id);
 const token=browser.approve(proposal.id,review.write);
 return {browser,controller,proposal,token,writes,committed,release:()=>{if(held&&!held.writableEnded)held.end('Saved Creek draft once');},close:async()=>{if(held&&!held.writableEnded)held.end('Saved Creek draft once');await browser.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}

it('a normal static form returns its actual successful receipt and rejects replay',async()=>{
 const f=await fixture('static');
 try{const result=await f.browser.execute(f.proposal.id,f.token);expect(result.proposal.status).toBe('completed');expect(result.receipt).toMatchObject({status:200,body:'Saved Creek draft once'});expect(f.writes).toEqual(['choice=Creek']);await expect(f.browser.execute(f.proposal.id,f.token)).rejects.toThrow('already');expect(f.writes).toHaveLength(1);}finally{await f.close();}
});

it('a consumed asynchronous write with no response receipt stays uncertain and cannot replay',async()=>{
 const f=await fixture('async');
 try{
  const executing=f.browser.execute(f.proposal.id,f.token);const settled=executing.catch(error=>error);await f.committed;
  expect(await settled).toBeInstanceOf(Error);expect(f.browser.proposal(f.proposal.id)?.status).toBe('uncertain');expect(f.writes).toEqual(['choice=Creek']);
  await expect(f.browser.execute(f.proposal.id,f.token)).rejects.toThrow('already');expect(f.writes).toHaveLength(1);
 }finally{await f.close();}
});

it('prevented submission with no consumed write fails without inventing a receipt or uncertainty',async()=>{
 const f=await fixture('no-write');
 try{await expect(f.browser.execute(f.proposal.id,f.token)).rejects.toThrow('receipt');expect(f.browser.proposal(f.proposal.id)?.status).toBe('failed');expect(f.writes).toEqual([]);}finally{await f.close();}
});

it('cancellation after asynchronous commit preserves uncertainty and no replay',async()=>{
 const f=await fixture('async');
 try{
  const executing=f.browser.execute(f.proposal.id,f.token);const settled=executing.catch(error=>error);await f.committed;f.controller.abort();
  expect(await settled).toBeInstanceOf(Error);expect(f.browser.proposal(f.proposal.id)?.status).toBe('uncertain');expect(f.writes).toEqual(['choice=Creek']);
  await expect(f.browser.execute(f.proposal.id,f.token)).rejects.toThrow('already');expect(f.writes).toHaveLength(1);
 }finally{await f.close();}
});
