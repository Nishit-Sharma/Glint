import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test} from 'vitest';
import {ModuleView} from '../src/renderer/src/components/InteractiveModule';
import {helperExample} from '../src/learning/helper-example';
import {helperStudio} from '../src/learning/reusable-helper';
import {pickingHelper} from '../src/learning/picking-helper';
import {pickingExampleDefinition} from '../src/learning/picking-example';
test('ordinary blank helper offers a contextual picking entry without replacing text or record entry',()=>{
 const html=renderToStaticMarkup(createElement(ModuleView,{data:helperExample,state:helperStudio.initial(helperExample),onAction:()=>{}}));expect(html).toContain('Create a local picking manifest');expect(html).toContain('Create a local record helper');expect(html).toContain('Start demonstration');
});
test('registered v2 renderer exposes local typed authoring and keeps observation claims bounded',()=>{
 const html=renderToStaticMarkup(createElement(ModuleView,{data:helperExample,state:pickingHelper.initial(helperExample.id),onAction:()=>{}}));expect(html).toContain('Local picking manifest');expect(html).toContain('Start with a local example');expect(html).toContain('does not verify a physical human gesture');expect(html).not.toContain('textarea aria-label="JSON');expect(html).not.toContain('saved example needs review');
});
test('real React markup keeps every visible predicate choice bound to its operator token',()=>{
 const state=pickingHelper.update(helperExample.id,pickingHelper.initial(helperExample.id),{kind:'picking-candidate',definition:pickingExampleDefinition(),reason:'Review the declared predicate menus.',expectedRevision:0});
 const html=renderToStaticMarkup(createElement(ModuleView,{data:helperExample,state,onAction:()=>{}}));
 const menus=[...html.matchAll(/<label>Condition<select[^>]*>(.*?)<\/select><\/label>/g)].map(match=>[...match[1].matchAll(/<option([^>]*)>([^<]*)<\/option>/g)].map(option=>({value:option[1].match(/\bvalue="([^"]*)"/)?.[1]??option[2],label:option[2],selected:/\bselected(?:=|\s|$)/.test(option[1])})));
 const equality=[{value:'eq',label:'equals'},{value:'ne',label:'does not equal'}],numeric=[...equality,{value:'gt',label:'is greater than'},{value:'gte',label:'is at least'},{value:'lt',label:'is less than'},{value:'lte',label:'is at most'}];
 expect(menus).toHaveLength(5);expect(menus.map(menu=>menu.map(({value,label})=>({value,label})))).toEqual([equality,equality,numeric,equality,equality]);expect(menus.map(menu=>menu.filter(option=>option.selected).map(option=>option.value))).toEqual([['eq'],['eq'],['gt'],['eq'],['eq']]);
});

test('declared case tables identify columns and expose a keyboard reachable editing region',()=>{
 const state=pickingHelper.update(helperExample.id,pickingHelper.initial(helperExample.id),{kind:'picking-candidate',definition:pickingExampleDefinition(),reason:'Review declared table values.',expectedRevision:0});
 const html=renderToStaticMarkup(createElement(ModuleView,{data:helperExample,state,onAction:()=>{}}));
 const tables=[...html.matchAll(/<div class="learning-table picking-case-editor" role="region" aria-label="Editable values for case (\d+)" tabindex="0"><table><caption>Declared table for case \1<\/caption><thead>(.*?)<\/thead><tbody>(.*?)<\/tbody><\/table><\/div>/g)];
 expect(tables.length).toBeGreaterThan(0);
 for(const [,index,head,body] of tables){
  expect([...head.matchAll(/<th[^>]*scope="col"[^>]*>(.*?)<\/th>/g)].map(match=>match[1])).toEqual(['sku (string)','name (string)','stock (integer)','private (boolean)','Remove']);
  expect(body).toContain(`Case ${index} row 1 value 1 value type`);
  expect(body).toContain(`Case ${index} row 1 value 1`);
  expect(body).toContain('Remove case row 1');
 }
});
