import {expect,test} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {JoinLab} from '../src/renderer/src/components/JoinLab';
import {joinLab,describeLastJoinChange} from '../src/learning/join-lab';
import {exampleLesson} from '../src/learning/example';

test('two applied changes distinguish cumulative reviewed practice4→4 from the actual last edit5→4',()=>{
 const data=joinLab.parse({...exampleLesson,practice:{...exampleLesson.practice,left:{...exampleLesson.practice.left,rows:exampleLesson.practice.left.rows.map(row=>row.id==='practice-b'?{...row,values:['x','blue']}:row)}}});
 let state=joinLab.initial(data);
 state=joinLab.update(data,state,{kind:'predict',count:4,reasoning:'Both x members match both x invitations.',expectedRevision:0});
 state=joinLab.update(data,state,{kind:'set-mode',mode:'LEFT',expectedRevision:1});
 state=joinLab.update(data,state,{kind:'predict',count:4,reasoning:'I forgot the unmatched NULL-key member.',expectedRevision:2});
 expect(joinLab.observe(data,state).observation?.rowCount).toBe(5);
 state=joinLab.update(data,state,{kind:'edit-row',side:'left',rowId:'practice-b',values:['y','blue'],expectedRevision:3});
 expect(joinLab.observe(data,state).observation).toBeNull();
 state=joinLab.update(data,state,{kind:'predict',count:5,reasoning:'I expect no change.',expectedRevision:4});
 const view=joinLab.observe(data,state);
 expect(view.change).toMatchObject({originalCount:4,currentCount:4});
 expect(view).toHaveProperty('lastChange',{
  beforeCount:5,afterCount:4,
  addedPairIds:['practice-b:@unmatched'],removedPairIds:['practice-b:practice-r1','practice-b:practice-r2'],changedPairIds:[],
  edits:[{kind:'cell',side:'left',rowId:'practice-b',columnId:'p-key',before:'x',after:'y'}],
  rows:[{leftRowId:'practice-b',before:{key:'x',matchingRightRowIds:['practice-r1','practice-r2'],outputCount:2,reason:'matches'},after:{key:'y',matchingRightRowIds:[],outputCount:1,reason:'no-match'}}],
 });
 expect(data.practice.left.rows[1].values).toEqual(['x','blue']);
});

