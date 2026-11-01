import {createHash} from 'node:crypto';
import type {Task} from '../core/types';
import {readImageCopyCommand,type ImageCopyResult} from '../shared/image-copy';

export const IMAGE_COPY_BYTE_LIMIT=16*1024*1024;
export const IMAGE_COPY_PIXEL_LIMIT=16_000_000;
type BitmapImage={isEmpty:()=>boolean;getSize:(scaleFactor?:number)=>{width:number;height:number};toBitmap:(options?:{scaleFactor?:number})=>Buffer};
type ImageClipboard<Image extends BitmapImage>={createFromBuffer:(bytes:Buffer)=>Image;writePng:(bytes:Buffer)=>Promise<void>|void;readPng:()=>Promise<Buffer>|Buffer};
const fail=():never=>{throw Error('The saved image could not be copied and verified. Your saved image is unchanged.');};
function dimensions(bytes:Buffer){
 if(bytes.length<33||bytes.length>IMAGE_COPY_BYTE_LIMIT||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR')return fail();
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);if(width<1||height<1||width>16384||height>16384||width*height>IMAGE_COPY_PIXEL_LIMIT)return fail();return {width,height};
}
export async function copySavedImage<Image extends BitmapImage>(value:unknown,getTask:(id:string)=>Promise<Task>,clipboard:ImageClipboard<Image>,assertCurrent:()=>void=()=>{}):Promise<ImageCopyResult>{
 const input=readImageCopyCommand(value),task=await getTask(input.taskId),saved=task.id===input.taskId?task.artifacts.find(artifact=>artifact.id===input.artifactId)?.revisions.find(revision=>revision.revision===input.revision&&revision.digest===input.digest):undefined;
 if(!saved||saved.mimeType!=='image/png'||saved.encoding!=='base64'||saved.content.length>Math.ceil(IMAGE_COPY_BYTE_LIMIT/3)*4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(saved.content))return fail();
 const bytes=Buffer.from(saved.content,'base64'),{width,height}=dimensions(bytes);
 if(bytes.toString('base64')!==saved.content||createHash('sha256').update(bytes).digest('hex')!==input.digest)return fail();
 const image=clipboard.createFromBuffer(bytes),size=image.getSize(1),bitmap=image.toBitmap({scaleFactor:1});
 if(image.isEmpty()||size.width!==width||size.height!==height||bitmap.length!==width*height*4)return fail();
 assertCurrent();await clipboard.writePng(bytes);
 const copiedBytes=await clipboard.readPng(),copiedDimensions=dimensions(copiedBytes);if(copiedDimensions.width!==width||copiedDimensions.height!==height)return fail();
 const copied=clipboard.createFromBuffer(copiedBytes),copiedSize=copied.getSize(1),copiedBitmap=copied.toBitmap({scaleFactor:1});
 if(copied.isEmpty()||copiedSize.width!==width||copiedSize.height!==height||!copiedBitmap.equals(bitmap))return fail();
 return {kind:'copied',taskId:input.taskId,artifactId:input.artifactId,revision:input.revision,digest:input.digest,width,height,bitmapDigest:createHash('sha256').update(bitmap).digest('hex')};
}
