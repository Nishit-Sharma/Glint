import {TEXT_HELPER_ACTIVITY_LIMIT,type HelperState} from '../../../learning/reusable-helper';

/** Read-only view of host-committed local runs, independent of the current draft. */
export function TextHelperActivity({state}:{state:HelperState}){
 const activity=state.runActivity;
 return <section className="learning-section" aria-label="Local text helper activity">
  <h4>Local run activity</h4>
  <p>Only saved runs from Run active helper are recorded here. Checks, version comparisons and previews are not activity records. Other helper types and connected-agent activity are not recorded here.</p>
  <p className="tiny">The latest {TEXT_HELPER_ACTIVITY_LIMIT} records are retained, ordered by committed helper revision. Earlier activity is unavailable; the previous latest result is not reconstructed as history.</p>
  {!activity?<p>No recorded run activity. This does not mean the helper was never used.</p>:<>
   <p>{activity.runs.length} retained {activity.runs.length===1?'record':'records'} · recording began at helper revision {activity.startedAtRevision}.</p>
   <ol className="helper-history">{[...activity.runs].reverse().map(run=>{
    const saved=state.versions.find(version=>version.version===run.version);
    return <li key={run.atRevision}><details><summary>Run at helper revision {run.atRevision} · version {run.version}</summary>
     <p>Saved helper: {saved?.definition.name??'Unavailable saved definition'} · version {run.version} saved at helper revision {run.savedAtRevision}. This is the version used for this run, independent of the current draft or activation.</p>
     <p>Exact input</p><pre className="source-content" aria-label={`Run ${run.atRevision} exact input`}>{run.input}</pre>{run.input===''&&<p className="tiny">Empty input.</p>}
     {run.result.kind==='output'?<><p>Saved output{run.result.exceptionId?' · exception '+run.result.exceptionId:''}</p><pre className="source-content" aria-label={`Run ${run.atRevision} saved output`}>{run.result.text}</pre>{run.result.text===''&&<p className="tiny">Empty output.</p>}</>:<><p>Saved outcome: Abstained · exception {run.result.exceptionId}</p><pre className="source-content" aria-label={`Run ${run.atRevision} abstention reason`}>{run.result.reason}</pre></>}
    </details></li>;
   })}</ol>
  </>}
 </section>;
}
