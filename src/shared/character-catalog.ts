import {Schema} from 'effect';

export const CHARACTER_SHAPES=[
 {id:'soup',label:'Dumpling'},{id:'onigiri',label:'Onigiri'},{id:'mushroom',label:'Mushroom'},
 {id:'star',label:'Star'},{id:'sprout',label:'Dollop'},{id:'dumpling',label:'Crescent'},
 {id:'pillow',label:'Pillow'},{id:'bean',label:'Bean'},{id:'pebble',label:'Pebble'},{id:'drop',label:'Drop'},{id:'bloom',label:'Bloom'},
] as const;
// Keep the old shape readable in saved profiles without offering it for new choices.
export const CHARACTER_PICKER_SHAPES=CHARACTER_SHAPES.filter(shape=>shape.id!=='dumpling');
export const CHARACTER_COLORS=[
 {id:'dough',label:'Dough',hex:'#d6b590'},{id:'iris',label:'Iris',hex:'#8793d0'},{id:'sage',label:'Sage',hex:'#81a993'},
 {id:'apricot',label:'Apricot',hex:'#d29b82'},{id:'rose',label:'Rose',hex:'#c68d9e'},{id:'sky',label:'Sky',hex:'#7aabca'},{id:'butter',label:'Butter',hex:'#ccb66e'},
] as const;
export const CHARACTER_FACES=[{id:'curious',label:'Curious'},{id:'bright',label:'Bright'},{id:'mellow',label:'Mellow'}] as const;
const revision=Schema.Number.pipe(Schema.int(),Schema.between(0,Number.MAX_SAFE_INTEGER));
const personalName=Schema.NullOr(Schema.String.pipe(Schema.filter(value=>[...value].length<=40&&!/[\p{Cc}\p{Cf}]/u.test(value))));
export const CharacterProfileSchema=Schema.Struct({
 personalName,
 look:Schema.Struct({shape:Schema.Literal(...CHARACTER_SHAPES.map(value=>value.id)),color:Schema.Literal(...CHARACTER_COLORS.map(value=>value.id)),face:Schema.Literal(...CHARACTER_FACES.map(value=>value.id)),motion:Schema.Boolean,glasses:Schema.optional(Schema.Literal('none','round')),accessory:Schema.optional(Schema.Literal('none','scarf'))}),
});
export const CharacterSnapshotSchema=Schema.Struct({revision,profile:CharacterProfileSchema});
export const CharacterUpdateSchema=Schema.Struct({expectedRevision:revision,profile:CharacterProfileSchema});
export type CharacterProfile=typeof CharacterProfileSchema.Type;
export type CharacterSnapshot=typeof CharacterSnapshotSchema.Type;
export type CharacterUpdate=typeof CharacterUpdateSchema.Type;
export const DEFAULT_CHARACTER:CharacterProfile={personalName:null,look:{shape:'soup',color:'dough',face:'curious',motion:true}};
export type CharacterState={kind:'available';current:CharacterSnapshot}|{kind:'unavailable';message:string};
export type CharacterCommit={kind:'saved';current:CharacterSnapshot}|{kind:'conflict';current:CharacterSnapshot}|{kind:'unavailable';message:string};
export function readCharacterUpdate(input:unknown):CharacterUpdate {
 const value=Schema.decodeUnknownSync(CharacterUpdateSchema,{onExcessProperty:'error'})(input);
 return {...value,profile:{...value.profile,personalName:value.profile.personalName?.normalize('NFC').trim()||null}};
}
// Glint is the app. Each companion has its own name: the user's choice, else its shape's first default.
const CHARACTER_DEFAULT_NAMES:{readonly [Shape in CharacterProfile['look']['shape']]:readonly [string,...string[]]}={soup:['Bao','Momo'],onigiri:['Nori'],mushroom:['Moss'],star:['Lumi'],sprout:['Miso'],dumpling:['Mochi'],pillow:['Bo'],bean:['Fig'],pebble:['Pip'],drop:['Dotty'],bloom:['Fenn']};
export const characterNameOptions=(shape:CharacterProfile['look']['shape']):readonly [string,...string[]]=>CHARACTER_DEFAULT_NAMES[shape];
export const characterDefaultName=(shape:CharacterProfile['look']['shape'])=>characterNameOptions(shape)[0];
export const characterLabel=(profile:CharacterProfile)=>profile.personalName??characterDefaultName(profile.look.shape);
export const sameCharacter=(left:CharacterProfile,right:CharacterProfile)=>left.personalName===right.personalName&&left.look.shape===right.look.shape&&left.look.color===right.look.color&&left.look.face===right.look.face&&left.look.motion===right.look.motion&&(left.look.glasses??'none')===(right.look.glasses??'none')&&(left.look.accessory??'none')===(right.look.accessory??'none');
const UnavailableSchema=Schema.Struct({kind:Schema.Literal('unavailable'),message:Schema.String});
export const readCharacterState=Schema.decodeUnknownSync(Schema.Union(Schema.Struct({kind:Schema.Literal('available'),current:CharacterSnapshotSchema}),UnavailableSchema),{onExcessProperty:'error'});
export const readCharacterCommit=Schema.decodeUnknownSync(Schema.Union(Schema.Struct({kind:Schema.Literal('saved','conflict'),current:CharacterSnapshotSchema}),UnavailableSchema),{onExcessProperty:'error'});
