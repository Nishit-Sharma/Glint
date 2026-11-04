import {Schema} from 'effect';
import {CharacterProfileSchema,CHARACTER_PICKER_SHAPES,DEFAULT_CHARACTER,type CharacterProfile} from './character-catalog';

const defaultNames=[{shape:'soup',names:['Bao','Momo']},{shape:'onigiri',names:['Nori']},{shape:'mushroom',names:['Moss']},{shape:'star',names:['Lumi']},{shape:'sprout',names:['Miso']}];
export const botNameOptions=(shape:CharacterProfile['look']['shape']):readonly string[]=>defaultNames.find(value=>value.shape===shape)?.names??['Glint'];
export const ONBOARDING_SHAPES=CHARACTER_PICKER_SHAPES.slice(0,5);
const revision=Schema.Number.pipe(Schema.int(),Schema.between(0,Number.MAX_SAFE_INTEGER));
const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200));
const displayText=(maximum:number)=>Schema.String.pipe(Schema.maxLength(maximum),Schema.filter(value=>!/[\p{Cc}\p{Cf}]/u.test(value)));
export const BotSchema=Schema.Struct({id,revision,profile:CharacterProfileSchema,title:Schema.optional(displayText(80)),tagline:Schema.optional(displayText(160)),hidden:Schema.optional(Schema.Boolean),pinned:Schema.optional(Schema.Boolean),notificationsEnabled:Schema.optional(Schema.Boolean)});
const ChooseSchema=Schema.Struct({kind:Schema.Literal('choose'),revision,draft:CharacterProfileSchema});
const StartupSchema=Schema.Struct({botId:id,taskId:id});
export const FloatingBoundsSchema=Schema.Struct({x:Schema.Number.pipe(Schema.int(),Schema.between(-100000,100000)),y:Schema.Number.pipe(Schema.int(),Schema.between(-100000,100000)),width:Schema.Number.pipe(Schema.int(),Schema.between(320,16000)),height:Schema.Number.pipe(Schema.int(),Schema.between(220,16000))});
export type FloatingBounds=typeof FloatingBoundsSchema.Type;
const ReadySchema=Schema.Struct({startup:Schema.optional(Schema.NullOr(StartupSchema)),floatingBounds:Schema.optional(FloatingBoundsSchema),floatingBotId:Schema.optional(id),floatingVisible:Schema.optional(Schema.Boolean),kind:Schema.Literal('ready'),revision,defaultBotId:id,legacyBotId:id,examplePending:Schema.Boolean,bots:Schema.Array(BotSchema).pipe(Schema.minItems(1),Schema.maxItems(40))});
export const BotSnapshotSchema=Schema.Union(ChooseSchema,ReadySchema);
export type Bot=typeof BotSchema.Type;
export type BotSnapshot=typeof BotSnapshotSchema.Type;
export type ReadyBots=Extract<BotSnapshot,{kind:'ready'}>;
export type BotState={kind:'available';current:BotSnapshot}|{kind:'unavailable';message:string};
export type BotCommit={kind:'saved'|'conflict';current:BotSnapshot}|{kind:'unavailable';message:string};
export const BotCommandSchema=Schema.Union(
 Schema.Struct({type:Schema.Literal('draft'),expectedRevision:revision,profile:CharacterProfileSchema}),
 Schema.Struct({type:Schema.Literal('complete'),expectedRevision:revision,profile:CharacterProfileSchema}),
 Schema.Struct({type:Schema.Literal('add'),expectedRevision:revision,profile:CharacterProfileSchema}),
 Schema.Struct({type:Schema.Literal('update'),expectedRevision:revision,botId:id,profile:CharacterProfileSchema}),
 Schema.Struct({type:Schema.Literal('default'),expectedRevision:revision,botId:id}),
 Schema.Struct({type:Schema.Literal('duplicate'),expectedRevision:revision,botId:id}),
 Schema.Struct({type:Schema.Literal('details'),expectedRevision:revision,botId:id,title:displayText(80),tagline:displayText(160)}),
 Schema.Struct({type:Schema.Literal('visibility'),expectedRevision:revision,botId:id,hidden:Schema.Boolean}),
 Schema.Struct({type:Schema.Literal('notifications'),expectedRevision:revision,botId:id,enabled:Schema.Boolean}),
 Schema.Struct({type:Schema.Literal('pin'),expectedRevision:revision,botId:id,pinned:Schema.Boolean}),
 Schema.Struct({type:Schema.Literal('floating-selection'),expectedRevision:revision,botId:id}),
 Schema.Struct({type:Schema.Literal('startup'),expectedRevision:revision,selection:Schema.NullOr(StartupSchema)}),
);
export type BotCommand=typeof BotCommandSchema.Type;
export const readBotCommand=Schema.decodeUnknownSync(BotCommandSchema,{onExcessProperty:'error'});
export function readBotSnapshot(input:unknown):BotSnapshot{
 const value=Schema.decodeUnknownSync(BotSnapshotSchema,{onExcessProperty:'error'})(input);
 if(value.kind==='ready'&&(new Set(value.bots.map(bot=>bot.id)).size!==value.bots.length||!value.bots.some(bot=>bot.id===value.defaultBotId)||!value.bots.some(bot=>bot.id===value.legacyBotId)||!!value.floatingBotId&&!value.bots.some(bot=>bot.id===value.floatingBotId)||!!value.startup&&!value.bots.some(bot=>bot.id===value.startup!.botId)))throw Error('Saved bot identities need review.');
 return value;
}
export const freshBotChoice=():BotSnapshot=>({kind:'choose',revision:0,draft:DEFAULT_CHARACTER});
export function assignedBot(catalog:ReadyBots,assignedBotId:string|undefined):Bot|undefined{return catalog.bots.find(bot=>bot.id===(assignedBotId??catalog.legacyBotId));}
export function pickForMe(profile:CharacterProfile,random=Math.random):CharacterProfile{
 const choices=ONBOARDING_SHAPES.filter(shape=>shape.id!==profile.look.shape),shape=choices[Math.min(choices.length-1,Math.max(0,Math.floor(random()*choices.length)))];
 return {...profile,look:{...profile.look,shape:shape.id}};
}
export function newCharacterProfile(profile:CharacterProfile,previous?:CharacterProfile):CharacterProfile{
 const parsed=Schema.decodeUnknownSync(CharacterProfileSchema,{onExcessProperty:'error'})(profile);
 if(parsed.look.shape==='dumpling'&&previous?.look.shape!=='dumpling')throw Error('Choose an available shape.');
 return {...parsed,personalName:parsed.personalName?.normalize('NFC').trim()||null};
}
export function readBotState(input:unknown):BotState{
 const result=Schema.decodeUnknownSync(Schema.Union(Schema.Struct({kind:Schema.Literal('available'),current:BotSnapshotSchema}),Schema.Struct({kind:Schema.Literal('unavailable'),message:Schema.String})),{onExcessProperty:'error'})(input);
 return result.kind==='unavailable'?result:{kind:'available',current:readBotSnapshot(result.current)};
}
export function readBotCommit(input:unknown):BotCommit{
 const result=Schema.decodeUnknownSync(Schema.Union(Schema.Struct({kind:Schema.Literal('saved','conflict'),current:BotSnapshotSchema}),Schema.Struct({kind:Schema.Literal('unavailable'),message:Schema.String})),{onExcessProperty:'error'})(input);
 return result.kind==='unavailable'?result:{kind:result.kind,current:readBotSnapshot(result.current)};
}

export const visibleBots=(catalog:ReadyBots)=>catalog.bots.filter(bot=>!bot.hidden).sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned));

export function startupConversation<T extends {id:string;assignedBotId?:string;archive?:unknown}>(catalog:ReadyBots,tasks:readonly T[]):T|undefined{const choice=catalog.startup;if(!choice||!catalog.bots.some(bot=>bot.id===choice.botId&&!bot.hidden))return;return tasks.find(task=>task.id===choice.taskId&&task.assignedBotId===choice.botId&&!task.archive);}

export function fitFloatingBounds(saved:FloatingBounds|undefined,work:{x:number;y:number;width:number;height:number}):FloatingBounds{const width=Math.min(saved?.width??360,work.width),height=Math.min(saved?.height??440,work.height);return {x:Math.round(Math.max(work.x,Math.min(saved?.x??work.x+work.width-width-20,work.x+work.width-width))),y:Math.round(Math.max(work.y,Math.min(saved?.y??work.y+20,work.y+work.height-height))),width:Math.round(width),height:Math.round(height)};}
