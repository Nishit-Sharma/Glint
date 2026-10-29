import {expect,test} from 'vitest';
import {parseSignalAssignment,signalConceptDocument} from '../src/learning/signal-concept';

test('explains only a reviewed simple assignment and separates its evidence from a hypothetical schedule',()=>{
 const rule=parseSignalAssignment('q <= d;');expect(rule).toEqual({target:'q',value:'d',quote:'q <= d;'});const text=signalConceptDocument(rule!);expect(text).toContain('Reviewed source line');expect(text).toContain('q <= d;');expect(text).toContain('## Quick');expect(text).toContain('## Deep');expect(text).toContain('## Visual');expect(text).toContain('hypothetical');expect(text).toContain('one direct effective driver');expect(text).toContain('no later transaction replaces');expect(text).toContain('not a VHDL simulation');expect(text).toContain('does not establish');
});
test.each(['q <= d after 1 ns;','q <= d and e;','q <= not d;','q <= d; -- note','q <= q;','if <= d;','q <= d;\nr <= e;','q := d;','q <= (d);','q <= d when en else e;'])('refuses syntax outside the exact supported line: %s',line=>expect(parseSignalAssignment(line)).toBeNull());
test('refuses VHDL-2008 reserved words as either basic name, including release assignment syntax',()=>{
 expect(parseSignalAssignment('q <= release;')).toBeNull();
 const words='assume assume_guarantee context cover default fairness force parameter property protected release restrict restrict_guarantee sequence strong vmode vprop vunit'.split(' ');
 for(const word of words){expect(parseSignalAssignment(`q <= ${word};`),word).toBeNull();expect(parseSignalAssignment(`${word.toUpperCase()} <= d;`),word).toBeNull();}
 expect(parseSignalAssignment('q <= ReLeAsE;')).toBeNull();
});
