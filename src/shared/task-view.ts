import {LibraryPinsSchema} from './saved-work-library';
import {LocalResearchPreferencesSchema} from './local-research-suggestions';
import {TaskSectionsSavedSchema} from './task-sections';
import {Schema} from 'effect';
import type {Task} from '../core/types';
import {searchableSavedFile,savedWorkSearchLimits,type SavedWorkMatch} from './saved-work-search';
import {savedWorkSearchText} from './saved-work-search-text';

const Id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0')));
const Revision=Schema.Int.pipe(Schema.nonNegative(),Schema.filter(Number.isSafeInteger));
const FileReference=Schema.Struct({revision:Revision.pipe(Schema.positive()),digest:Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/))});
const FileLabel=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(500),Schema.filter(value=>!value.includes('\0')));
const FavoriteFile=Schema.Struct({taskId:Id,artifactId:Id,label:FileLabel,reference:FileReference});
export const FileFavoritesSchema=Schema.Struct({revision:Revision,items:Schema.Array(FavoriteFile).pipe(Schema.maxItems(100),Schema.filter(items=>new Set(items.map(item=>JSON.stringify([item.taskId,item.artifactId]))).size===items.length))});
export const TaskViewSavedSchema=Schema.Struct({schemaVersion:Schema.Literal(1),taskId:Schema.NullOr(Id),fileFavorites:Schema.optional(FileFavoritesSchema),libraryPins:Schema.optional(LibraryPinsSchema),sidebarSections:Schema.optional(TaskSectionsSavedSchema),localResearch:Schema.optional(LocalResearchPreferencesSchema)});
export type TaskViewSaved=typeof TaskViewSavedSchema.Type;
export type FileFavorites=typeof FileFavoritesSchema.Type;
export type FavoriteFile=typeof FavoriteFile.Type;
export const FileFavoritesStateSchema=Schema.Union(Schema.Struct({kind:Schema.Literal('available'),...FileFavoritesSchema.fields}),Schema.Struct({kind:Schema.Literal('unavailable'),message:Schema.String}));
export type FileFavoritesState=typeof FileFavoritesStateSchema.Type;
const FileFavoritesChangeSchema=Schema.Struct({expectedRevision:Revision,change:Schema.Union(
 Schema.Struct({kind:Schema.Literal('favorite','unfavorite'),taskId:Id,artifactId:Id,...FileReference.fields}),
 Schema.Struct({kind:Schema.Literal('clear-unavailable'),taskId:Id,artifactId:Id})
)});
export type FileFavoritesChange=typeof FileFavoritesChangeSchema.Type;
export type FileFavoritesCommand={type:'file-favorites.get'}|({type:'file-favorites.change'}&FileFavoritesChange);
export const readFileFavoritesChange=Schema.decodeUnknownSync(FileFavoritesChangeSchema,{onExcessProperty:'error'});
export const readFileFavoritesState=Schema.decodeUnknownSync(FileFavoritesStateSchema,{onExcessProperty:'error'});
export const readFileFavoritesCommand=Schema.decodeUnknownSync(Schema.Union(Schema.Struct({type:Schema.Literal('file-favorites.get')}),Schema.Struct({type:Schema.Literal('file-favorites.change'),...FileFavoritesChangeSchema.fields})),{onExcessProperty:'error'});
export const favoriteFileKey=(value:{taskId:string;artifactId:string})=>JSON.stringify([value.taskId,value.artifactId]);
export type FavoriteFileView={favorite:FavoriteFile;match?:Extract<SavedWorkMatch,{kind:'file'}>;unavailable?:string};
/** Local navigation only. The original favorite label/reference is retained;
 * opening explicitly targets the current saved file through normal search guards. */
export function favoriteFileViews(tasks:readonly Task[],items:readonly FavoriteFile[]):FavoriteFileView[]{
 return items.map(favorite=>{
  const owners=tasks.filter(task=>task.id===favorite.taskId),task=owners.length===1?owners[0]:undefined,files=task?.artifacts.filter(file=>file.id===favorite.artifactId),file=files?.length===1?files[0]:undefined,revision=file?.revisions.at(-1);
  if(!task||!file||!revision||file.revisions.filter(item=>item.revision===revision.revision).length!==1)return {favorite,unavailable:'The saved file or its task is no longer available.'};
  if(!searchableSavedFile(revision))return {favorite,unavailable:'The current file is outside plain-text and Markdown search.'};
  if(revision.title.length+revision.content.length>savedWorkSearchLimits.file)return {favorite,unavailable:'The current file exceeds the complete-file search limit.'};
  const text=savedWorkSearchText(task,file,revision,revision.content);
  if(text===null)return {favorite,unavailable:'The current saved file could not be projected safely.'};
  return {favorite,match:{kind:'file',taskId:task.id,taskTitle:task.title,title:revision.title,artifactId:file.id,revision:revision.revision,digest:revision.digest,mimeType:revision.mimeType,encoding:revision.encoding,contentLength:revision.content.length,contentPrefix:revision.content,field:'File name',excerpt:text.slice(0,savedWorkSearchLimits.excerpt)}};
 });
}

export type TaskViewState=
 | {kind:'available';taskId:string|null}
 | {kind:'missing';taskId:null;message:string}
 | {kind:'unavailable';taskId:null;message:string};
export type TaskPinsState={kind:'available';taskIds:readonly string[]}|{kind:'unavailable';taskIds:readonly [];message:string};
/** Pinned task IDs are local navigation preferences, never shared model context. */
export function orderTaskList<T extends {id:string;updatedAt:string}>(tasks:readonly T[],pinnedTaskIds:readonly string[]):T[]{
 return [...tasks].sort((a,b)=>{const ai=pinnedTaskIds.indexOf(a.id),bi=pinnedTaskIds.indexOf(b.id);return ai>=0||bi>=0?ai<0?1:bi<0?-1:ai-bi:b.updatedAt.localeCompare(a.updatedAt);});
}
export function restoreTaskView<T extends {id:string;archive?:unknown}>(tasks:T[],state:TaskViewState):T|undefined{
 return state.kind==='available'&&state.taskId!==null?tasks.find(task=>task.id===state.taskId&&!task.archive):undefined;
}
