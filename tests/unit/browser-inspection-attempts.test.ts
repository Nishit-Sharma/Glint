import {expect,it} from 'vitest';
import {BrowserInspectionAttempts} from '../../src/host/browser/inspection-attempts';

const owner={taskId:'task',runId:'run',operationId:'action'};
it('stops only the matching active attempt and does not let a late stop reach a newer attempt',()=>{
 const attempts=new BrowserInspectionAttempts(),first=attempts.begin({...owner,attemptId:'first'});
 expect(attempts.stop({...owner,attemptId:'wrong'})).toEqual({kind:'not-active'});
 expect(first.signal.aborted).toBe(false);
 expect(attempts.stop({...owner,attemptId:'first'})).toEqual({kind:'stopped'});
 expect(first.signal.aborted).toBe(true);first.finish();
 const second=attempts.begin({...owner,attemptId:'second'});
 expect(attempts.stop({...owner,attemptId:'first'})).toEqual({kind:'not-active'});
 expect(attempts.stop({...owner,taskId:'other',attemptId:'second'})).toEqual({kind:'not-active'});
 expect(second.signal.aborted).toBe(false);second.finish();
 expect(()=>attempts.begin({...owner,attemptId:'first'})).toThrow();
});
it('does not report a stop after the reviewed outcome has begun committing',()=>{
 const attempts=new BrowserInspectionAttempts(),active=attempts.begin({...owner,attemptId:'commit'});
 active.beginCommit();expect(attempts.stop({...owner,attemptId:'commit'})).toEqual({kind:'finishing'});
 expect(active.signal.aborted).toBe(false);active.finish();
});
it('will not begin committing after stop, and closing retires active attempts',()=>{
 const attempts=new BrowserInspectionAttempts(),a=attempts.begin({...owner,attemptId:'a'});
 attempts.stop({...owner,attemptId:'a'});expect(()=>a.beginCommit()).toThrow();a.finish();
 const b=attempts.begin({...owner,attemptId:'b'});attempts.close();expect(b.signal.aborted).toBe(true);expect(()=>attempts.begin({...owner,attemptId:'c'})).toThrow();b.finish();attempts.resume();expect(()=>attempts.begin({...owner,attemptId:'b'})).toThrow();expect(attempts.begin({...owner,attemptId:'c'}).signal.aborted).toBe(false);
});
