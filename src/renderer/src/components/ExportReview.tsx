import {Check} from 'lucide-react';
import type {ExportAction} from '../../../core/types';
import {Button,SectionTitle,type Run} from '../ui';
import {DeveloperDetails} from './DeveloperDetails';
import {publicErrorMessage} from '../../../shared/public-messages';
const date=(value:string)=>new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
export function ExportReview({ taskId, action: a, busy, run, canApprove=true,showHeading=true }: {
    taskId: string;
    action: ExportAction;
    busy: boolean;
    canApprove?: boolean;
    showHeading?: boolean;
    run: Run;
}) { return <section className={'export-review ' + (a.status === 'verified' ? 'verified' : '')}>{showHeading&&<SectionTitle>{a.status==='verified'?'File saved':a.status==='uncertain'?'Check this save':a.status==='failed'?'Could not save file':a.status==='retired'?'Approval expired':'Review export'}</SectionTitle>}<dl><dt>Destination</dt><dd className="break" data-export-destination tabIndex={0}>{a.proposal.path}</dd><dt>Version</dt><dd>Revision {a.proposal.revision}</dd></dl><details className="export-file-details"><summary>File details</summary><p className="tiny">{a.proposal.byteLength.toLocaleString()} bytes</p></details><DeveloperDetails title="File verification"><p className="tiny break">{a.proposal.artifactDigest}</p></DeveloperDetails>{a.status === 'proposed' && <><p className="tiny">Save this version to the location shown. Existing files will not be replaced.</p><Button kind="primary" disabled={busy||!canApprove} onClick={() => void run({ type: 'export.approve', taskId, actionId: a.proposal.id, digest: a.proposal.digest, requestId: crypto.randomUUID() })}><Check size={16}/>Approve export</Button>{!canApprove&&<p className="tiny">Save or review the draft changes before approving an export.</p>}</>}{a.status === 'verified' && <p className="tiny"><Check size={13}/>Saved and checked · {date(a.evidence!.verifiedAt)}</p>}{a.error && <p className="warning">{a.status==='uncertain'?'The file may have been saved. Check the destination before trying again.':publicErrorMessage(a.error)}</p>}{a.status === 'uncertain' && <Button disabled={busy} onClick={() => void run({ type: 'export.inspect', taskId, actionId: a.proposal.id }, 'File checked')}>Check saved file</Button>}</section>; }
