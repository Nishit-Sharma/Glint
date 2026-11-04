import {buildCodexInput} from '../src/host/codex-provider';
import {afterEach,describe,expect,it} from 'vitest'
import {build} from 'esbuild'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {randomUUID} from 'node:crypto'
import {placeCompanion,type Rect} from '../src/host/native'
import type {Command,CompactFit,CompanionEvent} from '../src/shared/bridge'

// Exercise the actual host handler and placement solver with inert OS/provider boundaries.
const cleanups:Array<()=>Promise<void>>=[]
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup()})
async function fixture(){
  const root=resolve('.'),dir=await mkdtemp(join(tmpdir(),'native-content-fit-')),key='nativeFit'+randomUUID().replaceAll('-','')
  const calls={events:[] as CompanionEvent[],bounds:[] as Rect[],shows:0,captures:0,provider:0,confirmations:0}
  const work={x:0,y:0,width:1800,height:1100}
  let source:Rect={x:100,y:80,width:900,height:700},bounds:Rect={x:1350,y:20,width:430,height:760},minimum=[360,500],visible=true
  const window=(id:string)=>({id,title:'Synthetic source',owner:{name:'Fixture source',processId:1},documentToken:'stable',bounds:{...source}})
  const seams={work,buildCodexInput,placeCompanion,inspect:async(id:string)=>window(id),capture:()=>{calls.captures++;throw Error('No capture expected')},provider:()=>{calls.provider++;throw Error('No provider expected')},confirm:()=>{calls.confirmations++;return {response:0}}}
  Reflect.set(globalThis,key,seams)
  const seam=`globalThis[${JSON.stringify(key)}]`
  const electron=`const noop=()=>{};export const app={getPath:()=>process.env.WINDOW_COMPANION_DATA_DIR,setPath:noop,isReady:()=>false,disableHardwareAcceleration:noop,whenReady:()=>new Promise(()=>{}),on:noop};export const Notification={isSupported:()=>false};export const BrowserWindow=class{};export const clipboard={};export class ClipboardItem{};export const Menu=undefined;export const dialog={showMessageBox:()=>${seam}.confirm()};export const Tray=class{};export const systemPreferences={isTrustedAccessibilityClient:()=>false};export const globalShortcut={};export const ipcMain={};export const nativeImage={};export const safeStorage={};export const screen={getDisplayMatching:()=>({workArea:${seam}.work})};export const session={};`
  const provider=`export const buildCodexInput=(...args)=>${seam}.buildCodexInput(...args);export class MetaProvider{run(){return ${seam}.provider()};reset(){};close(){}};export class CodexProvider extends MetaProvider{}`
  const native=`export class NativeSourceAdapter{inspect(id){return ${seam}.inspect(id)};capture(){return ${seam}.capture()}};export const placeCompanion=(...a)=>${seam}.placeCompanion(...a);`
  const outfile=join(dir,'host.mjs')
  await build({stdin:{contents:await readFile(join(root,'src/host/index.ts'),'utf8')+'\nexport {command,validate,monitorAttached,retireUnavailableWindow};export const setPanel=p=>{panel=p;core={listTasks:async()=>[]}};export const dispose=()=>{cancelEntrancePresentation(false);cancelCollapsePresentation(false)};',resolveDir:join(root,'src/host'),loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile,plugins:[{name:'inert-native-fit-boundaries',setup(b){b.onResolve({filter:/^(electron|\.\/provider|\.\/codex-provider|\.\/native)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='electron'?electron:a.path==='./native'?native:provider,loader:'js'}))}}]})
  const previous=process.env.WINDOW_COMPANION_DATA_DIR;process.env.WINDOW_COMPANION_DATA_DIR=dir
  let host:any
  try{host=await import(/* @vite-ignore */pathToFileURL(outfile).href)}finally{if(previous===undefined)delete process.env.WINDOW_COMPANION_DATA_DIR;else process.env.WINDOW_COMPANION_DATA_DIR=previous}
  host.setPanel({isDestroyed:()=>false,isVisible:()=>visible,hide:()=>{visible=false},setAlwaysOnTop:()=>{},webContents:{capturePage:async()=>({toDataURL:()=>''}),send:(_topic:string,event:CompanionEvent)=>calls.events.push(event)},setMinimumSize:(w:number,h:number)=>{minimum=[w,h]},setBounds:(next:Rect)=>{bounds={...next};calls.bounds.push({...next})},getBounds:()=>({...bounds}),getSize:()=>[bounds.width,bounds.height],show:()=>{visible=true;calls.shows++},showInactive:()=>{visible=true}})
  cleanups.push(async()=>{host.dispose();Reflect.deleteProperty(globalThis,key);await rm(dir,{recursive:true,force:true})})
  const command=(c:Command):Promise<any>=>host.command(host.validate(c))
  const fit=():CompactFit=>{const event=calls.events.filter((e):e is Extract<CompanionEvent,{type:'surface'}>=>e.type==='surface').at(-1);if(!event?.compactFit)throw Error('No compact fit offered');return event.compactFit}
  return {calls,seams,command,fit,monitor:host.monitorAttached,retire:host.retireUnavailableWindow,bounds:()=>({...bounds}),minimum:()=>minimum,visible:()=>visible,setSource:(next:Rect)=>{source={...next}},source:()=>({...source})}
}
const fitCommand=(fitId:string,height:number,phase:'preparing'|'running'|'settled'='settled'):Command=>({type:'surface.fit',fitId,height,phase})

