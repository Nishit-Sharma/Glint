import {expect,test} from 'vitest';
import {prepareSignalOverwrites,signalOverwriteDocument,signalOverwritePracticeDocument,signalOverwriteAnswers,signalOverwriteTrace} from '../../src/learning/signal-overwrite';

const pairs=(text:string)=>prepareSignalOverwrites([{sourceId:'source',text}]);
test('reviews exact adjacent source lines and preserves CRLF, indentation, name case and offsets',()=>{
 const text='process(clk)\r\n  Q <= primary;\r\n\tq <= backup;\r\nend process;';
 const [pair]=pairs(text);expect(pair).toMatchObject({sourceId:'source',quote:'Q <= primary;\r\n\tq <= backup;',first:{target:'Q',value:'primary'},second:{target:'q',value:'backup'}});expect(text.slice(pair.start,pair.end)).toBe(pair.quote);expect(pairs(text)).toHaveLength(1);
});
test.each([
 'q <= a;\nwait for 0 ns;\nq <= b;', 'q <= a;\n-- comment\nq <= b;', 'q <= a;\n\nq <= b;', 'q <= a;\nq <= b after 1 ns;', 'q <= a;\nr <= b;', 'q <= a;\nq <= A;', 'q <= release;\nq <= b;', 'q <= a;\nend process;\nq <= b;', 'q <= a; q <= b;',
])('refuses an unsupported or nonadjacent source pair: %s',text=>expect(pairs(text)).toEqual([]));
test('never joins lines across sources or over the existing review limits',()=>{
 expect(prepareSignalOverwrites([{sourceId:'a',text:'q <= a;'},{sourceId:'b',text:'q <= b;'}])).toEqual([]);expect(pairs('q <= a;\nq <= b;\n'+'x'.repeat(20001))).toEqual([]);
});
test('source-linked quick/deep/visual and editable skipping preserve the exact quote and distinguish source from assumptions',()=>{
 const pair=pairs('q <= a;\nq <= b;')[0],original=signalOverwriteDocument(pair,true),changed=signalOverwriteDocument(pair,false);
 for(const text of [original,changed])for(const expected of [pair.quote,'## Quick','## Deep','## Visual','same driver','without an intervening wait or delay','not a VHDL simulation','Concurrent assignments','not established','10.5.2.2','14.7.5'])expect(text).toContain(expected);
 expect(signalOverwriteTrace(true)).toEqual({during:0,firstScheduled:1,replacement:0,after:0});expect(signalOverwriteTrace(false)).toEqual({during:0,firstScheduled:1,replacement:null,after:1});expect(original).toContain('final scheduled value stays 0');expect(changed).toContain('final scheduled value changes from 0 to 1');
});
test.each(signalOverwriteAnswers)('separate three-statement practice preserves first answer %s and explains replacement versus current-value reading',answer=>{
 const content=signalOverwritePracticeDocument(pairs('q <= a;\nq <= b;')[0],answer);expect(content).toContain(`Your saved answer: (${answer[0]}, ${answer[1]})`);expect(content).toContain(answer==='01'?'matches this result':'does not match this result');expect(content).toContain('audit <= lamp;');expect(content).toContain('second reads the current lamp value 1');expect(content).toContain('Earlier exposure is unknown');expect(content).toContain('does not establish mastery');
});
