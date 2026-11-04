import {afterEach,expect,test,vi} from 'vitest';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import ts from 'typescript';
import {createHash} from 'node:crypto';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('../support/controlled-renderer.fixture')).hooks}));
import {createElement,useState,useEffect} from 'react';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';
import {DraftNavigationProvider,useDraftNavigation,useGuardedAction} from '../../src/renderer/src/draft-navigation';
import {ResponsePreferencesEditor} from '../../src/renderer/src/ResponsePreferencesEditor';
import {Button,Field} from '../../src/renderer/src/ui';

// The established AST seam executes the exact current SettingsView function.
// React scheduling/DOM, IPC and unrelated preference panes are substituted.
async function settingsView(){
 const source=await readFile('src/renderer/src/App.tsx','utf8'),file=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),node=file.statements.find((value):value is ts.FunctionDeclaration=>ts.isFunctionDeclaration(value)&&value.name?.text==='SettingsView');if(!node)throw Error('Actual SettingsView missing');
 const body=node.getText(file),environment={React:{Fragment:Symbol.for('react.fragment')},createElement,ContentBackup:()=>null,TaskResumeSuggestionSettings:()=>null,LocalResearchSuggestionSettings:()=>null,useState,useEffect,useGuardedAction,ResponsePreferencesEditor,Button,Field,AppearanceEditor:()=>null,CapturePrivacySettings:()=>null,DeveloperDetails:()=>null,publicErrorMessage:()=>'',connectionIssueMessage:()=>''},code=ts.transpileModule(body+'\nreturn SettingsView;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React,jsxFactory:'createElement'}}).outputText;
 return {View:new Function(...Object.keys(environment),code)(...Object.values(environment)) as (props:any)=>ReturnType<typeof createElement>,sourceSha256:createHash('sha256').update(source).digest('hex'),bodySha256:createHash('sha256').update(body).digest('hex')};
}
async function settle(){for(let i=0;i<8;i++)await Promise.resolve();}
afterEach(()=>vi.unstubAllGlobals());
test('active Responses click keeps its exact dirty form registered for the next guarded navigation',async()=>{
 const actual=await settingsView(),invoke=vi.fn(async()=>({kind:'available',current:{revision:0,enabled:false,text:''}}));vi.stubGlobal('window',{companion:{invoke}});let navigation!:ReturnType<typeof useDraftNavigation>;
 function Harness(){navigation=useDraftNavigation();return createElement(DraftNavigationProvider,{value:navigation.api,children:createElement(actual.View,{busy:false,run:vi.fn(),onRefresh:async()=>{},back:vi.fn()})});}
 const r=createControlledRenderer(()=>createElement(Harness)),tab=(area:string)=>r.find(node=>node.props.id==='preference-tab-'+area);r.render();tab('responses').props.onClick();r.render();await settle();r.render();r.find(node=>node.type==='textarea').props.onChange({target:{value:'Exact unsaved tone\nKeep this edit'}});r.render();expect(navigation.api.hasDirty()).toBe(true);
 tab('responses').props.onClick();r.render();const sameAreaReview=navigation.review;if(sameAreaReview){sameAreaReview.props.onLeave();r.render();}
 const stillRegistered=navigation.api.hasDirty(),sameText=r.find(node=>node.type==='textarea').props.value;tab('connection').props.onClick();r.render();const subsequentReview=!!navigation.review;
 await mkdir('evidence',{recursive:true});await writeFile('evidence/navigation-click-witness.json',JSON.stringify({boundary:'Actual SettingsView AST/function, response form and navigation registry; controlled React scheduling/DOM and preference IPC. No browser execution.',...actual,View:undefined,sameAreaReview:!!sameAreaReview,stillRegistered,sameText,subsequentReview},null,2));
 expect.soft(sameAreaReview).toBeNull();expect.soft(stillRegistered).toBe(true);expect.soft(subsequentReview).toBe(true);if(navigation.review){navigation.review.props.onKeep();r.render();expect(r.find(node=>node.type==='textarea').props.value).toBe('Exact unsaved tone\nKeep this edit');tab('connection').props.onClick();r.render();expect(navigation.review).not.toBeNull();navigation.review!.props.onLeave();r.render();expect(tab('connection').props['aria-selected']).toBe(true);expect(navigation.api.hasDirty()).toBe(false);}
});
test.each([['connection','Home'],['storage','End']] as const)('same-area keyboard %s/%s keeps the owned dirty guard for subsequent navigation',async(area,key)=>{
 const actual=await settingsView(),focus=vi.fn();vi.stubGlobal('document',{getElementById:()=>({focus})});let navigation!:ReturnType<typeof useDraftNavigation>;
 function Harness(){navigation=useDraftNavigation();return createElement(DraftNavigationProvider,{value:navigation.api,children:createElement(actual.View,{busy:false,run:vi.fn(),onRefresh:async()=>{},back:vi.fn()})});}
 const r=createControlledRenderer(()=>createElement(Harness)),tab=(name:string)=>r.find(node=>node.props.id==='preference-tab-'+name);r.render();if(area!=='connection'){tab(area).props.onClick();r.render();}const owner=Symbol('owned dirty editor');navigation.api.register(owner,true);const preventDefault=vi.fn();tab(area).props.onKeyDown({key,preventDefault});r.render();const sameAreaReview=navigation.review;if(sameAreaReview){sameAreaReview.props.onLeave();r.render();}const stillRegistered=navigation.api.hasDirty();tab(area==='storage'?'connection':'storage').props.onClick();r.render();
 await mkdir('evidence',{recursive:true});await writeFile('evidence/navigation-keyboard-'+key+'-witness.json',JSON.stringify({boundary:'Actual SettingsView and navigation registry; controlled key event/DOM. A still-mounted owned dirty editor token supplies the dirty context on Connection/Storage.',sourceSha256:actual.sourceSha256,bodySha256:actual.bodySha256,sameAreaReview:!!sameAreaReview,stillRegistered,subsequentReview:!!navigation.review},null,2));
 expect(preventDefault).toHaveBeenCalledOnce();expect.soft(sameAreaReview).toBeNull();expect.soft(stillRegistered).toBe(true);expect.soft(navigation.review).not.toBeNull();if(navigation.review){navigation.review.props.onKeep();r.render();expect(tab(area).props['aria-selected']).toBe(true);expect(navigation.api.hasDirty()).toBe(true);}
});
