import type {Source,SourceRef,SourceVersion,Task} from '../../core/types';

type LinkedChange={reference:SourceRef;label:string};
export type SavedDocumentSourceChange=
 | LinkedChange&{kind:'unavailable'}
 | LinkedChange&{kind:'refresh-required';current:SourceRef}
 | LinkedChange&{kind:'ready';current:SourceRef;source:Source;before:SourceVersion;after:SourceVersion};

/** Only exact saved snapshots are eligible; live content is never checked here. */
export function savedDocumentSourceChanges(task:Task,refs:readonly SourceRef[]):SavedDocumentSourceChange[]{
 return refs.flatMap((reference):SavedDocumentSourceChange[]=>{
  const source=task.sources.find(item=>item.id===reference.sourceId),after=source?.versions.at(-1),before=source?.versions.find(version=>version.id===reference.sourceId&&version.version===reference.version&&version.digest===reference.digest),label=after?.label??before?.label??'Unavailable source';
  if(!source||!before||!after||after.id!==source.id||after.version!==source.currentVersion)return [{kind:'unavailable',reference,label}];
  const current={sourceId:source.id,version:after.version,digest:after.digest};
  if(source.freshness!=='fresh')return [{kind:'refresh-required',reference,label,current}];
  if(reference.version===current.version&&reference.digest===current.digest)return [];
  if(before.version>=after.version)return [{kind:'unavailable',reference,label}];
  return [{kind:'ready',reference,label,current,source,before,after}];
 });
}
