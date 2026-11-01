import type {ConnectionStatus} from '../shared/bridge';
import type {RequestInferenceSelection} from '../shared/request-inference';

type Readers={current:()=>Promise<ConnectionStatus>;selected:(selection:RequestInferenceSelection)=>Promise<ConnectionStatus>};
/** Metadata for the existing held-follow-up approval; never dispatches a request. */
export async function queuedInferenceReview(selection:RequestInferenceSelection|undefined,route:'codex'|'meta',readers:Readers){
 if(selection&&route!=='codex')throw Error('This queued follow-up keeps a Codex model choice. Reconnect Codex before reviewing it.');
 const connection=selection?await readers.selected(selection):await readers.current();
 if(selection&&(connection.provider!=='Codex (temporary)'||connection.model!==selection.model||connection.reasoning!==selection.effort))throw Error('The exact frozen queued model choice could not be validated. Nothing was sent.');
 return {connection,destination:`${connection.provider} · ${selection?.model??connection.model} · ${selection?.effort??connection.reasoning??'adapter default'} reasoning · ${connection.tier??selection?.tier??'adapter default'} speed`};
}
