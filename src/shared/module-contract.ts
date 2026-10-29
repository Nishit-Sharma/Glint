/** Lightweight renderer discriminator; schema/runtime loads only for an actual module answer. */
export const MODULE_MIME='application/vnd.window-companion.modules+json';

export const MODULE_EXPORT_RECOVERY='Choose Save as document, then export the saved document.';
export const MODULE_REVISION_RECOVERY='Use this answer’s controls, or choose Save as document to edit its text.';
export function assertRawModuleOperationAllowed(mimeType:string,operation:'export'|'revise'):void{
 if(mimeType===MODULE_MIME)throw Error(operation==='export'?MODULE_EXPORT_RECOVERY:MODULE_REVISION_RECOVERY);
}