describe('Bounded native compact content fitting',()=>{
  it('acknowledges the exact held bounds and rejects a retired running reservation',async()=>{
    const f=await fixture();await f.command({type:'surface.attach',windowId:'window:1'});const token=f.fit();
    await f.command(fitCommand(token.id,295,'preparing'));
    expect(await f.command(fitCommand(token.id,600,'running'))).toEqual({height:295,maxHeight:1100});
    await f.command(fitCommand(token.id,400,'settled'));
    expect(await f.command(fitCommand(token.id,295,'running'))).toBeNull();expect(f.bounds().height).toBe(400);
  })
  it.each([{x:150,y:150,width:900,height:700},{x:0,y:0,width:1800,height:1100}])('retires a drawing immediately when the source moves over it: %j',async source=>{
    const f=await fixture();await f.command({type:'surface.attach',windowId:'window:1'});const token=f.fit();
    await f.command(fitCommand(token.id,295,'preparing'));await f.command(fitCommand(token.id,295,'running'));
    f.setSource(source);await f.monitor();expect(f.bounds().width).toBeLessThan(100);expect(f.source()).toEqual(source);
    expect(await f.command(fitCommand(token.id,600,'settled'))).toBeNull();
    expect([f.calls.captures,f.calls.provider,f.calls.confirmations]).toEqual([0,0,0]);
  })
  it('fits an explicitly approved detached panel without pretending an exterior gap exists',async()=>{
    const f=await fixture();f.setSource({...f.seams.work});await f.command({type:'surface.attach',windowId:'window:1'});expect(f.bounds().width).toBeLessThan(100);f.seams.confirm=()=>{f.calls.confirmations++;return {response:1}};await f.command({type:'surface.expand'});const token=f.fit(),before=f.source();expect(f.bounds().width).toBe(360);
    expect(await f.command(fitCommand(token.id,295,'preparing'))).toEqual({height:295,maxHeight:1100});expect(f.bounds().height).toBe(295);await f.command(fitCommand(token.id,295,'running'));await f.command(fitCommand(token.id,600));expect(f.bounds().height).toBe(600);await f.monitor();expect(f.bounds().height).toBe(600);expect(f.source()).toEqual(before);expect([f.calls.captures,f.calls.provider,f.calls.confirmations]).toEqual([0,0,1]);
  })
  it('fits measured short content, grows independently of the shrunken viewport and survives monitor ticks',async()=>{
    const f=await fixture();await f.command({type:'surface.attach',windowId:'window:1'})
    const token=f.fit(),source=f.source(),shows=f.calls.shows
    expect(token.maxHeight).toBe(1100)
    expect(await f.command(fitCommand(token.id,295,'preparing'))).toEqual({height:295,maxHeight:1100})
    expect(f.bounds()).toEqual({x:1012,y:80,width:360,height:295});expect(f.minimum()).toEqual([320,220])
    await f.command(fitCommand(token.id,800));expect(f.bounds().height).toBe(800)
    await f.monitor();expect(f.bounds().height).toBe(800);expect(f.fit()).toEqual(token)
    await f.command(fitCommand(token.id,100000));expect(f.bounds()).toEqual({x:1012,y:0,width:360,height:1100})
    await f.command(fitCommand(token.id,1));expect(f.bounds().height).toBe(220)
    expect(f.source()).toEqual(source);expect(f.calls.shows).toBe(shows)
    expect([f.calls.captures,f.calls.provider,f.calls.confirmations]).toEqual([0,0,0])
    expect(f.calls.events.filter(e=>e.type==='presentation.enter'||e.type==='presentation.exit')).toHaveLength(0)
  })

  it('uses the actual above/below exterior cap instead of collapsing for an oversized request',async()=>{
    const f=await fixture();f.setSource({x:0,y:0,width:1800,height:720});await f.command({type:'surface.attach',windowId:'window:1'})
    const token=f.fit();expect(token.maxHeight).toBe(368)
    expect(f.bounds()).toEqual({x:0,y:732,width:360,height:368})
    await f.command(fitCommand(token.id,295));expect(f.bounds().height).toBe(295)
    expect(await f.command(fitCommand(token.id,10000))).toEqual({height:368,maxHeight:368})
    await f.monitor();expect(f.bounds()).toEqual({x:0,y:732,width:360,height:368})
    f.setSource({x:0,y:0,width:1800,height:600});await f.monitor()
    expect(f.bounds()).toEqual({x:0,y:612,width:360,height:488});expect(f.fit()).toEqual({id:token.id,maxHeight:488})
    expect(f.calls.events.filter(e=>e.type==='surface'&&e.mode==='anchor')).toHaveLength(0)
  })

  it('freezes both pending fits and periodic placement while the original reveal is running',async()=>{
    const f=await fixture();await f.command({type:'surface.attach',windowId:'window:1'});const token=f.fit()
    await f.command(fitCommand(token.id,295,'preparing'))
    const inspect=f.seams.inspect;let release!:(value:any)=>void,entered!:()=>void
    const paused=new Promise<void>(r=>entered=r),held=new Promise<any>(r=>release=r)
    f.seams.inspect=async()=>{entered();return held}
    const old=f.command(fitCommand(token.id,600,'preparing'));await paused
    await f.command(fitCommand(token.id,600,'running'));release(await inspect('window:1'));expect(await old).toBeNull()
    f.seams.inspect=inspect;f.setSource({x:50,y:150,width:900,height:700})
    const before=f.bounds(),writes=f.calls.bounds.length;await f.monitor();expect(f.bounds()).toEqual(before);expect(f.calls.bounds).toHaveLength(writes)
    expect(await f.command(fitCommand(token.id,700,'preparing'))).toBeNull()
    await f.command(fitCommand(token.id,700));expect(f.bounds()).toEqual({x:962,y:150,width:360,height:700})
    await f.command(fitCommand(token.id,500,'preparing'));await f.command(fitCommand(token.id,500,'running'))
    await f.command(fitCommand(token.id,400));expect(f.bounds().height).toBe(400)
  })

  it('cannot commit a monitor placement that started before the reveal became running',async()=>{
    const f=await fixture();await f.command({type:'surface.attach',windowId:'window:1'});const token=f.fit()
    await f.command(fitCommand(token.id,295,'preparing'))
    const inspect=f.seams.inspect;let count=0,release!:(value:any)=>void,entered!:()=>void
    const paused=new Promise<void>(r=>entered=r),held=new Promise<any>(r=>release=r)
    f.seams.inspect=async id=>{if(++count===2){entered();return held}return inspect(id)}
    const monitoring=f.monitor();await paused;const before=f.bounds(),writes=f.calls.bounds.length
    await f.command(fitCommand(token.id,295,'running'));release({...await inspect('window:1'),bounds:{x:200,y:200,width:900,height:700}});await monitoring
    expect(f.bounds()).toEqual(before);expect(f.calls.bounds).toHaveLength(writes)
  })

  it.each(['new attachment','workspace'] as const)('discards an asynchronous fit after a %s takes ownership',async change=>{
    const f=await fixture();await f.command({type:'surface.attach',windowId:'window:1'});const token=f.fit(),inspect=f.seams.inspect
    let release!:(value:any)=>void,entered!:()=>void
    const paused=new Promise<void>(r=>entered=r),held=new Promise<any>(r=>release=r)
    f.seams.inspect=async id=>{if(id==='window:1'){entered();return held}return inspect(id)}
    const pending=f.command(fitCommand(token.id,295));await paused
    if(change==='new attachment')await f.command({type:'surface.attach',windowId:'window:2'})
    else {f.seams.inspect=inspect;await f.command({type:'surface.workspace'})}
    const before=f.bounds(),writes=f.calls.bounds.length;release(await inspect('window:1'));expect(await pending).toBeNull()
    expect(f.bounds()).toEqual(before);expect(f.calls.bounds).toHaveLength(writes)
    expect(await f.command(fitCommand(token.id,700))).toBeNull()
    if(change==='new attachment')expect(f.fit().id).not.toBe(token.id)
  })

  it('keeps exit dimensions and the anchor immutable, then issues a new token for reopening',async()=>{
    const f=await fixture();await f.command({type:'surface.attach',windowId:'window:1'});const token=f.fit()
    await f.command(fitCommand(token.id,295))
    const inspect=f.seams.inspect;let release!:(value:any)=>void,entered!:()=>void
    const paused=new Promise<void>(r=>entered=r),held=new Promise<any>(r=>release=r)
    f.seams.inspect=async()=>{entered();return held}
    const pending=f.command(fitCommand(token.id,700));await paused
    await f.command({type:'surface.collapse'});await Promise.resolve();const drawing=f.bounds()
    release(await inspect('window:1'));expect(await pending).toBeNull();expect(f.bounds()).toEqual(drawing)
    expect(drawing.height).toBe(295)
    const prepared=f.calls.events.find((e):e is Extract<CompanionEvent,{type:'presentation.prepare'}>=>e.type==='presentation.prepare')!
    expect(prepared.purpose).toBe('collapse');await f.command({type:'presentation.capture',exitId:prepared.exitId});await Promise.resolve()
    const exit=f.calls.events.find((e):e is Extract<CompanionEvent,{type:'presentation.exit'}>=>e.type==='presentation.exit')!
    await f.command({type:'presentation.finish',exitId:exit.exitId});const anchor=f.bounds()
    expect(anchor.width).toBeLessThan(100);expect(await f.command(fitCommand(token.id,900))).toBeNull();expect(f.bounds()).toEqual(anchor)
    await f.command({type:'presentation.reveal',exitId:exit.exitId});f.seams.inspect=inspect
    await f.command({type:'surface.expand'});const reopened=f.fit();expect(reopened.id).not.toBe(token.id);expect(f.bounds().height).toBe(295);expect(f.visible()).toBe(false)
    expect(await f.command(fitCommand(token.id,800))).toBeNull()
    await f.command(fitCommand(reopened.id,310,'preparing'));expect(f.bounds().height).toBe(310)
    const entrance=f.calls.events.find((e):e is Extract<CompanionEvent,{type:'presentation.enter'}>=>e.type==='presentation.enter')!
    await f.command({type:'presentation.show',entranceId:entrance.entranceId});expect(f.visible()).toBe(true)
    await f.command(fitCommand(reopened.id,310,'running'));expect(await f.command(fitCommand(reopened.id,700,'preparing'))).toBeNull();expect(f.bounds().height).toBe(310)
  })

  it('lets the newest content measurement win when inspections resolve out of order',async()=>{
    const f=await fixture();await f.command({type:'surface.attach',windowId:'window:1'});const token=f.fit(),inspect=f.seams.inspect
    let release!:(value:any)=>void,entered!:()=>void
    const paused=new Promise<void>(r=>entered=r),held=new Promise<any>(r=>release=r)
    f.seams.inspect=async()=>{entered();return held};const old=f.command(fitCommand(token.id,295));await paused
    f.seams.inspect=inspect;await f.command(fitCommand(token.id,600));release(await inspect('window:1'));expect(await old).toBeNull();expect(f.bounds().height).toBe(600)
    await f.monitor();expect(f.bounds().height).toBe(600)
  })

  it('does not gain collapse, capture or provider authority when source geometry becomes unavailable',async()=>{
    const f=await fixture();await f.command({type:'surface.attach',windowId:'window:1'});const token=f.fit()
    await f.command(fitCommand(token.id,295));const before=f.bounds(),events=f.calls.events.length
    f.setSource({x:0,y:0,width:1800,height:1100});expect(await f.command(fitCommand(token.id,900))).toBeNull();expect(f.bounds()).toEqual(before)
    f.seams.inspect=async()=>{throw Error('Source closed')};expect(await f.command(fitCommand(token.id,400))).toBeNull();expect(f.bounds()).toEqual(before)
    expect(f.calls.events).toHaveLength(events);expect([f.calls.captures,f.calls.provider,f.calls.confirmations]).toEqual([0,0,0])
  })

  it('retains the current fit offer when an unrelated saved source is retired',async()=>{
    const f=await fixture();await f.command({type:'surface.attach',windowId:'window:2'});const token=f.fit()
    await f.command(fitCommand(token.id,295));await f.retire('window:old','Old source closed')
    expect(f.fit()).toEqual(token);await f.command(fitCommand(token.id,500));expect(f.bounds().height).toBe(500)
  })

  it('fits unattached compact content within the work area with a viewport-independent cap',async()=>{
    const f=await fixture();await f.command({type:'surface.companion'});const token=f.fit(),shows=f.calls.shows
    await f.command(fitCommand(token.id,250));expect(f.bounds().height).toBe(250)
    expect(await f.command(fitCommand(token.id,10000))).toEqual({height:1100,maxHeight:1100})
    expect(f.bounds()).toEqual({x:1420,y:0,width:360,height:1100});expect(f.calls.shows).toBe(shows)
  })

  it('validates a narrow height-and-lifecycle request and ignores unknown tokens',async()=>{
    const f=await fixture();await f.command({type:'surface.attach',windowId:'window:1'});const token=f.fit(),before=f.bounds()
    for(const payload of [{height:0},{height:-1},{height:NaN},{height:Infinity},{height:1.5},{height:'295'},{height:100001},{fitId:''},{fitId:'x'.repeat(201)},{fitId:'x\0y'},{phase:'hidden'},{width:1000},{x:0},{windowId:'window:2'},{taskId:'task:1'}]){
      await expect(async()=>f.command({...fitCommand(token.id,295),...payload} as Command)).rejects.toThrow()
    }
    expect(await f.command(fitCommand('not-the-host-token',295))).toBeNull();expect(f.bounds()).toEqual(before)
  })
})
