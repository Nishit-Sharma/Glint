import {Notification} from 'electron';
import {requestNoticeHeading,type RequestNotice,type RequestNotificationNativeStatus} from '../shared/request-notifications';
import type {NotificationToastAction} from '../shared/task-notifications';
type NativeNotice={on(event:'click',callback:()=>void):unknown;on(event:'close',callback:()=>void):unknown;on(event:'failed',callback:()=>void):unknown;show:()=>void;close:()=>void};
export type DesktopRequestTransport={status:()=>RequestNotificationNativeStatus;show:(notice:RequestNotice,onFailed?:()=>void)=>Promise<'requested'|'failed'|'unsupported'>;retire:(noticeIds:readonly string[])=>void;close:()=>void;resume:()=>void};
export class DesktopRequestNotifications implements DesktopRequestTransport{
 private notices=new Map<string,NativeNotice>();private closed=false;
 constructor(private readonly activate:(action:NotificationToastAction)=>void,private readonly native:{supported:()=>boolean;create:(title:string,body:string)=>NativeNotice}={supported:()=>Notification.isSupported(),create:(title,body)=>new Notification({title,body,silent:true})}){}
 status():RequestNotificationNativeStatus{let supported=false;try{supported=this.native.supported();}catch{}return {supported,permission:'not-verified',message:supported?'System notifications are supported. OS permission, Focus settings and actual delivery are not verified here.':'System notifications are unavailable. Retained request notices remain in Glint.'};}
 async show(notice:RequestNotice,onFailed?:()=>void):Promise<'requested'|'failed'|'unsupported'>{
  if(this.closed||!this.status().supported)return 'unsupported';
  try{
   const card=this.native.create('Glint · '+requestNoticeHeading(notice),notice.category==='research'?'Open Glint to review local research suggestions. Opening this notice does not prepare or send a question.':'Open Glint to review this exact conversation. Notifications cannot approve actions or answer questions.');this.notices.get(notice.id)?.close();this.notices.set(notice.id,card);
   card.on('click',()=>{if(!this.closed&&this.notices.get(notice.id)===card)this.activate({kind:'open',noticeId:notice.id});});card.on('close',()=>{if(this.notices.get(notice.id)===card)this.notices.delete(notice.id);});card.on('failed',()=>{if(this.notices.get(notice.id)===card){this.notices.delete(notice.id);onFailed?.();}});card.show();return 'requested';
  }catch{return 'failed';}
 }
 retire(ids:readonly string[]){for(const id of ids){const card=this.notices.get(id);this.notices.delete(id);try{card?.close();}catch{}}}
 close(){this.closed=true;this.retire([...this.notices.keys()]);}
 resume(){this.closed=false;}
}
