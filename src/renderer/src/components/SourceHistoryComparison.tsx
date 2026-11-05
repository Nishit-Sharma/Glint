import {useLayoutEffect,useRef,useState} from 'react';
import type {Source,SourceRef,SourceVersion} from '../../../core/types';
import {sourceSnapshotDifference} from '../source-snapshot-difference';
import {sourceRoleLabel} from '../../../shared/public-messages';
import {Button} from '../ui';
import './source-snapshot-difference.css';

type View={owner:number;open:number;before:SourceRef;after:SourceRef};
const key=(ref:Pick<SourceRef,'version'|'digest'>)=>JSON.stringify([ref.version,ref.digest]);
const reference=(source:Source,version:SourceVersion):SourceRef=>({sourceId:source.id,version:version.version,digest:version.digest});

/** Read-only comparison of explicitly chosen snapshots; neither endpoint follows a later save. */
export function SourceHistoryComparison({taskId,source,selectedReference}:{taskId:string;source:Source;selectedReference:SourceRef}){
 const scope=useRef({identity:'',epoch:0}),identity=JSON.stringify([taskId,source.id,selectedReference.sourceId,selectedReference.version,selectedReference.digest]);
 if(scope.current.identity!==identity)scope.current={identity,epoch:scope.current.epoch+1};
 const owner=scope.current.epoch,[view,setView]=useState<View>(),opened=view?.owner===owner?view:undefined;
 const heading=useRef<HTMLHeadingElement>(null),opener=useRef<HTMLButtonElement>(null),mounted=useRef(true),serial=useRef(0);
 useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useLayoutEffect(()=>{if(opened){heading.current?.scrollIntoView({block:'center',inline:'nearest'});heading.current?.focus({preventScroll:true});}},[opened?.open]);
 const versions=source.versions.filter(version=>version.id===source.id).sort((a,b)=>a.version-b.version),latest=versions.find(version=>version.version===source.currentVersion),selected=versions.find(version=>selectedReference.sourceId===source.id&&version.version===selectedReference.version&&version.digest===selectedReference.digest);
 function open(){
  if(scope.current.epoch!==owner||!latest||!selected)return;
  const before=selected&&selected.version<latest.version?selected:[...versions].reverse().find(version=>version.version<latest.version);
  if(before)setView({owner,open:++serial.current,before:reference(source,before),after:reference(source,latest)});
 }
 function choose(side:'before'|'after',value:string){
  if(scope.current.epoch!==owner)return;
  const version=versions.find(version=>key(version)===value);if(!version)return;
  setView(current=>current?.owner===owner?{...current,[side]:reference(source,version)}:current);
 }
 function close(){
  if(scope.current.epoch!==owner||!opened||serial.current!==opened.open)return;const closingOpen=opened.open;setView(undefined);
  requestAnimationFrame(()=>{if(mounted.current&&scope.current.epoch===owner&&serial.current===closingOpen)opener.current?.focus();});
 }
 if(versions.length<2&&!opened)return null;
 const result=opened?sourceSnapshotDifference(source,opened.before,opened.after):undefined;
 const choices=(side:'before'|'after',label:string)=>opened&&<label>{label}<select aria-label={label} value={key(opened[side])} onChange={event=>choose(side,event.target.value)}>
  {!versions.some(version=>key(version)===key(opened[side]))&&<option value={key(opened[side])}>Selected snapshot unavailable</option>}
  {versions.map(version=><option key={key(version)} value={key(version)}>Version {version.version} · {version.label} · {version.kind}</option>)}
 </select></label>;
 return <section className="source-history-comparison" aria-label="Compare source history">
  <button type="button" ref={opener} disabled={!latest||!selected||versions.length<2} onClick={open}>Compare saved versions</button>
  {opened&&result&&<section className="source-snapshot-difference" aria-label="Selected source version comparison">
   <h3 ref={heading} tabIndex={-1}>Compare saved source versions</h3>
   <p>Choose two saved versions of this source. This read-only comparison does not update sources or saved work. Current live content is unknown.</p>
   <div className="source-history-selectors">{choices('before','From snapshot')}{choices('after','To snapshot')}</div>
   <p aria-live="polite" aria-atomic="true">Selected snapshots: Version {opened.before.version} → Version {opened.after.version}.</p>
   {latest&&latest.version>Math.max(opened.before.version,opened.after.version)&&<p className="warning">Version {latest.version} is newer than your selections. It has not been selected.</p>}
   {source.freshness!=='fresh'&&<p className="warning">This source requires review. Saved snapshots remain available; this comparison does not establish freshness.</p>}
   {opened.before.version>=opened.after.version?<p role="status">Choose an earlier From snapshot and a later To snapshot. No comparison was made.</p>:result.kind==='missing'?<p role="status">An exact selected snapshot is unavailable. No comparison was made.</p>:result.kind==='unsupported'?<p role="status">Text comparison requires two saved text snapshots. Window and image snapshots are not compared here.</p>:result.kind==='no-newer'?<p role="status">Choose two different saved versions. No comparison was made.</p>:<>
    <p>From: {result.before.label} · Version {result.before.version} · {sourceRoleLabel(result.before.role)}. To: {result.after.label} · Version {result.after.version} · {sourceRoleLabel(result.after.role)}.</p>
    {result.kind==='large'?<p role="status">The text is too large or complex for an inline comparison. Use Earlier versions to open each full saved copy.</p>:<>
     {result.unchanged?<p>Text is unchanged between the selected saved snapshots.</p>:<div className="source-snapshot-changes" aria-label="Selected saved text changes">{result.parts.map((part,index)=><div key={index} className={part.added?'source-change-added':part.removed?'source-change-removed':'source-change-context'}><span className="source-change-label">{part.added?'Added':part.removed?'Removed':'Unchanged'}</span><pre>{part.value}</pre></div>)}</div>}
     <details><summary>Read From snapshot · Version {result.before.version}</summary><pre className="source-snapshot-text" tabIndex={0}>{result.before.content}</pre></details>
     <details><summary>Read To snapshot · Version {result.after.version}</summary><pre className="source-snapshot-text" tabIndex={0}>{result.after.content}</pre></details>
    </>}
   </>}
   <Button kind="text" onClick={close}>Close version comparison</Button>
  </section>}
 </section>;
}
