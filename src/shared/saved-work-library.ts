import {Schema} from 'effect';
import type {Artifact,ArtifactRevision,Task} from '../core/types';
const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0'))),revision=Schema.Int.pipe(Schema.nonNegative(),Schema.filter(Number.isSafeInteger)),digest=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),label=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(500),Schema.filter(value=>!!value.trim()&&!value.includes('\0')));
const reference=Schema.Struct({revision:revision.pipe(Schema.positive()),digest});
const pin=Schema.Struct({taskId:id,artifactId:id,label,reference});
export const LibraryPinsSchema=Schema.Struct({revision,items:Schema.Array(pin).pipe(Schema.maxItems(100),Schema.filter(items=>new Set(items.map(item=>JSON.stringify([item.taskId,item.artifactId]))).size===items.length))});
export type LibraryPins=typeof LibraryPinsSchema.Type;
export type LibraryPin=typeof pin.Type;
const change=Schema.Struct({expectedRevision:revision,change:Schema.Union(Schema.Struct({kind:Schema.Literal('pin'),taskId:id,artifactId:id,...reference.fields}),Schema.Struct({kind:Schema.Literal('unpin'),taskId:id,artifactId:id}))});
export type LibraryPinChange=typeof change.Type;
export const readLibraryPinChange=Schema.decodeUnknownSync(change,{onExcessProperty:'error'});
const state=Schema.Union(Schema.Struct({kind:Schema.Literal('available'),...LibraryPinsSchema.fields}),Schema.Struct({kind:Schema.Literal('unavailable'),message:Schema.String}));
export type LibraryPinState=typeof state.Type;
export const readLibraryPinState=Schema.decodeUnknownSync(state,{onExcessProperty:'error'});
export const SAVED_LINK_MIME='application/vnd.glint.saved-link+json';
const url=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(2048),Schema.filter(value=>{try{const parsed=new URL(value);return value===value.trim()&&!/[\u0000-\u0020\u007f]/.test(value)&&['http:','https:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password;}catch{return false;}}));
const definition=Schema.Struct({schemaVersion:Schema.Literal(1),creationId:Schema.String.pipe(Schema.pattern(/^[a-f0-9-]{36}$/)),label,url});
export type SavedLink=typeof definition.Type;
export const readSavedLinkDefinition=Schema.decodeUnknownSync(definition,{onExcessProperty:'error'});
const command=Schema.Union(Schema.Struct({type:Schema.Literal('library.pins.get')}),Schema.Struct({type:Schema.Literal('library.pins.change'),...change.fields}),Schema.Struct({type:Schema.Literal('library.link.create'),taskId:id,definition}));
export type SavedWorkLibraryCommand=typeof command.Type;
export const readSavedWorkLibraryCommand=Schema.decodeUnknownSync(command,{onExcessProperty:'error'});
export function savedLink(revision:ArtifactRevision):SavedLink|undefined{if(revision.mimeType!==SAVED_LINK_MIME||revision.encoding==='base64'||revision.content.length>8000)return;try{return readSavedLinkDefinition(JSON.parse(revision.content));}catch{return;}}
export const libraryPinKey=(item:{taskId:string;artifactId:string})=>JSON.stringify([item.taskId,item.artifactId]);
export type LibraryPinView={pin:LibraryPin;artifact?:Artifact;current?:ArtifactRevision;unavailable?:string};
export function libraryPinViews(tasks:readonly Task[],items:readonly LibraryPin[]):LibraryPinView[]{return items.map(pin=>{const owners=tasks.filter(task=>task.id===pin.taskId),owner=owners.length===1?owners[0]:undefined,files=owner?.artifacts.filter(artifact=>artifact.id===pin.artifactId),artifact=files?.length===1?files[0]:undefined,current=artifact?.revisions.at(-1);return {pin,...(artifact&&current&&artifact.revisions.filter(item=>item.revision===current.revision).length===1?{artifact,current}:{unavailable:'The saved item or its task is unavailable. Only its pin can be removed.'})};});}
export type SavedLinkResult={taskId:string;artifactId:string;revision:ArtifactRevision};
