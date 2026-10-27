import type { ArtifactRevision, SourceRef, Task } from '../../core/types';
export interface DraftState {
  base?: ArtifactRevision;
  title: string;
  content: string;
  sourceRefs: SourceRef[];
}
export function currentSourceRefs(task: Task): SourceRef[] {
  return task.sources.map(source => {
    const version = source.versions[source.versions.length - 1];
    return { sourceId: source.id, version: version.version, digest: version.digest };
  });
}
const refsKey = (refs: SourceRef[]) => JSON.stringify([...refs].sort((a,b) => a.sourceId.localeCompare(b.sourceId)));
export function draftFrom(revision: ArtifactRevision | undefined, task: Task): DraftState {
  return { base: revision, title: revision?.title ?? '', content: revision?.content ?? '', sourceRefs: revision?.sourceRefs ?? currentSourceRefs(task) };
}
export function isDraftDirty(draft: DraftState): boolean {
  return draft.title !== (draft.base?.title ?? '') || draft.content !== (draft.base?.content ?? '') || (draft.base !== undefined && refsKey(draft.sourceRefs) !== refsKey(draft.base.sourceRefs));
}
export function reconcileDraft(draft: DraftState, latest: ArtifactRevision, task: Task): DraftState {
  return latest.revision !== draft.base?.revision && !isDraftDirty(draft) ? draftFrom(latest, task) : draft;
}
export function changedDependencies(task: Task, refs: SourceRef[]): string[] {
  return refs.flatMap(ref => {
    const source = task.sources.find(source => source.id === ref.sourceId);
    if (!source) return ['Removed source'];
    const version = source.versions[source.versions.length - 1];
    return source.freshness !== 'fresh' || source.currentVersion !== ref.version || version.digest !== ref.digest ? [version.label] : [];
  });
}
