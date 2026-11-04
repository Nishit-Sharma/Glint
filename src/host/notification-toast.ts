import {randomUUID} from 'node:crypto';
import {BrowserWindow,screen} from 'electron';
import type {NotificationToastAction} from '../shared/task-notifications';
const escape=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
type Card={noticeId:string;title:string;body:string;token:string};
/** One app-owned, protected desktop surface; no preload, scripts, provider or OS-notification grant. */
export class NotificationToast{
 private window:BrowserWindow|undefined;private cards:Card[]=[];private revision=0;private timer:ReturnType<typeof setTimeout>|undefined;private release:(()=>void)|undefined;private pending=Promise.resolve();private closed=false;
 constructor(private readonly activate:(action:NotificationToastAction)=>void,private readonly ownProcess:(pid:number)=>()=>void,private readonly protect:(window:BrowserWindow)=>void=window=>window.setContentProtection(true)){}
 ids(){if(!this.window||this.window.isDestroyed())return [];const match=/^window:([1-9]\d*):[01]$/.exec(this.window.getMediaSourceId());return match?[`window:${match[1]}`]:[];}
 show(noticeId:string,title:string,body:string){if(this.closed)return;this.cards=[...this.cards.filter(card=>card.noticeId!==noticeId),{noticeId,title:title.slice(0,100),body:body.slice(0,500),token:randomUUID()}].slice(-3);this.render();}
 private render(){
  if(this.closed||!this.cards.length){this.clear();return;}
  if(!this.window||this.window.isDestroyed()){
   const window=this.window=new BrowserWindow({show:false,width:380,height:180,frame:false,resizable:false,focusable:false,alwaysOnTop:true,skipTaskbar:true,title:'Glint local notifications',backgroundColor:'#222221',webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});
   this.protect(window);window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
   window.webContents.on('will-navigate',(event,url)=>{event.preventDefault();const match=/^glint-local-notice:\/\/(open|dismiss)\/([a-f0-9-]+)\/?$/.exec(url);if(!match)return;const card=this.cards.find(card=>card.token===match[2]);if(!card)return;this.cards=this.cards.filter(item=>item.token!==card.token);this.activate({kind:match[1] as 'open'|'dismiss',noticeId:card.noticeId});this.render();});
   window.webContents.on('will-redirect',event=>event.preventDefault());window.webContents.on('render-process-gone',()=>this.clear());
   window.on('closed',()=>{if(this.window===window){this.window=undefined;this.release?.();this.release=undefined;}});
  }
  const window=this.window,revision=++this.revision,work=screen.getPrimaryDisplay().workArea,width=Math.min(380,work.width-24),height=Math.min(100+this.cards.length*145,work.height-24);
  window.hide();window.setBounds({x:work.x+work.width-width-12,y:work.y+work.height-height-12,width,height});
  const html=`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline';base-uri 'none';form-action 'none'"><title>Glint local notifications</title><style>body{margin:0;padding:14px;background:#222221;color:#efefed;font:13px/1.4 system-ui}header{font-size:12px;color:#aaa9a7}article{padding:12px 0;border-bottom:1px solid #ffffff20}strong{font-size:14px}p{margin:6px 0;overflow-wrap:anywhere;max-height:70px;overflow:auto}strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}a{display:inline-block;color:#efefed;margin-right:18px;padding:4px 0}a:focus{outline:2px solid #c0d4ee}</style><header>Glint · Local notifications</header>${this.cards.map(card=>`<article><strong>${escape(card.title)}</strong><p>${escape(card.body)}</p><a href="glint-local-notice://open/${card.token}">Open in Glint</a><a href="glint-local-notice://dismiss/${card.token}">Dismiss</a></article>`).join('')}`;
  const load=window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html)).then(()=>{if(this.closed||this.window!==window||window.isDestroyed()||revision!==this.revision)return;this.release?.();const pid=window.webContents.getOSProcessId();if(!Number.isSafeInteger(pid)||pid<=0){this.clear();return;}this.release=this.ownProcess(pid);window.showInactive();});const completed=load.catch(()=>{if(this.window===window&&revision===this.revision)this.clear();});this.pending=Promise.all([this.pending,completed]).then(()=>{});
  if(this.timer)clearTimeout(this.timer);this.timer=setTimeout(()=>this.clear(),15000);
 }
 clear(){this.revision++;if(this.timer)clearTimeout(this.timer);this.timer=undefined;this.cards=[];const window=this.window;this.window=undefined;this.release?.();this.release=undefined;if(window&&!window.isDestroyed())window.close();}
 resume(){this.closed=false;}
 async close(){this.closed=true;this.clear();await this.pending;}
}
