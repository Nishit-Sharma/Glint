import {describe,it,expect} from 'vitest';
import {publicErrorMessage,sourceRoleLabel,requestStatusLabel,connectionIssueMessage} from '../src/shared/public-messages';
import {savedWorkUnavailable} from '../src/shared/saved-work-search';
describe('Public error and status copy',()=>{
 it.each([
  ["Error invoking remote method 'companion:command': Error: EACCES open /Users/private/.runtime/tasks.json",'cannot access'],
  ['ENOENT: /tmp/private/capture.png','no longer available'],
  ['Invalid model draft: schemaVersion is missing; {"spec":{"secret":"x"}}','usable draft'],
  ['Invalid experiment: division by zero','divides by zero'],
  ['HTTP 401 {"error":"bad key"}','sign-in or API key'],
  ['429 allowance exceeded','usage limit'],
  ['Provider response incomplete: output_tokens=12000','response was incomplete'],
  ['Connection closed before the response finished.','response was incomplete'],
  ['Task store is unreadable or incompatible; existing data was preserved.','could not be opened'],
  ['Destination bytes do not match the approved artifact.','new review'],
  ['Model request was not authorized. Nothing was sent.','not authorized'],
  ['Export was not approved.','not approved'],
  ['Uncertain export after write /tmp/private/file','may have been saved'],
  ['Native window metadata changed. Rebind explicitly.','Refresh the selected window'],
  ['Unknown companion command.','not available'],
  ['This saved helper changed or is no longer available. Refresh Saved helpers and choose it again.','Refresh Saved helpers'],
  ['The observed module state changed. Recompute the explanation.','saved choices changed'],
  ['This helper changed. Reload it before applying the correction.','saved choices changed'],
  ['Local request stopped. Remote completion and charges are unverified.','may still complete or charge'],
  ['Meta stream stalled. Local transport stopped; remote outcome and charges are unverified.','may still complete or charge'],
  ['Local Codex transport disconnected.','may still complete or charge'],
 ])('explains the recovery without exposing internals for %s',(raw,expected)=>{
  const message=publicErrorMessage(new Error(raw));expect(message).toContain(expected);expect(message).not.toMatch(/\/Users\/|\/tmp\/|\.runtime|schemaVersion|output_tokens|\{"/);expect(publicErrorMessage(message)).toBe(message);
 });
 it('does not accept a safe-looking prefix with appended private data',()=>{
  expect(publicErrorMessage('The response was incomplete. Check your connection before trying again. /Users/private/key')).not.toContain('/Users');
 });
 it('preserves only the exact saved-work recovery messages',()=>{
  for(const message of [savedWorkUnavailable,'Saved work changed while opening. Search again to choose from the current task list.','This saved task is no longer available. Search again.']){
   expect(publicErrorMessage(new Error(message))).toBe(message);
   expect(publicErrorMessage(`Error invoking remote method 'companion:command': Error: ${message}`)).toBe(message);
   expect(publicErrorMessage(publicErrorMessage(message))).toBe(message);
   expect(publicErrorMessage(message+' /Users/private/file')).not.toContain('/Users/private/file');
  }
 });
 it('preserves the exact actionable unavailable-foreground message without changing it into a rebind error',()=>{
  const message='Switch to the window you want to use, then press the screen context shortcut again.';
  expect(publicErrorMessage(message)).toBe(message);
  expect(publicErrorMessage(message+' /Users/private/file')).not.toContain('/Users');
 });
 it('explains the current browser redirect limit without exposing unrelated diagnostics',()=>{
  const message='Automatic page redirects are not supported in this browser yet. Open the final page address and try again.';
  expect(publicErrorMessage(message)).toBe(message);expect(publicErrorMessage(message+' /Users/private/file')).not.toContain('/Users');
 });
 it('distinguishes an expired intake from an unavailable global shortcut',()=>{
  const message=publicErrorMessage('This screen selection expired. Use the shortcut again.');expect(message).toBe('This capture request has ended. Use the screen context shortcut again.');expect(publicErrorMessage(message)).toBe(message);
 });
 it('explains connection startup and account availability without diagnostic detail',()=>{
  expect(connectionIssueMessage('This installed Codex connection does not advertise GPT-6 Luna.')).toContain('not available for this account');
  expect(connectionIssueMessage('GPT-6 Luna Fast is not advertised by this connection.')).toContain('not available for this account');
  expect(connectionIssueMessage('The local Codex CLI could not be started. /Users/private/bin')).toBe('Codex could not be opened. Open or update Codex, then check the connection.');
  expect(connectionIssueMessage('An existing signed-in ChatGPT Codex connection is required.')).toContain('sign in');
 });
 it('uses natural labels without changing stored status values',()=>{
  expect(requestStatusLabel('cancelled')).toBe('Stopped');expect(sourceRoleLabel('fact')).toBe('Source material');
 });
});


it('preserves exact recurring authorization recovery copy without accepting appended private data',()=>{
 for(const message of ['Recurring responses were not authorized. The schedule stays paused.','Codex sign-in metadata is unavailable. Recurring responses cannot be authorized.','The account or instructions changed. Resume again to authorize the current scope.']){expect(publicErrorMessage(new Error(message))).toBe(message);expect(publicErrorMessage(message+' /Users/private/secret')).not.toContain('/Users/private');}
});
