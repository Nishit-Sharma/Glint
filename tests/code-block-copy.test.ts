import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect,vi} from 'vitest';
import {Streamdown} from 'streamdown';
import {markdownPolicy} from '../src/renderer/src/components/markdown-policy';
import {ReadableText} from '../src/renderer/src/components/ReadableText';
import {StreamingText} from '../src/renderer/src/components/StreamingText';
import * as codeBlock from '../src/renderer/src/components/CodeBlock';
import {readCodeBlockCopy,writeCodeBlockCopy,CODE_BLOCK_COPY_LIMIT} from '../src/shared/code-block-copy';

function copiedBlocks(text:string){
 const blocks:unknown[]=[];
 renderToStaticMarkup(createElement(Streamdown,{...markdownPolicy,mode:'static',controls:false,components:{pre:({node})=>{blocks.push(node?.data?.glintCodeCopy);return null;}},children:text}));
 return blocks;
}

describe('exact code block source',()=>{
 it('retains tabs, indentation, blank lines, Unicode, entities and every source line ending',()=>{
  const code='\t  const café = "😀 & < >";  \r\n\r\n\treturn café;\r\n\r\n';
  expect(copiedBlocks('Before\n\n```ts metadata\r\n'+code+'```\n\n`inline`\n\n~~~text\nsecond\n\n~~~')).toEqual([code,'second\n\n']);
 });
 it('retains the final missing newline and handles empty fences without adding bytes',()=>{
  expect(copiedBlocks('```js\nno newline')).toEqual(['no newline']);
  expect(copiedBlocks('```js\nwith newline\n')).toEqual(['with newline\n']);
  expect(copiedBlocks('```\n```')).toEqual(['']);
 });
 it('excludes Markdown container and fence indentation while retaining code indentation',()=>{
  expect(copiedBlocks('> ```js\n>   quoted\n> \n> ```\n\n- ```js\n  \t  listed\n  ```\n\n  ```js\n    indented fence\n  ```')).toEqual(['  quoted\n\n','\t  listed\n','  indented fence\n']);
 });
 it('retains indented code without its Markdown indent and includes its real trailing newline',()=>{
  expect(copiedBlocks('    first\n    \tsecond\n')).toEqual(['first\n\tsecond\n']);
 });
 it('offers one explicit copy button per code block and none for inline code',()=>{
  const html=renderToStaticMarkup(createElement(ReadableText,{text:'`inline`\n\n```js\nfirst\n```\n\n```\nsecond\n```'}));
  expect(html.match(/aria-label="Copy code block"/g)).toHaveLength(2);
  expect(html).toContain('role="status"');
  expect(html).not.toContain('Code copied.');
  expect(renderToStaticMarkup(createElement(ReadableText,{text:'`inline`'}))).not.toContain('<button');
 });
 it('keeps Copy unavailable while streaming and available once complete',()=>{
  const text='```js\nvalue\n```';
  expect(renderToStaticMarkup(createElement(StreamingText,{text,streaming:true}))).toContain('disabled=""');
  expect(renderToStaticMarkup(createElement(StreamingText,{text,streaming:false}))).not.toContain('disabled=""');
 });
 it('passes the original line endings to Copy after a response finishes',()=>{
  const code='\t  const café = "😀 & < >";  \r\n\r\n\treturn café;\r\n\r\n',blocks:(string|undefined)[]=[],original=codeBlock.CodeBlock;
  const view=vi.spyOn(codeBlock,'CodeBlock').mockImplementation(props=>{blocks.push(props.text);return createElement(original,props);});
  try{
   renderToStaticMarkup(createElement(StreamingText,{text:'Before\r\n\r\n```ts\r\n'+code+'```',streaming:false}));
   expect(blocks).toEqual([code]);
  }finally{view.mockRestore();}
 });
});

describe('dedicated code copy command',()=>{
 it('validates without trimming or changing code and only writes the supplied text',()=>{
  const value={type:'code-block.copy',text:'\t\n Héllo 😀 \r\n'};
  expect(readCodeBlockCopy(value)).toEqual(value);
  const writes:string[]=[];
  expect(writeCodeBlockCopy(value,text=>{writes.push(text);})).toBeNull();
  expect(writes).toEqual([value.text]);
  expect(writeCodeBlockCopy({type:'code-block.copy',text:''},text=>{writes.push(text);})).toBeNull();
 });
 it('rejects malformed, oversized and unknown fields before touching the clipboard',()=>{
  for(const input of [null,{}, {type:'clipboard.read',text:'x'}, {type:'code-block.copy',text:5}, {type:'code-block.copy',text:'x',read:true}, {type:'code-block.copy',text:'x'.repeat(CODE_BLOCK_COPY_LIMIT+1)}]){
   let writes=0;
   expect(()=>writeCodeBlockCopy(input,()=>{writes++;})).toThrow();
   expect(writes).toBe(0);
  }
 });
 it('propagates a failed write without claiming success or retrying a different API',()=>{
  let writes=0;
  expect(()=>writeCodeBlockCopy({type:'code-block.copy',text:'x'},()=>{writes++;throw Error('unavailable');})).toThrow('unavailable');
  expect(writes).toBe(1);
 });
});
