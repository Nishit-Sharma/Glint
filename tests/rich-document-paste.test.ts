import {expect,it,vi} from 'vitest';
import type {EditorOptions} from '@tiptap/core';
const capture=vi.hoisted(()=>({options:undefined as Partial<EditorOptions>|undefined}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('./controlled-renderer.fixture')).hooks}));
vi.mock('@tiptap/react',()=>({useEditor:(options:Partial<EditorOptions>)=>{capture.options=options;return null;},useEditorState:()=>undefined,EditorContent:()=>null}));
import {createElement} from 'react';
import {getSchema} from '@tiptap/core';
import {EditorState,TextSelection,type Transaction} from '@tiptap/pm/state';
import {Slice} from '@tiptap/pm/model';
import {createControlledRenderer} from './controlled-renderer.fixture';
import RichDocument from '../src/renderer/src/components/RichDocument';
const capturedOptions=():Partial<EditorOptions>|undefined=>capture.options;

for(const sample of [{name:'empty',pasted:'',expected:'Rsum 731.Résumé 東京731.'},{name:'Unicode',pasted:'Résumé 東京731.',expected:'Résumé 東京731.'}])it(`actual rich-document paste callback preserves selected content for ${sample.name} plain text`,()=>{
 const original='Rsum 731.Résumé 東京731.';capture.options=undefined;
 const renderer=createControlledRenderer(()=>createElement(RichDocument,{value:'# Paste check\n\n**'+original+'**',title:'Paste check',documentKey:'owned-paste-check',onChange:()=>{}}));renderer.render();
 const options=capturedOptions(),handler=options?.editorProps?.handlePaste;if(!options||typeof handler!=='function')throw Error('Actual RichDocument paste callback was not captured.');
 const schema=getSchema(options.extensions??[]),doc=schema.node('doc',null,[schema.node('paragraph',null,schema.text(original,[schema.marks.bold.create()]))]);let state=EditorState.create({doc,selection:TextSelection.create(doc,1,original.length+1)}),dispatches=0,prevented=false;
 const view={get state(){return state;},dispatch(transaction:Transaction){state=state.apply(transaction);dispatches++;}},event={preventDefault(){prevented=true;},clipboardData:{getData(format:string){expect(format).toBe('text/plain');return sample.pasted;}}};
 const before={text:state.doc.textContent,selection:state.doc.textBetween(state.selection.from,state.selection.to)},handled=Reflect.apply(handler,undefined,[view,event,Slice.empty]);
 const after={text:state.doc.textContent,selection:state.doc.textBetween(state.selection.from,state.selection.to),marks:state.doc.firstChild?.firstChild?.marks.map(mark=>mark.type.name)??[]};
 console.log(JSON.stringify({sample:sample.name,payload:sample.pasted,before,after,dispatches,prevented,handled}));
 expect.soft(after.text).toBe(sample.expected);expect.soft(after.marks).toEqual(['bold']);expect(prevented).toBe(true);expect(handled).toBe(true);
 if(!sample.pasted){expect(after.selection).toBe(original);expect(dispatches).toBe(0);}else{expect(state.selection.empty).toBe(true);expect(dispatches).toBe(1);}
});
