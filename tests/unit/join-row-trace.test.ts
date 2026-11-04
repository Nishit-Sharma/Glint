import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test} from 'vitest';
import {joinLab} from '../../src/learning/join-lab';
import {exampleLesson} from '../../src/learning/example';
import {JoinLab} from '../../src/renderer/src/components/JoinLab';
import {JoinRowTrace} from '../../src/renderer/src/components/JoinRowTrace';

const render=(data:ReturnType<typeof joinLab.parse>,state:ReturnType<typeof joinLab.initial>)=>renderToStaticMarkup(createElement(JoinRowTrace,{data,state}));

test('a checked join offers an exact row trace for duplicate matches without dispatching work',()=>{
 const data=joinLab.parse(exampleLesson),state=joinLab.update(data,joinLab.initial(data),{kind:'predict',count:1,reasoning:'One x member should give one row.',expectedRevision:0});
 const before=JSON.stringify({data,state}),actions:unknown[]=[];
 const html=renderToStaticMarkup(createElement(JoinLab,{data,state,humanLabels:true,onAction:action=>{actions.push(action);}}));
 expect(html).toContain('Trace one input row');
 expect(html).toContain('Choose a left input row');
 expect(html).toContain('Members row 1 contributes 2 of the 2 output rows.');
 expect(html).toContain('Each matching right row keeps a separate pair.');
 expect(html).toContain('Unknown (NULL)');
 expect(actions).toEqual([]);expect(JSON.stringify({data,state})).toBe(before);
});

test('practice edits and a pending first transfer withhold the trace instead of revealing computed answers',()=>{
 const data=joinLab.parse(exampleLesson);let state=joinLab.initial(data);
 expect(render(data,state)).toBe('');
 state=joinLab.update(data,state,{kind:'predict',count:1,reasoning:'First practice prediction.',expectedRevision:state.revision});
 expect(render(data,state)).toContain('Trace one input row');
 state=joinLab.update(data,state,{kind:'set-mode',mode:'LEFT',expectedRevision:state.revision});
 expect(render(data,state)).toBe('');
 state=joinLab.update(data,state,{kind:'predict',count:4,reasoning:'LEFT preserves both unmatched rows.',expectedRevision:state.revision});
 expect(render(data,state)).toContain('Trace one input row');
 state=joinLab.update(data,state,{kind:'start-transfer',expectedRevision:state.revision});
 expect(render(data,state)).toBe('');
 state=joinLab.update(data,state,{kind:'predict',count:5,reasoning:'First transfer remains independently recorded.',expectedRevision:state.revision});
 expect(render(data,state)).toContain('Shipments row 1 contributes 2 of the 6 output rows.');
 expect(render(data,state)).not.toContain('Members row');
});

test.each(['INNER','LEFT'] as const)('%s gives an explicit NULL explanation without treating NULL as an equal key',mode=>{
 const data=joinLab.parse({...exampleLesson,practice:{...exampleLesson.practice,join:{...exampleLesson.practice.join,mode},left:{...exampleLesson.practice.left,rows:[exampleLesson.practice.left.rows[2]]}}});
 const state=joinLab.update(data,joinLab.initial(data),{kind:'predict',count:2,reasoning:'Inspect missing values.',expectedRevision:0});
 const html=render(data,state);
 expect(html).toContain('This left key is NULL. Equality is unknown, including when the right key is also NULL.');
 expect(html).toContain(mode==='LEFT'?'LEFT keeps this left row once, with NULL values for the right columns.':'INNER leaves this left row out.');
 expect(html).not.toContain('Match · 1 pair');
 expect(html.match(/Unknown \(NULL\)/g)).toHaveLength(4);
});

test.each(['INNER','LEFT'] as const)('%s distinguishes unequal keys and the right-side NULL comparison',mode=>{
 const data=joinLab.parse({...exampleLesson,practice:{...exampleLesson.practice,join:{...exampleLesson.practice.join,mode},left:{...exampleLesson.practice.left,rows:[exampleLesson.practice.left.rows[1]]}}});
 const state=joinLab.update(data,joinLab.initial(data),{kind:'predict',count:2,reasoning:'Inspect a missing match.',expectedRevision:0});
 const html=render(data,state);
 expect(html).toContain('No right row has an equal non-NULL key.');
 expect(html.match(/Different key/g)).toHaveLength(3);expect(html.match(/Unknown \(NULL\)/g)).toHaveLength(1);
 expect(html).toContain(mode==='LEFT'?'contributes 1 of the 1 output row.':'contributes 0 of the 0 output rows.');
});

test.each(['left','right'] as const)('empty %s tables have a useful result instead of an unusable selector',side=>{
 const data=joinLab.parse({...exampleLesson,practice:{...exampleLesson.practice,[side]:{...exampleLesson.practice[side],rows:[]}}});
 const state=joinLab.update(data,joinLab.initial(data),{kind:'predict',count:1,reasoning:'Inspect an empty input.',expectedRevision:0});
 const html=render(data,state);
 expect(html).toContain(side==='left'?'There are no left input rows, so this join produces no output rows.':'No right rows to compare.');
 if(side==='left')expect(html).not.toContain('<select');
});

test('literal NULL text remains a matched string and authored markup stays inert',()=>{
 const label='<img src=x onerror=alert(1)>',data=joinLab.parse({...exampleLesson,practice:{...exampleLesson.practice,left:{...exampleLesson.practice.left,title:label,rows:[{id:'literal-left',values:['NULL','red']}]},right:{...exampleLesson.practice.right,rows:[{id:'literal-right',values:['NULL','red']}]}}});
 const state=joinLab.update(data,joinLab.initial(data),{kind:'predict',count:0,reasoning:'Literal text is a value.',expectedRevision:0}),html=render(data,state);
 expect(html).toContain('&quot;NULL&quot;');expect(html).toContain('Match · 1 pair');expect(html).not.toContain('Unknown (NULL)');expect(html).not.toContain('<img');expect(html).toContain('&lt;img');
});

test('a correct result starts collapsed while an incorrect result exposes the row trace',()=>{
 const data=joinLab.parse(exampleLesson),initial=joinLab.initial(data);
 const correct=render(data,joinLab.update(data,initial,{kind:'predict',count:2,reasoning:'Both x invitations match.',expectedRevision:0}));
 const incorrect=render(data,joinLab.update(data,initial,{kind:'predict',count:1,reasoning:'Only counted the member.',expectedRevision:0}));
 expect(correct).toMatch(/^<details class="join-row-trace">/);expect(incorrect).toMatch(/^<details class="join-row-trace" open="">/);
});

test('a restored checked state derives the same trace and rejects a different source basis',()=>{
 const data=joinLab.parse(exampleLesson),state=joinLab.update(data,joinLab.initial(data),{kind:'predict',count:2,reasoning:'Both x invitations match.',expectedRevision:0});
 expect(render(data,joinLab.parseState(data,JSON.parse(JSON.stringify(state))))).toBe(render(data,state));
 expect(()=>render({...data,source:{...data.source,digest:'another-basis'}},state)).toThrow(/another lesson/);
});
