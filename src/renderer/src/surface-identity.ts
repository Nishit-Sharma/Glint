import type {Task} from '../../core/types';
import type {AttachedWindow} from '../../shared/bridge';

/** Native observations can invalidate grounding without changing task.updatedAt. */
export function surfaceIdentity(task?:Task,attachment?:AttachedWindow){
 return JSON.stringify([task?.id,task?.updatedAt,task?.sources.map(source=>[source.id,source.currentVersion,source.freshness,source.staleReason,source.versions.at(-1)?.digest,source.versions.at(-1)?.label]),attachment&&[attachment.id,attachment.title,attachment.ownerName]]);
}

/** Request results/timestamps do not replace a presentation scene. Source and
 * task changes still invalidate its measured context. */
export function presentationIdentity(task?:Task,attachment?:AttachedWindow){
 return JSON.stringify([task?.id,task?.sources.map(source=>[source.id,source.currentVersion,source.freshness,source.staleReason,source.versions.at(-1)?.digest,source.versions.at(-1)?.label]),attachment&&[attachment.id,attachment.title,attachment.ownerName]]);
}
