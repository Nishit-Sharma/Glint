import {it,expect} from 'vitest';
import {parseScreenBriefModel,readScreenBrief,SCREEN_BRIEF_DELIMITER,screenBriefNotes} from '../../src/core/screen-brief';

const ref={sourceId:'visit',version:2,digest:'a'.repeat(64)};
const question={question:'When should we arrive?',answer:'Doors open at **18:00**. Group size is still unknown.',sourceRefs:['S1']};
const output=(questions:unknown[],actions:unknown[]=[])=>'Doors open at 18:00; group size is unknown.'+SCREEN_BRIEF_DELIMITER+JSON.stringify({actions,questions});

it('binds earned questions to exact host references and preserves their readable saved fallback',()=>{
 const brief=parseScreenBriefModel(output([question]),[ref]);
 expect(brief.questions?.[0]).toEqual({...question,sourceRefs:[ref]});
 expect(brief.questions?.[0].sourceRefs[0]).not.toBe(ref);
 expect(readScreenBrief(JSON.stringify(brief),[ref])).toEqual(brief);
 expect(readScreenBrief(JSON.stringify(brief),[{...ref,version:3}])).toBeUndefined();
 expect(screenBriefNotes(brief)).toContain('## When should we arrive?\n\nDoors open at **18:00**. Group size is still unknown.');
});

it.each([
 {...question,sourceRefs:[]},{...question,sourceRefs:['S2']},{...question,sourceRefs:['S1','S1']},
 {...question,question:'x'.repeat(121)},{...question,answer:'x'.repeat(1601)},
 {...question,answer:'[Open](/action)'},{...question,answer:'<img src=x onerror=send()>'},
 {...question,tool:'send'},{...question,approval:true},{question:'No answer',sourceRefs:['S1']}
])('rejects malformed or authority-bearing question %j',value=>{
 expect(()=>parseScreenBriefModel(output([value]),[ref])).toThrow('Invalid screen brief');
});

it('bounds module density and rejects duplicate questions without truncating data',()=>{
 expect(()=>parseScreenBriefModel(output(Array.from({length:4},(_,i)=>({...question,question:'Question '+i}))),[ref])).toThrow('0–3');
 expect(()=>parseScreenBriefModel(output([question,{...question,question:' WHEN SHOULD WE ARRIVE? '}]),[ref])).toThrow('duplicate question');
 const action={label:'Draft a checklist',outcome:'Editable text.',requestKind:'create',seedPrompt:'Draft a checklist.',sourceRefs:['S1']};
 expect(()=>parseScreenBriefModel(output([question,{...question,question:'What is unknown?'}],[action,action]),[ref])).toThrow('at most 3');
 expect(()=>parseScreenBriefModel(output([question]),[])).toThrow();
});
