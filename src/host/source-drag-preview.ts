import {BrowserWindow,screen} from 'electron';
import type {NativeWindow,Rect} from './native';
import type {SourceDragState} from '../shared/source-drag';

const escape=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const validRect=(value:unknown):value is Rect=>{
 if(!value||typeof value!=='object')return false;
 const r=value as Rect;return [r.x,r.y,r.width,r.height,r.x+r.width,r.y+r.height].every(Number.isFinite)&&r.width>0&&r.height>0;
};
const sameRect=(a:Rect,b:Rect)=>a.x===b.x&&a.y===b.y&&a.width===b.width&&a.height===b.height;
const inside=(a:Rect,b:Rect)=>a.x>=b.x&&a.y>=b.y&&a.x+a.width<=b.x+b.width&&a.y+a.height<=b.y+b.height;

/** One owned, nonactivating overlay. Only metadata reviewed by the host drag owner enters here. */
export function createSourceDragPreview(anchor:()=>Rect,protect:(window:BrowserWindow)=>void=window=>window.setContentProtection(true)){
 let window:BrowserWindow|undefined,key='',loadedKey='',revision=0,displayed:{target:NativeWindow;bounds:Rect;paragraph:Rect}|undefined;
 const clear=()=>{
  revision++;const previous=window;window=undefined;key='';loadedKey='';displayed=undefined;
  if(previous&&!previous.isDestroyed())previous.close();
 };
 const ids=()=>{
  if(!window||window.isDestroyed())return [];
  const match=/^window:([1-9]\d*):[01]$/.exec(window.getMediaSourceId());
  return match&&Number.isSafeInteger(Number(match[1]))?[`window:${match[1]}`]:[];
 };
 const visibleOnDesktop=(own:BrowserWindow,record:NonNullable<typeof displayed>)=>{
  try{
   const bounds=own.getBounds(),{paragraph,target}=record;
   if(!validRect(bounds)||!validRect(paragraph)||!sameRect(bounds,record.bounds)||!sameRect(bounds,target.bounds)||!inside(paragraph,{x:0,y:0,width:bounds.width,height:bounds.height}))return false;
   const display=screen.getDisplayMatching(bounds),work=display?.workArea;
   if(!display||!Number.isSafeInteger(display.id)||display.id===-1||!target.displayId||String(display.id)!==target.displayId||!Number.isFinite(display.scaleFactor)||display.scaleFactor<=0||display.scaleFactor!==target.scaleFactor||!validRect(work))return false;
   const global={x:bounds.x+paragraph.x,y:bounds.y+paragraph.y,width:paragraph.width,height:paragraph.height};
   return validRect(global)&&inside(global,work);
  }catch{return false;}
 };
 const presented=()=>{
  if(!window||window.isDestroyed()||!window.isVisible()||loadedKey!==key||!displayed||!visibleOnDesktop(window,displayed)){displayed=undefined;return undefined;}
  return structuredClone(displayed.target);
 };
 const show=(state:SourceDragState,target?:NativeWindow)=>{
  if(state.kind==='idle'||state.kind==='target'&&(!target||state.title!==target.title||state.ownerName!==target.owner.name)){clear();return;}
  if(!window||window.isDestroyed()){
   key='';loadedKey='';revision++;
   window=new BrowserWindow({show:false,frame:false,transparent:true,hasShadow:false,focusable:false,alwaysOnTop:true,skipTaskbar:true,title:'Source attachment preview',webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});
   const own=window;
   own.setIgnoreMouseEvents(true);protect(own);
   own.webContents.setWindowOpenHandler(()=>({action:'deny'}));
   own.webContents.on('will-navigate',event=>{event.preventDefault();if(window===own)clear();});
   own.webContents.on('render-process-gone',()=>{if(window===own)clear();});
   own.on('closed',()=>{if(window===own){revision++;window=undefined;key='';loadedKey='';displayed=undefined;}});
  }
  const own=window,base=anchor(),bounds=state.kind==='target'&&target?target.bounds:{x:base.x+80,y:base.y,width:260,height:state.kind==='blocked'?100:72};
  const next=JSON.stringify([state,target&&[target.id,target.osId,target.owner.processId,target.documentToken]]);
  if(next===key){own.setBounds(bounds);if(loadedKey===key)own.showInactive();return;}
  displayed=undefined;own.hide();own.setBounds(bounds);key=next;const loadRevision=++revision;
  const label=state.kind==='target'?`Attach to ${(state.title||'Untitled window').slice(0,160)} · ${state.ownerName.slice(0,100)}`:state.kind==='searching'?'Choose a source window…':state.message.slice(0,300);
  // Keep the accepted warm neutral palette and system type of the native utility surface.
  const html=`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline'"><title>Source attachment preview</title><style>html,body{margin:0;width:100%;height:100%;box-sizing:border-box;background:transparent}body{border:${state.kind==='target'?'2px solid #cdb28a':'0'};border-radius:9px;color:#f0eee8;font:13px/18px system-ui}p{display:inline-block;max-width:calc(100% - 24px);margin:8px;padding:8px 10px;border-radius:6px;background:#242723;overflow-wrap:anywhere}</style><p>${escape(label)}${state.kind==='target'?'<br>Release to attach and capture one local snapshot · Esc to cancel<br>Nothing is sent or followed automatically.':''}</p>`;
  void own.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html)).then(async()=>{
   if(window!==own||revision!==loadRevision||own.isDestroyed())return;
   loadedKey=next;own.showInactive();
   if(state.kind!=='target'||!target||!state.ownerName||state.title.length>160||state.ownerName.length>100)return;
   const fit=await own.webContents.executeJavaScript(`(()=>{const p=document.querySelector('p');if(!p)return null;const r=p.getBoundingClientRect(),s=getComputedStyle(p);return {fits:s.visibility==='visible'&&s.display!=='none'&&r.width>0&&r.height>0&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&p.scrollWidth<=p.clientWidth&&p.scrollHeight<=p.clientHeight,rect:{x:r.x,y:r.y,width:r.width,height:r.height}};})()`);
   if(window===own&&revision===loadRevision&&!own.isDestroyed()&&own.isVisible()&&fit?.fits===true&&validRect(fit.rect)){
    const record={target:structuredClone(target),bounds:own.getBounds(),paragraph:fit.rect};
    if(visibleOnDesktop(own,record))displayed=record;
   }
  }).catch(()=>{if(window===own&&revision===loadRevision)clear();});
 };
 return {show,clear,ids,presented};
}
