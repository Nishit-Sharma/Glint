import {expect,test} from 'vitest';
import {signalPracticeDocument} from '../src/learning/signal-sequential-practice';

test('distinguishes the reviewed source from the synthetic two-statement scenario and retains either answer',()=>{
 for(const answer of [0,1] as const){const out=signalPracticeDocument('q <= d;',answer,'I thought the first line took effect immediately.');expect(out).toContain('q <= d;');expect(out).toContain('lamp <= sensor;');expect(out).toContain('audit <= lamp;');expect(out).toContain('synthetic');expect(out).toContain(`Your saved answer: ${answer}`);expect(out).toContain(answer===0?'matches':'does not match');expect(out).toContain('schedules 0');expect(out).toContain('Earlier exposure is unknown');expect(out).toContain('not a VHDL simulation');expect(out).toContain('I thought the first line took effect immediately.');}
});
