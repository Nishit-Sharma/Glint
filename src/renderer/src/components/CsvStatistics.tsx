import {useEffect,useRef,useState} from 'react';
import type {Artifact,SourceRef,Task} from '../../../core/types';
import {CSV_STATISTICS_MIME,csvStatistics,csvStatisticsHeaders,csvStatisticsRef,readCsvStatistics,readCsvStatisticsData,readCsvStatisticsSettings,type CsvStatistics as SavedStatistics,type CsvStatisticsData,type CsvStatisticsSettings,type CsvStatisticsSave,type CsvStatisticsSaved} from '../../../shared/csv-statistics';
import {publicErrorMessage} from '../../../shared/public-messages';
import {useNavigationDraft} from '../draft-navigation';
import {changedDependencies} from '../editor-state';
import {Button,Field,type Run} from '../ui';
import {SourceLinks} from './SourceLinks';
import './csv-statistics.css';

const initial:CsvStatisticsSettings={title:'CSV statistics',columns:[],missing:'reject'};
type Props={task:Task;source?:SourceRef;artifact?:Artifact;busy:boolean;run:Run;isCurrent:()=>boolean;onSaved:(saved:CsvStatisticsSaved)=>void;onBack?:()=>void};
export function CsvStatistics(props:Props){
 let body:SavedStatistics|undefined;try{if(props.artifact){const revision=props.artifact.revisions.at(-1)!;if(revision.mimeType!==CSV_STATISTICS_MIME)throw Error();body=readCsvStatistics(JSON.parse(revision.content));}}catch{return <p role="alert">These statistics cannot be read. Their saved bytes are kept.</p>;}
 return <Editor key={props.task.id+':'+(props.artifact?.id??JSON.stringify(props.source))} {...props} initialBody={body}/>;
}
function Editor({task,source,artifact,busy,run,isCurrent,onSaved,onBack,initialBody}:{initialBody?:SavedStatistics}&Props){
 const [body,setBody]=useState(initialBody),[basis,setBasis]=useState(()=>artifact?{artifactId:artifact.id,revision:artifact.revisions.at(-1)!.revision,digest:artifact.revisions.at(-1)!.digest}:undefined),[base,setBase]=useState<CsvStatisticsSettings>(()=>initialBody?.settings??initial),[raw,setRaw]=useState<CsvStatisticsSettings>(()=>initialBody?.settings??initial),[data,setData]=useState<CsvStatisticsData>(),[loadError,setLoadError]=useState(''),[loadEpoch,setLoadEpoch]=useState(0),[saving,setSaving]=useState(false),[pending,setPending]=useState<CsvStatisticsSave>(),[message,setMessage]=useState('');
 const alive=useRef(true),lock=useRef(false),creationId=useRef(initialBody?.creationId??crypto.randomUUID()),scope=useRef(isCurrent);scope.current=isCurrent;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const reference=body?.source??source,key=JSON.stringify([task.id,reference]),dirty=JSON.stringify(raw)!==JSON.stringify(base),navigation=useNavigationDraft(dirty,()=>setRaw(base));
 useEffect(()=>{let current=true;setData(undefined);setLoadError('');if(!reference){setLoadError('Choose an exact saved CSV source.');return;}void window.companion.invoke({type:'statistics.data',taskId:task.id,source:reference}).then(value=>{
  if(!current||!alive.current||!scope.current())return;const next=readCsvStatisticsData(value);if(next.taskId!==task.id||JSON.stringify(next.source)!==JSON.stringify(reference))throw Error('The CSV source response changed.');
  if(body&&(next.dataDigest!==body.dataDigest||JSON.stringify(csvStatistics(next.csv,body.settings))!==JSON.stringify(body.results)))throw Error('The saved statistics do not match their exact CSV data and recorded method.');setData(next);
 }).catch(error=>{if(current&&alive.current)setLoadError(publicErrorMessage(error));});return()=>{current=false;};},[key,loadEpoch]);
 const revision=artifact?.revisions.at(-1),changed=!!basis&&(!revision||revision.revision!==basis.revision||revision.digest!==basis.digest),stale=!!reference&&changedDependencies(task,[reference]).length>0,held=busy||saving||!!pending;
 let settings:CsvStatisticsSettings|undefined,results:ReturnType<typeof csvStatistics>|undefined,issue='';
 if(data)try{settings=readCsvStatisticsSettings(raw);results=csvStatistics(data.csv,settings);}catch(error){issue=raw.columns.length?publicErrorMessage(error):'Choose at least one numeric column.';}
 const headers=data?csvStatisticsHeaders(data.csv):[];
 function edit(next:CsvStatisticsSettings){if(!held&&!stale){setRaw(next);setMessage('');}}
 async function save(command?:CsvStatisticsSave){
  if(lock.current||busy||!scope.current()||!data||!reference)return;
  if(!command){if(!settings||issue||changed||stale)return;command={type:'statistics.save',taskId:task.id,creationId:creationId.current,source:reference,dataDigest:data.dataDigest,settings,...(basis?{artifact:basis}:{})};}
  lock.current=true;setSaving(true);setPending(command);setMessage('');
  try{
   const saved=await run<CsvStatisticsSaved>(command,undefined,{isCurrent:()=>alive.current&&scope.current()});if(!alive.current||!scope.current())return;if(!saved){setMessage('The save was not confirmed. Check the same save before changing its columns or settings.');return;}
   const value=saved.task.artifacts.find(item=>item.id===saved.artifactId)?.revisions.find(item=>item.revision===saved.revision&&item.digest===saved.digest);if(saved.task.id!==task.id||!value||value.mimeType!==CSV_STATISTICS_MIME)throw Error('The saved statistics receipt could not be matched.');
   const next=readCsvStatistics(JSON.parse(value.content));if(next.creationId!==command.creationId||JSON.stringify(next.source)!==JSON.stringify(command.source)||next.dataDigest!==command.dataDigest)throw Error('The saved statistics owner or data basis could not be matched.');
   if(JSON.stringify(next.results)!==JSON.stringify(csvStatistics(data.csv,next.settings)))throw Error('The saved results could not be verified against the exact CSV.');setBody(next);setBasis(csvStatisticsRef(saved));setRaw(next.settings);setBase(next.settings);setPending(undefined);navigation();onSaved(saved);
  }catch(error){if(alive.current)setMessage(publicErrorMessage(error)+' Check the same save before changing settings.');}
  finally{lock.current=false;if(alive.current)setSaving(false);}
 }
 function reload(){if(!artifact)return;navigation.guard(()=>{try{const current=artifact.revisions.at(-1)!,next=readCsvStatistics(JSON.parse(current.content));setBody(next);setBasis({artifactId:artifact.id,revision:current.revision,digest:current.digest});setRaw(next.settings);setBase(next.settings);setPending(undefined);setMessage('');setLoadEpoch(value=>value+1);}catch{setMessage('The current saved statistics are unavailable. Your inputs are kept.');}});}
 return <section className="csv-statistics" aria-label="CSV descriptive statistics"><h2>{artifact?'Saved CSV statistics':'Analyze CSV statistics'}</h2>
  <p>Local descriptive statistics from every data record in your exact saved CSV: up to 10,000 records and 100 columns within the existing 100,000-character import limit. Choose columns by position. No AI request, formula evaluation, trend inference or outlier detection.</p>
  {loadError?<p role="alert">{loadError} <Button disabled={held} onClick={()=>setLoadEpoch(value=>value+1)}>Reload statistics data</Button></p>:!data?<p role="status">Reading the exact saved CSV…</p>:<>
   <p>Source: {data.label} · saved version {data.source.version}{data.originalFile?` · imported file ${data.originalFile.name}`:''}</p>
   {stale&&<p role="status">Earlier source data. These statistics retain their exact saved CSV version. Start new statistics from the current source to analyze updated values; this result remains readable.</p>}
   <Field label="Statistics title"><input value={raw.title} maxLength={160} disabled={held||stale} onChange={event=>edit({...raw,title:event.currentTarget.value})}/></Field>
   <fieldset disabled={held||stale} className="csv-statistics-columns"><legend>Numeric columns</legend>{headers.map((heading,column)=><label key={column}><input type="checkbox" checked={raw.columns.includes(column)} onChange={event=>edit({...raw,columns:event.currentTarget.checked?[...raw.columns,column].sort((a,b)=>a-b):raw.columns.filter(value=>value!==column)})}/><span>{column+1} · {heading||'Empty heading'}</span></label>)}</fieldset>
   <Field label="Empty or absent numeric cells"><select value={raw.missing} disabled={held||stale} onChange={event=>edit({...raw,missing:event.currentTarget.value==='omit-empty'?'omit-empty':'reject'})}><option value="reject">Reject the analysis</option><option value="omit-empty">Omit empty cells and report their count</option></select></Field>
   <p className="tiny">Numeric cells must be complete finite decimal numbers, with optional exponent. Spaces, units, formulas and overflowing or underflowing numbers are rejected. Omit-empty applies only to empty or absent cells; other invalid values always stop the analysis.</p>
   {issue&&<p role="alert">{issue}</p>}
   {results&&<div className="csv-statistics-results" aria-label="Calculated statistics">{results.map(result=><section key={result.column}><h3>Column {result.column+1} · {result.heading||'Empty heading'}</h3><dl>{([
    ['Numeric count',result.count],['Empty cells omitted',result.missing],['Sum',result.sum],['Mean',result.mean],['Median',result.median],['Minimum',result.min],['Maximum',result.max],['Population variance (÷ n)',result.populationVariance],['Population standard deviation',result.populationStdDev],['Sample variance (÷ n − 1)',result.sampleVariance],['Sample standard deviation',result.sampleStdDev],
   ] as const).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value===null?'Unavailable — requires at least two numeric values':String(value)}</dd></div>)}</dl></section>)}</div>}
   <details><summary>Calculation method and exact input basis</summary><p>Compensated summation; median from sorted numeric values; variance from a shifted, scaled two-pass calculation. Population divides by n; sample divides by n − 1. JavaScript finite floating-point precision applies, so results can be rounded; the original CSV cell text is preserved unchanged. Arithmetic overflow or variance underflow stops the analysis. Each column uses its own explicit empty-cell policy. Saved results include the method, selected column positions, source version and exact decoded CSV hash.</p><p>CSV SHA-256: <code>{data.dataDigest}</code></p></details>
   {changed&&<p role="alert">The saved statistics changed. Your inputs are kept. Reload the saved version before saving different settings.</p>}
   {pending&&<p role="status">{message||'Saving the exact statistics…'} Closing does not undo a save that already completed. Inspect Files before creating another result.</p>}
   <div className="row"><Button disabled={busy||saving||!pending&&(!results||!!issue||changed||stale||!!body&&!dirty)} onClick={()=>void save(pending)}>{pending?'Check same statistics save':body?'Save statistics changes':'Save statistics'}</Button>{changed&&<Button disabled={busy||saving} onClick={reload}>Reload saved statistics</Button>}{dirty&&!pending&&<Button disabled={busy||saving} onClick={()=>{setRaw(base);navigation();}}>Discard statistics edits</Button>}{onBack&&<Button disabled={busy||saving} onClick={onBack}>Back to source</Button>}</div>
   <SourceLinks task={task} refs={[data.source]} title="Exact CSV source"/>
  </>}
 </section>;
}
