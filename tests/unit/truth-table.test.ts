import {expect,test} from 'vitest';
import {parseBinaryAssignment,makeTruthComparison,readTruthBinding,truthStatus} from '../../src/learning/truth-table';

test.each(['and','or','xor'])('truth table for %s has four exact binary outputs and explains a baseline comparison',operator=>{
 const line=`y <= a ${operator} b;`,rule=parseBinaryAssignment(line);expect(rule).not.toBeNull();const data=makeTruthComparison(rule!);expect(data.rows.map(row=>row.values[0])).toEqual(operator==='and'?['0','0','0','1']:operator==='or'?['0','1','1','1']:['0','1','1','0']);expect(data.rows.every(row=>row.values[1].includes('00'))).toBe(true);expect(data.rows[0].values[2]).toBe(line);expect(data.question).toContain('not VHDL simulation');
});
test.each(['y <= a and b; -- comment','y <= (a and b);','y <= not a;','y <= a and b or c;','y <= a and a;','a <= a xor b;','y <= A and a;','signal y: std_logic;','y <= a and b;\nz <= a and b;','y <= if and b;'])('unsupported or ambiguous selected source is refused: %s',line=>expect(parseBinaryAssignment(line)).toBeNull());
test('unmarked unrelated comparisons do not acquire source authority',()=>{expect(readTruthBinding('An ordinary comparison.', 'ordinary')).toBeNull();expect(truthStatus(undefined,undefined)).toEqual({kind:'unverified'});});
