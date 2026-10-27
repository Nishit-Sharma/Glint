import {afterEach,describe,expect,it} from 'vitest'
import {build} from 'esbuild'
import {mkdtemp,mkdir,readFile,rm,rename} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {randomUUID} from 'node:crypto'
import type {Companion} from '../src/core/companion'
import type {Task} from '../src/core/types'
import type {Command} from '../src/shared/bridge'
import {placeCompanion} from '../src/host/native'

// Bundle the production host handler. Only OS/network boundaries are substituted;
// source versions, request authority and all durable writes use the actual core.
const cleanups:Array<()=>Promise<void>>=[]
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup()})
async function fixture(){
  const root=resolve('.');await mkdir(join(root,'.runtime'),{recursive:true})
  const dir=await mkdtemp(join(root,'.runtime','host-boundary-')),key='hostBoundary'+randomUUID().replaceAll('-','')
  const calls={confirmations:[] as string[],details:[] as any[],provider:[] as any[],captures:0,shows:0,quitCalls:0,events:[] as any[]}
  let configured=true,response=1,bytes=1024*1024,label='capture-A',output='Synthetic completed output'
  const window=(id:string)=>({id,title:'Unchanged synthetic title',owner:{name:'Owned synthetic source',processId:1},documentToken:'constant-metadata',bounds:{x:0,y:0,width:100,height:100}})
  const seams={
    confirm:async(_panel:unknown,detail:any)=>{calls.confirmations.push(detail.message);calls.details.push(detail);return {response}},
    status:async()=>({configured,provider:'Codex (temporary)',endpoint:'fixture://no-network',model:'fixture',state:'ready'}),
    run:async(input:any)=>{calls.provider.push(input);return output},placeCompanion,quitCalls:0,quitFlush:undefined as undefined|((id:string)=>void),
    native:{foregroundWindow:async()=>window('window:1'),listWindows:async()=>[window('window:1'),window('window:2')],permissionStatus:async()=>({screen:'granted'}),inspect:async(id:string)=>window(id),capture:async(id:string)=>{calls.captures++;return {source:window(id),sourceVersion:label,capturedAt:new Date().toISOString(),png:Buffer.alloc(bytes),dataUrl:'data:image/png;base64,'+Buffer.from(label).toString('base64'),imageSha256:label,transform:{fixture:true}}}},
  }
  Reflect.set(globalThis,key,seams)
  const seam=`globalThis[${JSON.stringify(key)}]`
  const electron=`const noop=()=>{};export const app={getPath:()=>process.env.WINDOW_COMPANION_DATA_DIR,setPath:noop,whenReady:()=>new Promise(()=>{}),on:noop,quit:()=>{${seam}.quitCalls++}};export const BrowserWindow=class {};export const Menu=undefined;export const dialog={showMessageBox:(...a)=>${seam}.confirm(...a)};export const Tray=class{};export const systemPreferences={isTrustedAccessibilityClient:()=>false};export const globalShortcut={unregisterAll:noop,register:()=>true};export const ipcMain={};export const nativeImage={};export const safeStorage={};export const screen={getDisplayMatching:()=>({workArea:{x:0,y:0,width:1800,height:1100}})};export const session={};`
  const provider=`export class MetaProvider{status(){return ${seam}.status()};run(input){return ${seam}.run(input)};reset(){};close(){}};export class CodexProvider extends MetaProvider{}`
  const native=`export class NativeSourceAdapter{foregroundWindow(){return ${seam}.native.foregroundWindow()};listWindows(){return ${seam}.native.listWindows()};inspect(id){return ${seam}.native.inspect(id)};capture(id,o){return ${seam}.native.capture(id,o)};permissionStatus(){return ${seam}.native.permissionStatus()}};export const placeCompanion=(...a)=>${seam}.placeCompanion(...a);`
  const outfile=join(dir,'host-under-test.mjs')
  await build({stdin:{contents:await readFile(join(root,'src/host/index.ts'),'utf8')+'\nexport {command,validate,createCompanion,attach,monitorAttached,activateShortcut,stopForQuit,beginQuit,quitDrafts};export const resumeForTest=()=>{quitting=false};export const stopMonitor=()=>{if(monitor)clearInterval(monitor)};export const setCore=c=>{core=c};export const setPanel=p=>{panel=p};export const captureCache=captures;',resolveDir:join(root,'src/host'),loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile,plugins:[{name:'inert-host-boundaries',setup(b){b.onResolve({filter:/^(electron|\.\/provider|\.\/codex-provider|\.\/native)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='electron'?electron:a.path==='./native'?native:provider,loader:'js'}))}}]})
  const previous=process.env.WINDOW_COMPANION_DATA_DIR;process.env.WINDOW_COMPANION_DATA_DIR=dir
  let host:any
  try{host=await import(/* @vite-ignore */pathToFileURL(outfile).href)}finally{if(previous===undefined)delete process.env.WINDOW_COMPANION_DATA_DIR;else process.env.WINDOW_COMPANION_DATA_DIR=previous}
  const core:Companion=await host.createCompanion({dataDir:join(dir,'store')});host.setCore(core)
  let bounds={x:1350,y:20,width:430,height:760},minimum=[360,500]
  let visible=true;const presentationAcks:Promise<unknown>[]=[];
  host.setPanel({isDestroyed:()=>false,isVisible:()=>visible,hide:()=>{visible=false},setAlwaysOnTop:()=>{},webContents:{capturePage:async()=>({toDataURL:()=>''}),send:(_topic:string,event:any)=>{calls.events.push(event);if(event.type==='draft.flush')seams.quitFlush?.(event.quitId);if(event.type==='presentation.exit')presentationAcks.push(host.command({type:'presentation.finish',exitId:event.exitId}).then(()=>host.command({type:'presentation.reveal',exitId:event.exitId})));if(event.type==='presentation.enter')presentationAcks.push(host.command({type:'presentation.show',entranceId:event.entranceId}));}},setMinimumSize:(w:number,h:number)=>{minimum=[w,h]},setBounds:(b:typeof bounds)=>{bounds=b},getBounds:()=>bounds,getSize:()=>[bounds.width,bounds.height],show:()=>{visible=true;calls.shows++},showInactive:()=>{visible=true}})
  cleanups.push(async()=>{host.stopMonitor();await core.close();Reflect.deleteProperty(globalThis,key);await rm(dir,{recursive:true,force:true})})
  const command=(c:Command):Promise<any>=>host.command(host.validate(c))
  return {core,command,calls,seams,directory:dir,stop:host.stopForQuit,beginQuit:host.beginQuit,barrier:host.quitDrafts,resume:host.resumeForTest,hide:()=>{visible=false;},nativeQuitCalls:()=>seams.quitCalls,shortcut:host.activateShortcut,settlePresentation:async()=>{await Promise.resolve();await Promise.all(presentationAcks)},bounds:()=>bounds,minimum:()=>minimum,attach:host.attach,monitor:host.monitorAttached,cache:host.captureCache as Map<string,any>,setConfigured:(v:boolean)=>{configured=v},setResponse:(v:number)=>{response=v},setOutput:(v:string)=>{output=v},setCapture:(size:number,name:string)=>{bytes=size;label=name}}
}
describe('Shutdown admission and draft durability',()=>{
  it('a pre-quit context capture cannot resume after the app was kept open',async()=>{
    const f=await fixture(),task=await f.core.createTask({title:'Owned delayed capture'});await f.command({type:'context.start',ownerTaskId:task.id});const activation=f.calls.events.find(event=>event.type==='context.activate').activation;
    const inspect=f.seams.native.inspect;let release!:()=>void,entered!:()=>void;const waiting=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>entered=resolve);let held=true;
    f.seams.native.inspect=async id=>{if(held){held=false;entered();await waiting;}return inspect(id);};
    const pending=f.command({type:'context.capture',activationId:activation.activationId,windowId:activation.target.id,taskId:task.id});await started;await f.stop();f.resume();release();
    await expect(pending).rejects.toThrow();expect(f.calls.captures).toBe(0);expect(f.calls.confirmations).toEqual([]);expect((await f.core.getTask(task.id)).sources).toHaveLength(0);
  });
  it.each(['closing','kept-open'])('rejects a pre-admitted model lookup released after shutdown: %s',async phase=>{
    const f=await fixture(),task=await f.core.createTask({title:'Owned shutdown task'}),get=f.core.getTask.bind(f.core);let release!:()=>void,entered!:()=>void;
    const waiting=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>entered=resolve);let held=true;
    f.core.getTask=async id=>{if(held){held=false;entered();await waiting;}return get(id);};
    const pending=f.command({type:'model.run',taskId:task.id,requestId:'late-start',kind:'explain',prompt:'Owned synthetic prompt',sourceIds:[]});await started;await f.stop();if(phase==='kept-open')f.resume();release();
    await expect(pending).rejects.toThrow();expect(f.calls.confirmations).toEqual([]);expect(f.calls.provider).toHaveLength(0);expect((await get(task.id)).requests).toHaveLength(0);
  });
  it('a fail-stopped store still reaches explicit keep-open and discard decisions',async()=>{
    const f=await fixture(),task=await f.core.createTask({title:'Owned failed store'}),store=join(f.directory,'store');
    await rename(join(store,'tasks.json'),join(store,'acknowledged-before-failure.json'));await mkdir(join(store,'tasks.json'));
    await expect(f.core.saveComposerDraft(task.id,0,{text:'Unconfirmed message',kind:'explain'})).rejects.toThrow();await expect(f.core.listTasks()).rejects.toThrow('persistence failed');
    f.hide();f.setResponse(0);f.seams.quitFlush=id=>{f.barrier.acknowledge(id);};await f.beginQuit();expect(f.calls.confirmations).toContain('Quit without saving messages?');expect(f.nativeQuitCalls()).toBe(0);
    f.setResponse(1);await f.beginQuit();await expect.poll(()=>f.nativeQuitCalls()).toBe(1);
  });
});
describe('Production host authority and capture boundaries',()=>{
  it.each(['rename','reference'] as const)('preserves a new capture task adopted by %s before source publication',async adoption=>{
    const f=await fixture();await f.command({type:'context.start',newTask:true});const activation=f.calls.events.find(event=>event.type==='context.activate').activation;
    const create=f.core.createTask.bind(f.core),put=f.core.putSource.bind(f.core);let release!:()=>void,entered!:()=>void,id='';const barrier=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>entered=resolve);
    f.core.createTask=async input=>{const created=await create(input);id=created.id;entered();await barrier;return created;};
    f.core.putSource=async(taskId,input,...rest)=>{const saved=await put(taskId,input,...rest);await f.command({type:'context.cancel',activationId:activation.activationId});return saved;};
    const pending=f.command({type:'context.capture',activationId:activation.activationId,windowId:activation.target.id});await started;
    if(adoption==='rename')await f.core.updateTask(id,{title:'Adopted task'});else await put(id,{kind:'text',role:'fact',label:'Kept reference',content:'Keep this user work.'});release();
    await expect(pending).rejects.toThrow();const retained=await f.core.getTask(id);if(adoption==='rename')expect(retained.title).toBe('Adopted task');else expect(retained.sources[0].versions[0].content).toBe('Keep this user work.');expect(f.cache.size).toBe(0);
  });
  it('cancelling after a new task source commit rolls back its exact unpublished task snapshot',async()=>{
    const f=await fixture();await f.command({type:'context.start',newTask:true});const activation=f.calls.events.find(event=>event.type==='context.activate').activation;
    const original=f.core.putSource.bind(f.core);let release!:()=>void,entered!:()=>void;const barrier=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>entered=resolve);
    f.core.putSource=async(taskId,input)=>{const saved=await original(taskId,input);entered();await barrier;return saved;};
    const pending=f.command({type:'context.capture',activationId:activation.activationId,windowId:activation.target.id});await started;await f.command({type:'context.cancel',activationId:activation.activationId});release();
    await expect(pending).rejects.toThrow('expired');expect(await f.core.listTasks()).toHaveLength(0);expect(f.cache.size).toBe(0);expect(f.calls.captures).toBe(1);expect(f.calls.provider).toHaveLength(0);
  });
  it('cancelling while a new task commit is delayed cannot attach or publish captured pixels',async()=>{
    const f=await fixture();await f.command({type:'context.start',newTask:true});const activation=f.calls.events.find(event=>event.type==='context.activate').activation;const original=f.core.createTask.bind(f.core);let release!:()=>void,entered!:()=>void;const barrier=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>entered=resolve);f.core.createTask=async input=>{const task=await original(input);entered();await barrier;return task;};const capturing=f.command({type:'context.capture',activationId:activation.activationId,windowId:activation.target.id});await started;await f.command({type:'context.cancel',activationId:activation.activationId});release();await expect(capturing).rejects.toThrow('expired');expect(await f.core.listTasks()).toHaveLength(0);expect(f.cache.size).toBe(0);expect(f.calls.captures).toBe(1);expect(f.calls.provider).toHaveLength(0);expect(f.calls.events.filter(event=>event.type==='changed')).toHaveLength(0);
  })
  it.each(['rename','reference'] as const)('cancelled new-task rollback preserves a concurrent %s adoption',async adoption=>{
    const f=await fixture();await f.command({type:'context.start',newTask:true});const activation=f.calls.events.find(event=>event.type==='context.activate').activation;
    const create=f.core.createTask.bind(f.core),discard=f.core.discardTaskIfUnchanged.bind(f.core);let releaseCreate!:()=>void,created!:()=>void,releaseDiscard!:()=>void,discarding!:()=>void;const createdBarrier=new Promise<void>(resolve=>releaseCreate=resolve),createdSignal=new Promise<void>(resolve=>created=resolve),discardBarrier=new Promise<void>(resolve=>releaseDiscard=resolve),discardSignal=new Promise<void>(resolve=>discarding=resolve);let adoptedId='';
    f.core.createTask=async input=>{const task=await create(input);adoptedId=task.id;created();await createdBarrier;return task;};f.core.discardTaskIfUnchanged=async expected=>{discarding();await discardBarrier;return discard(expected);};
    const capturing=f.command({type:'context.capture',activationId:activation.activationId,windowId:activation.target.id});await createdSignal;await f.command({type:'context.cancel',activationId:activation.activationId});releaseCreate();await discardSignal;
    if(adoption==='rename')await f.core.updateTask(adoptedId,{title:'Adopted work'});else await f.core.putSource(adoptedId,{kind:'text',label:'Kept reference',role:'fact',content:'A deliberate new reference.'});releaseDiscard();await expect(capturing).rejects.toThrow('expired');const kept=await f.core.getTask(adoptedId);if(adoption==='rename')expect(kept.title).toBe('Adopted work');else expect(kept.sources[0].versions[0].content).toBe('A deliberate new reference.');expect(f.cache.size).toBe(0);expect(f.calls.provider).toHaveLength(0);
  })
  it('cancelling while an existing task source commit is delayed invalidates unpublished pixels',async()=>{
    const f=await fixture(),task=await f.core.createTask({title:'Existing'});await f.command({type:'context.start',ownerTaskId:task.id});const activation=f.calls.events.find(event=>event.type==='context.activate').activation;const original=f.core.putSource.bind(f.core);let release!:()=>void,entered!:()=>void;const barrier=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>entered=resolve);f.core.putSource=async(taskId,input)=>{const saved=await original(taskId,input);entered();await barrier;return saved;};const capturing=f.command({type:'context.capture',activationId:activation.activationId,windowId:activation.target.id,taskId:task.id});await started;await f.command({type:'context.cancel',activationId:activation.activationId});release();await expect(capturing).rejects.toThrow('expired');expect((await f.core.getTask(task.id)).sources[0].freshness).toBe('refresh-required');expect(f.cache.size).toBe(0);expect(f.calls.provider).toHaveLength(0);
  })
  it('cancelled context capture creates no empty task and performs no pixels or provider call',async()=>{
    const f=await fixture();await f.command({type:'context.start',newTask:true,requestId:'new-task-cancel'});const activation=f.calls.events.find(event=>event.type==='context.activate').activation;expect(activation).toMatchObject({newTask:true,requestId:'new-task-cancel'});f.setResponse(0);await expect(f.command({type:'context.capture',activationId:activation.activationId,windowId:activation.target.id})).rejects.toThrow('cancelled');expect(await f.core.listTasks()).toHaveLength(0);expect(f.calls.captures).toBe(0);expect(f.calls.provider).toHaveLength(0);
  })
  it('exact refresh activation keeps its task owner and rejects capturing into another task',async()=>{
    const f=await fixture(),a=await f.core.createTask({title:'A'}),b=await f.core.createTask({title:'B'});const captured=await f.command({type:'windows.capture',taskId:a.id,windowId:'window:1'}),source=captured.sources[0],v=source.versions[0],reference={taskId:a.id,sourceId:source.id,version:v.version,digest:v.digest};await f.command({type:'context.start',source:reference,ownerTaskId:a.id,requestId:'refresh-owned-A'});const activation=f.calls.events.filter(event=>event.type==='context.activate').at(-1).activation;expect(activation).toMatchObject({ownerTaskId:a.id,source:reference,analyze:true,requestId:'refresh-owned-A'});const count=f.calls.captures;await expect(f.command({type:'context.capture',activationId:activation.activationId,windowId:'window:1',taskId:b.id})).rejects.toThrow('different task');expect(f.calls.captures).toBe(count);expect((await f.core.getTask(b.id)).sources).toHaveLength(0);expect(f.calls.provider).toHaveLength(0);
  })
  it('source preview rejects old references after refresh without returning newer pixels',async()=>{
    const f=await fixture(),a=await f.core.createTask({title:'Preview'});let captured=await f.command({type:'windows.capture',taskId:a.id,windowId:'window:1'});const source=captured.sources[0],v=source.versions[0],reference={sourceId:source.id,version:v.version,digest:v.digest};expect(await f.command({type:'source.preview',taskId:a.id,sourceId:source.id,reference})).toMatchObject({reference});f.setCapture(1024,'capture-B');captured=await f.command({type:'windows.capture',taskId:a.id,windowId:'window:1',sourceId:source.id});expect(await f.command({type:'source.preview',taskId:a.id,sourceId:source.id,reference})).toBeNull();expect(await f.command({type:'source.preview',taskId:a.id,sourceId:source.id})).toMatchObject({reference:{...reference,version:2,digest:captured.sources[0].versions[1].digest}});expect(f.calls.provider).toHaveLength(0);
  })
  it('updates only task details without capture, provider activity or export authority',async()=>{
    const f=await fixture(),task=await f.command({type:'tasks.create',title:'Original',goal:'Original goal'});
    const updated=await f.command({type:'tasks.update',taskId:task.id,title:'  Renamed  ',goal:''});
    expect(updated).toEqual({...task,title:'Renamed',goal:'',updatedAt:updated.updatedAt});
    expect(f.calls.captures).toBe(0);expect(f.calls.provider).toHaveLength(0);expect(f.calls.confirmations).toHaveLength(0);
    expect(f.calls.events.at(-1)).toEqual({type:'changed',taskId:task.id});
    for(const payload of [{title:' '},{title:'x'.repeat(201)},{goal:null},{goal:'x'.repeat(10001)},{goal:'a\0b'},{actions:[]},{windowId:'window:1'},{taskId:undefined}]){
      await expect(async()=>f.command({...{type:'tasks.update',taskId:task.id,title:'Valid'},...payload} as Command)).rejects.toThrow();
    }
    expect(await f.core.getTask(task.id)).toEqual(updated);
  })
  it('retiring old source A keeps a collapsed attachment B as an anchor',async()=>{
    const f=await fixture(),task=await f.command({type:'tasks.create',title:'Collapsed unrelated attachment'})
    await f.command({type:'windows.capture',taskId:task.id,windowId:'window:1'});await f.command({type:'surface.attach',windowId:'window:2'});await f.command({type:'surface.collapse'});await f.settlePresentation()
    const shows=f.calls.shows,original=f.seams.native.inspect;f.seams.native.inspect=async id=>{if(id==='window:1')throw Error('Old source closed');return original(id)}
    await expect(f.command({type:'model.run',taskId:task.id,requestId:'old-source-closed',kind:'explain',prompt:'Explain synthetic source'})).rejects.toThrow('unavailable')
    expect(f.calls.events.filter(e=>e.type==='surface').at(-1)).toMatchObject({mode:'anchor',attachedWindow:{id:'window:2'}})
    expect(f.bounds().width).toBeLessThan(100);expect(f.calls.shows).toBe(shows);expect(f.calls.provider).toHaveLength(0)
  })
  it.each(['new attachment','workspace mode'])('ignores late background placement after a %s',async change=>{
    const f=await fixture();await f.command({type:'surface.attach',windowId:'window:1'})
    const original=f.seams.native.inspect;let count=0,release!:(value:any)=>void,entered!:()=>void
    const pending=new Promise<any>(resolve=>{release=resolve}),paused=new Promise<void>(resolve=>{entered=resolve})
    f.seams.native.inspect=async id=>{if(id==='window:1'&&++count===2){entered();return pending}return original(id)}
    const monitoring=f.monitor();await paused
    if(change==='new attachment')await f.command({type:'surface.attach',windowId:'window:2'})
    else await f.command({type:'surface.workspace'})
    release(await original('window:1'));await monitoring
    const last=f.calls.events.at(-1)
    if(change==='new attachment')expect(last.attachedWindow.id).toBe('window:2')
    else {expect(last.mode).toBe('workspace');expect(f.bounds().height).toBe(760)}
  })
  it.each(['surface.workspace','model.run'] as const)('retires a closed source observed by %s before the monitor tick',async route=>{
    const f=await fixture(),task=await f.command({type:'tasks.create',title:'Synthetic source close race'})
    const captured:Task=await f.command({type:'windows.capture',taskId:task.id,windowId:'window:1'}),source=captured.sources[0]
    await f.command({type:'surface.attach',windowId:'window:1'});f.seams.native.inspect=async()=>{throw Error('Window closed')}
    if(route==='surface.workspace')await f.command({type:route})
    else await expect(f.command({type:route,taskId:task.id,requestId:'closed-before-send',kind:'explain',prompt:'Explain synthetic window'})).rejects.toThrow('unavailable')
    expect((await f.core.getTask(task.id)).sources[0].freshness).toBe('refresh-required')
    expect(await f.command({type:'source.preview',taskId:task.id,sourceId:source.id})).toBeNull();expect(f.calls.provider).toHaveLength(0)
  })
  it('publishes native freshness changes and retires cached pixels when an attached window disappears',async()=>{
    const f=await fixture(),task=await f.command({type:'tasks.create',title:'Synthetic attachment lifecycle'})
    const captured:Task=await f.command({type:'windows.capture',taskId:task.id,windowId:'window:1'}),source=captured.sources[0]
    await f.command({type:'surface.attach',windowId:'window:1'})
    f.calls.events.length=0
    f.seams.native.inspect=async()=>{throw Error('Synthetic window closed')}
    await f.monitor()
    expect((await f.core.getTask(task.id)).sources[0].freshness).toBe('refresh-required')
    expect(await f.command({type:'source.preview',taskId:task.id,sourceId:source.id})).toBeNull()
    expect(f.calls.events).toContainEqual({type:'changed',taskId:task.id})
    expect(f.calls.events.at(-1)).toMatchObject({type:'surface',mode:'anchor'})
    expect(f.bounds().x).toBeLessThan(1800);expect(f.calls.provider).toHaveLength(0)
  })
  it('separates compact and workspace placement without capture, inference or monitor focus stealing',async()=>{
    const f=await fixture();await f.command({type:'surface.attach',windowId:'window:1'})
    expect(f.bounds()).toMatchObject({width:360,height:440});expect(f.minimum()).toEqual([320,220]);expect(f.calls.events.at(-1)).toMatchObject({mode:'companion',placement:'outside-source'})
    await f.command({type:'surface.workspace'});expect(f.bounds()).toMatchObject({width:430,height:760});expect(f.calls.events.at(-1).mode).toBe('workspace')
    const shows=f.calls.shows;await f.attach('window:1','workspace',false);expect(f.calls.shows).toBe(shows)
    f.seams.native.inspect=async id=>({id,title:'Maximized synthetic',owner:{name:'Owned',processId:1},documentToken:'changed',bounds:{x:0,y:0,width:1800,height:1100}})
    await f.command({type:'surface.attach',windowId:'window:1'});expect(f.bounds().width).toBeLessThan(100)
    f.setResponse(0);await f.command({type:'surface.workspace'});expect(f.bounds().width).toBeLessThan(100)
    expect(f.calls.captures).toBe(0);expect(f.calls.provider).toHaveLength(0)
  })
  it('stores only a validated model experiment and keeps provenance host-owned',async()=>{
    const f=await fixture(),task=await f.command({type:'tasks.create',title:'Source-derived synthetic experiment'})
    await f.command({type:'source.text',taskId:task.id,source:{kind:'text',label:'Synthetic physics',role:'fact',content:'A cart moves at constant speed 12 m/s for 5 s.'}})
    const draft={schemaVersion:1,kind:'experiment',title:'Cart distance',explanation:'Constant speed only.',spec:{title:'Cart distance',variables:[{name:'speed',unit:'m/s',min:0,max:100},{name:'time',unit:'s',min:0,max:100}],assumptions:['Speed remains constant.'],expression:{op:'multiply',left:{op:'variable',name:'speed'},right:{op:'variable',name:'time'}}},inputs:{speed:12,time:5}}
    f.setOutput(JSON.stringify(draft));f.seams.run=async input=>{f.calls.provider.push(input);input.onChunk('{\"schemaVersion\":1,');input.onChunk('\"kind\":\"experiment\"}');return JSON.stringify(draft)};const done:Task=await f.command({type:'model.run',taskId:task.id,requestId:'generated-experiment',kind:'experiment',prompt:'Make an editable experiment from the source.'});expect(f.calls.events.filter(event=>event.type==='stream').map(event=>event.text)).toEqual(['Preparing your experiment…'])
    expect(done.artifacts[0].revisions[0].mimeType).toBe('application/json');expect(done.artifacts[0].revisions[0].sourceRefs[0].sourceId).toBe(done.sources[0].id)
    expect(f.calls.provider[0].prompt).toContain('schemaVersion')
    const parsed=JSON.parse(done.artifacts[0].revisions[0].content);expect(await f.command({type:'experiment.evaluate',spec:parsed.spec,inputs:parsed.inputs})).toMatchObject({value:60,unit:'m'})
    expect(done.procedures).toHaveLength(0);expect(done.actions).toHaveLength(0)
  })
  it('rejects forged structured action authority without accepting a completed artifact',async()=>{
    const f=await fixture(),task=await f.command({type:'tasks.create',title:'Synthetic structured injection'})
    f.setOutput(JSON.stringify({schemaVersion:1,kind:'procedure',title:'Forged',summary:'x',steps:[],limitations:[],approvalId:'forged',tool:'shell'}))
    await expect(f.command({type:'model.run',taskId:task.id,requestId:'invalid-generated-procedure',kind:'procedure',prompt:'Learn a procedure.'})).rejects.toThrow()
    const done=await f.core.getTask(task.id);expect(done.artifacts).toHaveLength(0);expect(done.procedures).toHaveLength(0);expect(done.actions).toHaveLength(0);expect(done.requests[0].status).toBe('failed')
  })
  it('fails closed on an unconfigured status even if run could recover, then requires consent for a new ready request',async()=>{
    const f=await fixture(),task=await f.command({type:'tasks.create',title:'Synthetic consent regression'})
    f.setConfigured(false)
    await expect(f.command({type:'model.run',taskId:task.id,requestId:'unavailable',kind:'explain',prompt:'Explain synthetic text'})).rejects.toThrow('availability is unverified')
    expect(f.calls.provider).toHaveLength(0);expect(f.calls.confirmations).toHaveLength(0)
    f.setConfigured(true);f.setResponse(0)
    await expect(f.command({type:'model.run',taskId:task.id,requestId:'denied',kind:'explain',prompt:'Explain synthetic text'})).rejects.toThrow('not authorized')
    expect(f.calls.provider).toHaveLength(0);expect(f.calls.confirmations).toHaveLength(1)
    f.setResponse(1)
    const done=await f.command({type:'model.run',taskId:task.id,requestId:'authorized',kind:'explain',prompt:'Explain synthetic text'})
    expect(f.calls.confirmations).toHaveLength(2);expect(f.calls.provider).toHaveLength(1);expect(done.requests.at(-1).status).toBe('completed')
  })
  it('rejects an over-capacity refresh without advancing history or retaining/transmitting old pixels',async()=>{
    const f=await fixture(),task=await f.command({type:'tasks.create',title:'Synthetic cache budget regression'})
    let t:Task=await f.command({type:'windows.capture',taskId:task.id,windowId:'window:1'});const a=t.sources[0]
    for(let i=2;i<=5;i++){f.setCapture(7*1024*1024,'other-'+i);t=await f.command({type:'windows.capture',taskId:task.id,windowId:'window:'+i})}
    f.setCapture(7*1024*1024,'new-A')
    await expect(f.command({type:'windows.capture',taskId:task.id,windowId:'window:1',sourceId:a.id})).rejects.toThrow('exceed 32 MiB')
    const after=await f.core.getTask(task.id),current=after.sources.find(s=>s.id===a.id)!
    expect(current.currentVersion).toBe(1);expect(current.versions).toHaveLength(1);expect(current.freshness).toBe('refresh-required')
    expect(await f.command({type:'source.preview',taskId:task.id,sourceId:a.id})).toBeNull()
    expect(await f.command({type:'source.preview',taskId:task.id,sourceId:after.sources[1].id})).not.toBeNull()
    await expect(f.command({type:'model.run',taskId:task.id,requestId:'after-rejected-refresh',kind:'explain',prompt:'Explain synthetic windows'})).rejects.toThrow('explicit refresh')
    expect(f.calls.provider).toHaveLength(0)
    f.setCapture(1024*1024,'new-smaller-A')
    const refreshed:Task=await f.command({type:'windows.capture',taskId:task.id,windowId:'window:1',sourceId:a.id})
    expect(refreshed.sources[0].currentVersion).toBe(2)
    await f.command({type:'model.run',taskId:task.id,requestId:'after-successful-refresh',kind:'explain',prompt:'Explain synthetic windows'})
    expect(f.calls.provider[0].sources[0].version).toBe(2)
    expect(Buffer.from(f.calls.provider[0].sources[0].content.split(',')[1],'base64').toString()).toBe('new-smaller-A')
  })
  it.each(['version','digest','captureId','imageSha256'])('rejects a mismatched cached %s before preview and transmission',async(field)=>{
    const f=await fixture(),task=await f.command({type:'tasks.create',title:'Synthetic exact capture binding'})
    const t:Task=await f.command({type:'windows.capture',taskId:task.id,windowId:'window:1'}),source=t.sources[0],bound=f.cache.get(`${task.id}:${source.id}`)
    if(field==='version')bound.version++
    else if(field==='digest')bound.digest='different'
    else if(field==='captureId')bound.capture.sourceVersion='different'
    else bound.capture.imageSha256='different'
    // Preview must discard the mismatched cache, and run cannot revive it.
    expect(await f.command({type:'source.preview',taskId:task.id,sourceId:source.id})).toBeNull()
    await expect(f.command({type:'model.run',taskId:task.id,requestId:'mismatch-'+field,kind:'explain',prompt:'Explain synthetic window'})).rejects.toThrow('Refresh the selected window')
    expect(f.calls.provider).toHaveLength(0)
  })
})

