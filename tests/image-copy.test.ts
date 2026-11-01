import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createCompanion} from '../src/core/companion';
import {copySavedImage} from '../src/host/image-copy';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1sAAAAASUVORK5CYII=';
const bitmap=Buffer.from([255,255,255,255]);
const image=()=>({isEmpty:()=>false,getSize:()=>({width:1,height:1}),toBitmap:()=>Buffer.from(bitmap)});
const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
async function fixture(){const directory=await mkdtemp(join(tmpdir(),'image-copy-')),core=await createCompanion({dataDir:directory}),task=await core.createTask({title:'Owned image'}),saved=await core.saveArtifact(task.id,{title:'Saved PNG',content:png,mimeType:'image/png',encoding:'base64',sourceRefs:[]});cleanups.push(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});return {core,task,command:{type:'image.copy' as const,taskId:task.id,artifactId:saved.artifactId,revision:1,digest:saved.revision.digest}};}
it('copies the exact saved PNG only, verifies newly-written bitmap, and leaves the task unchanged',async()=>{
 const f=await fixture();await f.core.saveArtifact(f.task.id,{artifactId:f.command.artifactId,expectedRevision:1,title:'Later PNG',content:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/kN8AAAAASUVORK5CYII=',mimeType:'image/png',encoding:'base64',sourceRefs:[]});const before=await f.core.getTask(f.task.id),calls:string[]=[];
 const result=await copySavedImage(f.command,id=>f.core.getTask(id),{createFromBuffer:bytes=>{expect(bytes).toEqual(Buffer.from(png,'base64'));return image();},writePng:async bytes=>{expect(bytes).toEqual(Buffer.from(png,'base64'));await Promise.resolve();calls.push('write');},readPng:()=>{expect(calls).toEqual(['write']);calls.push('read');return Buffer.from(png,'base64');}});
 expect(result).toEqual({taskId:f.command.taskId,artifactId:f.command.artifactId,revision:f.command.revision,digest:f.command.digest,kind:'copied',width:1,height:1,bitmapDigest:createHash('sha256').update(bitmap).digest('hex')});
 expect(calls).toEqual(['write','read']);expect(await f.core.getTask(f.task.id)).toEqual(before);
});

it('rejects wrong references and modified stored image bytes before touching the clipboard',async()=>{
 const f=await fixture();let touches=0;const adapter={createFromBuffer:()=>{touches++;return image();},writePng:()=>{touches++;},readPng:()=>{touches++;return Buffer.from(png,'base64');}};
 await expect(copySavedImage({...f.command,digest:'0'.repeat(64)},id=>f.core.getTask(id),adapter)).rejects.toThrow();
 const task=await f.core.getTask(f.task.id);task.artifacts[0].revisions[0].content=task.artifacts[0].revisions[0].content+'AAAA';await expect(copySavedImage(f.command,async()=>task,adapter)).rejects.toThrow();expect(touches).toBe(0);
});
it('rejects malformed command and image bounds before any clipboard read or write',async()=>{
 const f=await fixture();let touches=0;const adapter={createFromBuffer:()=>{touches++;return image();},writePng:()=>{touches++;},readPng:()=>{touches++;return Buffer.from(png,'base64');}};
 await expect(copySavedImage({...f.command,path:'/not-a-destination'},id=>f.core.getTask(id),adapter)).rejects.toThrow();
 const task=await f.core.getTask(f.task.id),bytes=Buffer.from(png,'base64');bytes.writeUInt32BE(20000,16);task.artifacts[0].revisions[0].content=bytes.toString('base64');task.artifacts[0].revisions[0].digest=createHash('sha256').update(bytes).digest('hex');await expect(copySavedImage({...f.command,digest:task.artifacts[0].revisions[0].digest},async()=>task,adapter)).rejects.toThrow();expect(touches).toBe(0);
});
it('does not acknowledge a mismatching native bitmap readback or a failed write',async()=>{
 const f=await fixture(),before=await f.core.getTask(f.task.id);let reads=0,decodes=0;
 await expect(copySavedImage(f.command,id=>f.core.getTask(id),{createFromBuffer:()=>++decodes===1?image():({...image(),toBitmap:()=>Buffer.alloc(4)}),writePng:()=>{},readPng:()=>Buffer.from(png,'base64')})).rejects.toThrow();
 await expect(copySavedImage(f.command,id=>f.core.getTask(id),{createFromBuffer:()=>image(),writePng:()=>{throw Error('Owned write denied');},readPng:()=>{reads++;return Buffer.from(png,'base64');}})).rejects.toThrow();expect(reads).toBe(0);expect(await f.core.getTask(f.task.id)).toEqual(before);
});
it('checks current host scope immediately before the clipboard side effect',async()=>{
 const f=await fixture();let writes=0,reads=0;
 await expect(copySavedImage(f.command,id=>f.core.getTask(id),{createFromBuffer:()=>image(),writePng:()=>{writes++;},readPng:()=>{reads++;return Buffer.from(png,'base64');}},()=>{throw Error('Owned task view changed');})).rejects.toThrow();expect(writes).toBe(0);expect(reads).toBe(0);
});
