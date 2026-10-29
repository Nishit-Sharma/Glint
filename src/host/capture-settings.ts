import {randomUUID} from 'node:crypto';
import {mkdir,open,readFile,rename,rm} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {Schema} from 'effect';
import {CaptureSnapshotSchema,readCaptureUpdate,type CaptureCommit,type CaptureSnapshot,type CaptureState} from '../shared/capture-policy';

const FileSchema=Schema.Struct({schemaVersion:Schema.Literal(1),...CaptureSnapshotSchema.fields});
const unavailable:CaptureState={kind:'unavailable',message:'Your capture setup could not be opened. Capture is unavailable and your saved setup has not been changed.'};
const isMissing=(error:unknown)=>error instanceof Error&&'code' in error&&error.code==='ENOENT';

export class CaptureSettingsSaveError extends Error{
 constructor(readonly outcome:'not-saved'|'uncertain',cause:unknown){
  super(outcome==='not-saved'?'Capture setup could not be saved. Your previous setup was preserved.':'Capture setup save could not be confirmed. Read the current setup before deciding what to do next.',{cause});
  this.name='CaptureSettingsSaveError';
 }
}

/** One host owner, created after the existing core-store lock is held. */
export class CaptureSettings{
 private queue:Promise<unknown>=Promise.resolve();
 private constructor(private readonly directory:string){}
 static async open(directory:string){
  if(!isAbsolute(directory))throw Error('Capture setup requires an absolute host-owned directory.');
  return new CaptureSettings(directory);
 }
 private serialize<T>(action:()=>Promise<T>):Promise<T>{const result=this.queue.then(action);this.queue=result.catch(()=>{});return result;}
 private async load():Promise<CaptureState>{
  try{
   const input:unknown=JSON.parse(await readFile(join(this.directory,'capture-settings.json'),'utf8'));
   const {schemaVersion,...current}=Schema.decodeUnknownSync(FileSchema,{onExcessProperty:'error'})(input);
   return {kind:'available',current};
  }catch(error){
   if(isMissing(error))return {kind:'available',current:{revision:0,policy:{policyVersion:1,setupApproval:'not-approved',privateApps:[]}}};
   return unavailable;
  }
 }
 read(){return this.serialize(()=>this.load());}
 update(input:unknown):Promise<CaptureCommit>{
  const update=readCaptureUpdate(input);
  return this.serialize(async()=>{
   const state=await this.load();
   if(state.kind==='unavailable')return state;
   if(update.expectedRevision!==state.current.revision)return {kind:'conflict',current:state.current};
   if(state.current.revision===Number.MAX_SAFE_INTEGER)throw Error('Capture setup revision limit reached. Your saved setup was preserved.');
   const policy=state.current.policy;
   const current:CaptureSnapshot={revision:state.current.revision+1,policy:update.kind==='approve-setup'
    ?{policyVersion:1,setupApproval:'approved',privateApps:update.privateApps}
    :update.kind==='revoke-setup'
     ?{...policy,setupApproval:'not-approved'}
     :{...policy,privateApps:update.privateApps}};
   await mkdir(this.directory,{recursive:true,mode:0o700});
   const temporary=join(this.directory,`.capture-settings-${randomUUID()}.tmp`);
   let renamed=false;
   try{
    const file=await open(temporary,'wx',0o600);
    try{await file.writeFile(JSON.stringify({schemaVersion:1,...current}));await file.sync();}finally{await file.close();}
    await rename(temporary,join(this.directory,'capture-settings.json'));renamed=true;
    const directory=await open(this.directory,'r');try{await directory.sync();}finally{await directory.close();}
    return {kind:'saved',current};
   }catch(error){throw new CaptureSettingsSaveError(renamed?'uncertain':'not-saved',error);}
   finally{await rm(temporary,{force:true});}
  });
 }
}
