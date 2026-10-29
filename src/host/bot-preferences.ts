import {randomInt,randomUUID} from 'node:crypto';
import {mkdir,open,readFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Schema} from 'effect';
import {CharacterPreferences} from './character-preferences';
import {isCode} from '../core/store';
import type {Companion} from '../core/companion';
import {BotSnapshotSchema,botNameOptions,freshBotChoice,newCharacterProfile,readBotCommand,readBotSnapshot,type BotState,type BotSnapshot,type BotCommit} from '../shared/bot-catalog';

const FileSchema=Schema.Struct({schemaVersion:Schema.Literal(2),current:BotSnapshotSchema});
const unavailable:Extract<BotState,{kind:'unavailable'}>={kind:'unavailable',message:'Your companions could not be opened. Saved appearances and tasks have not been replaced.'};
function creationProfile(input:Parameters<typeof newCharacterProfile>[0]){const profile=newCharacterProfile(input),names=botNameOptions(profile.look.shape);return {...profile,personalName:profile.personalName??names[randomInt(names.length)]};}
export class BotPreferences{
 private queue:Promise<unknown>=Promise.resolve();
 private constructor(private readonly directory:string){}
 private serialize<T>(operation:()=>Promise<T>):Promise<T>{const result=this.queue.then(operation);this.queue=result.catch(()=>{});return result;}
 static async open(directory:string,core:Companion){
  const store=new BotPreferences(directory);
  await store.serialize(async()=>{
   let current:BotSnapshot;
   try{current=await store.load();}catch(error){if(!isCode(error,'ENOENT'))return store;const tasks=await core.listTasks();let hasLegacy=true;try{await readFile(join(directory,'character-preferences.json'));}catch(error){if(isCode(error,'ENOENT'))hasLegacy=false;else return store;}
    if(tasks.length||hasLegacy){const legacy=await(await CharacterPreferences.open(directory)).read();if(legacy.kind!=='available')return store;const botId=randomUUID();current={kind:'ready',revision:1,defaultBotId:botId,legacyBotId:botId,examplePending:false,bots:[{id:botId,revision:legacy.current.revision,profile:legacy.current.profile}]};}
    else current=freshBotChoice();
    await store.save(current);
   }
   if(current.kind==='ready')await core.migrateBotAssignments(current.legacyBotId);
  });
  return store;
 }
 private async load():Promise<BotSnapshot>{const file=Schema.decodeUnknownSync(FileSchema,{onExcessProperty:'error'})(JSON.parse(await readFile(join(this.directory,'bot-catalog.json'),'utf8')));return readBotSnapshot(file.current);}
 private async save(current:BotSnapshot){
  readBotSnapshot(current);await mkdir(this.directory,{recursive:true,mode:0o700});
  const temporary=join(this.directory,`.bots-${randomUUID()}.tmp`);
  try{const file=await open(temporary,'wx',0o600);try{await file.writeFile(JSON.stringify({schemaVersion:2,current}));await file.sync();}finally{await file.close();}await rename(temporary,join(this.directory,'bot-catalog.json'));const directory=await open(this.directory,'r');try{await directory.sync();}finally{await directory.close();}}
  finally{await rm(temporary,{force:true});}
 }
 finishExample(core:Companion){return this.serialize(async()=>{let current:BotSnapshot;try{current=await this.load();}catch{return;}if(current.kind!=='ready'||!current.examplePending)return;await core.ensureLocalExample(current.defaultBotId);await this.save({...current,revision:current.revision+1,examplePending:false});});}
 read():Promise<BotState>{return this.serialize(async()=>{try{return {kind:'available',current:await this.load()};}catch{return unavailable;}});}
 command(input:unknown):Promise<BotCommit>{
  const command=readBotCommand(input);
  return this.serialize(async()=>{
   let current:BotSnapshot;try{current=await this.load();}catch{return unavailable;}
   if(command.expectedRevision!==current.revision)return {kind:'conflict',current};
   if(current.revision===Number.MAX_SAFE_INTEGER)throw Error('Companion revision limit reached.');
   let next:BotSnapshot;
   if(current.kind==='choose'){
    if(command.type!=='draft'&&command.type!=='complete')throw Error('Choose your first companion before adding another.');
    const profile=command.type==='complete'?creationProfile(command.profile):newCharacterProfile(command.profile);
    if(command.type==='draft')next={kind:'choose',revision:current.revision+1,draft:profile};
    else{const botId=randomUUID();next={kind:'ready',revision:current.revision+1,defaultBotId:botId,legacyBotId:botId,examplePending:true,bots:[{id:botId,revision:0,profile}]};}
   }else{
    if(command.type==='draft'||command.type==='complete')return {kind:'conflict',current};
    if(command.type==='add'){if(current.bots.length>=40)throw Error('Keep up to 40 companions.');next={...current,revision:current.revision+1,bots:[...current.bots,{id:randomUUID(),revision:0,profile:creationProfile(command.profile)}]};}
    else{const bot=current.bots.find(bot=>bot.id===command.botId);if(!bot)throw Error('This companion is unavailable. Its tasks are kept.');
     next=command.type==='default'?{...current,revision:current.revision+1,defaultBotId:bot.id}:{...current,revision:current.revision+1,bots:current.bots.map(item=>item.id===bot.id?{...bot,revision:bot.revision+1,profile:newCharacterProfile(command.profile,bot.profile)}:item)};
    }
   }
   await this.save(next);return {kind:'saved',current:next};
  });
 }
}
