import type {RequestRecord,Task} from '../../core/types';
import {EXPERIMENT_RESULT_PROMPT} from '../../learning/experiment-result-copy';
import {SIGNAL_OVERWRITE_PRACTICE_PROMPT} from '../../learning/signal-overwrite';
import {requestArtifact} from './browser-outcome';

/** Local deterministic actions record a fixed host-authored prompt. It is provenance, not
 * something the user wrote, so the conversation shows a short activity line instead of a
 * user bubble. Matching is by exact kind and prompt; stored requests are never rewritten. */
type Verb={past:string;present:string;progressive:string};
const SAVE:Verb={past:'Saved',present:'Save',progressive:'Saving'},CREATE:Verb={past:'Created',present:'Create',progressive:'Creating'};
type LocalAction={kind:string;prompt:string;verb:Verb;object:string};
export const LOCAL_ACTIONS:readonly LocalAction[]=[
 {kind:'experiment',prompt:'Save the explicitly reviewed local source formula transcription.',verb:SAVE,object:'source formula'},
 {kind:'experiment',prompt:'Save an explicitly requested deterministic experiment run.',verb:SAVE,object:'calculation run'},
 {kind:'experiment',prompt:EXPERIMENT_RESULT_PROMPT,verb:SAVE,object:'calculation result'},
 {kind:'experiment',prompt:'Save an explicitly reviewed bounded alternative-formula comparison.',verb:SAVE,object:'formula comparison'},
 {kind:'experiment',prompt:'Record a prediction for a separate bounded experiment input.',verb:SAVE,object:'practice prediction'},
 {kind:'experiment',prompt:'Save the first answer to a bounded source-formula target challenge.',verb:SAVE,object:'target challenge answer'},
 {kind:'experiment',prompt:'Explore a reviewed packing capacity.',verb:CREATE,object:'packing capacity explorer'},
 {kind:'experiment',prompt:'Record a prediction for a separate packing count.',verb:SAVE,object:'packing prediction'},
 {kind:'experiment',prompt:'Explain one reviewed signal assignment.',verb:CREATE,object:'signal assignment lesson'},
 {kind:'experiment',prompt:'Record the first answer to a separate hypothetical signal practice.',verb:SAVE,object:'signal practice answer'},
 {kind:'experiment',prompt:'Explain two reviewed assignments to one signal.',verb:CREATE,object:'signal replacement lesson'},
 {kind:'experiment',prompt:SIGNAL_OVERWRITE_PRACTICE_PROMPT,verb:SAVE,object:'signal replacement practice answer'},
 {kind:'experiment',prompt:'Explore a reviewed binary assignment.',verb:CREATE,object:'binary assignment explorer'},
 {kind:'experiment',prompt:'Predict, change and inspect a bounded finite workflow model.',verb:CREATE,object:'workflow model'},
 {kind:'experiment',prompt:'Admit this explicitly reviewed image transcription into a finite sequential learning model.',verb:CREATE,object:'image workflow model'},
 {kind:'experiment',prompt:'Review source-bound table extraction and run the installed deterministic join experiment.',verb:SAVE,object:'table join experiment'},
 {kind:'create',prompt:'Create a local document recipe to demonstrate, review and test.',verb:CREATE,object:'document recipe'},
 {kind:'create',prompt:'Save the explicitly reviewed local document recipe result as a new ordinary document.',verb:SAVE,object:'document recipe result'},
 {kind:'create',prompt:'Save the explicitly reviewed complete local table workflow result as an ordinary document.',verb:SAVE,object:'table workflow result'},
 {kind:'create',prompt:'Create a separate inactive draft from the explicitly reviewed local text actions.',verb:CREATE,object:'text helper draft'},
 {kind:'create',prompt:'Create a local text helper to teach, check and save.',verb:CREATE,object:'text helper'},
 {kind:'design-canvas-svg',prompt:'Prepare a safe SVG copy of the reviewed saved canvas.',verb:SAVE,object:'canvas as SVG'},
 {kind:'browser-workflow-authoring',prompt:'Save an explicitly authored browser workflow.',verb:SAVE,object:'browser workflow'},
];

/** Running: "Saving source formula…". Completed: "Saved source formula", followed in the conversation by its
 * own result card, so the title is added only where no card follows (`withTitle`, e.g. the sidebar preview).
 * Otherwise "Save source formula"; the existing status line below says why it did not finish. */
export function localActivityLabel(task:Task,request:RequestRecord,withTitle=false):string|undefined{
 /** A model answered this request, so its text came from a person (for example the same sentence typed in create mode). */
 if(request.responseModel)return;
 const action=LOCAL_ACTIONS.find(item=>item.kind===request.kind&&item.prompt===request.prompt);
 if(!action)return;
 /** Composer, follow-ups and PDF import also send kind `create`; an unfinished one may be a model call that failed
  * before its receipt was saved, so it keeps its question and retry controls. */
 if(action.kind==='create'&&request.status!=='completed')return;
 if(request.status==='running')return action.verb.progressive+' '+action.object+'…';
 if(request.status!=='completed')return action.verb.present+' '+action.object;
 const title=withTitle?requestArtifact(task,request)?.revision.title.trim():undefined;
 return action.verb.past+' '+action.object+(title?' · '+title:'');
}
