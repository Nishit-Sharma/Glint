import {randomUUID} from 'node:crypto';
import {mkdir,open,readFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Schema} from 'effect';
import {CharacterSnapshotSchema,DEFAULT_CHARACTER,readCharacterUpdate,sameCharacter,type CharacterState,type CharacterCommit,type CharacterSnapshot} from '../shared/character-catalog';
import {isCode} from '../core/store';

const FileSchema=Schema.Struct({schemaVersion:Schema.Literal(1),...CharacterSnapshotSchema.fields});
const unavailable:CharacterState={kind:'unavailable',message:'Your saved appearance could not be opened. It has not been changed.'};
export class CharacterPreferences {
 private queue:Promise<unknown>=Promise.resolve();
 private constructor(private readonly directory:string){}
 static async open(directory:string){return new CharacterPreferences(directory);}
 private serialize<T>(action:()=>Promise<T>):Promise<T>{const result=this.queue.then(action);this.queue=result.catch(()=>{});return result;}
 private async load():Promise<CharacterState>{
  try{const input:unknown=JSON.parse(await readFile(join(this.directory,'character-preferences.json'),'utf8'));const {schemaVersion,...current}=Schema.decodeUnknownSync(FileSchema,{onExcessProperty:'error'})(input);return {kind:'available',current};}
  catch(error){if(isCode(error,'ENOENT'))return {kind:'available',current:{revision:0,profile:DEFAULT_CHARACTER}};return unavailable;}
 }
 read(){return this.serialize(()=>this.load());}
 update(input:unknown):Promise<CharacterCommit>{
  const update=readCharacterUpdate(input);
  return this.serialize(async()=>{
   const state=await this.load();if(state.kind==='unavailable')return state;
   if(update.expectedRevision!==state.current.revision)return {kind:'conflict',current:state.current};
   if(state.current.revision===Number.MAX_SAFE_INTEGER)throw Error('Appearance revision limit reached. Your preferences were preserved.');
   const current:CharacterSnapshot={revision:state.current.revision+1,profile:update.profile};
   await mkdir(this.directory,{recursive:true,mode:0o700});
   const temporary=join(this.directory,`.character-${randomUUID()}.tmp`);let renamed=false;
   try{
    const file=await open(temporary,'wx',0o600);
    try{await file.writeFile(JSON.stringify({schemaVersion:1,...current}));await file.sync();}finally{await file.close();}
    await rename(temporary,join(this.directory,'character-preferences.json'));renamed=true;
    const directory=await open(this.directory,'r');try{await directory.sync();}finally{await directory.close();}
    return {kind:'saved',current};
   }catch(error){
    if(renamed){const observed=await this.load();if(observed.kind==='available'&&observed.current.revision===current.revision&&sameCharacter(observed.current.profile,current.profile))return {kind:'saved',current:observed.current};}
    throw new Error(renamed?'Appearance save could not be confirmed. Read the current preferences before saving again.':'Appearance could not be saved. Your previous preferences were preserved.',{cause:error});
   }finally{await rm(temporary,{force:true});}
  });
 }
}
