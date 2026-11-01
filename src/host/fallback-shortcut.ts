import {randomUUID} from 'node:crypto';
import {mkdir,open,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {DEFAULT_FALLBACK_SHORTCUT,FALLBACK_SHORTCUT_MESSAGES,readFallbackAccelerator} from '../shared/fallback-shortcut';
type ShortcutRegistry={register(accelerator:string,callback:()=>void):boolean;unregister(accelerator:string):void;isRegistered(accelerator:string):boolean};
type Options={directory:string;current():string;committed(accelerator:string):void;activate():void;registry:ShortcutRegistry};
/** Serializes only the existing fallback binding; current() remains the host's authority. */
export class FallbackShortcutSettings{
 private queue:Promise<unknown>=Promise.resolve();
 constructor(private readonly options:Options){}
 reset(expectedShortcut:string,assertCurrent:()=>void=()=>{}){return this.change(DEFAULT_FALLBACK_SHORTCUT,expectedShortcut,assertCurrent);}
 change(accelerator:string,expectedShortcut?:string,assertCurrent:()=>void=()=>{}):Promise<{shortcut:string;registered:boolean}>{
  const next=readFallbackAccelerator(accelerator);
  const action=async()=>{
   const {directory,current,committed,activate,registry}=this.options;
   assertCurrent();const previous=current();
   if(expectedShortcut!==undefined&&expectedShortcut!==previous)throw Error(FALLBACK_SHORTCUT_MESSAGES.changed);
   if(next===previous&&registry.isRegistered(next))return {shortcut:previous,registered:true};
   if(!registry.register(next,activate))throw Error(FALLBACK_SHORTCUT_MESSAGES.unavailable);
   const temporary=join(directory,`.shortcut-${randomUUID()}.tmp`);let published=false,applied=false;
   const apply=()=>{if(applied)return;applied=true;committed(next);if(next!==previous)registry.unregister(previous);};
   try{
    await mkdir(directory,{recursive:true,mode:0o700});
    const file=await open(temporary,'wx',0o600);
    try{await file.writeFile(JSON.stringify({shortcut:next}));await file.sync();}finally{await file.close();}
    assertCurrent();await rename(temporary,join(directory,'shortcut.json'));published=true;apply();
    const folder=await open(directory,'r');try{await folder.sync();}finally{await folder.close();}
    return {shortcut:next,registered:registry.isRegistered(next)};
   }catch(error){
    if(published){apply();throw new Error(FALLBACK_SHORTCUT_MESSAGES.uncertain,{cause:error});}
    registry.unregister(next);throw new Error(FALLBACK_SHORTCUT_MESSAGES.notSaved,{cause:error});
   }finally{await rm(temporary,{force:true}).catch(()=>{});}
  };
  const result=this.queue.then(action);this.queue=result.catch(()=>{});return result;
 }
}
