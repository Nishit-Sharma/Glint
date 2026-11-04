import type {ArtifactRevision,Task} from '../../../core/types';
import {inheritedSourceRefs} from '../../../shared/source-dependencies';
import {changedDependencies} from '../editor-state';

/** Labels only: hidden context is not promoted into source links or snapshot controls. */
export function InheritedSourceWarning({task,revision}:{task:Task;revision:Pick<ArtifactRevision,'sourceRefs'|'contextSourceRefs'>}){
 const changed=[...new Set(changedDependencies(task,inheritedSourceRefs(revision)))];
 return changed.length?<p className="warning" role="status">Inherited source context needs review: {changed.join(', ')}. This saved work retains earlier context; changing its linked sources does not update that context.</p>:null;
}
