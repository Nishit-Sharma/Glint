import {describe,expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {ArtifactRevision,Checkpoint,ExportAction,RequestRecord,Task} from '../../src/core/types';
import {buildHistoryEvents,historyRevision,historyTime,requestResultReference,validCheckpointNote} from '../../src/renderer/src/components/history-events';
import {TaskHistory} from '../../src/renderer/src/components/TaskHistory';

const at=(hour:number)=>`2026-10-24T${String(hour).padStart(2,'0')}:00:00.000Z`;
const revision=(number:number):ArtifactRevision=>({revision:number,title:`Report ${number}`,content:`Content ${number}`,mimeType:'text/plain',sourceRefs:[],digest:'saved-content',createdAt:at(number)});
const checkpoint=(id:string,hour:number):Checkpoint=>({id,note:id,createdAt:at(hour),sourceRefs:[],artifacts:[]});
const request=(patch:Partial<RequestRecord>={}):RequestRecord=>({id:'request-a',kind:'create',prompt:'Draft the visit report.',digest:'request-content',status:'completed',sourceRefs:[],startedAt:at(10),finishedAt:at(14),artifactId:'report',...patch});
const action=(status:ExportAction['status']='proposed'):ExportAction=>({proposal:{id:'export-'+status,taskId:'task',artifactId:'report',revision:1,path:'/chosen/report.txt',parentRealPath:'/chosen',parentDevice:'device',parentInode:'inode',artifactDigest:'saved-content',sourceRefs:[],byteLength:9,digest:'proposal-content',createdAt:at(11)},status,...(status==='verified'?{evidence:{path:'/chosen/report.txt',byteLength:9,digest:'saved-content',verifiedAt:at(15)}}:{}),...(['failed','retired','uncertain'].includes(status)?{error:'The outcome is uncertain.'}:{})});
const task=(patch:Partial<Task>={}):Task=>({id:'task',title:'Visit report',goal:'',status:'active',createdAt:at(1),updatedAt:at(16),sources:[],artifacts:[{id:'report',revisions:[revision(1),revision(2),revision(3),revision(4)]}],requests:[],checkpoints:[],procedures:[],actions:[],memory:{enabled:false},...patch});
const render=(value:Task,open=true)=>renderToStaticMarkup(createElement(TaskHistory,{task:value,busy:false,run:async()=>undefined,...(open?{onOpenRevision:()=>{}}:{})}));

describe('one recorded history chronology',()=>{
 it('interleaves all record types by creation time without relabeling later states or mutating arrays',()=>{
  const checkpoints=[checkpoint('early',9),checkpoint('latest',12)],requests=[request()],actions=[action('verified')];
  const events=buildHistoryEvents({checkpoints,requests,actions});
  expect(events.map(event=>event.id)).toEqual(['checkpoint:latest','export:export-verified','request:request-a','checkpoint:early']);
  expect(checkpoints.map(item=>item.id)).toEqual(['early','latest']);expect(requests[0].finishedAt).toBe(at(14));expect(actions[0].evidence?.verifiedAt).toBe(at(15));
  expect(events.find(event=>event.kind==='export')?.at).toBe(at(11));
 });
 it('renders the merged order and labels request timestamps as starts',()=>{
  const html=render(task({checkpoints:[checkpoint('Latest checkpoint',12)],requests:[request()],actions:[action()]}));
  expect(html.indexOf('history-event-checkpoint')).toBeLessThan(html.indexOf('history-event-export'));expect(html.indexOf('history-event-export')).toBeLessThan(html.indexOf('history-event-request'));expect(html).toContain('Started ');expect(html).toContain('Finished ');
 });
 it('gives equal timestamps deterministic ordering and leaves invalid times unknown at the end',()=>{
  const events=buildHistoryEvents({checkpoints:[{...checkpoint('a',10),createdAt:'invalid'}],requests:[request()],actions:[{...action(),proposal:{...action().proposal,createdAt:at(10)}}]});
  expect(events.map(event=>event.kind)).toEqual(['export','request','checkpoint']);expect(historyTime('invalid')).toBe('Time unavailable');
 });
});

describe('exact history revisions',()=>{
 it('resolves the successful revision after its reviewed base, never the newest artifact',()=>{
  const reference=requestResultReference(request({kind:'revise',targetArtifactId:'report',expectedRevision:2}))!;
  expect(reference).toEqual({artifactId:'report',revision:3});expect(historyRevision(task(),reference)?.content).toBe('Content 3');
  expect(historyRevision(task({artifacts:[{id:'report',revisions:[revision(4)]}]}),reference)).toBeUndefined();
 });
 it('keeps checkpoint pairs exact when newer revisions exist',()=>{
  const saved={...checkpoint('Reviewed report',12),artifacts:[{artifactId:'report',revision:1}]};
  const html=render(task({checkpoints:[saved]}));expect(html).toContain('Report 1 · Revision 1');expect(html).not.toContain('Report 4');
 });
 it('does not invent outputs for non-completed or legacy revision requests',()=>{
  for(const status of ['running','failed','cancelled','interrupted'] as const)expect(requestResultReference(request({status}))).toBeUndefined();
  expect(requestResultReference(request({kind:'revise'}))).toBeUndefined();expect(requestResultReference(request({kind:'revise',targetArtifactId:'report',expectedRevision:0}))).toBeUndefined();expect(requestResultReference(request({targetArtifactId:'another-report',expectedRevision:1}))).toBeUndefined();
 });
 it('does not render a fake link when navigation is not wired or exact bytes are absent',()=>{
  expect(render(task({requests:[request()]}),false)).not.toContain('class="history-revision-link"');
  const html=render(task({requests:[request()],artifacts:[{id:'report',revisions:[revision(4)]}]}));expect(html).toContain('Saved revision 1 is no longer available.');expect(html).not.toContain('Report 4');
 });
});

it('keeps failed/retired/uncertain exports distinct from verified writes',()=>{
 const html=render(task({actions:[action('failed'),action('retired'),action('uncertain'),action('verified')]}));
 expect(html).toContain('Could not save');expect(html).toContain('Approval expired');expect(html).toContain('Check saved file');expect(html).toContain('Saved and checked');expect(html).not.toContain('Approve export');
});
it('rejects whitespace-only checkpoint text without stripping meaningful original spacing',()=>{
 for(const value of ['', ' ', '\n\t  '])expect(validCheckpointNote(value)).toBe(false);
 const note='  Confirm the host.\n';expect(validCheckpointNote(note)).toBe(true);expect(note).toBe('  Confirm the host.\n');
});
