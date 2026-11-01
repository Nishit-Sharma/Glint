import {MemoryReceipt} from '../UserMemory';
import type {UserMemory} from '../../../shared/user-memory';
import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {ArrowUpRight,ChevronDown,FileText,Layers,Minus,RefreshCw,Square,AppWindow,EyeOff} from 'lucide-react';
import type {Artifact,Source,SourceRef,Task} from '../../../core/types';
import type {AttachedWindow,ConnectionStatus,CompactFit,CompactFitBounds} from '../../../shared/bridge';
import {StreamingText} from './StreamingText';
import {GeneratedSurface} from './GeneratedSurface';
import {ReadyArtifact,usePresentationSession} from './ReadyArtifact';
import {ReadableText} from './ReadableText';
import {presentationIdentity} from '../surface-identity';
import {changedDependencies} from '../editor-state';
import {Button} from '../ui';
import {publicErrorMessage,requestStatusLabel} from '../../../shared/public-messages';
import {browserRequestOutcome,earlierBrowserOutcome,requestArtifact} from '../browser-outcome';
import {SOURCE_FORMULA_MIME,readSourceFormulaPacket} from '../../../learning/source-formula';
import {WindowSourceContinuity} from './WindowSourceContinuity';

const latest=<T,>(items:T[])=>items[items.length-1];
interface Props {
 memory?:UserMemory;character:ReactNode;active:boolean;compactFit?:CompactFit;task?:Task;loaded:boolean;busy:boolean;connection?:ConnectionStatus;attachedWindow?:AttachedWindow;
 running:boolean;anyRunning:boolean;requestId?:string;stream?:string;error:string;notice:string;composer:ReactNode;draftText?:string;
 onWorkspace:(page?:'work'|'sources'|'tasks'|'roster'|'settings')=>void;onReviewSource:(reference:SourceRef,isCurrent?:()=>boolean)=>void;sourceReviewCurrent?:()=>boolean;
 onArtifact:(artifact:Artifact)=>void;onRefresh:(source:Source)=>void;onCaptureAttached:()=>void;
 onHide?:()=>void;onCollapse:()=>void;onStop:()=>void;onDismissError:()=>void;
 contextContent?:ReactNode;renderBrief?:(artifact:Artifact)=>ReactNode;onStartContext:()=>void;
 selectedSourceIds?:string[];onSourceSelection:(id:string)=>void;
}
export function CompactCompanion({memory,character,active,compactFit,task,loaded,busy,attachedWindow,running,anyRunning,requestId,stream,error,notice,composer,draftText='',onWorkspace,onReviewSource,sourceReviewCurrent,onArtifact,onRefresh,onCaptureAttached,onHide,onCollapse,onStop,onDismissError,contextContent,renderBrief,onStartContext,selectedSourceIds,onSourceSelection}:Props){
 const presentation=usePresentationSession();
 const [preparedFitId,setPreparedFitId]=useState<string>(),[failedFitId,setFailedFitId]=useState<string>(),[selectedId,setSelectedId]=useState<string>(),main=useRef<HTMLElement>(null),content=useRef<HTMLDivElement>(null);
 const fitFailed=!!compactFit&&failedFitId===compactFit.id;
 const sources=task?.sources??[];
 const scopeIds=selectedSourceIds??sources.map(source=>source.id);
 const selected=scopeIds.length===1?sources.find(source=>source.id===scopeIds[0]):undefined;
 const version=selected&&latest(selected.versions);
 const currentRequest=task?.requests.at(-1),saved=task&&currentRequest?requestArtifact(task,currentRequest):undefined;
 const artifact=currentRequest?saved?.artifact:task&&[...task.artifacts].sort((a,b)=>latest(b.revisions).createdAt.localeCompare(latest(a.revisions).createdAt))[0],revision=artifact&&latest(artifact.revisions);
 const ownsResponse=!!requestId&&(!currentRequest||currentRequest.id===requestId||(running&&!task?.requests.some(request=>request.id===requestId)));
 const currentStream=ownsResponse?stream:undefined,currentRunning=(running&&ownsResponse)||currentRequest?.status==='running';
 const outcome=task&&currentRequest?browserRequestOutcome(task,currentRequest):undefined;
 const earlierOutcome=task&&currentRequest?earlierBrowserOutcome(task,currentRequest)?.outcome:undefined;
 const showOutcome=!!currentRequest&&(!!outcome||currentRequest.status!=='completed'||!revision)&&!currentRunning&&!currentStream;

 const uncaptured=!!attachedWindow&&!sources.some(source=>latest(source.versions).kind==='window'&&latest(source.versions).windowId===attachedWindow.id),stale=selected?.freshness==='refresh-required';
 const differentSelectedWindow=!!attachedWindow&&version?.kind==='window'&&version.windowId!==attachedWindow.id;
 const sourceName=uncaptured?attachedWindow!.title:scopeIds.length===0?'Only your question':scopeIds.length>1?`${scopeIds.length} sources selected`:version?.label||'No source attached';
 let formulaValid=false;if(revision?.mimeType===SOURCE_FORMULA_MIME)try{readSourceFormulaPacket(revision.content);formulaValid=true;}catch{/* Unsupported saved packets are never displayed as raw text. */}
 const itemIdentity=[task?.id,artifact?.id,revision?.revision,revision?.digest].join(':');
 const renderedBrief=artifact&&revision?.mimeType!==SOURCE_FORMULA_MIME&&renderBrief?.(artifact),isShownBrief=!!renderedBrief&&!currentStream&&!currentRunning&&!showOutcome;
 const resultRefs=(currentStream||currentRunning)?task?.requests.find(request=>request.id===(ownsResponse?requestId:currentRequest?.id))?.sourceRefs:revision?.sourceRefs;
 const differentScope=selectedSourceIds!==undefined&&!!resultRefs&&(scopeIds.length!==resultRefs.length||scopeIds.some(id=>!resultRefs.some(ref=>ref.sourceId===id&&sources.find(s=>s.id===id)?.currentVersion===ref.version)));
 const citations=resultRefs?.map(ref=>({ref,version:sources.find(source=>source.id===ref.sourceId)?.versions.find(version=>version.version===ref.version&&version.digest===ref.digest)}));
 const outdatedResult=!!task&&!!resultRefs&&changedDependencies(task,resultRefs).length>0;
 useEffect(()=>{if(active)main.current?.focus({preventScroll:true});},[active]);
 useLayoutEffect(()=>{
  if(!active||!main.current||!content.current)return;
  const root=main.current.closest<HTMLElement>('.compact-companion'),body=root?.querySelector<HTMLElement>('.compact-body');if(!root||!body)return;
  let frame=0,disposed=false,request=0,lastSent='',reserved=false,reserving=false,preparing=false;
  // Keep the leased snapshot geometry until exit/cancel hands ownership back.
  // Text and task updates continue; only presentation fitting is held.
  const size=(height:number)=>{if(presentation.exiting)return;root.style.height=height+'px';root.style.setProperty('--compact-height',height+'px');};
  const fail=()=>{if(!disposed&&!presentation.exiting&&compactFit)setFailedFitId(compactFit.id);};
  const phase=()=>root.dataset.surfaceReveal==='running'?'running':root.dataset.surfaceReveal==='pending'?'preparing':'settled';
  const freeze=async()=>{
   cancelAnimationFrame(frame);if(presentation.exiting)return false;if(reserved)return true;if(disposed||reserving||!compactFit)return false;
   const at=++request;reserving=true;lastSent='running';
   try{const result=await window.companion.invoke<CompactFitBounds|null>({type:'surface.fit',fitId:compactFit.id,height:Math.min(100000,Math.ceil(root.offsetHeight)),phase:'running'});if(disposed||presentation.exiting||at!==request||!result)return false;size(result.height);reserved=true;return true;}
   catch{return false;}finally{reserving=false;}
  };
  const fit=()=>{
   if(presentation.exiting){cancelAnimationFrame(frame);request++;lastSent='';return;}
   if(phase()==='running'){void freeze();return;}
   cancelAnimationFrame(frame);frame=requestAnimationFrame(async()=>{
    if(disposed||presentation.exiting||!content.current||!main.current)return;const state=phase();if(state==='running'){void freeze();return;}if(state==='preparing'&&(reserved||preparing))return;
    const chrome=root.querySelector<HTMLElement>('.compact-chrome')!.offsetHeight;
    const parts=[...body.children].filter(node=>node!==main.current).reduce((sum,node)=>sum+(node as HTMLElement).offsetHeight,0);
    const style=getComputedStyle(main.current),padding=parseFloat(style.paddingTop)+parseFloat(style.paddingBottom);
    const natural=Math.min(100000,Math.ceil(Math.max(220,chrome+8+parts+content.current.scrollHeight+padding+2)));
    if(!compactFit){size(innerHeight);return;}
    const key=state+':'+natural+':'+compactFit.maxHeight;if(key===lastSent)return;lastSent=key;const at=++request;
    if(state==='preparing')preparing=true;else reserved=false;
    try{const result=await window.companion.invoke<CompactFitBounds|null>({type:'surface.fit',fitId:compactFit.id,height:natural,phase:state});if(disposed||presentation.exiting||at!==request||phase()!==state)return;if(!result){preparing=false;fail();return;}size(result.height);}
    catch{preparing=false;if(!disposed&&at===request)fail();return;}
    if(disposed||presentation.exiting||at!==request||phase()!==state)return;
    if(state==='preparing'){
     // Reserve native bounds BEFORE allowing the original runtime to measure.
     // This closes replies already committed in main but still in IPC transit.
     if(!await freeze()){preparing=false;fail();return;}const reservation=request;
     requestAnimationFrame(()=>requestAnimationFrame(()=>{if(!disposed&&!presentation.exiting&&reservation===request&&phase()==='preparing')setPreparedFitId(compactFit.id);}));
    }
    preparing=false;
   });
  };
  const resize=new ResizeObserver(fit);resize.observe(content.current);const compose=body.querySelector('.compact-compose');if(compose)resize.observe(compose);
  const state=new MutationObserver(fit);state.observe(root,{attributes:true,attributeFilter:['data-surface-reveal']});window.addEventListener('resize',fit);const unsubscribe=presentation.subscribe(fit);fit();
  return()=>{disposed=true;request++;cancelAnimationFrame(frame);resize.disconnect();state.disconnect();unsubscribe();window.removeEventListener('resize',fit);};
 },[active,loaded,compactFit?.id,compactFit?.maxHeight,presentation]);
 return <GeneratedSurface className="app compact-companion" active={active} ready={loaded&&(fitFailed||!compactFit||preparedFitId===compactFit.id)} skipReason={fitFailed?'native bounds could not be reserved':undefined} label="Attached companion" identity={presentationIdentity(task,attachedWindow)+':'+selected?.id+':'+loaded} live={busy||running}>
  <header className="chrome compact-chrome" data-generation-live-region>{character}<button className="compact-task" onClick={()=>onWorkspace(task?'roster':'tasks')} aria-label={task?'Choose task: '+task.title:'Start a task'}><strong>{task?.title||'Companion'}</strong><ChevronDown size={12}/></button><div className="chrome-actions">{anyRunning&&!running&&<Button kind="icon" title="Stop current request" onClick={onStop}><Square size={13}/></Button>}<Button kind="icon" title="Open task workspace" onClick={()=>onWorkspace(task?undefined:'tasks')}><AppWindow size={15}/></Button><Button kind="icon" title="Hide floating companion" onClick={onHide} disabled={!onHide}><EyeOff size={15}/></Button><Button data-presentation-exit-control kind="icon" title="Collapse to edge anchor" onClick={onCollapse}><Minus size={15}/></Button></div></header>
  <div className="compact-body" data-generation-live-region>
  {notice&&<p className="compact-notice" role="status">{notice}</p>}
  {!contextContent&&(uncaptured||(scopeIds.length>0&&!currentRequest&&!revision&&!currentStream&&!currentRunning))&&<div className="compact-source">
   <div className="compact-source-heading"><Layers size={12}/>{!attachedWindow&&sources.length>1?<label className="compact-source-choice"><span className="sr-only">Source to inspect</span><select value={selected?.id||''} onChange={event=>{setSelectedId(event.target.value);onSourceSelection(event.target.value);}}><option value="" disabled>{sourceName}</option>{sources.map(source=><option key={source.id} value={source.id}>{latest(source.versions).label}</option>)}</select></label>:<strong title={sourceName}>{sourceName}</strong>}
    <span className={'compact-source-status'+(stale||uncaptured?' stale':'')}>{uncaptured?'Not captured':stale?'Refresh required':version?.kind==='window'?'Snapshot':version?'Saved':''}</span>
    {uncaptured?<Button kind="text" disabled={busy} onClick={onCaptureAttached}>Capture</Button>:version?.kind==='window'?<Button kind="icon" title="Refresh selected source snapshot" disabled={busy} onClick={()=>onRefresh(selected!)}><RefreshCw size={12}/></Button>:<Button kind="text" title={version?'Manage sources':'Add source'} onClick={()=>onWorkspace('sources')}>{scopeIds.length?'Review':'Add source'}</Button>}
   </div>
   <span className="sr-only">{uncaptured?'This window has not been captured. ':''}{scopeIds.length} selected task references will be used. Frozen snapshots expire after five minutes. Refresh when the source changes.</span>
  </div>}
  <main ref={main} tabIndex={-1} className="compact-main" aria-label="Current source and request">
  <div className="compact-content" ref={content}>
   {fitFailed&&<p className="warning" role="alert">The opening was interrupted. Close and reopen Glint to try again. Your task is kept.</p>}
   {error&&<div className="message error" role="alert"><span>{publicErrorMessage(error)}</span><Button title="Dismiss error" kind="icon" onClick={onDismissError}>×</Button></div>}
   {contextContent?contextContent:!loaded?<p className="loading">Opening…</p>:!task?<div className="context-welcome"><h2>What’s on your screen?</h2><p>Use your shortcut to understand a window and find useful next steps.</p><Button onClick={onStartContext}>Use screen context</Button></div>:<>
    {task.status==='paused'&&<p className="warning">Task paused. Resume in the workspace.</p>}
    {!uncaptured&&differentSelectedWindow&&<p className="tiny" role="status">The attached window differs from the selected source: {version?.label}. Review Context to change the selected source.</p>}
    {!uncaptured&&!differentSelectedWindow&&selected&&version?.kind==='window'&&<WindowSourceContinuity task={task} sourceId={selected.id} onReview={onReviewSource} isCurrent={sourceReviewCurrent}/>}
    {(currentStream||currentRunning)?<section className="compact-response" aria-label="Current response">{!currentRunning&&<div className="compact-result-heading"><strong>Partial response</strong></div>}<StreamingText text={currentStream||'Preparing a response…'} streaming={active&&currentRunning}/></section>:showOutcome?<section className="compact-response" aria-label="Latest request outcome"><p className="conversation-status" role="status">{outcome?.label??requestStatusLabel(currentRequest!.status)}</p>{outcome?.message?<p>{outcome.message}</p>:currentRequest!.error&&<p className="warning">{publicErrorMessage(currentRequest!.error)}</p>}<button type="button" className="conversation-open" onClick={()=>onWorkspace('work')}>{outcome?.needsReview||earlierOutcome?.needsReview?'Review browser outcome':'View request in conversation'}<ArrowUpRight size={14}/></button></section>:revision&&artifact?(renderedBrief||<section className="settled-result" aria-label="Latest saved result"><div className="settled-result-card">{revision.mimeType==='image/png'&&revision.encoding==='base64'?<ReadyArtifact identity={itemIdentity} variant="image"><img className="compact-artifact-image" src={'data:image/png;base64,'+revision.content} alt={revision.title}/></ReadyArtifact>:revision.mimeType===SOURCE_FORMULA_MIME&&!formulaValid?<p role="status">This saved source formula needs inspection. Its original content is kept.</p>:revision.mimeType==='application/json'||formulaValid?<ReadyArtifact identity={itemIdentity}><button className="compact-structured" onClick={()=>onArtifact(artifact)}><FileText size={17}/><span><strong>{revision.title}</strong><small>Review and edit</small></span><ArrowUpRight size={14}/></button></ReadyArtifact>:<ReadableText text={revision.content}/>}</div></section>):!draftText.trim()&&!uncaptured?<div className="context-welcome"><Button onClick={onStartContext}>Use screen context</Button></div>:null}
    {currentRequest&&<MemoryReceipt receipt={currentRequest.memory} status={currentRequest.status} memory={memory}/>}
    {earlierOutcome&&<section aria-label="Earlier browser action"><p className="conversation-status" role="status">Earlier browser action: {earlierOutcome.label}</p><p className="tiny">{earlierOutcome.needsReview?earlierOutcome.message:'The earlier website outcome was reviewed by you. See its request for the recorded evidence.'}</p>{!showOutcome&&<button type="button" className="conversation-open" onClick={()=>onWorkspace('work')}>{earlierOutcome.needsReview?'Review browser outcome':'View request in conversation'}<ArrowUpRight size={14}/></button>}</section>}
    {!isShownBrief&&citations&&citations.length>0&&<div className="compact-citations" aria-label="Response sources">{citations.map(({ref,version})=><button key={[ref.sourceId,ref.version,ref.digest].join(':')} onClick={()=>onReviewSource(ref)} title={'View the source used for this response'}>{version?.label||'Earlier source'}</button>)}{outdatedResult&&<div className="compact-result-recovery" role="status"><span>Earlier context. Review sources before continuing.</span><button onClick={()=>onWorkspace('sources')}>Review sources</button></div>}</div>}
    {!isShownBrief&&!currentStream&&!currentRunning&&!showOutcome&&revision&&artifact&&revision.mimeType!=='application/json'&&revision.mimeType!==SOURCE_FORMULA_MIME&&<button className="compact-open-result" aria-label={'Open saved result: '+revision.title} onClick={()=>onArtifact(artifact)}>Open {revision.title}<ArrowUpRight size={12}/></button>}
   </>}
  </div></main>
  {task&&!contextContent&&<div className="compact-compose">{differentScope&&<button className="compact-next-scope" onClick={()=>onWorkspace('sources')}>Next message: {sourceName}</button>}{composer}</div>}
  </div>
 </GeneratedSurface>;
}
