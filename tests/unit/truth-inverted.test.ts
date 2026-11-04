import {expect,test} from 'vitest';
import {makeTruthComparison,makeTruthPrediction,observeTruthPrediction,parseBinaryAssignment} from '../../src/learning/truth-table';
import {truthChangeTrace} from '../../src/learning/truth-change-trace';

test.each([
 ['nand',['1','1','1','0']],['nor',['1','0','0','0']],['xnor',['1','0','0','1']],
] as const)('reviewed %s computes all four binary rows, trace and prediction', (op,outputs)=>{
 const quote=`y <= a ${op} b;`,rule=parseBinaryAssignment(quote);expect(rule).not.toBeNull();const data=makeTruthComparison(rule!);expect(data.rows.map(row=>row.values[0])).toEqual(outputs);expect(data.rows[0].values[2]).toBe(quote);
 for(const [i,pair] of ['00','01','10','11'].entries()){const trace=truthChangeTrace(quote,'pair-'+pair)!;expect(trace.before.output).toBe(1);expect(trace.after.output).toBe(Number(outputs[i]));expect(trace.outputChanged).toBe(outputs[i]!=='1');expect(trace.explanation).toContain(op.toUpperCase());expect(data.rows[i].values[1]).toContain(outputs[i]==='1'?'stays 1':'changes from 1 to 0');}
 expect(makeTruthPrediction(rule!).rows).toHaveLength(2);expect(observeTruthPrediction(rule!,'predict-0')!.output).toBe(outputs[2]);expect(observeTruthPrediction(rule!,undefined)).toBeNull();
});
test.each(['y <= not a;','y <= a nand (b);','y <= a nand b; -- comment','y <= a nand b or c;','y <= a NAND a;'])('still refuses unsupported syntax %s',quote=>expect(parseBinaryAssignment(quote)).toBeNull());

test.each([
 ['nand','00','NAND returns 1 because at least one input is 0.'],['nand','01','NAND returns 1 because at least one input is 0.'],['nand','10','NAND returns 1 because at least one input is 0.'],['nand','11','NAND returns 0 because both inputs are 1.'],
 ['nor','00','NOR returns 1 because both inputs are 0.'],['nor','01','NOR returns 0 because at least one input is 1.'],['nor','10','NOR returns 0 because at least one input is 1.'],['nor','11','NOR returns 0 because at least one input is 1.'],
 ['xnor','00','XNOR returns 1 because the inputs are the same.'],['xnor','01','XNOR returns 0 because the inputs differ.'],['xnor','10','XNOR returns 0 because the inputs differ.'],['xnor','11','XNOR returns 1 because the inputs are the same.'],
] as const)('%s %s gives its exact rationale',(op,pair,explanation)=>expect(truthChangeTrace(`y <= a ${op} b;`,'pair-'+pair)!.explanation).toBe(explanation));
test.each([
 ['nand','For a = 1 and b = 0, NAND returns 1 because at least one input is 0.'],
 ['nor','For a = 1 and b = 0, NOR returns 0 because at least one input is 1.'],
 ['xnor','For a = 1 and b = 0, XNOR returns 0 because the inputs differ.'],
] as const)('%s gives exact prediction feedback',(op,explanation)=>expect(observeTruthPrediction(parseBinaryAssignment(`y <= a ${op} b;`)!,'predict-0')!.explanation).toBe(explanation));
