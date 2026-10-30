import {it,expect,vi} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {projectTaskDialogue} from '../src/core/task-dialogue';
import {taskContext} from '../src/host/browser/coordinator';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {emptyTaskSession} from '../src/core/task-session';
import {BrowserService} from '../src/host/browser/service';
import {publicErrorMessage} from '../src/shared/public-messages';
import type {ConnectionStatus} from '../src/shared/bridge';

const external=vi.hoisted(()=>({launch:vi.fn(),dialog:vi.fn()}));
vi.mock('playwright-core',()=>({chromium:{launch:external.launch}}));
vi.mock('electron',()=>({dialog:{showMessageBox:external.dialog}}));

it.each([
 ['abort','browserType.launch: Target page, context or browser has been closed\nexception while trying to kill process: Error: kill EPERM\nprocess did exit: exitCode=null, signal=SIGABRT'],
 ['missing executable','Executable doesn\'t exist at /private/path'],
 ['incomplete runtime','Browser launch failed on an incomplete runtime fixture'],
 ['incompatible runtime','Browser launch failed on an incompatible runtime fixture'],
] as const)('%s launch failure retains request and reports unavailability',async(_case,launchError)=>{
 const dir=await mkdtemp(join(tmpdir(),'browser-readiness-current-')),core=await createCompanion({dataDir:dir});
 const status=vi.fn(async()=>({configured:true,provider:'Codex (temporary)'} as ConnectionStatus)),run=vi.fn(async()=>{throw Error('Unexpected planner');});
 external.dialog.mockReset().mockResolvedValue({response:1});
 external.launch.mockReset().mockRejectedValue(Error(launchError));
 const service=new BrowserService(core,{panel:()=>({}) as never,route:()=>({key:'fixture',provider:{status,run}}),changed:()=>{},progress:()=>{}});
 try{
  const task=await core.createTask({title:'Runtime abort'}),prior={origin:'https://example.invalid',url:'https://example.invalid/previous',requestId:'prior'};
  await core.replaceSession(task.id,0,{...emptyTaskSession(),browserContext:prior});
  const draft=await core.saveComposerDraft(task.id,0,{text:'Keep this exact browser request.',kind:'explain'});
  const error=await service.run({taskId:task.id,requestId:'abort',prompt:draft.text,url:'https://example.invalid',submittedDraft:draft}).catch(error=>error);
  const kept=await core.getTask(task.id);
  expect(kept.requests.at(-1)).toMatchObject({status:'failed',error:'Companion could not open its browser. Your task is kept.'});expect(kept.session?.draft).toBe(draft.text);expect(kept.session?.browserContext).toEqual(prior);expect(kept.session?.runs).toEqual([]);expect(run).not.toHaveBeenCalled();
  expect(kept.requests.at(-1)?.browserStart).toEqual({origin:'https://example.invalid',recordedAt:expect.any(String)});
  expect.soft(publicErrorMessage(error)).toBe('Companion could not open its browser. Your task is kept.');expect(publicErrorMessage(new Error("Error invoking remote method 'companion:command': Error: Companion could not open its browser. Your task is kept."))).toBe('Companion could not open its browser. Your task is kept.');
  expect(status).toHaveBeenCalledOnce();expect(external.dialog).toHaveBeenCalledOnce();expect(external.launch).toHaveBeenCalledOnce();expect(external.launch).toHaveBeenCalledWith({headless:false,chromiumSandbox:true});
 }finally{service.close();await core.close();await rm(dir,{recursive:true,force:true});}
});

