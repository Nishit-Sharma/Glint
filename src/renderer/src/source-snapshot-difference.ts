import {diffLines,type Change} from 'diff';
import type {Source,SourceRef,SourceVersion} from '../../core/types';

export type SnapshotDifference=
 | {kind:'missing'}
 | {kind:'unsupported'}
 | {kind:'no-newer'}
 | {kind:'large';before:SourceVersion;after:SourceVersion}
 | {kind:'ready';before:SourceVersion;after:SourceVersion;parts:Change[];unchanged:boolean};
/** Compare saved text only. Omitted afterReference retains the latest-saved work comparison. */
export function sourceSnapshotDifference(source:Source,reference:SourceRef,afterReference?:SourceRef):SnapshotDifference{
 if(reference.sourceId!==source.id||afterReference&&afterReference.sourceId!==source.id)return {kind:'missing'};
 const before=source.versions.find(v=>v.id===source.id&&v.version===reference.version&&v.digest===reference.digest),after=source.versions.find(v=>v.id===source.id&&(afterReference?v.version===afterReference.version&&v.digest===afterReference.digest:v.version===source.currentVersion));
 if(!before||!after)return {kind:'missing'};
 if(before.kind!=='text'||after.kind!=='text')return {kind:'unsupported'};
 if(before.version===after.version&&before.digest===after.digest)return {kind:'no-newer'};
 if(before.version>=after.version)return {kind:'missing'};
 if(before.content.length+after.content.length>100_000)return {kind:'large',before,after};
 const parts=diffLines(before.content,after.content,{timeout:30,maxEditLength:1000});if(!parts)return {kind:'large',before,after};
 return {kind:'ready',before,after,parts,unchanged:before.content===after.content};
}
