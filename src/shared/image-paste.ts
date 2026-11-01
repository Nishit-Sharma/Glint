import {Schema} from 'effect';
import type {SourceRef} from '../core/types';
export const IMAGE_PASTE_BYTES=8*1024*1024;
export const IMAGE_PASTE_PIXELS=40_000_000;
const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0')));
const digest=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/));
const command=Schema.Struct({type:Schema.Literal('source.image.paste'),taskId:id,sourceId:Schema.String.pipe(Schema.pattern(/^[a-f0-9-]{36}$/)),content:Schema.String.pipe(Schema.maxLength(Math.ceil(IMAGE_PASTE_BYTES/3)*4+32),Schema.pattern(/^data:image\/(?:png|jpeg);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/))});
export type ImagePasteCommand=typeof command.Type;
export const readImagePasteCommand=Schema.decodeUnknownSync(command,{onExcessProperty:'error'});
const result=Schema.Struct({taskId:id,reference:Schema.Struct({sourceId:id,version:Schema.Literal(1),digest}),width:Schema.Int.pipe(Schema.positive()),height:Schema.Int.pipe(Schema.positive()),imageDigest:digest});
export type ImagePasteResult=typeof result.Type;
export const readImagePasteResult=Schema.decodeUnknownSync(result,{onExcessProperty:'error'});
export function selectedWithPastedImage(existing:string[]|undefined,before:readonly {id:string}[],reference:SourceRef){return [...new Set([...(existing??before.map(source=>source.id)),reference.sourceId])];}
