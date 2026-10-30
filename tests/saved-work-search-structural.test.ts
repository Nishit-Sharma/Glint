import {expect,test} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {Task} from '../src/core/types';
import {searchSavedWork} from '../src/shared/saved-work-search';
import {ReadableText} from '../src/renderer/src/components/ReadableText';

const fixture=(content:string):Task=>({id:'owner',title:'Orchard',goal:'',status:'active',createdAt:'time',updatedAt:'time',sources:[],artifacts:[{id:'notes',revisions:[{revision:1,digest:'saved-digest',title:'Notes',content,mimeType:'text/markdown',sourceRefs:[],createdAt:'time'}]}],requests:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false}});
const render=(text:string)=>renderToStaticMarkup(createElement(ReadableText,{text}));
test.each([
 ['srcset','Before.\n\n<img alt="Visible diagram" srcset="https://owned.example/a.png 1x, data:image/png;base64,hidden-srcset-payload 2x">\n\nAfter.','hidden-srcset-payload'],
 ['xlink:href','Before.\n\n<svg><image xlink:href="data&#58;image/svg+xml,hidden-xlink-payload"></image></svg>\n\nAfter.','hidden-xlink-payload'],
])('raw HTML %s is escaped in ReadableText while search omits image-resource values by policy',(_name,content,payload)=>{
 const html=render(content);expect(html).toContain(payload);expect(html).toContain('Before.');expect(html).toContain('After.');const task=fixture(content),before=JSON.stringify(task);expect(searchSavedWork([task],payload,'files')).toMatchObject({matchCount:0,searched:1,unavailable:0});expect(searchSavedWork([task],'Before.','files').matchCount).toBe(1);expect(JSON.stringify(task)).toBe(before);
});
test('a valid full nested data image stays hidden in ReadableText and a structurally uncertain cut is not searched',()=>{
 const content='![Nested diagram](data:image/svg+xml,%3Csvg%3E'+'('.repeat(20)+'hidden-nested-payload'+'x'.repeat(120_000)+')'.repeat(20)+'%3C/svg%3E)',html=render(content);expect(html).not.toContain('hidden-nested-payload');const task=fixture(content),before=JSON.stringify(task);expect(searchSavedWork([task],'hidden-nested-payload','files')).toMatchObject({matchCount:0,searched:0,partial:0,unavailable:0,unsearchedFiles:1});expect(JSON.stringify(task)).toBe(before);
});
test('oversized code and prose remain intact in the viewer and are explicitly unsearched',()=>{
 const code='~~~\n<img srcset="data:image/png;base64,visible-code-payload">\n<image xlink:href="data&#58;image/png;base64,visible-xlink-code">\n![Literal](data:image/svg+xml,visible-nested-code'+ '('.repeat(20)+'x'.repeat(120_000)+')'.repeat(20)+')\n~~~',html=render(code);
 for(const payload of ['visible-code-payload','visible-xlink-code','visible-nested-code']){expect(html).toContain(payload);expect(searchSavedWork([fixture(code)],payload,'files')).toMatchObject({matchCount:0,searched:0,partial:0,unavailable:0,unsearchedFiles:1});}
 const prose='Escaped prose: \\![Literal\\]\\(data:image/png;base64,visible-escaped-payload) '+'p'.repeat(120_000);expect(render(prose)).toContain('visible-escaped-payload');expect(searchSavedWork([fixture(prose)],'visible-escaped-payload','files')).toMatchObject({matchCount:0,searched:0,partial:0,unavailable:0,unsearchedFiles:1});
});
test('an uncertain angle destination or cut HTML resource value is explicitly unavailable without synthetic delimiters',()=>{
 for(const content of ['![Angle diagram](<d&#97;ta&colon;image/svg+xml,uncertain-angle-payload'+'x'.repeat(120_000)+'>)','<img srcset="data:image/png;base64,uncertain-attribute-payload'+'x'.repeat(120_000)+' 1x">']){
  const payload=content.includes('angle')?'uncertain-angle-payload':'uncertain-attribute-payload';expect(searchSavedWork([fixture(content)],payload,'files')).toMatchObject({matchCount:0,searched:0,partial:0,unavailable:0,unsearchedFiles:1});
 }
});
test('an oversized file is unsearched even if an early destination or label looks complete',()=>{
 const content='Before ![Complete diagram](data:image/png;base64,complete-image-payload) after.\n\n<img alt="Use ![syntax](data:image/png;base64,visible-alt-example)" src="https://owned.example/a.png">\n\n'+'p'.repeat(120_000),task=fixture(content);
 expect(searchSavedWork([task],'complete-image-payload','files')).toMatchObject({matchCount:0,searched:0,partial:0,unavailable:0,unsearchedFiles:1});for(const text of ['Complete diagram','Before','visible-alt-example'])expect(searchSavedWork([task],text,'files')).toMatchObject({matchCount:0,searched:0,partial:0,unavailable:0,unsearchedFiles:1});
});
