import {createServer} from 'node:http';

/** Disposable, owned form targets. No redirects, credentials, external assets or JS. */
export async function workflowSite(){
 const effects:{target:string;title:string;delivery:string}[]=[],requests:string[]=[];
 const escape=(text:string)=>text.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
 const server=createServer(async(request,response)=>{
  requests.push(request.method+' '+request.url);
  if(!request.url?.startsWith('/requests/')){response.statusCode=404;response.end('Outside disposable target');return;}
  response.setHeader('content-type','text/html; charset=utf-8');
  if(request.method==='POST'){
   let body='';for await(const chunk of request)body+=chunk;
   const fields=new URLSearchParams(body),value={target:request.url,title:fields.get('title')??'',delivery:fields.get('delivery')??''};effects.push(value);
   response.end('<title>Saved request</title><h1>Draft saved: '+escape(value.title)+'</h1><p>Delivery: '+escape(value.delivery)+'</p>');return;
  }
  const defaults=request.url==='/requests/defaults';
  const delivery=request.url.endsWith('/choice')?'<select name="delivery"><option value="pickup">Collect locally</option><option value="courier">Send by courier</option><option value="post">Post parcel</option></select>':'<input name="delivery"'+(defaults?' value="Website delivery"':'')+'>';
  response.end('<title>Request draft</title><h1>Request draft</h1><p>Owned disposable workflow target: '+escape(request.url)+'</p><form method="post"'+(request.url==='/requests/outside-form'?' action="/outside/submit"':'')+'><label>Request title<input name="title"'+(defaults?' value="Website title"':'')+'></label><label>Delivery'+delivery+'</label><button>Save draft</button></form>');
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const address=server.address();if(!address||typeof address==='string')throw Error('Disposable workflow server has no port.');
 return {origin:'http://127.0.0.1:'+address.port,effects,requests,close:()=>new Promise<void>(resolve=>server.close(()=>resolve()))};
}
