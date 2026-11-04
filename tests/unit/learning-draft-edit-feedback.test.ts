import {expect,test} from 'vitest';
import {createElement,type ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {LearningDraftProvider,LearningDraftScope} from '../../src/renderer/src/learning-draft-context';
import {useNavigationForm,formSubmission} from '../../src/renderer/src/draft-navigation';
import {createLearningDrafts} from '../../src/renderer/src/learning-drafts';
const owner={taskId:'owned',artifactId:'answer',artifactRevision:1,artifactDigest:'digest',moduleId:'join',moduleVersion:1},slot='join:prediction:practice',initial={prediction:'',reasoning:''};
function setup(){const cache=createLearningDrafts({read:async()=>({kind:'available',epoch:'initial',records:[]}),save:async(owner,slot,epoch,revision,value)=>({kind:'saved',epoch,record:{owner,slot,revision:revision+1,value}})});let form:ReturnType<typeof useNavigationForm<typeof initial>>|undefined;
 function Editor(){form=useNavigationForm(initial,0,undefined,undefined,{slot,basisMode:'explicit',basis:'exact'});return createElement('div',{'data-held':form.held,'data-rejected':form.rejected},createElement('input',{value:form.draft.prediction,readOnly:true}),form.feedback);}
 const render=(child:ReactNode=createElement(Editor))=>renderToStaticMarkup(createElement(LearningDraftProvider,{cache,children:createElement(LearningDraftScope,{owner,children:child})}));return {cache,render,get form(){if(!form)throw Error('Render the form first');return form;}};
}
test('the actual scoped hook exposes a safe alert, keeps inputs editable, and blocks silent submission of accepted data',async()=>{
 const f=setup();await f.cache.load();f.render();expect(f.form.setDraft({prediction:'0',reasoning:'accepted'})).toEqual({kind:'accepted'});await f.cache.flush();expect(f.render()).toContain('Unapplied edits saved on this Mac');expect(f.form.setDraft({prediction:'0'.repeat(32769),reasoning:'private attempted text'})).toMatchObject({kind:'rejected',reason:'text-too-long'});
 const html=f.render();expect(html).toContain('role="alert"');expect(html).toContain('This change was not applied.');expect(html).toContain('last accepted value');expect(html).toContain('Use shown accepted values');expect(html).toContain('data-held="false"');expect(html).toContain('data-rejected="true"');expect(html).toContain('value="0"');expect(html).not.toContain('Unapplied edits saved on this Mac');expect(html).not.toContain('private attempted text');let sent=0;expect(f.form.submit(()=>{sent++;return formSubmission(1,Promise.resolve(true));})).toBe(false);await f.cache.flush();expect(sent).toBe(0);
 expect(f.form.setDraft({prediction:'1',reasoning:'corrected'})).toEqual({kind:'accepted'});await f.cache.flush();expect(f.render()).not.toContain('This change was not applied.');
});

test('an unsupported initial preparation is read-only feedback, while standalone memory forms make no new durable cap promise',async()=>{
 const f=setup();await f.cache.load();function Oversized(){const form=useNavigationForm({field:'0'.repeat(32769)},0,undefined,undefined,{slot:'owned-initial',basisMode:'explicit',basis:'exact'});return createElement('div',{'data-held':form.held},form.feedback);}
 const html=f.render(createElement(Oversized));expect(html).toContain('data-held="true"');expect(html).toContain('supported input limits');expect(html).toContain('Files');expect(f.cache.getSnapshot().entries).toEqual({});
 let memory:ReturnType<typeof useNavigationForm<{field:string}>>|undefined;function Standalone(){const form=useNavigationForm({field:'0'.repeat(32769)},0);memory=form;expect(form.held).toBe(false);return createElement('span',null,form.feedback);}
 expect(()=>renderToStaticMarkup(createElement(Standalone))).not.toThrow();expect(memory?.setDraft({field:'still memory'})).toEqual({kind:'accepted'});expect(f.cache.getSnapshot().entries).toEqual({});
});

test('a rejected edit during the hook’s pre-dispatch flush prevents the old accepted closure from being submitted',async()=>{
 let accept:()=>void=()=>{};const cache=createLearningDrafts({read:async()=>({kind:'available',epoch:'initial',records:[]}),save:(owner,slot,epoch,revision,value)=>new Promise(resolve=>{accept=()=>resolve({kind:'saved',epoch,record:{owner,slot,revision:revision+1,value}});})});await cache.load();let form:ReturnType<typeof useNavigationForm<typeof initial>>|undefined;
 function Editor(){form=useNavigationForm(initial,0,undefined,undefined,{slot,basisMode:'explicit',basis:'exact'});return null;}
 renderToStaticMarkup(createElement(LearningDraftProvider,{cache,children:createElement(LearningDraftScope,{owner,children:createElement(Editor)})}));if(!form)throw Error('Expected form');const active=form as ReturnType<typeof useNavigationForm<typeof initial>>;expect(active.setDraft({prediction:'0',reasoning:'accepted'})).toEqual({kind:'accepted'});await Promise.resolve();let sent=0;expect(active.submit(()=>{sent++;return formSubmission(1,Promise.resolve(true));})).toBe(true);expect(active.setDraft({prediction:'0'.repeat(32769),reasoning:''})).toMatchObject({kind:'rejected'});accept();await cache.flush();for(let i=0;i<10;i++)await Promise.resolve();expect(sent).toBe(0);expect(cache.getEditRejection(owner,slot)).toBeDefined();
});
