import {expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...((await import('./controlled-renderer.fixture')).hooks)}));
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {helperStudio} from '../src/learning/reusable-helper';
import {helperExample} from '../src/learning/helper-example';
import type {SavedHelperEntry} from '../src/shared/saved-helpers';
import {TextHelperActivity} from '../src/renderer/src/components/TextHelperActivity';
import {SavedHelpers} from '../src/renderer/src/components/SavedHelpers';
import {createControlledRenderer} from './controlled-renderer.fixture';

test('read-only history shows newest revisions, exact text/empty outcomes and saved-version identity without reconstructing legacy runs',()=>{
 let state=helperStudio.initial(helperExample);const act=(action:Record<string,unknown>)=>{state=helperStudio.update(helperExample,state,{...action,expectedRevision:state.revision});};
 act({kind:'append-operation',operation:{kind:'trim'}});act({kind:'add-test',test:{id:'plain',label:'Trim',role:'example',input:' A ',expected:{kind:'output',text:'A'}}});act({kind:'add-test',test:{id:'empty',label:'Empty',role:'counterexample',input:'',expected:{kind:'output',text:''}}});act({kind:'save-version',changeNote:'Trim'});act({kind:'activate-version',version:1});act({kind:'run-active',input:'  <tag>日本語</tag>\n  '});const first=state.revision;act({kind:'run-active',input:'   '});const second=state.revision;act({kind:'set-details',name:'UNSAVED_DRAFT_NAME',description:state.draft.description,invocation:state.draft.invocation});
 const r=createControlledRenderer(()=>createElement(TextHelperActivity,{state}));r.render();const text=(node:ReturnType<typeof r.find>):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
 expect(r.nodes().filter(node=>node.type==='summary').map(text)).toEqual([`Run at helper revision ${second} · version 1`,`Run at helper revision ${first} · version 1`]);expect(text(r.find(node=>node.props['aria-label']===`Run ${first} exact input`))).toBe('  <tag>日本語</tag>\n  ');expect(text(r.find(node=>node.props['aria-label']===`Run ${second} saved output`))).toBe('');expect(r.nodes().some(node=>node.type==='button'||node.type==='input'||node.type==='textarea'||node.type==='form')).toBe(false);
 const html=renderToStaticMarkup(createElement(TextHelperActivity,{state}));expect(html).toContain('&lt;tag&gt;日本語&lt;/tag&gt;');expect(html).not.toContain('<tag>');expect(html).not.toContain('UNSAVED_DRAFT_NAME');expect(html).toContain('version 1 saved at helper revision 4');
 const {runActivity:_omitted,...legacy}=state,old=renderToStaticMarkup(createElement(TextHelperActivity,{state:legacy}));expect(old).toContain('No recorded run activity');expect(old).toContain('does not mean the helper was never used');expect(old).not.toContain('Run at helper revision');
});

test('Saved helpers discovers only validated recorded-text metadata and distinguishes filter-empty from no helpers',()=>{
 const entry=(name:string,activity?:SavedHelperEntry['textRunActivity']):SavedHelperEntry=>({taskId:'task-'+name,taskTitle:'Owned QA',artifactId:'artifact-'+name,artifactRevision:1,artifactDigest:'digest-'+name,moduleId:'module-'+name,helperId:name,stateRevision:12,name,description:'Local helper',invocation:'Find '+name,version:1,activeVersion:1,savedVersionCount:2,example:undefined,...(activity?{textRunActivity:activity}:{})});
 const recorded=entry('Recorded QA',{retainedCount:2,startedAtRevision:10,latest:{atRevision:12,version:1}}),legacy=entry('Legacy QA',{retainedCount:0}),other=entry('Other helper');let entries=[recorded,legacy,other];const open=vi.fn();
 const r=createControlledRenderer(()=>createElement(SavedHelpers,{entries,pending:false,onOpen:open,onRefresh:()=>{}}));r.render();const text=(node:ReturnType<typeof r.find>):string=>node.type==='#text'?node.props.text:node.children.map(text).join(''),content=()=>r.nodes().filter(node=>node.type==='#text').map(node=>node.props.text).join('');expect(r.nodes().filter(node=>node.type==='article')).toHaveLength(3);expect(content()).toContain('2 retained text-run records');expect(content()).toContain('Earlier activity is unavailable');expect(content()).toContain('not recorded here for this helper type');
 r.find(node=>node.type==='select').props.onChange({target:{value:'activity'}});r.render();expect(r.nodes().filter(node=>node.type==='article')).toHaveLength(1);r.find(node=>node.type==='button'&&text(node)==='Open helper').props.onClick();expect(open).toHaveBeenCalledWith(recorded);expect(content()).not.toContain('Legacy QA');
 entries=[legacy,other];r.render();expect(content()).toContain('No helpers match the recorded text-run filter');expect(content()).not.toContain('No saved helpers yet');entries=[];r.render();expect(content()).toContain('No saved helpers yet');
});
