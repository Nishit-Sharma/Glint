import {posix} from 'node:path';
import {packageParts,xml,children,one} from './xlsx-context';
import {DOCUMENT_IMPORT_TEXT_LIMIT} from '../shared/document-import';

const failure=()=>Error('This PowerPoint presentation is unsupported, malformed or exceeds the PPTX limits. Choose an unencrypted .pptx with readable slide text, up to 200 slides, 100,000 extracted characters, 10,000 characters per paragraph, 2,000 ZIP entries and 32 MiB expanded (4 MiB per XML part). Nothing was imported.');
const presentationNamespaces=new Set(['http://schemas.openxmlformats.org/presentationml/2006/main','http://purl.oclc.org/ooxml/presentationml/main']);
const relationshipNamespaces=['http://schemas.openxmlformats.org/officeDocument/2006/relationships','http://purl.oclc.org/ooxml/officeDocument/relationships'];
const elements=(node:Node)=>Array.from(node.childNodes).filter((child):child is Element=>child.nodeType===1);
function paragraphs(shape:Element,namespace:string){
 const found:Element[]=[],pending=[shape];while(pending.length){const node=pending.pop()!;if(node.localName==='p'&&node.namespaceURI===namespace)found.push(node);else pending.push(...elements(node).reverse());}return found;
}
function paragraphText(paragraph:Element){
 let text='';for(const item of elements(paragraph)){if(item.namespaceURI!==paragraph.namespaceURI)throw failure();if(item.localName==='br')text+='\n';else if(item.localName==='r'||item.localName==='fld'){const value=one(item,'t',item.localName==='r');text+=value?.textContent??'';}else if(!['pPr','endParaRPr'].includes(item.localName))throw failure();if(text.length>10000)throw failure();}return text;
}
/** Presentation-declared slide order and literal on-slide text only. No presentation engine. */
export function readPptxContext(bytes:Buffer):{text:string;warnings:string[]}{
 try{
  const part=packageParts(bytes),types=xml(part('[Content_Types].xml'),'Types','http://schemas.openxmlformats.org/package/2006/content-types');
  if(!children(types,'Override').some(node=>node.getAttribute('PartName')==='/ppt/presentation.xml'&&node.getAttribute('ContentType')==='application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml'))throw failure();
  const presentation=xml(part('ppt/presentation.xml'),'presentation');if(!presentationNamespaces.has(presentation.namespaceURI??''))throw failure();const namespace=presentation.namespaceURI!,drawing=namespace.includes('purl.oclc.org')?'http://purl.oclc.org/ooxml/drawingml/main':'http://schemas.openxmlformats.org/drawingml/2006/main',relations=xml(part('ppt/_rels/presentation.xml.rels'),'Relationships','http://schemas.openxmlformats.org/package/2006/relationships'),targets=new Map<string,{path:string;type:string}>();
  for(const relation of children(relations,'Relationship')){const id=relation.getAttribute('Id')??'',target=relation.getAttribute('Target')??'',type=relation.getAttribute('Type')??'';if(!id||targets.has(id)||relation.getAttribute('TargetMode')==='External'||/^[a-z][a-z\d+.-]*:|[\\?#%]/i.test(target))throw failure();const path=target.startsWith('/')?target.slice(1):posix.normalize(posix.join('ppt',target));if(!path.startsWith('ppt/')||path.split('/').includes('..'))throw failure();targets.set(id,{path,type});}
  const slides=children(one(presentation,'sldIdLst'),'sldId');if(!slides.length||slides.length>200)throw failure();const usedPaths=new Set<string>(),usedIds=new Set<string>();let text='',readable=false,hidden=0,paragraphCount=0;
  const add=(line:string)=>{if(text.length+line.length+1>DOCUMENT_IMPORT_TEXT_LIMIT)throw failure();text+=line+'\n';};add('# PowerPoint presentation context (literal slide text; no presentation execution)');
  for(const [index,entry] of slides.entries()){
   const id=entry.getAttribute('id')??'',relationship=relationshipNamespaces.map(ns=>entry.getAttributeNS(ns,'id')).find(Boolean),target=targets.get(relationship??'');if(!/^[1-9]\d*$/.test(id)||usedIds.has(id)||!target?.type.endsWith('/slide')||usedPaths.has(target.path))throw failure();usedIds.add(id);usedPaths.add(target.path);
   const slide=xml(part(target.path),'sld',namespace),show=slide.getAttribute('show')||'1';if(!['0','1','true','false'].includes(show))throw failure();const isHidden=show==='0'||show==='false';if(isHidden)hidden++;add(`\n## Slide ${index+1} (${isHidden?'hidden':'visible'})`);add(`Slide ID ${id} · package part ${JSON.stringify(target.path)}`);
   const tree=one(one(slide,'cSld'),'spTree');let shapeNumber=0,slideParagraphs=0;
   for(const shape of elements(tree)){
    if(shape.namespaceURI!==namespace)throw failure();if(['nvGrpSpPr','grpSpPr','extLst'].includes(shape.localName))continue;if(!['sp','grpSp','graphicFrame','cxnSp','pic','contentPart'].includes(shape.localName))throw failure();shapeNumber++;
    for(const [paragraphIndex,paragraph] of paragraphs(shape,drawing).entries()){if(++paragraphCount>10000)throw failure();const value=paragraphText(paragraph);if(value.trim())readable=true;add(`S${shapeNumber}/P${paragraphIndex+1} = ${JSON.stringify(value)}`);slideParagraphs++;}
   }
   if(!slideParagraphs)add('(No local slide text; visual or inherited content is not extracted.)');
  }
  if(!readable)throw failure();return {text,warnings:[`All ${slides.length} slides are included in presentation-declared order, including ${hidden} hidden slide(s). S/P addresses identify shape and paragraph order in the slide XML, not visual reading order.`,`Text runs and paragraph/line breaks are retained as quoted literal text. Displayed field text may be cached; it is not recalculated.`,`Images, audio, video, charts, SmartArt, speaker notes, comments, inherited master/layout text, animation and visual layout are not imported. No OCR or full PowerPoint rendering is performed.`,`Only ordinary .pptx is supported, up to 200 slides and 100,000 extracted characters. Oversized or unsupported files are rejected without truncation. Macros, links and presentation code are never executed or fetched.`]};
 }catch{throw failure();}
}