describe('Context-first intake and scoped analysis',()=>{
  it('pins the selected task at shortcut invocation before asynchronous foreground metadata returns',async()=>{
    const f=await fixture(),a=await f.core.createTask({title:'Task A'}),b=await f.core.createTask({title:'Task B'}),target=await f.seams.native.inspect('window:1');
    await f.command({type:'context.view',taskId:a.id});let release!:()=>void,entered!:()=>void;const barrier=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>entered=resolve);
    f.seams.native.foregroundWindow=async()=>{entered();await barrier;return target;};const pending=f.shortcut();await started;await f.command({type:'context.view',taskId:b.id});release();await pending;
    const activation=f.calls.events.filter(event=>event.type==='context.activate').at(-1).activation;expect(activation).toMatchObject({ownerTaskId:a.id,trigger:'shortcut'});
    await expect(f.command({type:'context.capture',activationId:activation.activationId,windowId:target.id,taskId:b.id})).rejects.toThrow('different task');expect(f.calls.captures).toBe(0);expect(f.calls.provider).toHaveLength(0);
  });
  it('shortcut uses the external foreground and rejects self or missing focus without offering background choices',async()=>{
    const f=await fixture(),windows=await f.seams.native.listWindows();
    f.seams.native.foregroundWindow=async()=>windows[1];await f.shortcut();
    const activation=f.calls.events.filter(e=>e.type==='context.activate').at(-1).activation;
    expect(activation.target.id).toBe('window:2');expect(activation.choices).toEqual([]);
    const count=f.calls.events.filter(e=>e.type==='context.activate').length;
    for(const foreground of [undefined,{...windows[0],owner:{name:'Window Companion',processId:process.pid}}]){
      f.seams.native.foregroundWindow=async()=>foreground as any;await f.shortcut();
      expect(f.calls.events.filter(e=>e.type==='context.activate')).toHaveLength(count);
      expect(f.calls.events.at(-1)).toMatchObject({type:'context.error'});
    }
    await expect(f.command({type:'context.capture',activationId:activation.activationId,windowId:activation.target.id})).rejects.toThrow('expired');
    expect(f.calls.captures).toBe(0);expect(f.calls.provider).toHaveLength(0);
  });
  it('rejects a foreground document change between intake validation and native capture consent',async()=>{
    const f=await fixture();await f.command({type:'context.start'});
    const activation=f.calls.events.filter(e=>e.type==='context.activate').at(-1).activation;
    const original=f.seams.native.inspect;let reads=0;
    f.seams.native.inspect=async id=>({...await original(id),documentToken:++reads===1?'constant-metadata':'different-document'});
    await expect(f.command({type:'context.capture',activationId:activation.activationId,windowId:activation.target.id})).rejects.toThrow('Source changed');
    expect(f.calls.captures).toBe(0);expect(f.calls.confirmations).toHaveLength(0);expect(f.calls.provider).toHaveLength(0);
  });
  it('resolves exact foreground metadata before focusing and preserves the current task on capture',async()=>{
    const f=await fixture(),task=await f.core.createTask({title:'Current work'});
    const windows=await f.seams.native.listWindows();f.seams.native.foregroundWindow=async()=>windows[1];
    await f.command({type:'context.start'});const activation=f.calls.events.filter(e=>e.type==='context.activate').at(-1).activation;
    expect(activation.target.id).toBe('window:2');expect(f.calls.captures).toBe(0);expect(f.calls.provider).toHaveLength(0);
    const result=await f.command({type:'context.capture',activationId:activation.activationId,windowId:'window:2',taskId:task.id});
    expect(result).toMatchObject({state:'captured',task:{id:task.id},tucked:false});expect(result.task.sources).toHaveLength(1);expect((await f.core.listTasks())).toHaveLength(1);expect(f.calls.provider).toHaveLength(0);
    await expect(f.command({type:'context.capture',activationId:activation.activationId,windowId:'window:2',taskId:task.id})).rejects.toThrow('expired');
  });
  it('never selects an arbitrary background source when foreground is missing or belongs to this app',async()=>{
    const f=await fixture();f.seams.native.foregroundWindow=async()=>undefined as any;
    await f.command({type:'context.start'});let activation=f.calls.events.filter(e=>e.type==='context.activate').at(-1).activation;expect(activation.target).toBeUndefined();expect(activation.choices).toHaveLength(2);
    f.seams.native.foregroundWindow=async()=>({...activation.choices[0],owner:{name:'Window Companion',processId:process.pid}});
    await f.command({type:'context.start'});activation=f.calls.events.filter(e=>e.type==='context.activate').at(-1).activation;expect(activation.target).toBeUndefined();expect(f.calls.captures).toBe(0);
    await expect(f.command({type:'context.capture',activationId:activation.activationId,windowId:'window:999'})).rejects.toThrow('external window');
  });
  it('rejects replaced, cancelled and changed-window selections before capture',async()=>{
    const f=await fixture();await f.command({type:'context.start'});const first=f.calls.events.filter(e=>e.type==='context.activate').at(-1).activation;
    await f.command({type:'context.start'});const next=f.calls.events.filter(e=>e.type==='context.activate').at(-1).activation;
    await expect(f.command({type:'context.capture',activationId:first.activationId,windowId:'window:1'})).rejects.toThrow('expired');
    const original=f.seams.native.inspect;f.seams.native.inspect=async id=>({...await original(id),documentToken:'changed'});
    await expect(f.command({type:'context.capture',activationId:next.activationId,windowId:'window:1'})).rejects.toThrow('Source changed');
    await f.command({type:'context.cancel',activationId:next.activationId});await expect(f.command({type:'context.capture',activationId:next.activationId,windowId:'window:1'})).rejects.toThrow('expired');expect(f.calls.captures).toBe(0);expect(f.calls.provider).toHaveLength(0);
  });
  it('keeps no-room intake at an anchor before creating a task, capturing or inferring',async()=>{
    const f=await fixture();await f.command({type:'surface.collapse'});await f.settlePresentation();
    const target={...(await f.seams.native.inspect('window:1')),bounds:{x:0,y:0,width:1800,height:1100}};f.seams.native.inspect=async()=>target;f.seams.native.foregroundWindow=async()=>target;f.seams.native.listWindows=async()=>[target];
    await f.command({type:'context.start'});const a=f.calls.events.filter(e=>e.type==='context.activate').at(-1).activation;
    const result=await f.command({type:'context.capture',activationId:a.activationId,windowId:target.id});expect(result.state).toBe('no-room');expect(f.bounds().width).toBeLessThan(100);expect(f.calls.captures).toBe(0);expect(f.calls.provider).toHaveLength(0);expect(await f.core.listTasks()).toHaveLength(0);
  });
  it('cancelling while native capture consent is pending prevents a late approval from capturing',async()=>{
    const f=await fixture();await f.command({type:'context.start'});const a=f.calls.events.filter(e=>e.type==='context.activate').at(-1).activation;
    let release!:(v:{response:number})=>void,entered!:()=>void;const enteredPromise=new Promise<void>(r=>entered=r);f.seams.confirm=async()=>{entered();return new Promise(r=>release=r)};
    const pending=f.command({type:'context.capture',activationId:a.activationId,windowId:'window:1'});await enteredPromise;await f.command({type:'context.cancel',activationId:a.activationId});release({response:1});await expect(pending).rejects.toThrow('expired');expect(f.calls.captures).toBe(0);expect(f.calls.provider).toHaveLength(0);
  });
  it('adding a new appshot during a request does not refresh or abort its frozen active source',async()=>{
    const f=await fixture(),task=await f.core.createTask({title:'Active work'});const first:Task=await f.command({type:'windows.capture',taskId:task.id,windowId:'window:1'});
    let release!:(v:any)=>void,started!:()=>void,signal:AbortSignal;const ready=new Promise<void>(r=>started=r);
    const request=f.core.runRequest({taskId:task.id,requestId:'in-flight',kind:'explain',prompt:'Original snapshot',sourceIds:[first.sources[0].id]},ctx=>{signal=ctx.signal;started();return new Promise(r=>release=r)});await ready;
    await f.command({type:'context.start'});const a=f.calls.events.filter(e=>e.type==='context.activate').at(-1).activation;
    const next=await f.command({type:'context.capture',activationId:a.activationId,windowId:'window:1',taskId:task.id});expect(next.task.sources).toHaveLength(2);expect(next.sourceId).not.toBe(first.sources[0].id);expect(signal!.aborted).toBe(false);release({title:'Original response',content:'Original source retained.'});expect((await request).status).toBe('completed');
  });
  it('scopes actual transport to selected sources and hides structured suggestion tails in streamed prose',async()=>{
    const f=await fixture(),task=await f.core.createTask({title:'Selected context'});let current=await f.core.putSource(task.id,{kind:'text',label:'Visitor guide',role:'fact',content:'Doors open at 18:00.'});const selected=current.sources[0];current=await f.core.putSource(task.id,{kind:'text',label:'Old unrelated source',role:'fact',content:'Do not send this.'});await f.core.invalidateSource(task.id,current.sources[1].id,'Unrelated old document');
    const v=selected.versions[0],refs=[{sourceId:selected.id,version:v.version,digest:v.digest}];
    f.seams.run=async input=>{f.calls.provider.push(input);for(const chunk of ['Doors open at 18:00.','\n<!-- companion-','actions -->\n','{"actions":[]}'])input.onChunk(chunk);return 'Doors open at 18:00.\n<!-- companion-actions -->\n{"actions":[]}';};
    const result=await f.command({type:'model.run',taskId:task.id,requestId:'brief',kind:'brief',prompt:'Read this snapshot.',sourceIds:[selected.id],expectedSourceRefs:refs});expect(result.requests[0].status).toBe('completed');expect(f.calls.provider[0].sources.map((s:any)=>s.label)).toEqual(['Visitor guide']);expect(f.calls.events.filter(e=>e.type==='stream').map(e=>e.text).join('')).not.toMatch(/companion-actions|"actions"/);expect(JSON.parse(result.artifacts[0].revisions[0].content)).toMatchObject({kind:'screen-brief',insight:'Doors open at 18:00.',actions:[]});
    await expect(f.command({type:'model.run',taskId:task.id,requestId:'brief',kind:'brief',prompt:'Read this snapshot.',sourceIds:[selected.id],expectedSourceRefs:[{...refs[0],digest:'forged'}]})).rejects.toThrow('source versions changed');expect(f.calls.provider).toHaveLength(1);
  });
});

