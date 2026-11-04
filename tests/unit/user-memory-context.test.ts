import {expect,test} from 'vitest';
import {selectUserMemory,memoryConsent,type UserMemory} from '../../src/shared/user-memory';
import {userMemoryContext} from '../../src/host/user-memory-context';
import {buildMetaMessages} from '../../src/host/provider';
import {buildCodexInput} from '../../src/host/codex-provider';

test('bounded topic selection is identical in consent and provider context, with off text excluded',()=>{
 const memory:UserMemory={revision:2,enabled:true,facts:[{id:'unrelated',revision:1,text:'A private cooking fact.',topics:['cooking']},...Array.from({length:9},(_,i)=>({id:'fact-'+i,revision:2,text:'Design fact '+i,topics:i===8?['design']:[]}))]};
 const question={title:'Design',goal:'',prompt:'Explain this layout'},selected=selectUserMemory(memory,question);
 expect(selected.facts.map(fact=>fact.id)).toEqual(['fact-8','fact-0','fact-1','fact-2','fact-3','fact-4','fact-5','fact-6']);expect(selected.receipt.omitted).toBe(1);
 const consent=memoryConsent(selected),context=userMemoryContext('{"title":"Design"}',selected)!;
 for(const fact of selected.facts)expect(consent).toContain(fact.text);
 for(const absent of ['A private cooking fact.','Design fact 7']){expect(consent).not.toContain(absent);expect(context).not.toContain(absent);}
 expect(JSON.parse(context).title).toBe('Design');expect(JSON.parse(context).explicitUserMemory.facts[0]).toEqual({text:'Design fact 8'});
 expect(JSON.stringify(buildMetaMessages(question.prompt,[],context))).toContain('Design fact 8');
 expect(JSON.stringify(buildCodexInput({prompt:question.prompt,sources:[],taskContext:context}))).toContain('Design fact 8');
 const off=selectUserMemory({...memory,enabled:false},question);expect(memoryConsent(off)).not.toContain('Design fact');expect(userMemoryContext('  {"exact":true} ',off)).toBe('  {"exact":true} ');
 const long=selectUserMemory({...memory,facts:memory.facts.slice(1).map(fact=>({...fact,text:'a'.repeat(800)}))},question);expect(long.facts).toHaveLength(5);expect(long.receipt.omitted).toBe(4);
 expect(()=>userMemoryContext(JSON.stringify({history:'x'.repeat(39_900)}),selected)).toThrow('safe context limit');
});

test('topic scopes keep C++, C#, C and dotted names distinct',()=>{
 const memory:UserMemory={revision:1,enabled:true,facts:[{id:'cpp',revision:1,text:'C++ specific fact',topics:['C++']},{id:'cs',revision:1,text:'C# specific fact',topics:['C#']},{id:'c',revision:1,text:'C specific fact',topics:['C']},{id:'node',revision:1,text:'Node.js specific fact',topics:['Node.js']}]};
 const selected=(prompt:string)=>selectUserMemory(memory,{title:'Programming',goal:'',prompt}).facts.map(fact=>fact.id);
 expect(selected('Explain C++ ownership.')).toEqual(['cpp']);expect(selected('Explain C# types.')).toEqual(['cs']);expect(selected('Explain C pointers.')).toEqual(['c']);expect(selected('Explain Node.js modules.')).toEqual(['node']);expect(selected('Explain node modules.')).toEqual([]);
});

test('project account-memory exclusion shares no facts in consent or either provider serializer while inherited and global-off choices stay distinct',()=>{
 const memory:UserMemory={revision:1,enabled:true,facts:[{id:'synthetic-fact',revision:1,text:'SYNTHETIC_ACCOUNT_FACT',topics:[]}]},question={title:'Synthetic project',goal:'',prompt:'Explain the plan'},project={useAccountMemory:false};
 const excluded=selectUserMemory(memory,question,project),context=userMemoryContext('{"title":"Synthetic project"}',excluded);
 expect(excluded.receipt).toEqual({revision:1,status:'off',facts:[],omitted:0});expect(memoryConsent(excluded,project)).toContain('off for this project');expect(context).toBe('{"title":"Synthetic project"}');
 for(const value of [memoryConsent(excluded,project),JSON.stringify(buildMetaMessages(question.prompt,[],context)),JSON.stringify(buildCodexInput({prompt:question.prompt,sources:[],taskContext:context}))])expect(value).not.toContain('SYNTHETIC_ACCOUNT_FACT');
 expect(selectUserMemory(memory,question,{}).facts).toHaveLength(1);expect(selectUserMemory({...memory,enabled:false},question,{useAccountMemory:true}).facts).toEqual([]);
});
