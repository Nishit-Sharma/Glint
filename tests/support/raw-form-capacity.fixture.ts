import {joinLab} from '../../src/learning/join-lab';
import {exampleLesson} from '../../src/learning/example';
import {parseWindowWorkflowProposal} from '../../src/learning/window-workflow-proposal';
import {syntheticCandidate} from './window-learning.fixture';
import {initialWindowReviewForm} from '../../src/renderer/src/window-review-form';
export const sqlOwner={taskId:'owned-task',artifactId:'owned-module',artifactRevision:1,artifactDigest:'digest',moduleId:'join',moduleVersion:1};
export const sqlSlot='join:row:left:owned-row';
export function fourColumnLesson(){
 const table=(id:string,key:number)=>({id,title:id,columns:Array.from({length:4},(_,i)=>({id:id+'-c'+i,label:'Column '+i,type:'integer' as const})),rows:[{id:id==='owned-left'?'owned-row':id+'-row',values:[key,0,0,0]}]});
 return joinLab.parse({...exampleLesson,practice:{id:'owned-practice',title:'Owned numeric practice',left:table('owned-left',1),right:table('owned-right',1),join:{mode:'INNER',leftColumnId:'owned-left-c0',rightColumnId:'owned-right-c0'}},transfer:{id:'owned-transfer',title:'Owned numeric transfer',left:table('transfer-left',1),right:table('transfer-right',2),join:{mode:'LEFT',leftColumnId:'transfer-left-c0',rightColumnId:'transfer-right-c0'}}});
}
export function largeWindowForm(){
 const base=syntheticCandidate(),citations=[...base.proposal.citations,...Array.from({length:42},(_,i)=>({id:'extra-'+i,source:'S1' as const,location:{kind:'image-region' as const,x:0.1,y:0.1,width:0.2,height:0.2,quote:'文'.repeat(500)}}))];
 const candidate=parseWindowWorkflowProposal(JSON.stringify({...base.proposal,citations}),base.provenance);
 if(candidate.kind!=='window-workflow-review-candidate')throw Error('Expected bounded owned synthetic candidate');
 const initial=initialWindowReviewForm(candidate),raw={...initial,states:initial.states.map(row=>({...row,reason:'Reviewed label'})),events:initial.events.map(row=>({...row,reason:'Reviewed label'})),transitions:initial.transitions.map(row=>({...row,reason:'Reviewed arrow'})),evidence:initial.evidence.map((row,i)=>({...row,reviewed:i<6,reason:'理'.repeat(500)})),initialStateId:'idle',eventSequence:'start, finish, start'};
 return {candidate,initial,raw};
}

