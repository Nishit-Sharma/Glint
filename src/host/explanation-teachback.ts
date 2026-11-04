import type {Companion} from '../core/companion';
import type {Task} from '../core/types';
import type {Command} from '../shared/bridge';
import {TEACHBACK_MIME,teachbackBody,teachbackQuestion,finishTeachback} from '../shared/explanation-teachback';
import {sameDocumentRefs} from '../shared/saved-document-draft';
export async function prepareExplanationTeachback(core:Companion,task:Task,command:Extract<Command,{type:'model.run'}>,assertCurrent:()=>void){
 if(!command.teachback)return;
 if(command.kind!=='revise'||command.artifactId!==command.teachback.basis.artifactId||command.prompt!==command.teachback.answer||command.suggestEdits||command.explainDepth||command.explanationBasis||command.revisionBasis||command.canvasContext||command.briefAction||command.conversationAttempt||command.submittedDraft)throw Error('Teach-back requires the exact saved explanation and your original answer.');
 const {revision}=teachbackQuestion(task,command.teachback);
 if(!command.expectedSourceRefs||!sameDocumentRefs(command.expectedSourceRefs,revision.sourceRefs)||!command.sourceIds||command.sourceIds.length!==revision.sourceRefs.length||new Set(command.sourceIds).size!==command.sourceIds.length||command.sourceIds.some(id=>!revision.sourceRefs.some(ref=>ref.sourceId===id)))throw Error('Review the explanation’s exact selected sources before requesting feedback.');
 const prepared=await core.beginExplanationTeachback(task.id,command.requestId,command.teachback,assertCurrent);
 return {
  request:{taskId:task.id,requestId:command.requestId,kind:'revise',prompt:command.prompt,artifactId:prepared.artifactId,expectedRevision:1,sourceIds:command.sourceIds,expectedSourceRefs:command.expectedSourceRefs,expectedArtifacts:[command.teachback.basis,...(command.teachback.replyTo?[command.teachback.replyTo]:[])],executionScope:'explanation-teachback:v1:'+prepared.artifactId},
  bind(projected:Task){
   const proposal=projected.artifacts.find(item=>item.id===prepared.artifactId)?.revisions.at(-1),pending=proposal&&teachbackBody(proposal);
   if(!pending||pending.phase!=='pending')throw Error('The original teach-back submission is unavailable in the selected request context.');
   const context=teachbackQuestion(projected,pending.input);
   const parent=pending.input.replyTo?projected.artifacts.find(artifact=>artifact.id===pending.input.replyTo!.artifactId)?.revisions.at(-1):undefined,prior=parent&&teachbackBody(parent);
   return {
    prompt:`Respond to the learner’s explanation of this question: ${pending.question}\nLearner’s exact answer: ${JSON.stringify(pending.input.answer)}\n${prior?`Previous learner answer: ${JSON.stringify(prior.input.answer)}\nPrevious tentative feedback: ${JSON.stringify(prior.feedback)}\n`:''}\nSaved explanation sections: ${JSON.stringify({answer:context.explanation.answer,coreIdea:context.explanation.deep!.coreIdea,workedExample:context.explanation.deep!.workedExample,checkAnswer:context.explanation.deep!.check.answer})}\n${pending.input.replyTo?'This is the second explicit answer to the prior targeted follow-up. Respond to this answer; do not ask another follow-up.':'Give tentative, tailored feedback on the learner’s reasoning and ask exactly one targeted follow-up that addresses a specific clarification in that answer.'}\nReturn only JSON {"learner":{"start":0,"quote":"exact learner excerpt"},"explanation":{"section":"answer|coreIdea|workedExample|checkAnswer","start":0,"quote":"exact section excerpt"},"sources":[{"source":{"sourceId":"exact ID","version":1,"digest":"exact digest"},"start":0,"quote":"exact source excerpt"}],"feedback":"tentative explanation-specific feedback, no grade or mastery claim"${pending.turn===1?',"followUp":"one targeted question"':''}}. All offsets are UTF-16 and quotes must match exactly. Include at least one exact text source quote. Source identities: ${JSON.stringify(context.sources.filter(source=>source.kind==='text').map(({id,version,digest})=>({sourceId:id,version,digest})))}`,
    finish:(content:string)=>({title:pending.turn===1?'Teach-back feedback':'Follow-up feedback',content:JSON.stringify(finishTeachback(pending,content,projected)),mimeType:TEACHBACK_MIME}),
   };
  },
 };
}