describe('Context authority review regressions',()=>{
 it('checks no-room after a tucked chooser has expanded the app',async()=>{
  const f=await fixture();await f.command({type:'surface.collapse'});await f.settlePresentation();
  const target={...await f.seams.native.inspect('window:1'),bounds:{x:0,y:0,width:1800,height:1100}};f.seams.native.foregroundWindow=async()=>undefined as any;f.seams.native.listWindows=async()=>[target];f.seams.native.inspect=async()=>target;
  await f.command({type:'context.start'});const a=f.calls.events.filter(e=>e.type==='context.activate').at(-1).activation;expect(a.target).toBeUndefined();expect(f.bounds().width).toBeGreaterThan(100);
  const result=await f.command({type:'context.capture',activationId:a.activationId,windowId:target.id});expect(result.state).toBe('no-room');expect(f.bounds().width).toBeLessThan(100);expect(f.calls.captures).toBe(0);expect(f.calls.provider).toHaveLength(0);expect(await f.core.listTasks()).toHaveLength(0);
 });
 it('appends context even if an old-source request starts during capture consent',async()=>{
  const f=await fixture(),task=await f.core.createTask({title:'Concurrent context'}),first:Task=await f.command({type:'windows.capture',taskId:task.id,windowId:'window:1'});
  await f.command({type:'context.start'});const a=f.calls.events.filter(e=>e.type==='context.activate').at(-1).activation;
  let approve!:(value:{response:number})=>void,entered!:()=>void;const waiting=new Promise<void>(r=>entered=r);f.seams.confirm=async()=>{entered();return new Promise(r=>approve=r)};const capture=f.command({type:'context.capture',activationId:a.activationId,windowId:'window:1',taskId:task.id});await waiting;
  let finish!:(value:any)=>void,ready!:()=>void,signal:AbortSignal;const started=new Promise<void>(r=>ready=r);const request=f.core.runRequest({taskId:task.id,requestId:'started-after-capture-intake',kind:'explain',prompt:'Keep the original snapshot.',sourceIds:[first.sources[0].id]},ctx=>{signal=ctx.signal;ready();return new Promise(r=>finish=r)});await started;approve({response:1});const result=await capture;expect(result.task.sources).toHaveLength(2);expect(result.sourceId).not.toBe(first.sources[0].id);expect(signal!.aborted).toBe(false);finish({title:'Original response',content:'Original source preserved.'});expect((await request).status).toBe('completed');
 });
 it.each([false,true])('rejects own windows at the common capture sink (changed during consent: %s)',async changed=>{
  const f=await fixture(),task=await f.core.createTask({title:'Own window rejection'}),original=f.seams.native.inspect;let inspected=0;f.seams.native.inspect=async id=>{const source=await original(id);return !changed||++inspected>1?{...source,owner:{name:'Window Companion',processId:process.pid}}:source;};
  await expect(f.command({type:'windows.capture',taskId:task.id,windowId:'window:1'})).rejects.toThrow(changed?'Source changed':'external window');expect(f.calls.captures).toBe(0);expect((await f.core.getTask(task.id)).sources).toHaveLength(0);expect(f.calls.provider).toHaveLength(0);
 });
});

