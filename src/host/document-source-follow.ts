import type {Companion} from '../core/companion';
import type {Task} from '../core/types';
import {documentStampChange,persistedDocumentStamp,type DocumentBinding,type DocumentObservation,type RuntimeDocumentStamp,type DocumentCapture} from '../shared/document-source';
import type {NativeWindow} from './native';

type Selection={task:Task;sourceId:string;target:NativeWindow;capture?:DocumentCapture};
type Bound={binding:DocumentBinding;target:NativeWindow;stamp?:RuntimeDocumentStamp};
export type DocumentFollowStatus=
 | {kind:'off';capabilityVersion:1;reason:string}
 | {kind:'bound';capabilityVersion:1;taskId:string;sourceId:string;windowId:string;automaticSnapshots:'off'|'on'|'paused';reason:string;evidence:'foreground-application-correlation'|'unavailable'};
type Dependencies={
 core:Pick<Companion,'getTask'|'reconcileDocumentSource'>;
 observe(target:NativeWindow,options:{signal:AbortSignal;assertCurrent:()=>void}):Promise<DocumentObservation>;
 approve(scope:{taskId:string;sourceId:string;windowId:string;application:string;title:string},assertCurrent:()=>void):Promise<boolean>;
 refresh(binding:DocumentBinding,stamp:RuntimeDocumentStamp,assertCurrent:()=>void):Promise<Selection|null>;
 retire(binding:DocumentBinding):void;
 changed(taskId:string):void;
};
const bindingFor=({task,sourceId,target,capture}:Selection):Bound=>{
 const source=task.sources.find(source=>source.id===sourceId),version=source?.versions.at(-1);
 if(!version||version.kind!=='window'||version.windowId!==target.id||version.windowProcessId!==target.owner.processId)throw Error('Select an exact saved window source.');
 if(capture&&(capture.ref.sourceId!==sourceId||capture.ref.version!==version.version||capture.ref.digest!==version.digest||capture.stamp.digest!==version.documentStamp?.digest||capture.stamp.method!==version.documentStamp?.method||capture.stamp.evidence!==version.documentStamp?.evidence||capture.stamp.edited!==undefined&&typeof capture.stamp.edited!=='boolean'))throw Error('The live capture does not match the exact saved source.');
 return {binding:{taskId:task.id,ref:{sourceId,version:version.version,digest:version.digest},windowId:target.id,processId:target.owner.processId},target,stamp:capture?{...capture.stamp}:version.documentStamp?persistedDocumentStamp(version.documentStamp):undefined};
};

