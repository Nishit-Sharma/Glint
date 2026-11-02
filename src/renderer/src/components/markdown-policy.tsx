import {createElement} from 'react';
import {defaultRehypePlugins,type Components} from 'streamdown';
import {CodeBlock} from './CodeBlock';
import {codeBlockSourcePlugin} from './code-block-source';
import {parsePageReferenceHref,type PageReference} from '../../../shared/page-reference';
import './markdown.css';

const elements=['p','strong','em','code','pre','ul','ol','li','h1','h2','h3','h4','h5','h6','blockquote','hr','br','del','table','thead','tbody','tr','th','td','span','a','img','input','sup','sub'];

export const markdownPolicy={
 skipHtml:true,
 allowedElements:elements,
 rehypePlugins:[defaultRehypePlugins.sanitize,codeBlockSourcePlugin],
 urlTransform:(url:string,key:string,node:{tagName:string})=>((node.tagName==='a'&&key==='href')||(node.tagName==='img'&&key==='src'))?url:'',
};

export function markdownComponents(hiddenHeadingLine?:number,copyEnabled=true,onPageReference?:(reference:PageReference)=>void):Components{
 const components:Components={
  strong:({children})=><strong>{children}</strong>,
  em:({children})=><em>{children}</em>,
  del:({children})=><del>{children}</del>,
  p:({children})=><p className="markdown-paragraph">{children}</p>,
  a:({children,href})=>{const reference=parsePageReferenceHref(href);return reference&&onPageReference?<button type="button" className="markdown-page-reference" onClick={()=>onPageReference(reference)}>{children}</button>:<span className="markdown-reference">{children}{href&&<> (<bdi>{href}</bdi>)</>}</span>;},
  img:({alt,src})=><span className="markdown-image-reference">Image reference{alt?`: ${alt}`:''}{src?` (${src})`:''} — image not loaded.</span>,
  input:({type,checked})=>type==='checkbox'?<input type="checkbox" checked={Boolean(checked)} disabled readOnly aria-label={checked?'Checked task':'Unchecked task'}/>:null,
  li:({children,className})=><li className={className?.split(/\s+/).includes('task-list-item')?'task-list-item':undefined}>{children}</li>,
  pre:({children,node})=><CodeBlock text={typeof node?.data?.glintCodeCopy==='string'?node.data.glintCodeCopy:undefined} enabled={copyEnabled}>{children}</CodeBlock>,
  code:({children,className})=><code className={className}>{children}</code>,
  table:({children})=><div className="markdown-table-scroll" tabIndex={0} role="region" aria-label="Table"><table>{children}</table></div>,
 };
 for(const [source,level] of [['h1','h2'],['h2','h3'],['h3','h4'],['h4','h5'],['h5','h6'],['h6','h6']] as const){
  components[source]=({children,node})=>hiddenHeadingLine!==undefined&&node?.position?.start.line===hiddenHeadingLine?null:createElement(level,source==='h6'?{'aria-level':7}:null,children);
 }
 return components;
}

export const inertMarkdownComponents=markdownComponents();
