import { expect, test } from 'vitest';
import { parseModule, initialModuleState, updateModuleState, moduleText } from '../src/core/interactive-modules';
import { exampleLesson } from '../src/learning/example';
import { joinLab } from '../src/learning/join-lab';

test('installed join module checks duplicates, preserves source and renders a readable result', () => {
  const data = parseModule(exampleLesson);
  let state = initialModuleState(data);
  state = updateModuleState(data, state, {kind:'edit-row', side:'left', rowId:'practice-b', values:['x','blue'], expectedRevision:0});
  state = updateModuleState(data, state, {kind:'predict', count:2, reasoning:'one row per member', expectedRevision:1});
  expect(joinLab.observe(data, state).observation?.rows.map(row=>row.id)).toEqual(['practice-a:practice-r1','practice-a:practice-r2','practice-b:practice-r1','practice-b:practice-r2']);
  expect(moduleText(data, state)).toContain('actual count is 4');
});

test('cosmetic edits do not unlock transfer and undo requires a new prediction', () => {
  let state = joinLab.update(exampleLesson, joinLab.initial(exampleLesson), {kind:'edit-row',side:'left',rowId:'practice-b',values:['y','green'],expectedRevision:0});
  state = joinLab.update(exampleLesson,state,{kind:'predict',count:2,reasoning:'',expectedRevision:1});
  expect(()=>joinLab.update(exampleLesson,state,{kind:'start-transfer',expectedRevision:2})).toThrow(/relationship/);
  state=joinLab.update(exampleLesson,state,{kind:'undo-practice',expectedRevision:2});
  expect(state.revision).toBe(3);
  expect(state.practice).toEqual(exampleLesson.practice);
  expect(joinLab.observe(exampleLesson,state).assessment).toBeNull();
});
