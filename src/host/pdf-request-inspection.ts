import {createHash} from 'node:crypto';
import type {SourceRef} from '../core/types';
import {PdfPageProvenanceSchema,pdfPageMessages} from '../shared/pdf-page-import';
import {Schema} from 'effect';
import {buildCodexInferenceWire,type RequestInferenceSelection} from '../shared/request-inference';
import {composeOrdinaryRequest} from './ordinary-request-composition';
import {buildCodexInput} from './codex-provider';

const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
/** Redacts only image bytes AFTER the actual production Codex serializer runs. */
export function inspectPdfRequest(taskId:string,input:Parameters<typeof composeOrdinaryRequest>[0],selection:RequestInferenceSelection,imageInput:'advertised'|'text-only'|'unknown'){
 if(imageInput==='text-only')throw Error(pdfPageMessages.textOnly);
 if(!input.sources.length||input.sources.some(source=>source.kind!=='image'||!source.pdfPage))throw Error(pdfPageMessages.images);
 const images=input.sources.map(source=>{
  const provenance=Schema.decodeUnknownSync(PdfPageProvenanceSchema,{onExcessProperty:'error'})(source.pdfPage),match=/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(source.content);if(!match)throw Error(pdfPageMessages.changed);
  const png=Buffer.from(match[1],'base64');if(png.length<24||hash(png)!==provenance.pngDigest||png.readUInt32BE(16)!==provenance.width||png.readUInt32BE(20)!==provenance.height)throw Error(pdfPageMessages.changed);
  const reference:SourceRef={sourceId:source.id,version:source.version,digest:source.digest};return {reference,provenance,label:source.label,dataUrl:source.content};
 });
 const request=composeOrdinaryRequest(input),wire=buildCodexInput(request);let imageIndex=0;
 const parts=wire.map(part=>{if(part.type!=='image')return part;const image=images[imageIndex++];if(!image||part.url!==image.dataUrl)throw Error(pdfPageMessages.changed);return {type:'image',reference:image.reference,pngDigest:image.provenance.pngDigest,width:image.provenance.width,height:image.provenance.height,bytes:'Exact selected PNG; rendered below. Base64 omitted from this inspection.'};});
 if(imageIndex!==images.length)throw Error(pdfPageMessages.changed);
 return {taskId,prompt:input.prompt,requested:selection,wireSettings:buildCodexInferenceWire(selection),imageInput,wireDigest:hash(JSON.stringify(wire)),parts,images};
}
