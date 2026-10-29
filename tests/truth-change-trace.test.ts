import {expect,it} from 'vitest';
import {truthChangeTrace} from '../src/learning/truth-change-trace';

it.each([
 ['and','00',0],['and','01',0],['and','10',0],['and','11',1],
 ['or','00',0],['or','01',1],['or','10',1],['or','11',1],
 ['xor','00',0],['xor','01',1],['xor','10',1],['xor','11',0],
] as const)('derives %s pair %s from the reviewed assignment', (operator,pair,output)=>{
 const trace=truthChangeTrace(`Result <= Left ${operator} Right;`,'pair-'+pair)!;
 expect(trace).toMatchObject({quote:`Result <= Left ${operator} Right;`,operator,outputName:'Result',before:{left:0,right:0,output:0},after:{left:Number(pair[0]),right:Number(pair[1]),output},inputs:[{name:'Left',before:0,after:Number(pair[0])},{name:'Right',before:0,after:Number(pair[1])}]});
 expect(trace.outputChanged).toBe(output!==0);expect(trace.explanation).toContain(operator.toUpperCase());
});
it('requires a supported complete reviewed line and a known saved pair',()=>{
 expect(truthChangeTrace('y <= a and b;',undefined)).toBeNull();
 expect(()=>truthChangeTrace('y <= not a;','pair-11')).toThrow('supported');
 expect(()=>truthChangeTrace('y <= a and b;','pair-22')).toThrow('saved input pair');
 expect(()=>truthChangeTrace('y <= a and b;','predict-1')).toThrow('saved input pair');
});

it.each(['01','10'])('explains AND with one zero at %s without implying both inputs are zero',pair=>{
 expect(truthChangeTrace('y <= a and b;','pair-'+pair)!.explanation).toBe('AND returns 0 because at least one input is 0.');
});
