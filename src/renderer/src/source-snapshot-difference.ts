import {diffLines,type Change} from 'diff';
import type {Source,SourceRef,SourceVersion} from '../../core/types';

export type SnapshotDifference=
 | {kind:'missing'}
 | {kind:'unsupported'}
 | {kind:'no-newer'}
 | {kind:'large';before:SourceVersion;after:SourceVersion}
 | {kind:'ready';before:SourceVersion;after:SourceVersion;parts:Change[];unchanged:boolean};
/** Compare saved text only. This does not check the live source or change any references. */
export function sourceSnapshotDifference(source:Source,reference:SourceRef):SnapshotDifference{
 if(reference.sourceId!==source.id)return {kind:'missing'};
 const before=source.versions.find(v=>v.id===source.id&&v.version===reference.version&&v.digest===reference.digest),after=source.versions.find(v=>v.id===source.id&&v.version===source.currentVersion);
 if(!before||!after)return {kind:'missing'};
 if(before.kind!=='text'||after.kind!=='text')return {kind:'unsupported'};
 if(before.version===after.version&&before.digest===after.digest)return {kind:'no-newer'};
 if(before.version>=after.version)return {kind:'missing'};
 if(before.content.length+after.content.length>100_000)return {kind:'large',before,after};
 const parts=diffLines(before.content,after.content,{timeout:30,maxEditLength:1000});if(!parts)return {kind:'large',before,after};
 return {kind:'ready',before,after,parts,unchanged:before.content===after.content};
}
