import type {SourceRef} from '../core/types';

type Provenance={sourceRefs:readonly SourceRef[];contextSourceRefs?:readonly SourceRef[]};
const same=(a:SourceRef,b:SourceRef)=>a.sourceId===b.sourceId&&a.version===b.version&&a.digest===b.digest;
/** Metadata only. Inherited context never becomes an editable link or a capture/send grant. */
export function sourceDependencyRefs(value:Provenance):SourceRef[]{
 const refs=[...value.sourceRefs,...(value.contextSourceRefs??[])];
 return refs.filter((ref,index)=>refs.findIndex(other=>same(ref,other))===index);
}
export function inheritedSourceRefs(value:Provenance):SourceRef[]{
 return sourceDependencyRefs(value).filter(ref=>!value.sourceRefs.some(link=>same(ref,link)));
}
