import {expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('../support/controlled-renderer.fixture')).hooks}));
vi.mock('lucide-react',()=>({Layers:()=>null}));
import {createElement} from 'react';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import type {Task,Source,SourceVersion} from '../../src/core/types';
import {createComposerDrafts} from '../../src/renderer/src/composer-drafts';
import {TaskWelcome,welcomeStarters} from '../../src/renderer/src/components/TaskWelcome';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';

const version=(label:string):SourceVersion=>({id:'shelf',kind:'text',role:'fact',content:'Private body never belongs in a starter',label,version:1,digest:'1'.repeat(64),capturedAt:'2026-11-04T00:00:00.000Z'});
const source=(changes:Partial<Source>={}):Source=>({id:'shelf',currentVersion:1,versions:[version('Shelf note')],freshness:'fresh',...changes});
function task(changes:Partial<Task>={}):Task{return {id:'welcome-task',title:'Shelf note',goal:'',status:'active',createdAt:'2026-11-04T00:00:00.000Z',updatedAt:'2026-11-04T00:00:00.000Z',sources:[source()],artifacts:[],requests:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false},session:{revision:1,draft:'',draftRevision:1,draftKind:'explain',runs:[],moduleStates:[]},...changes};}
type Host=ReturnType<ReturnType<typeof createControlledRenderer>['nodes']>[number];
const text=(node:Host):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');

/** The actual App wiring: TaskWelcome's onDraft expression and App's editPrompt, bound to a real draft cache. */
const app=ts.createSourceFile('App.tsx',readFileSync(new URL('../../src/renderer/src/App.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const js=(source:string)=>ts.transpileModule('('+source+')',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
function find<T extends ts.Node>(test:(node:ts.Node)=>node is T){let found:T|undefined;const visit=(node:ts.Node)=>{if(!found&&test(node))found=node;ts.forEachChild(node,visit);};visit(app);if(!found)throw Error('Actual App wiring unavailable');return found;}
const welcome=find((node):node is ts.JsxSelfClosingElement=>ts.isJsxSelfClosingElement(node)&&node.tagName.getText(app)==='TaskWelcome');
const attribute=(name:string)=>{const item=welcome.attributes.properties.find((property):property is ts.JsxAttribute=>ts.isJsxAttribute(property)&&property.name.getText(app)===name);if(!item?.initializer||!ts.isJsxExpression(item.initializer)||!item.initializer.expression)throw Error('Missing TaskWelcome '+name);return item.initializer.expression.getText(app);};
const editPromptSource=find((node):node is ts.FunctionDeclaration=>ts.isFunctionDeclaration(node)&&node.name?.text==='editPrompt').getText(app);

function harness(initial=task(),disabled=false){
 const saved:Array<{text:string}>=[],invoke=vi.fn();
 vi.stubGlobal('window',{companion:{invoke}});
 const drafts=createComposerDrafts(async(_id,revision,value)=>{saved.push({text:value.text});return {...value,revision:revision+1};});drafts.hydrate([initial]);
 const editPrompt=Function('task','drafts','return '+js(editPromptSource))(initial,drafts);
 const onDraft=Function('editPrompt','return '+js(attribute('onDraft')))(editPrompt) as (text:string)=>void;
 const onReview=vi.fn();
 const renderer=createControlledRenderer(()=>createElement(TaskWelcome,{task:initial,name:'Pip',portrait:createElement('span',{className:'portrait'}),draft:drafts.getSnapshot()[initial.id]?.text??'',disabled,onDraft,onReview}));
 renderer.render();
 const buttons=()=>renderer.nodes().filter(node=>node.type==='button');
 return {renderer,drafts,saved,invoke,onReview,buttons,draft:()=>drafts.getSnapshot()[initial.id]?.text};
}

test('a task with a saved source and no answers greets with the companion, a source chip and starters',()=>{
 const h=harness(),all=text(h.renderer.nodes()[0]);
 expect(all).toContain('Hi, I’m Pip.');expect(h.renderer.find(node=>node.props.className==='portrait').type).toBe('span');
 expect(text(h.renderer.find(node=>node.type==='h2'))).toBe('Added to this task');
 expect(text(h.renderer.find(node=>node.props.className==='task-welcome-source-text'))).toBe('Using: Shelf note');
 const review=h.buttons().find(node=>text(node)==='Review')!;expect(review.props['aria-label']).toBe('Review what you added');review.props.onClick();expect(h.onReview).toHaveBeenCalledWith({sourceId:'shelf',version:1,digest:'1'.repeat(64)});
 const group=h.renderer.find(node=>node.props.role==='group');expect(group.props['aria-label']).toBe('Suggested questions');expect(group.children.map(text)).toEqual(welcomeStarters(task()));expect(group.children).toHaveLength(3);
 expect(all).not.toContain('Private body');
});

test('starters only fill the composer: nothing is sent, and existing text is kept',async()=>{
 const h=harness(),[first,second]=welcomeStarters(task());
 h.buttons().find(node=>text(node)===first)!.props.onClick();
 expect(h.draft()).toBe(first);
 h.renderer.render();h.buttons().find(node=>text(node)===second)!.props.onClick();
 expect(h.draft()).toBe(first+'\n'+second);
 await h.drafts.flush(task().id);
 expect(h.invoke).not.toHaveBeenCalled();
 expect(h.saved.every(entry=>entry.text===first||entry.text===first+'\n'+second)).toBe(true);
 vi.unstubAllGlobals();
});

test('a disabled task keeps its draft when a starter is pressed',()=>{
 const h=harness(task(),true),[first]=welcomeStarters(task());
 const button=h.buttons().find(node=>text(node)===first)!;expect(button.props.disabled).toBe(true);button.props.onClick();
 expect(h.draft()).toBe('');vi.unstubAllGlobals();
});

test('the greeting is gone once the task has an answer or saved output',()=>{
 const answered=task({requests:[{id:'r1',kind:'explain',prompt:'Summarize',status:'completed',createdAt:'2026-11-04T00:00:00.000Z',updatedAt:'2026-11-04T00:00:00.000Z'} as unknown as Task['requests'][number]]});
 expect(harness(answered).renderer.nodes()).toHaveLength(0);
 const withArtifact=task({artifacts:[{id:'a1'} as unknown as Task['artifacts'][number]]});
 expect(harness(withArtifact).renderer.nodes()).toHaveLength(0);
 vi.unstubAllGlobals();
});

test('stale and multiple sources keep their honest summaries in the chip',()=>{
 const stale=harness(task({sources:[source({freshness:'refresh-required'})]}));
 expect(text(stale.renderer.find(node=>node.type==='h2'))).toBe('Earlier copy saved');
 expect(text(stale.renderer.find(node=>node.props.className==='task-welcome-source-text'))).toBe('Earlier copy: Shelf note · It may have changed. Check it before using it again.');
 expect(stale.buttons().find(node=>text(node)==='Review')!.props['aria-label']).toBe('Review earlier copy');
 const many=harness(task({sources:[source(),source({id:'second',versions:[{...version('Second'),id:'second'}]})]}));
 expect(text(many.renderer.find(node=>node.type==='h2'))).toBe('What you added');
 expect(text(many.renderer.find(node=>node.props.className==='task-welcome-source-text'))).toBe('2 items added.');
 expect(many.buttons().find(node=>text(node)==='Review')!.props['aria-label']).toBe('Review what you added');
 vi.unstubAllGlobals();
});
