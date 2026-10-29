import {createHash} from 'node:crypto';
import {expect,test} from 'vitest';
import {parseSignalAssignment,signalConceptDocument,signalExampleComparison} from '../src/learning/signal-concept';

const rule=parseSignalAssignment('q <= d;')!;
test('the already published v1 document remains byte-for-byte stable',()=>{
 expect(createHash('sha256').update(signalConceptDocument(rule)).digest('hex')).toBe('f786b51c02ac5ffaf59cb4ffefb0bacdad6d069d8f223d203ed5ca53c4f48eda');
});
test.each([
 [{target:0,value:0},0,0],
 [{target:1,value:0},1,0],
 [{target:1,value:1},1,1],
] as const)('compares the baseline with changed hypothetical bits %j', (example,during,after)=>{
 const result=signalExampleComparison(rule,example);expect(result.baseline).toEqual({target:0,value:1,during:0,after:1});expect(result.changed).toEqual({...example,during,after});
 const content=signalConceptDocument(rule,example);expect(content).toContain('q <= d;');expect(content).toContain('hypothetical');expect(content).toContain(`During the process, q reads ${during}`);expect(content).toContain(`After the later delta update, q reads ${after}`);expect(content).toContain('not a VHDL simulation');
});
