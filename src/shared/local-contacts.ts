import {Schema} from 'effect';

export const LOCAL_CONTACT_LIMIT=200;
export const LOCAL_CONTACT_FIELDS=['name','email','phone','address','notes'] as const;
export type LocalContactField=typeof LOCAL_CONTACT_FIELDS[number];
export const LOCAL_CONTACT_LABELS:Record<LocalContactField,string>={name:'Name',email:'Email',phone:'Phone',address:'Address',notes:'Notes'};
const revision=Schema.Number.pipe(Schema.int(),Schema.between(0,Number.MAX_SAFE_INTEGER));
const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200));
const bounded=(max:number)=>Schema.String.pipe(Schema.maxLength(max),Schema.filter(value=>!value.includes('\0')));
const name=bounded(200).pipe(Schema.filter(value=>!!value.trim()));
const email=bounded(320).pipe(Schema.filter(value=>!value.trim()||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())));
export const LocalContactDetailsSchema=Schema.Struct({name,email,phone:bounded(100),address:bounded(1_000),notes:bounded(2_000)});
export const LocalContactSchema=Schema.Struct({...LocalContactDetailsSchema.fields,id,revision,archived:Schema.Boolean,createdAt:Schema.String,updatedAt:Schema.String});
export const LocalContactsSchema=Schema.Struct({revision,contacts:Schema.mutable(Schema.Array(LocalContactSchema).pipe(Schema.maxItems(LOCAL_CONTACT_LIMIT)))}).pipe(Schema.filter(value=>new Set(value.contacts.map(contact=>contact.id)).size===value.contacts.length&&value.contacts.every(contact=>contact.revision<=value.revision)));
export const LocalContactsChangeSchema=Schema.Struct({expectedRevision:revision,change:Schema.Union(
 Schema.Struct({kind:Schema.Literal('save'),id:Schema.optional(id),details:LocalContactDetailsSchema}),
 Schema.Struct({kind:Schema.Literal('archive'),id,archived:Schema.Boolean}),
)});
const LocalContactsCommandSchema=Schema.Union(Schema.Struct({type:Schema.Literal('contacts.get')}),Schema.Struct({type:Schema.Literal('contacts.change'),...LocalContactsChangeSchema.fields}));
export type LocalContact=typeof LocalContactSchema.Type;
export type LocalContactDetails=typeof LocalContactDetailsSchema.Type;
export type LocalContacts=typeof LocalContactsSchema.Type;
export type LocalContactsChange=typeof LocalContactsChangeSchema.Type;
export type LocalContactsCommit={kind:'saved'|'conflict';current:LocalContacts};
export const readLocalContacts=Schema.decodeUnknownSync(LocalContactsSchema,{onExcessProperty:'error'});
export const readLocalContactsChange=Schema.decodeUnknownSync(LocalContactsChangeSchema,{onExcessProperty:'error'});
export const readLocalContactsCommand=Schema.decodeUnknownSync(LocalContactsCommandSchema,{onExcessProperty:'error'});
export const readLocalContactsCommit=Schema.decodeUnknownSync(Schema.Struct({kind:Schema.Literal('saved','conflict'),current:LocalContactsSchema}),{onExcessProperty:'error'});
export const emptyLocalContacts=():LocalContacts=>({revision:0,contacts:[]});
export const emptyLocalContactDetails=():LocalContactDetails=>({name:'',email:'',phone:'',address:'',notes:''});
export function searchLocalContacts(book:LocalContacts,query:string,archived=false):LocalContact[]{
 const terms=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
 return book.contacts.filter(contact=>contact.archived===archived&&terms.every(term=>LOCAL_CONTACT_FIELDS.map(field=>contact[field]).join('\n').toLocaleLowerCase().includes(term))).sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
}
/** Only selected fields become ordinary, visible composer text. */
export function localContactMessage(contact:LocalContact,fields:readonly LocalContactField[]):string{
 if(contact.archived)return '';
 const selected=LOCAL_CONTACT_FIELDS.filter(field=>fields.includes(field)&&contact[field].trim());
 if(!selected.length)return '';
 return 'Selected contact details:\n'+selected.map(field=>`${LOCAL_CONTACT_LABELS[field]}: ${contact[field]}`).join('\n');
}
export function appendLocalContactMessage(draft:string,preview:string):string{
 if(!preview.trim())throw Error('Choose at least one contact field.');
 const next=draft+(draft?'\n\n':'')+preview;
 if(next.length>100_000)throw Error('This message is too long to add contact details. Shorten it first.');
 return next;
}
