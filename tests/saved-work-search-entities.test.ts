import {expect,test} from 'vitest';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import {defaultRehypePlugins} from 'streamdown';
import type {Task} from '../src/core/types';
import {searchSavedWork} from '../src/shared/saved-work-search';

const fixture=(content:string):Task=>({id:'owner',title:'Orchard',goal:'',status:'active',createdAt:'time',updatedAt:'time',sources:[],artifacts:[{id:'notes',revisions:[{revision:1,digest:'saved-digest',title:'Diagram notes',content,mimeType:'text/markdown',sourceRefs:[],createdAt:'time'}]}],requests:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false}});
type Node={type:string;tagName?:string;properties?:Record<string,unknown>;value?:string;children?:Node[]};
const flatten=(node:Node):Node[]=>[node,...(node.children??[]).flatMap(flatten)];
const processor=unified().use(remarkParse).use(remarkRehype).use([defaultRehypePlugins.sanitize]);

test.each(['data&#58;image/png','d&#97;ta:image/png','&#100;ata&#x3A;image&sol;png','data&colon;image/png','data&Tab;:image/png','DATA:IMAGE/png'])('encoded image destination %s is hidden by the installed display sanitizer and excluded from local search',async prefix=>{
 const content=`Before ![Visible diagram](${prefix};base64,encoded-image-payload) after.`,tree=await processor.run(processor.parse(content)),image=flatten(tree as Node).find(node=>node.tagName==='img');expect(image?.properties).toEqual({alt:'Visible diagram'});
 const task=fixture(content),before=JSON.stringify(task),result=searchSavedWork([task],'encoded-image-payload','files');expect(result).toMatchObject({matchCount:0,searched:1,unavailable:0});const shown=searchSavedWork([task],'Visible diagram','files');expect(shown.matchCount).toBe(1);expect(shown.matches[0].excerpt).toBe('Before ![Visible diagram]() after.');expect(JSON.stringify(task)).toBe(before);
});
test('entity-encoded reference and HTML image destinations are omitted while authored labels and adjacent text stay searchable',()=>{
 const task=fixture('Before ![Reference label][diagram] after.\n\n[diagram]: d&#97;ta&colon;image&sol;png;base64,reference-image-payload\n\n<img alt="HTML label" src="data&#58;image/png;base64,html-image-payload">\n');
 expect(searchSavedWork([task],'reference-image-payload','files')).toMatchObject({matchCount:0,searched:1,unavailable:0});expect(searchSavedWork([task],'html-image-payload','files').matchCount).toBe(0);expect(searchSavedWork([task],'Reference label','files').matchCount).toBe(1);expect(searchSavedWork([task],'HTML label','files').matchCount).toBe(1);expect(searchSavedWork([task],'Before','files').matches[0].excerpt).not.toContain('image-payload');
});
test('literal code, ordinary text and a once-decoded visible relative destination are preserved',async()=>{
 const literal='`![Literal](data&#58;image/png;base64,visible-code)`\n\n~~~\n![Example](d&#97;ta:image/png;base64,visible-fence)\n~~~\n\nAn ordinary note: data&#58;image/png;base64,visible-note.';
 for(const word of ['visible-code','visible-fence','visible-note'])expect(searchSavedWork([fixture(literal)],word,'files').matchCount).toBe(1);
 const content='![Visible relative URI](data&amp;colon;image/png;base64,visible-relative-uri)',tree=await processor.run(processor.parse(content)),image=flatten(tree as Node).find(node=>node.tagName==='img');expect(image?.properties?.src).toBe('data&colon;image/png;base64,visible-relative-uri');expect(searchSavedWork([fixture(content)],'visible-relative-uri','files').matchCount).toBe(1);
});

test('non-entities retain their literal visible destination instead of being decoded speculatively',async()=>{
 for(const prefix of ['data&#x3aimage/png','data&#000000058;image/png','data&#x000003a;image/png','data&Colon;image/png']){
  const destination=prefix+';base64,literal-uri-payload',content=`![Literal URI](${destination})`,tree=await processor.run(processor.parse(content)),image=flatten(tree as Node).find(node=>node.tagName==='img');expect(image?.properties?.src).toBe(prefix==='data&Colon;image/png'?'data%E2%88%B7image/png;base64,literal-uri-payload':destination);expect(searchSavedWork([fixture(content)],'literal-uri-payload','files').matchCount).toBe(1);
 }
});