it('failed inspection leaves the prior action uncertain without asking for an outcome or retrying it',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'browser-inspection-current-')),core=await createCompanion({dataDir:dir});
 const status=vi.fn(),run=vi.fn();external.dialog.mockReset().mockResolvedValue({response:1});
 external.launch.mockReset().mockRejectedValue(Error('browserType.launch: closed; kill EPERM; signal=SIGABRT'));
 const service=new BrowserService(core,{panel:()=>({}) as never,route:()=>({key:'fixture',provider:{status,run}}),changed:()=>{},progress:()=>{}});
 try{
  const task=await core.createTask({title:'Uncertain effect'});await core.runRequest({taskId:task.id,requestId:'old-write',kind:'browser',prompt:'Save once.'},async()=>{throw Error('Website action outcome uncertain.');});
  await core.replaceSession(task.id,0,{...emptyTaskSession(),runs:[{id:'old-write',endpointKey:'earlier',origin:'https://example.invalid',browserId:'owned-browser',initialObservation:{id:'before',taskId:task.id,browserId:'owned-browser',documentId:'owned-document',url:'https://example.invalid/form',title:'Owned form',text:'Choice Mesa',digest:'before-digest',targets:[]},operations:[{id:'unknown-effect',intent:{kind:'click',snapshotId:'before',targetId:'save'},reason:'Save once',status:'uncertain'}]}]});
  const failure=await service.inspect({taskId:task.id,runId:'old-write',operationId:'unknown-effect',url:'https://example.invalid/receipt'}).catch(error=>error);
  const after=await core.getTask(task.id);expect(after.session?.runs[0].operations[0]).toMatchObject({id:'unknown-effect',status:'uncertain'});expect(after.session?.runs[0].operations[0].reconciliation).toBeUndefined();
  expect(external.dialog).toHaveBeenCalledOnce();expect(external.launch).toHaveBeenCalledOnce();expect(status).not.toHaveBeenCalled();expect(run).not.toHaveBeenCalled();
  expect(publicErrorMessage(failure)).toBe('Companion could not open its browser. Your task is kept.');
 }finally{service.close();await core.close();await rm(dir,{recursive:true,force:true});}
});

it('a stopped pending launch remains stopped when the SDK later rejects',async()=>{
 const {LocalBrowser}=await import('../src/host/browser/local-browser');const abort=new AbortController();let reject!:(error:Error)=>void;
 external.launch.mockReset().mockImplementation(()=>new Promise((_resolve,fail)=>{reject=fail;}));
 const pending=LocalBrowser.open({taskId:'stop-launch',origin:'https://example.invalid',url:'https://example.invalid',signal:abort.signal});
 abort.abort();reject(Error('kill EPERM'));
 await expect(pending).rejects.toThrow('Browser request was stopped before launch.');expect(external.launch).toHaveBeenCalledOnce();
});

it('a browser handle arriving after Stop is closed before creating a page',async()=>{
 const {LocalBrowser}=await import('../src/host/browser/local-browser');const abort=new AbortController();let resolve!:(value:unknown)=>void;
 external.launch.mockReset().mockImplementation(()=>new Promise(done=>{resolve=done;}));
 const pending=LocalBrowser.open({taskId:'stop-late',origin:'https://example.invalid',url:'https://example.invalid',signal:abort.signal});
 const close=vi.fn(async()=>{}),newContext=vi.fn();abort.abort();resolve({close,newContext});
 await expect(pending).rejects.toThrow('Browser request was stopped before opening a page.');expect(close).toHaveBeenCalledOnce();expect(newContext).not.toHaveBeenCalled();
});

it.each([true,false])('actual start-consent boundary keeps only the selected origin after approval=%s and never stores address tokens',async approved=>{
 const dir=await mkdtemp(join(tmpdir(),'browser-start-consent-')),core=await createCompanion({dataDir:dir}),task=await core.createTask({title:'Owned site recovery'}),provider=vi.fn();external.dialog.mockReset().mockResolvedValue({response:approved?1:0});external.launch.mockReset().mockRejectedValue(Error('PRIVATE_LAUNCH_DETAIL'));
 const service=new BrowserService(core,{panel:()=>({}) as never,route:()=>({key:'owned',provider:{status:async()=>({configured:true,provider:'Codex (temporary)'} as ConnectionStatus),run:provider}}),changed:()=>{},progress:()=>{}});
 try{
  await expect(service.run({taskId:task.id,requestId:'start',prompt:'Read the selected page',url:'https://owned-start.invalid/PRIVATE_PATH?token=PRIVATE_QUERY#PRIVATE_FRAGMENT'})).rejects.toThrow(approved?'could not open':'not authorized');const saved=await core.getTask(task.id);expect(saved.requests[0].browserStart).toEqual(approved?{origin:'https://owned-start.invalid',recordedAt:expect.any(String)}:undefined);expect(external.launch).toHaveBeenCalledTimes(approved?1:0);expect(provider).not.toHaveBeenCalled();
  const stored=JSON.stringify(saved),consent=JSON.stringify(external.dialog.mock.calls);for(const marker of ['PRIVATE_PATH','PRIVATE_QUERY','PRIVATE_FRAGMENT','PRIVATE_LAUNCH_DETAIL']){expect(stored).not.toContain(marker);expect(consent).not.toContain(marker);}
 }finally{service.close();await core.close();await rm(dir,{recursive:true,force:true});}
});


