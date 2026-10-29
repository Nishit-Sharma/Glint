import {createSourceAttachmentGesture,type SourceAttachmentOptions,type SourceDragPoint} from './source-attachment';
import type {NativeWindow,Rect} from './native';
import type {SourceDragState} from '../shared/source-drag';
import {publicErrorMessage} from '../shared/public-messages';

export type NativeSourceDragOptions=SourceAttachmentOptions&{
 cursor():SourceDragPoint;
 bounds():Rect;
 move(bounds:Rect):void;
 ignoredWindowIds():readonly string[];
 preview(state:SourceDragState,target?:NativeWindow):void;
 presented?():NativeWindow|undefined;
};
type NativeMouse={type:string;button?:string};

/** The host wires only its own before-mouse-event and canonical screen cursor here. */
export function createNativeSourceDrag(options:NativeSourceDragOptions){
 const gesture=createSourceAttachmentGesture(options),pending=new Set<Promise<void>>();
 let active:{id:string;point:SourceDragPoint;origin:Rect;key:string;phase:'armed'|'dragging'|'dropping';revision:number}|undefined;
 let timer:ReturnType<typeof setTimeout>|undefined,deadline:ReturnType<typeof setTimeout>|undefined,generation=0;
 const cursor=()=>{const point=options.cursor();if(![point.x,point.y].every(Number.isFinite)||Math.abs(point.x)>1_000_000||Math.abs(point.y)>1_000_000)throw Error('Invalid desktop drop point.');return {...point};};
 const clearTimer=()=>{if(timer!==undefined)clearTimeout(timer);timer=undefined;};
 const clearDeadline=()=>{if(deadline!==undefined)clearTimeout(deadline);deadline=undefined;};
 const track=(work:Promise<void>)=>{pending.add(work);void work.then(()=>pending.delete(work),()=>pending.delete(work));};
 const restore=(item:NonNullable<typeof active>)=>{const context=options.context();if(context.anchor&&context.key===item.key)options.move({...item.origin});};
 const cancel=()=>{
  const item=active;active=undefined;generation++;clearTimer();clearDeadline();gesture.cancel();
  if(item&&item.phase!=='armed')restore(item);
  options.preview({kind:'idle'});
 };
 const update=async(item:NonNullable<typeof active>,point:SourceDragPoint,revision:number)=>{
  const current=()=>{const context=options.context();return active===item&&item.phase==='dragging'&&item.revision===revision&&context.anchor&&context.key===item.key;};
  const guard=()=>{if(!current())throw Error('Source attachment cancelled.');};
  try{
   const target=await gesture.review(point,guard,options.ignoredWindowIds());if(!current())return;
   if(!target){options.preview({kind:'blocked',message:'No eligible window here. Press Down Arrow to choose one.'});return;}
   options.preview({kind:'target',title:target.title,ownerName:target.owner.name},target);
  }catch(error){if(current())options.preview({kind:'blocked',message:publicErrorMessage(error)});}
 };
 const mouse=(event:NativeMouse):boolean=>{
  if(event.type==='mouseDown'){
   cancel();if(event.button!=='left')return false;
   const context=options.context(),point=cursor(),origin=options.bounds();
   if(!context.anchor||point.x<origin.x||point.y<origin.y||point.x>=origin.x+origin.width||point.y>=origin.y+origin.height)return false;
   active={id:gesture.begin(point,options.ignoredWindowIds()),point:{...point},origin:{...origin},key:context.key,phase:'armed',revision:0};
   deadline=setTimeout(cancel,15_000);return false;
  }
  const item=active;if(!item)return false;
  const context=options.context();
  if(context.key!==item.key||!context.anchor){cancel();return event.type==='mouseUp'&&event.button==='left'&&item.phase!=='armed';}
  if(item.phase==='dropping')return event.type==='mouseUp'&&event.button==='left';
  const point=cursor();
  if(event.type==='mouseMove'){
   if(item.phase==='armed'&&Math.hypot(point.x-item.point.x,point.y-item.point.y)<6)return false;
   item.phase='dragging';options.move({...item.origin,x:Math.round(item.origin.x+point.x-item.point.x),y:Math.round(item.origin.y+point.y-item.point.y)});
   const revision=++item.revision;clearTimer();options.preview({kind:'searching'});
   timer=setTimeout(()=>{timer=undefined;track(update(item,{...point},revision));},50);return false;
  }
  if(event.type!=='mouseUp'||event.button!=='left')return false;
  clearTimer();if(item.phase==='armed'){cancel();return false;}
  const presented=options.presented?.();
  item.phase='dropping';item.revision++;options.preview({kind:'searching'});
  track((async()=>{
   let failure:string|undefined;
   try{
    const result=await gesture.drop(item.id,{...point},presented);
    if(result.kind!=='attached'&&active===item){restore(item);if(result.kind==='no-target')failure='No eligible window here. Press Down Arrow to choose one.';}
   }catch(error){if(active===item){restore(item);failure=publicErrorMessage(error);}}
   finally{
    if(active===item){
     active=undefined;clearDeadline();
     if(failure){const owner=generation;options.preview({kind:'blocked',message:failure});timer=setTimeout(()=>{timer=undefined;if(!active&&owner===generation)options.preview({kind:'idle'});},5000);}
     else options.preview({kind:'idle'});
    }
   }
  })());
  return true;
 };
 return {mouse,cancel,settled:async()=>{while(pending.size)await Promise.allSettled([...pending]);}};
}
