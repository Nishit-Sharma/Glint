import {parseSignalAssignment,type SignalAssignment} from './signal-concept';
import {prepareWorkflowPassages,type WorkflowReviewSource} from './workflow-review';

export type SignalOverwrite={sourceId:string;start:number;end:number;quote:string;first:SignalAssignment;second:SignalAssignment};
export const SIGNAL_OVERWRITE_ASSUMPTIONS='Assume compatible scalar binary signals and one nonpostponed sequential process that reaches these assignments in order without an intervening wait or delay, then suspends. Both assignments affect the same driver of the target. That driver directly determines the target value, with no other drivers, value-transforming resolution or external force, and no later assignment replaces its transaction. The surrounding process, declarations, control flow and execution are not established by the quoted lines.';
export const SIGNAL_OVERWRITE_LIMIT='This is a bounded illustrative scheduling model, not a VHDL simulation or a prediction of physical timing. Concurrent assignments or different drivers are outside this model.';
export const SIGNAL_OVERWRITE_PRACTICE_PROMPT='Record the first answer to a separate signal replacement practice.';
export const signalOverwriteAnswers=['00','01','10','11'] as const;
export type SignalOverwriteAnswer=typeof signalOverwriteAnswers[number];

/** Recognizes two adjacent complete lines only; never infers their process context. */
export function prepareSignalOverwrites(sources:readonly WorkflowReviewSource[]):SignalOverwrite[]{
 const prepared=prepareWorkflowPassages(sources);if(prepared.issues.length)return [];
 const pairs:SignalOverwrite[]=[];
 for(let i=0;i<prepared.passages.length-1;i++){
  const first=prepared.passages[i],second=prepared.passages[i+1],source=sources.find(s=>s.sourceId===first.sourceId);
  if(!source||first.sourceId!==second.sourceId||!/^[ \t]*(?:\r\n|\r|\n)[ \t]*$/.test(source.text.slice(first.end,second.start)))continue;
  const a=parseSignalAssignment(first.quote),b=parseSignalAssignment(second.quote);
  if(!a||!b||a.target.toLowerCase()!==b.target.toLowerCase()||a.value.toLowerCase()===b.value.toLowerCase())continue;
  pairs.push({sourceId:first.sourceId,start:first.start,end:second.end,quote:source.text.slice(first.start,second.end),first:a,second:b});
 }
 return pairs;
}

/** Fixed chosen bits make replacement visible; no source values are inferred. */
export function signalOverwriteTrace(secondEnabled:boolean){
 return {during:0 as const,firstScheduled:1 as const,replacement:secondEnabled?0 as const:null,after:secondEnabled?0 as const:1 as const};
}

function sourceIntro(pair:SignalOverwrite){
 return `## Reviewed source lines\n\n~~~vhdl\n${pair.quote}\n~~~\n\nBoth complete adjacent lines were selected from the saved linked text source. Their order and names are source facts; all values and the process context below are hypothetical. To correct either line, return to the source editor, save the correction and review the new source version.\n\n## Assumptions and limits\n\n${SIGNAL_OVERWRITE_ASSUMPTIONS}\n\n${SIGNAL_OVERWRITE_LIMIT}\n`;
}

export function signalOverwriteDocument(pair:SignalOverwrite,secondEnabled:boolean){
 const {target,value:first}=pair.first,second=pair.second.value,changed=signalOverwriteTrace(secondEnabled);
 return `# Two assignments to one signal\n\n${sourceIntro(pair)}\n## Quick\n\nUnder these assumptions, the second assignment replaces the first assignment's pending transaction for ${target} at the same simulation time. ${target} keeps its current value while this process continues.\n\n## Deep\n\nWith no explicit delay, each line schedules a transaction at the current simulation time. The first line reads the current ${first} value; the second reads the current ${second} value. Because they affect the same driver at the same time, the second removes the first pending transaction and adds its own. The driver update happens in a later delta cycle after the process suspends. This is not a general rule that the last line in a design wins: a different process has a different driver, and explicit delays or an intervening wait require other reasoning.\n\n## Visual — chosen hypothetical values\n\nStart with ${target} = 0, ${first} = 1 and ${second} = 0. These values are not extracted from your source.\n\n| Step | Current ${target} | Pending transaction for its driver |\n| --- | --- | --- |\n| Execute first line | 0 | 1, read from ${first} |\n| Execute second line | 0 | 0, read from ${second}; replaces 1 |\n| Suspend, then later delta update | 0 | Applied 0 |\n\nThe first 1 is never applied between these statements in this illustrative execution.\n\n## Change — choose whether the second statement executes\n\nOriginal hypothetical: both lines execute; the final scheduled value is 0.\n\nChanged hypothetical: the second statement ${secondEnabled?'executes':'is skipped'}. ${secondEnabled?'Its transaction replaces the first, so the final scheduled value stays 0.':'The first transaction remains, so the final scheduled value changes from 0 to 1.'} During the process, ${target} still reads ${changed.during}; after the later delta update it reads ${changed.after}.\n\nSkipping is your experimental choice, not a condition found in the source or a modification of the saved source.\n\n## Language basis\n\n[IEEE Std 1076-2008](https://faculty-web.msoe.edu/johnsontimoj/Common/FILES/VHDL_2008.pdf), 10.5.2.2 (zero-delay waveform transactions and replacement), 14.7.5 (process suspension and simulation cycles). This lesson illustrates only the restricted case stated above.\n`;
}

export function signalOverwritePracticeDocument(pair:SignalOverwrite,answer:SignalOverwriteAnswer){
 return `# Signal replacement practice\n\n${sourceIntro(pair)}\n## Separate hypothetical case\n\nThis three-statement case is synthetic; its names and values are chosen independently of your source. Earlier exposure is unknown. Assume the same process and direct-driver restrictions above for both lamp and audit. Start with lamp = 1, primary = 0 and backup = 0. These three statements execute without a wait between them, then the process suspends.\n\n~~~vhdl\nlamp <= primary;\naudit <= lamp;\nlamp <= backup;\n~~~\n\nPredict the values after the later delta update, in the order (lamp, audit).\n\n## First saved answer and explanation\n\nYour saved answer: (${answer[0]}, ${answer[1]}).\n\nThe result is (0, 1); your answer ${answer==='01'?'matches':'does not match'} this result. The first statement schedules 0 for lamp. The second reads the current lamp value 1 and schedules 1 for audit. The third replaces lamp's pending transaction with 0; it does not change what the earlier audit statement read. After suspension, the later delta update gives lamp = 0 and audit = 1 under these assumptions.\n\nThe lesson asks which pending transaction survives. This separate practice also asks what another assignment reads before the update. A single answer does not establish mastery. ${SIGNAL_OVERWRITE_LIMIT}\n`;
}
