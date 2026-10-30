import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test} from 'vitest';
import {ModuleView} from '../src/renderer/src/components/InteractiveModule';
import {documentRecipe} from '../src/learning/document-recipe';
import {parseModule} from '../src/core/interactive-modules';

test('the real installed view exposes a local demonstration entry and accurately limits its recording scope',()=>{
 const data=parseModule({kind:'document-recipe',schemaVersion:1,id:'recipe',title:'Document recipe'}),html=renderToStaticMarkup(createElement(ModuleView,{data,state:documentRecipe.initial(),onAction:()=>{throw Error('Rendering must never dispatch.');}}));
 expect(html).toContain('Start local document demonstration');expect(html).toContain('does not watch your screen');expect(html).toContain('Demonstration notes');expect(html).not.toContain('Save reviewed new document');expect(html).not.toContain('Preview selected notes locally');
});

test('authored names and local action results remain inert text in the actual renderer',()=>{
 let state=documentRecipe.initial();for(const action of [{kind:'document-recipe-start',name:'<img src=x onerror=alert(1)>',intent:'Local text only.',input:'Owner: <script>not run</script>'},{kind:'document-recipe-add',step:{kind:'field',name:'Owner'}}])state=documentRecipe.update(state,{...action,expectedRevision:state.revision});
 const data=parseModule({kind:'document-recipe',schemaVersion:1,id:'recipe',title:'Document recipe'}),html=renderToStaticMarkup(createElement(ModuleView,{data,state,onAction:()=>{throw Error('Rendering must never dispatch.');}}));expect(html).not.toContain('<script>');expect(html).not.toContain('<img src=x');expect(html).toContain('&lt;script&gt;');expect(html).toContain('Demonstration document');
});
