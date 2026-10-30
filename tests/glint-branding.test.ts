import {expect,it} from 'vitest';
import {publicErrorMessage} from '../src/shared/public-messages';

it('presents legacy product errors with the current name without exposing appended diagnostics',()=>{
 const samples=[
  ['Companion could not open its browser. Your task is kept.','Glint could not open its browser. Your task is kept.'],
  ['Choose an external window. Companion windows cannot be captured.','Choose an external window. Glint windows cannot be captured.'],
  ['This workspace is open in another copy of Companion. Close that copy and try again.','This workspace is open in another copy of Glint. Close that copy and try again.'],
  ['Allow screen recording for Companion in System Settings, then capture the window again.','Allow screen recording for Window Companion in System Settings, then capture the window again.'],
 ] as const;
 for(const [saved,shown] of samples){
  expect(publicErrorMessage(saved)).toBe(shown);
  expect(publicErrorMessage(shown)).toBe(shown);
  expect(publicErrorMessage(saved+' PRIVATE_PATH')).not.toContain('PRIVATE_PATH');
 }
});
