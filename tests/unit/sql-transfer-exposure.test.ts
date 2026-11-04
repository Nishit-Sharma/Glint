import {expect,test} from 'vitest';
import {exampleLesson} from '../../src/learning/example';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {JoinLab} from '../../src/renderer/src/components/JoinLab';
import {joinLab} from '../../src/learning/join-lab';

test('a previous practice can exactly match the later permitted transfer despite a different current practice',()=>{
 const p=exampleLesson.practice;
 const transfer={...p,id:'transfer-copy',title:'Separate challenge',left:{...p.left,id:'transfer-left',columns:p.left.columns.map(c=>({...c,id:'t-'+c.id})),rows:p.left.rows.map(r=>({...r,id:'t-'+r.id}))},right:{...p.right,id:'transfer-right',columns:p.right.columns.map(c=>({...c,id:'t-'+c.id})),rows:p.right.rows.map(r=>({...r,id:'t-'+r.id}))},join:{mode:'LEFT' as const,leftColumnId:'t-'+p.join.leftColumnId,rightColumnId:'t-'+p.join.rightColumnId}};
 const lesson=joinLab.parse({...exampleLesson,transfer});let state=joinLab.initial(lesson);
 state=joinLab.update(lesson,state,{kind:'set-mode',mode:'LEFT',expectedRevision:state.revision});state=joinLab.update(lesson,state,{kind:'predict',count:4,reasoning:'Already worked through this relationship.',expectedRevision:state.revision});const exposed=joinLab.observe(lesson,state);
 expect(exposed.problem.left.rows.map(r=>r.values)).toEqual(transfer.left.rows.map(r=>r.values));expect(exposed.problem.right.rows.map(r=>r.values)).toEqual(transfer.right.rows.map(r=>r.values));expect(exposed.problem.join.mode).toBe(transfer.join.mode);expect(exposed.assessment?.actualCount).toBe(4);
 state=joinLab.update(lesson,state,{kind:'set-mode',mode:'INNER',expectedRevision:state.revision});state=joinLab.update(lesson,state,{kind:'edit-row',side:'left',rowId:'practice-b',values:['x','blue'],expectedRevision:state.revision});state=joinLab.update(lesson,state,{kind:'predict',count:4,reasoning:'Current relationship is different.',expectedRevision:state.revision});state=joinLab.update(lesson,state,{kind:'start-transfer',expectedRevision:state.revision});const pending=joinLab.observe(lesson,state);
 expect(pending.phase).toBe('transfer-predict');expect(pending.observation).toBeNull();expect(pending.problem.left.rows.map(r=>r.values)).toEqual(exposed.problem.left.rows.map(r=>r.values));expect(pending.problem.right.rows.map(r=>r.values)).toEqual(exposed.problem.right.rows.map(r=>r.values));expect(pending.problem.join.mode).toBe(exposed.problem.join.mode);const html=renderToStaticMarkup(createElement(JoinLab,{data:lesson,state,onAction:()=>{throw Error('Unexpected action');}}));expect(html).toContain('Earlier exposure is not tracked');expect(html).toContain('Review saved practice');expect(html).not.toContain('Unseen transfer');expect(html).not.toContain('Transfer score:');expect(joinLab.text(lesson,state)).toContain('Earlier exposure is not tracked');
});
