import {expect,it} from 'vitest';
import type {Task} from '../../src/core/types';
import {readSpeechCommand,speechText,type SpeechTarget} from '../../src/shared/document-speech';

const digest='a'.repeat(64),revision={revision:1,title:'Synthetic reading text',content:'First line.\nSecond line.',mimeType:'text/plain',sourceRefs:[],digest,createdAt:'2026-11-01T00:00:00.000Z'},task={id:'reading-owner',artifacts:[{id:'reading-text',revisions:[revision]}],sources:[]} as unknown as Task;
it('reads the exact selected passage instead of silently substituting the whole saved document',()=>{
 const target={kind:'document',artifactId:'reading-text',revision:1,digest,range:{start:12,end:24}} as unknown as SpeechTarget;
 expect(speechText(task,target).text).toBe('Second line.');expect(revision.content).toBe('First line.\nSecond line.');
});
it('rejects an unavailable selected range without reading another part of the document',()=>{
 expect(()=>speechText(task,{kind:'document',artifactId:'reading-text',revision:1,digest,range:{start:12,end:100}} as unknown as SpeechTarget)).toThrow();
});
it('binds a Unicode selection to its exact canonical version and refuses split surrogate boundaries',()=>{
 const unicode={...task,artifacts:[{id:'reading-text',revisions:[{...revision,content:'A Café 東京😀 Z'}]}]},target={kind:'document' as const,artifactId:'reading-text',revision:1,digest,range:{start:2,end:11}};
 expect(readSpeechCommand({type:'speech.select',taskId:task.id,expectedRevision:0,target,voice:'Installed voice',speed:1})).toMatchObject({target});expect(speechText(unicode as Task,target).text).toBe('Café 東京😀');expect(()=>speechText(unicode as Task,{...target,range:{start:2,end:10}})).toThrow();
});
