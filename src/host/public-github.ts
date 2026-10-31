import {PUBLIC_GITHUB_ORIGIN,PUBLIC_GITHUB_README_LIMIT,parsePublicGithubRepository,readPublicGithubSnapshot,type PublicGithubSnapshot} from '../shared/public-github';

const JSON_LIMIT=420_000;
const record=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('GitHub returned an unsupported response. The saved snapshot is unchanged.');return value as Record<string,unknown>;};
const string=(value:unknown,max:number)=>{if(typeof value!=='string'||value.length>max||/[\0-\x1f\x7f]/.test(value))throw Error('GitHub returned unsupported repository metadata. The saved snapshot is unchanged.');return value;};
export type PublicGithubRead={snapshot:PublicGithubSnapshot;content:string};

/** One foreground read owner. cancel retires only the current operation, never future gestures. */
export class PublicGithubReader{
 private active?:{taskId:string;operationId:string;controller:AbortController};
 constructor(private readonly fetcher:typeof fetch=fetch,private readonly timeoutMs=15_000,private readonly now=()=>new Date()){}
 cancel(taskId?:string,operationId?:string){const active=this.active;if(active&&(!taskId||taskId===active.taskId)&&(!operationId||operationId===active.operationId)){this.active=undefined;active.controller.abort();}}
 async read<T>(taskId:string,operationId:string,repository:string,assertCurrent:()=>void,publish:(read:PublicGithubRead,guard:()=>void)=>Promise<T>):Promise<T>{
  const selected=parsePublicGithubRepository(repository);if(selected!==repository)throw Error('Review the exact GitHub repository before fetching.');
  assertCurrent();if(this.active)throw Error('A public GitHub read is already running. Cancel it before fetching again.');
  const operation={taskId,operationId,controller:new AbortController()};this.active=operation;
  let timedOut=false;const deadline=setTimeout(()=>{timedOut=true;operation.controller.abort();},this.timeoutMs);
  const guard=()=>{assertCurrent();if(this.active!==operation||operation.controller.signal.aborted)throw Error(timedOut?'GitHub timed out. The saved snapshot is unchanged. Use Refresh to try again.':'GitHub read canceled. The saved snapshot is unchanged.');};
  const get=async(path:string,limit:number)=>{
   guard();const response=await this.fetcher(PUBLIC_GITHUB_ORIGIN+path,{method:'GET',redirect:'manual',credentials:'omit',cache:'no-store',headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10','User-Agent':'Glint-Public-Readme'},signal:operation.controller.signal});guard();
   if(response.status!==200){await response.body?.cancel();if(response.status===403||response.status===429)throw Error('GitHub refused this public read or its unauthenticated rate limit was reached. Wait before using Refresh. The saved snapshot is unchanged.');if(response.status===404)throw Error('Public repository or README not found. Check the repository name. Private repositories are unsupported. The saved snapshot is unchanged.');if(response.status>=300&&response.status<400)throw Error('GitHub redirected this repository. Enter its current owner/repository explicitly. The saved snapshot is unchanged.');throw Error('GitHub could not return a supported public README. The saved snapshot is unchanged.');}
   if(response.url&&new URL(response.url).origin!==PUBLIC_GITHUB_ORIGIN){await response.body?.cancel();throw Error('GitHub response destination changed. The saved snapshot is unchanged.');}
   if(!response.headers.get('content-type')?.toLowerCase().includes('application/json')){await response.body?.cancel();throw Error('GitHub returned an unsupported response format. The saved snapshot is unchanged.');}
   const declared=response.headers.get('content-length');if(declared&&(!/^\d+$/.test(declared)||Number(declared)>limit)){await response.body?.cancel();throw Error('GitHub response is too large. The saved snapshot is unchanged.');}
   if(!response.body)throw Error('GitHub returned no response body. The saved snapshot is unchanged.');
   const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
   try{while(true){const chunk=await reader.read();guard();if(chunk.done)break;size+=chunk.value.byteLength;if(size>limit)throw Error('GitHub response is too large. The saved snapshot is unchanged.');chunks.push(chunk.value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
   guard();const bytes=Buffer.concat(chunks);let parsed:unknown;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('GitHub returned invalid JSON. The saved snapshot is unchanged.');}return record(parsed);
  };
  try{
   const repo=await get('/repos/'+selected,64*1024);guard();
   if(repo.private!==false||repo.visibility!==undefined&&repo.visibility!=='public')throw Error('Only public GitHub repositories are supported. The saved snapshot is unchanged.');
   if(string(repo.full_name,140).toLowerCase()!==selected)throw Error('GitHub repository identity changed. Enter its current owner/repository explicitly.');
   const defaultBranch=string(repo.default_branch,250),description=repo.description===null?'':string(repo.description,2000),stars=repo.stargazers_count;
   if(!Number.isSafeInteger(stars)||Number(stars)<0)throw Error('GitHub returned unsupported repository metadata.');
   // Closed projection: tokens, owner objects, URLs and every unknown field are discarded.
   const readme=await get('/repos/'+selected+'/readme',JSON_LIMIT);guard();
   if(readme.type!=='file'||readme.encoding!=='base64'||!Number.isSafeInteger(readme.size)||Number(readme.size)<1||Number(readme.size)>PUBLIC_GITHUB_README_LIMIT)throw Error('Only a UTF-8 README up to 256 KiB is supported. The saved snapshot is unchanged.');
   const encoded=typeof readme.content==='string'?readme.content.replace(/\n/g,''):'';
   if(!encoded||encoded.length>Math.ceil(PUBLIC_GITHUB_README_LIMIT/3)*4||encoded.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw Error('GitHub returned an unsupported README encoding.');
   const bytes=Buffer.from(encoded,'base64');if(bytes.length!==readme.size||bytes.toString('base64')!==encoded)throw Error('GitHub returned an incomplete README. The saved snapshot is unchanged.');
   let content:string;try{content=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{throw Error('This README is not valid UTF-8. The saved snapshot is unchanged.');}
   if(!content||content.includes('\0'))throw Error('This README contains unsupported text. The saved snapshot is unchanged.');
   const snapshot=readPublicGithubSnapshot({repository:selected,defaultBranch,path:string(readme.path,1000),blobSha:string(readme.sha,64),snapshotAt:this.now().toISOString(),description,stars:Number(stars)});
   guard();return await publish({snapshot,content},guard);
  }catch(error){if(timedOut)throw Error('GitHub timed out. The saved snapshot is unchanged. Use Refresh to try again.');if(operation.controller.signal.aborted)throw Error('GitHub read canceled. The saved snapshot is unchanged.');if(error instanceof TypeError)throw Error('GitHub could not be reached. Check your connection, then use Refresh. The saved snapshot is unchanged.');throw error;}
  finally{clearTimeout(deadline);operation.controller.abort();if(this.active===operation)this.active=undefined;}
 }
}