describe('Intake-aware placement ownership',()=>{
 it.each(['cancel','view change'])('cannot commit late attachment after %s',async change=>{
  const f=await fixture();await f.command({type:'surface.collapse'});await f.settlePresentation();await f.command({type:'context.start'});const a=f.calls.events.filter(e=>e.type==='context.activate').at(-1).activation;
  const original=f.seams.native.inspect;let count=0,release!:(value:any)=>void,entered!:()=>void;const paused=new Promise<void>(r=>entered=r),held=new Promise<any>(r=>release=r);f.seams.native.inspect=async id=>{if(++count===2){entered();return held}return original(id)};
  const pending=f.command({type:'context.capture',activationId:a.activationId,windowId:'window:1'});await paused;
  if(change==='cancel')await f.command({type:'context.cancel',activationId:a.activationId});else await f.command({type:'surface.workspace'});
  const eventCount=f.calls.events.length;release(await original('window:1'));await expect(pending).rejects.toThrow('expired');expect(f.calls.events.slice(eventCount).filter(e=>e.type==='surface'&&e.mode==='companion')).toHaveLength(0);expect(f.calls.captures).toBe(0);expect(await f.core.listTasks()).toHaveLength(0);
 });
});


describe('Frozen pixels retention',()=>{
 it('purges expired pixels before preview and while detached, preserving durable source records',async()=>{
  const f=await fixture(),task=await f.core.createTask({title:'Retention'});
  const captured:Task=await f.command({type:'windows.capture',taskId:task.id,windowId:'window:1'}),source=captured.sources[0];
  const entry=f.cache.get(`${task.id}:${source.id}`);entry.capture.capturedAt=new Date(Date.now()-300001).toISOString();
  expect(await f.command({type:'source.preview',taskId:task.id,sourceId:source.id})).toBeNull();expect(f.cache.size).toBe(0);expect((await f.core.getTask(task.id)).sources).toHaveLength(1);
  await f.command({type:'windows.capture',taskId:task.id,windowId:'window:1'});for(const entry of f.cache.values())entry.capture.capturedAt='invalid';await f.monitor();expect(f.cache.size).toBe(0);expect(f.calls.provider).toHaveLength(0);
 });
});
