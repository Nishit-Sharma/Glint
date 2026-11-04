import {exampleLesson} from '../../src/learning/example';
import type {JoinExtractionProposal} from '../../src/learning/grounded-join';
export function extractionFixture(ambiguous=false,joinCited=false){
 let content='';let index=0;
 const citations:JoinExtractionProposal['citations'][number][]=[];
 const cite=(quote:string)=>{const id=`citation-${++index}`,start=content.length;content+=quote+'\n';citations.push({id,source:'S1',location:{kind:'text-range',start,end:start+quote.length,quote}});return id;};
 const table=(t:typeof exampleLesson.practice.left|typeof exampleLesson.practice.right,side:'left'|'right')=>({id:t.id,title:t.title,citationId:cite(t.title),columns:t.columns.map(c=>({...c,sourceLabel:c.label,citationId:cite(c.label),typeCitationId:cite(c.type)})),rows:t.rows.map(row=>({id:row.id,cells:row.values.map((value,i)=>ambiguous&&side==='left'&&row.id==='practice-b'&&i===0?{kind:'needs-correction' as const,reason:'The key is unreadable; supply it explicitly.',citationId:cite('?')}:{kind:'observed' as const,value,citationId:cite(value===null?'NULL':String(value))})}))});
 const left=table(exampleLesson.practice.left,'left'),right=table(exampleLesson.practice.right,'right');
 const reason=joinCited?'The source explicitly specifies INNER equality on Team.':'Equality on the displayed Team columns is the proposed model.';
 const citationId=joinCited?cite(reason):null;
 const proposal={schemaVersion:1,extraction:{id:exampleLesson.practice.id,title:exampleLesson.practice.title,left,right,join:{kind:'mapped',keys:exampleLesson.practice.join,reason,citationId},assumptions:['The shown rows are the complete small example; no hidden rows are inferred.']},citations} satisfies JoinExtractionProposal;
 return {content,proposal,transfer:exampleLesson.transfer};
}
