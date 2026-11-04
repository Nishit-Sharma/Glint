import {describe,it,expect} from 'vitest';
import {installedSpeechVoices} from '../../src/host/document-speech';
import {resolveSpeechVoice} from '../../src/shared/document-speech';
const before='Daniel  en_GB # Hello\nSamantha (English (US))  en_US # Hello\n';
const after='Daniel (English (UK))  en_GB # Hello\nSamantha  en_US # Hello\n';
describe('Captured native speech voice aliases',()=>{
 it('restores captured Daniel and Samantha labels with the same qualified language and refuses unknown or ambiguous aliases',()=>{
  const old=installedSpeechVoices(before),current=installedSpeechVoices(after);
  expect(resolveSpeechVoice(current,{voice:'Daniel'})).toEqual({name:'Daniel (English (UK))',language:'en_GB'});
  expect(resolveSpeechVoice(current,{voice:'Samantha (English (US))'})).toEqual({name:'Samantha',language:'en_US'});
  expect(resolveSpeechVoice(old,{voice:'Daniel (English (UK))',voiceLanguage:'en_GB'})).toEqual({name:'Daniel',language:'en_GB'});
  expect(resolveSpeechVoice([{name:'Daniel (English (US))',language:'en_US'}],{voice:'Daniel'})).toBeUndefined();
  expect(resolveSpeechVoice([...current,{name:'Daniel (Alternative)',language:'en_GB'}],{voice:'Daniel'})).toBeUndefined();
  expect(resolveSpeechVoice([{name:'Other (English (UK))',language:'en_GB'}],{voice:'Other'})).toBeUndefined();
  expect(resolveSpeechVoice([{name:'New voice (English (UK))',language:'en_GB'}],{voice:'New voice',voiceLanguage:'en_GB'})).toEqual({name:'New voice (English (UK))',language:'en_GB'});
 });
});