it('navigation failure never persists or projects private address and diagnostic tokens',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'browser-navigation-privacy-')),core=await createCompanion({dataDir:dir}),task=await core.createTask({title:'Navigation recovery'}),provider=vi.fn(),close=vi.fn(async()=>{});
 const url='https://owned-start.invalid/PRIVATE_PATH?token=PRIVATE_QUERY#PRIVATE_FRAGMENT';
 const page={on:vi.fn(),goto:vi.fn(async()=>{throw Error(`page.goto: net::ERR_FAILED at ${url} PRIVATE_DIAGNOSTIC`);})};
 const context={on:vi.fn(),newPage:vi.fn(async()=>page),route:vi.fn(async()=>{}),routeWebSocket:vi.fn(async()=>{}),addInitScript:vi.fn(async()=>{})};
 external.dialog.mockReset().mockResolvedValue({response:1});external.launch.mockReset().mockResolvedValue({newContext:async()=>context,close});
 const service=new BrowserService(core,{panel:()=>({}) as never,route:()=>({key:'owned',provider:{status:async()=>({configured:true,provider:'Codex (temporary)'} as ConnectionStatus),run:provider}}),changed:()=>{},progress:()=>{}});
 try{
  const failure=await service.run({taskId:task.id,requestId:'start',prompt:'Read the selected page',url}).catch(error=>error);const saved=await core.getTask(task.id);
  expect(saved.requests[0]).toMatchObject({status:'failed',error:'The selected page could not be opened. Whether it loaded or changed the website is unknown.',browserStart:{origin:'https://owned-start.invalid'}});expect(page.goto).toHaveBeenCalledOnce();expect(close).toHaveBeenCalledOnce();expect(provider).not.toHaveBeenCalled();
  const outputs=[String(failure),JSON.stringify(saved),await readFile(join(dir,'tasks.json'),'utf8'),projectTaskDialogue(saved,'later',[]),taskContext(saved,'later')];
  for(const output of outputs)for(const marker of ['PRIVATE_PATH','PRIVATE_QUERY','PRIVATE_FRAGMENT','PRIVATE_DIAGNOSTIC'])expect(output).not.toContain(marker);
 }finally{service.close();await core.close();await rm(dir,{recursive:true,force:true});}
});

it('failed open cleanup does not expose diagnostics or release unconfirmed process ownership',async()=>{
 const {LocalBrowser}=await import('../src/host/browser/local-browser');const release=vi.fn(),detach=vi.fn(async()=>{}),close=vi.fn(async()=>{throw Error('PRIVATE_CLEANUP');});
 const page={on:vi.fn(),goto:vi.fn(async()=>{throw Error('PRIVATE_PATH PRIVATE_QUERY');})};const context={on:vi.fn(),newPage:async()=>page,route:async()=>{},routeWebSocket:async()=>{},addInitScript:async()=>{}};
 external.launch.mockReset().mockResolvedValue({newContext:async()=>context,newBrowserCDPSession:async()=>({send:async()=>({processInfo:[{type:'browser',id:42}]}),detach}),close});
 const failure=await LocalBrowser.open({taskId:'cleanup',origin:'https://owned-start.invalid',url:'https://owned-start.invalid/PRIVATE_PATH?token=PRIVATE_QUERY',onWindowOwner:()=>release}).catch(error=>error);
 expect(failure.message).toBe('Browser cleanup could not be confirmed. The page may have loaded or changed the website.');expect(close).toHaveBeenCalledOnce();expect(detach).toHaveBeenCalledOnce();expect(release).not.toHaveBeenCalled();for(const marker of ['PRIVATE_PATH','PRIVATE_QUERY','PRIVATE_CLEANUP'])expect(String(failure)).not.toContain(marker);
});
