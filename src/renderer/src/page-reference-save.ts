import type {Task} from '../../core/types';
import {prependPageReference,resolvePageReference,type PageReferencePreview,type PageReferenceSource} from '../../shared/page-reference';
import type {createSavedDocumentDraftController} from './saved-document-draft-controller';
import {parseSavedDocumentDraftBasis} from '../../shared/saved-document-draft';

export async function savePageReference(controller:ReturnType<typeof createSavedDocumentDraftController>,source:PageReferenceSource,preview:PageReferencePreview,options:{current:()=>boolean;load:(taskId:string)=>Promise<Task>;staged:()=>void}):Promise<boolean>{
 const before=controller.snapshot(),basis=parseSavedDocumentDraftBasis(before.basis);
 if(!options.current()||before.owner.taskId!==source.taskId||before.owner.artifactId!==source.artifact.artifactId||basis.revision!==source.artifact.revision||basis.digest!==source.artifact.digest||before.held||before.operation||before.raw.present)throw Error('Finish or save your existing document edits before linking a page. Your draft is kept.');
 const owner=await options.load(preview.reference.taskId);if(!options.current())return false;
 const checked=resolvePageReference(owner,preview.reference);
 if(checked.artifact.revision!==preview.artifact.revision||checked.artifact.digest!==preview.artifact.digest)throw Error('The selected page changed. Inspect its current saved content before linking it.');
 const current=controller.snapshot();
 if(current.basis!==before.basis||current.raw.present||current.held||current.operation)throw Error('The source document changed. Your current edits are kept.');
 const result=controller.edit({content:prependPageReference(before.fields.content,checked)});if(result.kind!=='accepted')throw Error('The page reference could not be staged. Existing document edits are kept.');
 options.staged();return controller.save();
}
