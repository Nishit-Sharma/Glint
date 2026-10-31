import {useId,useRef,useState} from 'react';
import type {HostStatus} from '../../../shared/bridge';
import {searchShortcuts} from '../shortcut-search';
import './shortcut-manager.css';

export function ShortcutManager({host}:{host?:HostStatus}){
 const [query,setQuery]=useState(''),input=useRef<HTMLInputElement>(null),id=useId();
 const results=searchShortcuts(host,query),total=searchShortcuts(host,'').length;
 return <section className="shortcut-manager" aria-labelledby={id+'-title'}>
  <h3 id={id+'-title'}>Keyboard shortcuts</h3>
  <p className="preference-explanation" id={id+'-help'}>Find current screen context bindings and macOS app menu defaults by action or keys. Searching only shows information.</p>
  <label htmlFor={id+'-search'}>Search keyboard shortcuts</label>
  <div className="shortcut-search"><input ref={input} id={id+'-search'} type="search" value={query} placeholder="Copy, Command+C, fallback…" maxLength={200} aria-describedby={id+'-help'} aria-controls={id+'-results'} onChange={event=>setQuery(event.target.value)}/><button type="button" disabled={!query} onClick={()=>{setQuery('');input.current?.focus();}}>Clear</button></div>
  <p className="shortcut-count" role="status" aria-live="polite">{!host?'Checking shortcuts…':results.length?`${results.length} of ${total} shortcuts`:'No keyboard shortcuts match. Try an action or key, or clear the search.'}</p>
  {host&&host.platform!=='darwin'&&<p className="shortcut-platform">Native menu bindings are listed for macOS. This platform’s menu bindings have not been verified.</p>}
  <ul className="shortcut-results" tabIndex={results.length?0:-1} id={id+'-results'} aria-label="Keyboard shortcut results">{results.map(item=><li key={item.id}><div className="shortcut-heading"><h4>{item.action}</h4><kbd>{item.keys}</kbd></div><p className="shortcut-availability">{item.scope} · {item.availability}</p><p>{item.explanation}</p></li>)}</ul>
 </section>;
}
