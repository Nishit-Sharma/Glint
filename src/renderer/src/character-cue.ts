import type {Task} from '../../core/types';
import {requestableSourceIds} from '../../shared/source-intake';

export type CharacterCueKind='ready'|'working'|'paused'|'uncertain'|'failed'|'interrupted'|'stale'|'needs-input';
export type CharacterCue={kind:CharacterCueKind;label:string;symbol:string;phase:'ready'|'working'|'waiting'};
const cues:Record<CharacterCueKind,CharacterCue>={
 ready:{kind:'ready',label:'Ready for your request',symbol:'',phase:'ready'},
 working:{kind:'working',label:'Working on this task’s request',symbol:'…',phase:'working'},
 paused:{kind:'paused',label:'Task paused',symbol:'Ⅱ',phase:'ready'},
 uncertain:{kind:'uncertain',label:'Action outcome uncertain — inspect before retrying',symbol:'?',phase:'waiting'},
 failed:{kind:'failed',label:'Latest request failed — review the error',symbol:'!',phase:'waiting'},
 interrupted:{kind:'interrupted',label:'Latest request interrupted — review before retrying',symbol:'!',phase:'waiting'},
 stale:{kind:'stale',label:'Selected sources need refresh',symbol:'↻',phase:'waiting'},
 'needs-input':{kind:'needs-input',label:'Saved follow-up or browser step needs your review',symbol:'?',phase:'waiting'},
};
/** Known current-task records only; this is workflow state, never model confidence. */
export function deriveCharacterCue(task:Task|undefined,sourceIds?:readonly string[],pending?:{taskId:string}):CharacterCue{
 if(!task)return cues.ready;
 const waitingQuestion=task.requests.some(request=>request.status==='running'&&request.questions?.some(question=>question.status==='waiting'));
 if(!waitingQuestion&&(pending?.taskId===task.id||task.requests.some(request=>request.status==='running')))return cues.working;
 const operation=task.session?.runs.at(-1)?.operations.at(-1);
 if(task.actions.some(action=>action.status==='uncertain')||task.session?.runs.some(run=>run.operations.some(item=>item.status==='uncertain'&&(!item.reconciliation||item.reconciliation.outcome==='uncertain'))))return cues.uncertain;
 if(task.status==='paused'||task.archive)return cues.paused;
 const request=task.requests.at(-1);
 if(request?.status==='failed')return cues.failed;
 if(request?.status==='interrupted')return cues.interrupted;
 const selected=new Set(requestableSourceIds(task,sourceIds));
 if(task.sources.some(source=>selected.has(source.id)&&source.freshness!=='fresh'))return cues.stale;
 if(waitingQuestion)return {...cues['needs-input'],label:'Waiting for your answer'};
 if(task.session?.queuedFollowups?.some(item=>item.status==='held')||operation?.status==='proposed')return cues['needs-input'];
 return cues.ready;
}
