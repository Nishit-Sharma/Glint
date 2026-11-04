// Seed runner-era journals for historical recovery tests only; current publication tests use concrete core methods.
import type {Companion} from '../../src/core/companion';
import {documentRecipePublication} from '../../src/core/document-recipe-host';
import {readDocumentRecipeSave,type DocumentRecipeSaved} from '../../src/shared/document-recipe';
import {readTableWorkflowDocumentSave,tableWorkflowDocumentPublication} from '../../src/core/table-workflow-host';
export async function legacyDocumentRecipeSave(core:Companion,raw:unknown,guard?:()=>void):Promise<DocumentRecipeSaved>{
 const value=readDocumentRecipeSave(raw),publication=documentRecipePublication(await core.getTask(value.taskId),value);if(publication.kind==='existing')return publication.result;
 const record=await core.runRequest(publication.request,async()=>publication.artifact,guard);if(record.status!=='completed')throw Error('The document save was not confirmed. '+(record.error??''));
 const saved=documentRecipePublication(await core.getTask(value.taskId),value);if(saved.kind!=='existing')throw Error('The original document needs inspection.');return saved.result;
}
export async function legacyTableWorkflowSave(core:Companion,raw:unknown,guard?:()=>void):Promise<{artifactId:string;revision:number}>{
 const value=readTableWorkflowDocumentSave(raw),publication=tableWorkflowDocumentPublication(await core.getTask(value.taskId),value);if(publication.kind==='existing')return publication.result;
 const record=await core.runRequest(publication.request,async()=>publication.artifact,guard);if(record.status!=='completed')throw Error('The table report was not confirmed. '+(record.error??''));
 const saved=tableWorkflowDocumentPublication(await core.getTask(value.taskId),value);if(saved.kind!=='existing')throw Error('The original report needs inspection.');return saved.result;
}
