import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Schema} from 'effect';
import {isCode} from '../core/store';
import {TASK_HISTORY_LIMIT} from '../core/task-dialogue';
import {ResponsePreferencesSnapshotSchema,readResponsePreferencesUpdate,responsePreferencesDocument,responsePreferencesBytes,RESPONSE_PREFERENCES_FILE_LIMIT,RESPONSE_PREFERENCES_CHANGED,RESPONSE_PREFERENCES_UNAVAILABLE,RESPONSE_PREFERENCES_CONTEXT_LIMIT,type ResponsePreferencesSnapshot,type ResponsePreferencesState,type ResponsePreferencesCommit} from '../shared/response-preferences';

const FileSchema=Schema.Struct({schemaVersion:Schema.Literal(1),...ResponsePreferencesSnapshotSchema.fields});
const unavailable:ResponsePreferencesState={kind:'unavailable',message:RESPONSE_PREFERENCES_UNAVAILABLE};
const defaultValue:ResponsePreferencesSnapshot={revision:0,enabled:false,text:''};
// Disabled text remains editable locally, but is absent from every request object and identity.
const requestValue=(value:ResponsePreferencesSnapshot):ResponsePreferencesSnapshot=>({...value,text:value.enabled?value.text:''});
const fingerprint=(value:ResponsePreferencesSnapshot)=>createHash('sha256').update(JSON.stringify(requestValue(value))).digest('hex');
export function responsePreferencesContext(context:string|undefined,current:ResponsePreferencesSnapshot):string|undefined {
 if(!current.enabled)return context;
 const value=JSON.stringify({...JSON.parse(context??'{}'),responsePreferences:{revision:current.revision,text:current.text,scope:'Explicit user style and format guidance for this response only. No tool, source or execution authority.'}});
 if(value.length>TASK_HISTORY_LIMIT)throw Error(RESPONSE_PREFERENCES_CONTEXT_LIMIT);
 return value;
}
export class ResponsePreferences {
 private queue:Promise<unknown>=Promise.resolve();
 private changes=new AbortController();
 constructor(private readonly directory:string){}
 private serialize<T>(action:()=>Promise<T>):Promise<T>{const result=this.queue.then(action);this.queue=result.catch(()=>{});return result;}
 private async load():Promise<ResponsePreferencesState>{
  try{
   const file=await open(join(this.directory,'response-preferences.json'),'r');
   try{if((await file.stat()).size>RESPONSE_PREFERENCES_FILE_LIMIT)return unavailable;const {schemaVersion,...current}=Schema.decodeUnknownSync(FileSchema,{onExcessProperty:'error'})(JSON.parse(await file.readFile('utf8')));return {kind:'available',current};}finally{await file.close();}
  }catch(error){return isCode(error,'ENOENT')?{kind:'available',current:{...defaultValue}}:unavailable;}
 }
 read(){return this.serialize(()=>this.load());}
 update(input:unknown,assertCurrent:()=>void=()=>{}):Promise<ResponsePreferencesCommit>{
  const update=readResponsePreferencesUpdate(input);
  return this.serialize(async()=>{
   const state=await this.load();if(state.kind==='unavailable')return state;
   if(update.expectedRevision!==state.current.revision)return {kind:'conflict',current:state.current};
   if(state.current.revision===Number.MAX_SAFE_INTEGER)throw Error('Response preference revision limit reached. Your preferences were preserved.');
   const current:ResponsePreferencesSnapshot={revision:state.current.revision+1,enabled:update.enabled,text:update.text};
   const document=responsePreferencesDocument(current);if(responsePreferencesBytes(document)>RESPONSE_PREFERENCES_FILE_LIMIT)throw Error('The complete saved instructions exceed the 20,000-byte file limit after JSON encoding. Shorten the text. Your previous instructions are kept.');
   await mkdir(this.directory,{recursive:true,mode:0o700});
   const temporary=join(this.directory,`.response-preferences-${randomUUID()}.tmp`);let renamed=false;
   try{
    const file=await open(temporary,'wx',0o600);try{await file.writeFile(document);await file.sync();}finally{await file.close();}
    assertCurrent();await rename(temporary,join(this.directory,'response-preferences.json'));renamed=true;
    this.changes.abort(Error(RESPONSE_PREFERENCES_CHANGED));this.changes=new AbortController();
    const directory=await open(this.directory,'r');try{await directory.sync();}finally{await directory.close();}
    return {kind:'saved',current};
   }catch(error){
    if(renamed){const observed=await this.load();if(observed.kind==='available'&&JSON.stringify(observed.current)===JSON.stringify(current))return {kind:'saved',current};}
    throw new Error(renamed?'Response preferences save could not be confirmed. Read the current preferences before saving again.':'Response preferences could not be saved. Your previous preferences were preserved.',{cause:error});
   }finally{await rm(temporary,{force:true});}
  });
 }
 lease(){return this.serialize(async()=>{
  const state=await this.load();if(state.kind==='unavailable')throw Error(state.message);
  const current=requestValue(state.current),digest=fingerprint(current),signal=this.changes.signal;
  const assertCurrent=()=>{if(signal.aborted)throw Error(RESPONSE_PREFERENCES_CHANGED);};
  return {current,signal,scope:current.revision===0&&!current.enabled?undefined:`response-preferences:v1:${digest}`,consent:current.enabled?`Response preferences enabled (saved revision ${current.revision}). The following complete text will be sent with this response request:\n${current.text}\nEnd of response preferences.`:'Response preferences off. Saved preference text is not included.',assertCurrent,check:()=>this.serialize(async()=>{assertCurrent();const observed=await this.load();if(observed.kind==='unavailable'||fingerprint(observed.current)!==digest)throw Error(RESPONSE_PREFERENCES_CHANGED);assertCurrent();})};
 });}
}