function reviewedData(){return joinLab.parse({...exampleLesson,practice:{...exampleLesson.practice,left:{...exampleLesson.practice.left,rows:exampleLesson.practice.left.rows.map(row=>row.id==='practice-b'?{...row,values:['x','blue']}:row)}}});}
function finalPractice(){const data=reviewedData();let state=joinLab.initial(data);for(const action of [{kind:'predict',count:4,reasoning:'Both duplicates.'},{kind:'set-mode',mode:'LEFT'},{kind:'predict',count:4,reasoning:'Forgot NULL.'},{kind:'edit-row',side:'left',rowId:'practice-b',values:['y','blue']},{kind:'predict',count:5,reasoning:'Forgot the changed member.'}])state=joinLab.update(data,state,{...action,expectedRevision:state.revision});return {data,state};}
test('last comparison stays hidden before the new prediction and carries only known practice into the distinct transfer',()=>{
 const {data,state}=finalPractice();const before=JSON.stringify({data,state});let transfer=joinLab.update(data,state,{kind:'start-transfer',expectedRevision:state.revision});let view=joinLab.observe(data,transfer);
 expect(view.lastChange).toBeNull();expect(view.observation).toBeNull();expect(view.assessment).toBeNull();expect(view.practiceReview?.lastChange).toMatchObject({beforeCount:5,afterCount:4});
 const text=joinLab.text(data,transfer);expect(text).toContain('Last applied practice change: 5 → 4');expect(text).not.toContain('transfer-a:transfer-r1');expect(text).not.toContain('6 output rows');
 transfer=joinLab.update(data,transfer,{kind:'predict',count:5,reasoning:'First unseen answer remains five.',expectedRevision:transfer.revision});const restored=joinLab.parseState(data,JSON.parse(JSON.stringify(transfer)));view=joinLab.observe(data,restored);expect(view.assessment).toMatchObject({predictedCount:5,actualCount:6,correct:false});expect(view.practiceReview?.lastChange).toMatchObject({beforeCount:5,afterCount:4});expect(()=>joinLab.update(data,restored,{kind:'predict',count:6,reasoning:'Replace first answer',expectedRevision:restored.revision})).toThrow();expect(JSON.stringify({data,state})).toBe(before);
});
test('Undo keeps existing one-step semantics and reapplying an edit creates a new comparison',()=>{
 const {data,state}=finalPractice();let next=joinLab.update(data,state,{kind:'undo-practice',expectedRevision:state.revision});expect(next.undoPractice).toBeUndefined();expect(joinLab.observe(data,next).lastChange).toBeNull();expect(joinLab.observe(data,next).observation).toBeNull();
 next=joinLab.update(data,next,{kind:'predict',count:5,reasoning:'Restored previous practice.',expectedRevision:next.revision});expect(joinLab.observe(data,next).observation?.rowCount).toBe(5);expect(joinLab.observe(data,next).lastChange).toBeNull();
 next=joinLab.update(data,next,{kind:'edit-row',side:'left',rowId:'practice-b',values:['y','blue'],expectedRevision:next.revision});expect(joinLab.observe(data,next).lastChange).toBeNull();next=joinLab.update(data,next,{kind:'predict',count:4,reasoning:'Reapplied explicit edit.',expectedRevision:next.revision});expect(joinLab.observe(data,next).lastChange).toMatchObject({beforeCount:5,afterCount:4});
});
test.each(['mode','keys','payload','right-key'] as const)('computed %s comparison identifies the changed input and preserves exact pair effects',kind=>{
 const data=joinLab.parse(exampleLesson);let state=joinLab.initial(data);const action=kind==='mode'?{kind:'set-mode',mode:'LEFT'}:kind==='keys'?{kind:'set-keys',leftColumnId:'p-alt',rightColumnId:'p-ralt'}:kind==='payload'?{kind:'edit-row',side:'left',rowId:'practice-a',values:['x','purple']}:{kind:'edit-row',side:'right',rowId:'practice-r1',values:['X','red']};state=joinLab.update(data,state,{...action,expectedRevision:0});expect(joinLab.observe(data,state).lastChange).toBeNull();state=joinLab.update(data,state,{kind:'predict',count:0,reasoning:'Inspect the actual deterministic result.',expectedRevision:1});const change=joinLab.observe(data,state).lastChange!;
 if(kind==='mode'){expect(change).toMatchObject({beforeCount:2,afterCount:4,edits:[{kind:'mode',before:'INNER',after:'LEFT'}]});expect(change.rows.map(row=>[row.leftRowId,row.before.outputCount,row.after.outputCount])).toEqual([['practice-b',0,1],['practice-null',0,1]]);}
 if(kind==='keys'){expect(change.edits).toEqual([{kind:'keys',before:{leftColumnId:'p-key',rightColumnId:'p-rkey'},after:{leftColumnId:'p-alt',rightColumnId:'p-ralt'}}]);expect(change.addedPairIds).toContain('practice-null:practice-rnull');expect(describeLastJoinChange(state.practice,change).rows.find(row=>row.label==='Members row 3')?.afterPairs).toContain('Invitations row 4');}
 if(kind==='payload'){expect(change).toMatchObject({beforeCount:2,afterCount:2,addedPairIds:[],removedPairIds:[],changedPairIds:['practice-a:practice-r1','practice-a:practice-r2'],edits:[{kind:'cell',side:'left',rowId:'practice-a',columnId:'p-alt',before:'red',after:'purple'}]});expect(()=>joinLab.update(data,state,{kind:'start-transfer',expectedRevision:2})).toThrow(/relationship/);}
 if(kind==='right-key'){expect(change).toMatchObject({beforeCount:2,afterCount:1,removedPairIds:['practice-a:practice-r1'],edits:[{kind:'cell',side:'right',rowId:'practice-r1',columnId:'p-rkey',before:'x',after:'X'}]});}
});
test('false remains a real join key in the before/after explanation',()=>{
 const data=joinLab.parse({...exampleLesson,practice:{...exampleLesson.practice,left:{...exampleLesson.practice.left,columns:[{id:'p-key',label:'Enabled',type:'boolean'}],rows:[{id:'false-left',values:[false]}]},right:{...exampleLesson.practice.right,columns:[{id:'p-rkey',label:'Enabled',type:'boolean'}],rows:[{id:'false-right',values:[false]}]}}});let state=joinLab.update(data,joinLab.initial(data),{kind:'edit-row',side:'right',rowId:'false-right',values:[true],expectedRevision:0});state=joinLab.update(data,state,{kind:'predict',count:0,reasoning:'false is distinct from true.',expectedRevision:1});const change=joinLab.observe(data,state).lastChange!;expect(change).toMatchObject({beforeCount:1,afterCount:0,edits:[{kind:'cell',side:'right',rowId:'false-right',columnId:'p-rkey',before:false,after:true}]});expect(describeLastJoinChange(state.practice,change).rows[0]).toMatchObject({before:'false matches Invitations row 1; 1 output row(s)',after:'false has no equal non-NULL right key; 0 output row(s)'});
});
test.each(['quick','deep','visual'] as const)('actual %s component projection describes only computed practice changes without dispatching an action',mode=>{
 const {data,state}=finalPractice(),snapshot=JSON.stringify({data,state}),actions:unknown[]=[];const html=renderToStaticMarkup(createElement(JoinLab,{data,state,humanLabels:true,explanationMode:mode,onAction:action=>{actions.push(action);}}));expect(html).toContain('aria-label="Last applied join change"');expect(html).toContain('Last applied practice change: 5 → 4 output rows.');expect(html).toContain('Members row 2, Team: &quot;x&quot; → &quot;y&quot;.');expect(html).toContain('hypothetical local practice edits');
 if(mode==='deep'){expect(html).toContain('Why the join rows changed');expect(html).toContain('2 output row(s)');expect(html).toContain('1 output row(s) because LEFT preserves');expect(html).toContain('Unchanged output contributions: Members row 1, Members row 3.');}
 if(mode==='visual'){expect(html).toContain('Before and after row pairs');expect(html).toContain('Invitations row 1, Invitations row 2');expect(html).toContain('No matching right row (NULL-extended)');}
 expect(actions).toEqual([]);expect(JSON.stringify({data,state})).toBe(snapshot);
});
test('actual transfer-pending component retains the known practice cause without rendering an answer or pair map',()=>{
 const {data,state}=finalPractice(),transfer=joinLab.update(data,state,{kind:'start-transfer',expectedRevision:state.revision});
 const html=renderToStaticMarkup(createElement(JoinLab,{data,state:transfer,humanLabels:true,explanationMode:'visual',onAction:()=>{throw Error('Rendering must not dispatch.');}}));
 expect(html).toContain('Practice comparison saved before transfer');expect(html).toContain('Last applied practice change: 5 → 4 output rows.');expect(html).toContain('Members row 2 pair comparison');
 expect(html).not.toContain('6 output rows');expect(html).not.toContain('Transfer score:');expect(html).not.toContain('aria-label="Computed result"');expect(html).not.toContain('aria-label="Pair map"');expect(html).toContain('Check prediction');
});