/** A host-session capability. Durable task/source data never recreates this grant. */
export class DocumentSourceFollow{
 private epoch=0;
 private abort=new AbortController();
 private selected:Bound|undefined;
 private granted=false;
 private reviewing:symbol|undefined;
 private running:Promise<DocumentFollowStatus>|undefined;
 private status:DocumentFollowStatus={kind:'off',capabilityVersion:1,reason:'Choose a window explicitly to follow its document metadata.'};
 constructor(private readonly dependencies:Dependencies){}
 read():DocumentFollowStatus{return structuredClone(this.status);}
 stop(reason='Document following stopped. Use a new gesture to bind a window.'){
  this.epoch++;this.abort.abort();this.abort=new AbortController();
  this.selected=undefined;this.granted=false;this.running=undefined;this.reviewing=undefined;this.status={kind:'off',capabilityVersion:1,reason};
 }
 bind(selection:Selection){
  const next=bindingFor(selection);this.stop('Source binding replaced.');this.selected=next;
  this.present('off',next.stamp?'Document metadata is followed for this selected window. Snapshots need a separate follow choice.':'Document identity is unavailable. The captured window remains a frozen snapshot.');
  return this.read();
 }
 private present(mode:'off'|'on'|'paused',reason:string){
  const current=this.selected;if(!current)return;
  this.status={kind:'bound',capabilityVersion:1,taskId:current.binding.taskId,sourceId:current.binding.ref.sourceId,windowId:current.binding.windowId,automaticSnapshots:mode,reason,evidence:current.stamp?.evidence??'unavailable'};
 }
 private guard(epoch:number,selected:Bound){
  if(epoch!==this.epoch||selected!==this.selected||this.abort.signal.aborted)throw Error('Document follow authority retired.');
 }
 assertGrant(binding:DocumentBinding){
  const current=this.selected?.binding;
  if(!this.granted||!current||current.taskId!==binding.taskId||current.ref.sourceId!==binding.ref.sourceId||current.ref.version!==binding.ref.version||current.ref.digest!==binding.ref.digest||current.windowId!==binding.windowId||current.processId!==binding.processId)throw Error('This selected-window follow choice expired.');
 }
 async enable():Promise<DocumentFollowStatus>{
  const selected=this.selected,epoch=this.epoch;if(!selected)throw Error('Choose a window explicitly before enabling document follow.');
  if(this.granted)return this.read();
  if(this.reviewing)throw Error('Finish the current document-follow review.');
  const guard=()=>this.guard(epoch,selected),review=Symbol();this.reviewing=review;
  try{
   const before=await this.dependencies.observe(selected.target,{signal:this.abort.signal,assertCurrent:guard});guard();
   if(before.kind==='frozen')throw Error(`Document following is unavailable (${before.reason}). Use an explicit snapshot.`);
   const approved=await this.dependencies.approve({taskId:selected.binding.taskId,sourceId:selected.binding.ref.sourceId,windowId:selected.binding.windowId,application:selected.target.owner.name,title:selected.target.title},guard);guard();
   if(!approved){this.present('off','Automatic snapshots were not enabled.');return this.read();}
   const after=await this.dependencies.observe(selected.target,{signal:this.abort.signal,assertCurrent:guard});guard();
   if(after.kind==='frozen')throw Error(`Document following is unavailable (${after.reason}). Use an explicit snapshot.`);
   const task=await this.dependencies.core.getTask(selected.binding.taskId);guard();
   const source=task.sources.find(source=>source.id===selected.binding.ref.sourceId),version=source?.versions.at(-1);
   if(!source||version?.version!==selected.binding.ref.version||version.digest!==selected.binding.ref.digest)throw Error('The reviewed source changed. Refresh it explicitly.');
   this.granted=true;this.present(after.kind==='inactive'?'paused':'on','Automatic snapshots follow document-address changes in this selected active window for this session. No requests are sent automatically.');return this.read();
  }finally{if(this.reviewing===review)this.reviewing=undefined;}
 }
 poll():Promise<DocumentFollowStatus>{
  if(this.running)return this.running;
  const result=this.observe();this.running=result;void result.finally(()=>{if(this.running===result)this.running=undefined;}).catch(()=>{});return result;
 }
 private async observe():Promise<DocumentFollowStatus>{
  const selected=this.selected,epoch=this.epoch;if(!selected)return this.read();
  const guard=()=>this.guard(epoch,selected);
  try{
   const task=await this.dependencies.core.getTask(selected.binding.taskId);guard();
   const saved=task.sources.find(source=>source.id===selected.binding.ref.sourceId)?.versions.at(-1);
   if(task.status!=='active'||saved?.version!==selected.binding.ref.version||saved.digest!==selected.binding.ref.digest){this.stop('The selected source or task was replaced. Bind it again explicitly.');return this.read();}
   const observation=await this.dependencies.observe(selected.target,{signal:this.abort.signal,assertCurrent:guard});guard();
   if(observation.kind==='inactive'){this.present(this.granted?'paused':'off','The selected window is in the background. No document metadata or snapshots are read from other windows.');return this.read();}
   if(observation.kind==='frozen'&&!selected.stamp&&!this.granted&&!['closed','excluded'].includes(observation.reason)){this.present('paused',`Document following is unavailable (${observation.reason}). Your explicit snapshot stays frozen and can be reviewed until its original expiry.`);return this.read();}
   const unchanged=observation.kind==='document'&&selected.stamp?.digest===observation.stamp.digest;
   const editedChanged=observation.kind==='document'&&selected.stamp&&documentStampChange(selected.stamp,observation.stamp)==='edited-state-changed';
   if(!unchanged||editedChanged)this.dependencies.retire(selected.binding);
   const transition=observation.kind==='document'&&selected.stamp&&typeof selected.stamp.edited==='boolean'&&typeof observation.stamp.edited==='boolean'&&editedChanged
    ?{kind:'edited-transition' as const,before:{...selected.stamp,edited:selected.stamp.edited},after:{...observation.stamp,edited:observation.stamp.edited}}:observation;
   const reconciled=await this.dependencies.core.reconcileDocumentSource(selected.binding,transition,guard);guard();
   if(reconciled.kind==='superseded'){this.stop('The selected source was replaced. Bind it again explicitly.');return this.read();}
   const source=reconciled.task.sources.find(source=>source.id===selected.binding.ref.sourceId);
   if(reconciled.kind==='invalidated')this.dependencies.changed(selected.binding.taskId);
   if(unchanged&&source?.freshness==='refresh-required'&&source.documentChange?.kind==='changed'&&source.documentChange.observedDigest===selected.stamp?.digest){this.dependencies.retire(selected.binding);this.present('paused','This same-address snapshot is historical. Capture it again explicitly. The existing follow choice covers document-address changes only.');return this.read();}
   if(unchanged&&source?.freshness==='fresh'){this.present(this.granted?'on':'off','The document-address observation is unchanged. Content edits at the same address remain unknown.');return this.read();}
   if(unchanged){this.dependencies.retire(selected.binding);if(source?.documentChange?.kind!=='changed'){this.present('paused','Window metadata changed without a reported document-address change. Take an explicit snapshot, or wait for a supported document change.');return this.read();}}
   if(observation.kind!=='document'){this.granted=false;this.present('paused',observation.kind==='frozen'?`Document following is frozen (${observation.reason}). Use an explicit snapshot.`:'The snapshot has no comparable document observation. Refresh it explicitly.');return this.read();}
   if(!this.granted){this.present('off','The document-address observation changed. The previous snapshot is historical. Choose a new snapshot.');return this.read();}
   this.assertGrant(selected.binding);
   const refreshed=await this.dependencies.refresh(selected.binding,observation.stamp,()=>{guard();this.assertGrant(selected.binding);});guard();
   if(!refreshed){this.present('paused','The companion has no room beside this window. No new snapshot or model request was made.');return this.read();}
   const next=bindingFor(refreshed);
   if(next.binding.taskId!==selected.binding.taskId||next.binding.ref.sourceId!==selected.binding.ref.sourceId||next.binding.windowId!==selected.binding.windowId||next.binding.processId!==selected.binding.processId||!next.stamp||documentStampChange(observation.stamp,next.stamp)!==undefined)throw Error('The refreshed snapshot does not match the followed window.');
   this.selected=next;this.present('on','A fresh snapshot of the selected active window replaced its previous version. Previous results remain historical.');return this.read();
  }catch(error){
   if(epoch!==this.epoch||selected!==this.selected)return this.read();
   this.granted=false;this.dependencies.retire(selected.binding);this.present('paused',error instanceof Error?error.message:'Document following is unavailable.');return this.read();
  }
 }
}
