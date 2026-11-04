import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test} from 'vitest';
import {exampleLesson} from '../src/learning/example';
import {joinLab,type JoinCase} from '../src/learning/join-lab';
import {JoinLab} from '../src/renderer/src/components/JoinLab';
import {JoinRewriteCheck} from '../src/renderer/src/components/JoinRewriteCheck';

const checked=(practice:JoinCase=exampleLesson.practice)=>{
 const data=joinLab.parse({...exampleLesson,practice});
 return {data,state:joinLab.update(data,joinLab.initial(data),{kind:'predict',count:0,reasoning:'Declared first prediction.',expectedRevision:0})};
};
test('applied data gives an exact counterexample without changing source, prediction or state',()=>{
 const {data,state}=checked(),before=JSON.stringify({data,state});
 const result=joinLab.compareRewrite(data,state,{...state.practice.join,mode:'LEFT'});
 expect(result).toMatchObject({origin:'deterministic',revision:1,checkedCases:1,witness:{change:{kind:'current'},original:{rowCount:2},rewritten:{rowCount:4}}});
 expect(result.witness?.rewritten.rows.filter(row=>row.kind==='left-unmatched').map(row=>row.provenance.leftRowId)).toEqual(['practice-b','practice-null']);
 expect(JSON.stringify({data,state})).toBe(before);
 expect(joinLab.compareRewrite(data,joinLab.parseState(data,JSON.parse(JSON.stringify(state))),result.proposed)).toEqual(result);
});
test('search finds a distinguishing case even when current INNER and LEFT outputs agree',()=>{
 const {data,state}=checked({...exampleLesson.practice,left:{...exampleLesson.practice.left,rows:[exampleLesson.practice.left.rows[0]]}});
 const result=joinLab.compareRewrite(data,state,{...state.practice.join,mode:'LEFT'});
 expect(result.checkedCases).toBe(3);
 expect(result.witness).toMatchObject({change:{kind:'empty',side:'right'},original:{rowCount:0},rewritten:{rowCount:1}});
});
test('equal row counts are insufficient: compare full values, including duplicate multiplicity',()=>{
 const {data,state}=checked({...exampleLesson.practice,left:{...exampleLesson.practice.left,rows:[{id:'left-row',values:['x','y']}]},right:{...exampleLesson.practice.right,rows:[{id:'right-one',values:['x','z']},{id:'right-two',values:['z','y']}]}});
 const result=joinLab.compareRewrite(data,state,{mode:'INNER',leftColumnId:'p-alt',rightColumnId:'p-ralt'});
 expect(result.witness).toMatchObject({change:{kind:'current'},original:{rowCount:1},rewritten:{rowCount:1}});
 expect(result.witness?.original.rows[0].rightValues).toEqual(['x','z']);
 expect(result.witness?.rewritten.rows[0].rightValues).toEqual(['z','y']);
});
test('one-cell substitution exposes a hidden key rewrite and preserves every other cell',()=>{
 const {data,state}=checked({...exampleLesson.practice,left:{...exampleLesson.practice.left,rows:[{id:'left-row',values:['x','x']}]},right:{...exampleLesson.practice.right,rows:[{id:'right-row',values:['x','x']}]}});
 const result=joinLab.compareRewrite(data,state,{mode:'INNER',leftColumnId:'p-alt',rightColumnId:'p-ralt'});
 expect(result.witness).toMatchObject({change:{kind:'cell',side:'left',rowId:'left-row',columnId:'p-key',before:'x',after:null},original:{rowCount:0},rewritten:{rowCount:1}});
 expect(result.witness?.problem.left.rows[0].values).toEqual([null,'x']);
 expect(result.witness?.problem.right).toEqual(data.practice.right);
});
test('same condition exhausts a finite search without claiming proof or coercing literal NULL',()=>{
 const {data,state}=checked({...exampleLesson.practice,left:{...exampleLesson.practice.left,rows:[{id:'left-row',values:['NULL','red']}]},right:{...exampleLesson.practice.right,rows:[{id:'right-row',values:['NULL','red']}]}});
 const result=joinLab.compareRewrite(data,state,state.practice.join);
 expect(result).toMatchObject({checkedCases:5,witness:null});
 expect(result.bounds).toContain('No new rows, new values, combined edits');
 expect(joinLab.observe(data,state).observation?.rowCount).toBe(1);
});
test('the declared 12-row input bound keeps exhaustive same-condition work finite',()=>{
 const {data,state}=checked({...exampleLesson.practice,left:{...exampleLesson.practice.left,rows:Array.from({length:12},(_,i)=>({id:'l-'+i,values:['left-'+i,'red']}))},right:{...exampleLesson.practice.right,rows:Array.from({length:12},(_,i)=>({id:'r-'+i,values:['right-'+i,'blue']}))}});
 expect(joinLab.compareRewrite(data,state,state.practice.join)).toMatchObject({checkedCases:579,witness:null});
});
test.each([false,true])('exact boolean and integer keys work without changing their type (%s)',boolean=>{
 const type=boolean?'boolean' as const:'integer' as const,value=boolean?false:0;
 const {data,state}=checked({...exampleLesson.practice,left:{...exampleLesson.practice.left,columns:[{id:'p-key',label:'Key',type}],rows:[{id:'left-row',values:[value]}]},right:{...exampleLesson.practice.right,columns:[{id:'p-rkey',label:'Key',type}],rows:[{id:'right-row',values:[value]}]}});
 expect(joinLab.compareRewrite(data,state,state.practice.join).witness).toBeNull();
 expect(joinLab.observe(data,state).observation?.rowCount).toBe(1);
});
test('comparison rejects invalid keys, unknown fields, changed source and unrevealed answers',()=>{
 const {data,state}=checked();
 expect(()=>joinLab.compareRewrite(data,joinLab.initial(data),state.practice.join)).toThrow(/prediction/);
 expect(()=>joinLab.compareRewrite(data,state,{...state.practice.join,leftColumnId:'missing'})).toThrow(/existing columns/);
 expect(()=>joinLab.compareRewrite(data,state,{...state.practice.join,sql:'arbitrary code'})).toThrow();
 expect(()=>joinLab.compareRewrite({...data,source:{...data.source,digest:'changed'}},state,state.practice.join)).toThrow(/another lesson/);
 const wrong=checked({...exampleLesson.practice,left:{...exampleLesson.practice.left,columns:[{id:'p-key',label:'Key',type:'integer'}],rows:[{id:'left-row',values:[1]}]},right:{...exampleLesson.practice.right,columns:[{id:'p-rkey',label:'Key',type:'integer'},{id:'p-ralt',label:'Other',type:'string'}],rows:[{id:'right-row',values:[1,'1']}]}});
 expect(()=>joinLab.compareRewrite(wrong.data,wrong.state,{...wrong.state.practice.join,rightColumnId:'p-ralt'})).toThrow(/same declared type/);
});
test('renderer offers the bounded inspection only after a checked answer and dispatches no actions',()=>{
 const {data,state}=checked(),actions:unknown[]=[];
 expect(renderToStaticMarkup(createElement(JoinRewriteCheck,{data,state:joinLab.initial(data)}))).toBe('');
 const html=renderToStaticMarkup(createElement(JoinLab,{data,state,onAction:action=>{actions.push(action);}}));
 expect(html).toContain('Check a join rewrite');expect(html).toContain('Search bounded cases');
 expect(html).toContain('This inspection is unsaved.');expect(html).toContain('No new rows, new values, combined edits');expect(actions).toEqual([]);
});