test('derived comparisons refuse forged outcomes, an incompatible source basis and a malformed Undo identity',()=>{
 const {data,state}=finalPractice(),before=JSON.stringify({data,state});
 expect(()=>joinLab.parseState(data,{...state,lastChange:{beforeCount:0,afterCount:999}})).toThrow();
 expect(()=>joinLab.observe({...data,source:{...data.source,digest:'changed-source-basis'}},state)).toThrow(/another lesson/);
 expect(()=>joinLab.observe(data,{...state,undoPractice:{...state.undoPractice,left:{...state.undoPractice!.left,rows:state.undoPractice!.left.rows.slice(1)}}})).toThrow(/Undo cannot replace lesson identities/);
 expect(()=>joinLab.update(data,state,{kind:'edit-row',side:'left',rowId:'practice-b',values:['x','blue'],expectedRevision:state.revision-1})).toThrow(/changed/);expect(JSON.stringify({data,state})).toBe(before);
});
test('an unmatched row payload edit distinguishes changed input from unchanged output contributions',()=>{
 const data=joinLab.parse(exampleLesson);let state=joinLab.update(data,joinLab.initial(data),{kind:'edit-row',side:'left',rowId:'practice-b',values:['y','purple'],expectedRevision:0});
 state=joinLab.update(data,state,{kind:'predict',count:2,reasoning:'The edited unmatched row still produces no INNER output.',expectedRevision:1});
 const change=joinLab.observe(data,state).lastChange!;expect(change).toMatchObject({beforeCount:2,afterCount:2,addedPairIds:[],removedPairIds:[],changedPairIds:[],rows:[],edits:[{kind:'cell',side:'left',rowId:'practice-b',columnId:'p-alt',before:'blue',after:'purple'}]});
 const text=joinLab.text(data,state);
 for(const mode of ['deep','visual'] as const){const html=renderToStaticMarkup(createElement(JoinLab,{data,state,humanLabels:true,explanationMode:mode,onAction:()=>{throw Error('Rendering must not dispatch.');}}));for(const rendered of [html,text]){expect(rendered).toContain('Members row 2, Color:');expect(rendered).toContain('purple');expect(rendered).toContain('Unchanged output contributions: Members row 1, Members row 2, Members row 3.');expect(rendered).not.toContain('Unchanged left rows:');}}
});
test('standalone supplied practice comparison makes no reviewed-transcription or citation claim',()=>{
 const {data,state}=finalPractice(),text=joinLab.text(data,state);
 for(const mode of ['quick','deep','visual'] as const){const html=renderToStaticMarkup(createElement(JoinLab,{data,state,humanLabels:true,explanationMode:mode,onAction:()=>{throw Error('Rendering must not dispatch.');}}));for(const rendered of [html,text]){expect(rendered).toContain('original supplied practice data is unchanged');expect(rendered).not.toContain('reviewed transcription');expect(rendered).not.toContain('its citations');}}
});
