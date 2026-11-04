import {expect,it} from 'vitest';
import {suggestionHunks,suggestionText,readDocumentSuggestionDecision} from '../src/shared/document-edit-suggestions';

it.each([
 ['','α🙂\r\n'],['one\r\ntwo\r\n','ONE\r\ntwo\r\n'],['same\nkeep\nsame\n','first\nkeep\nlast\n'],['line\n','line'],['a\n',''],['# A\n\n**old**\n\nend\n','# A\n\n**new**\n\nend\n'],
])('round-trips exact complete text including newline and Unicode (%j)',(before,after)=>{
 const changes=suggestionHunks(before,after);expect(suggestionText(before,changes,changes.map(()=>true))).toBe(after);expect(suggestionText(before,changes,changes.map(()=>false))).toBe(before);
});
it('applies only one exact hunk without fuzzy repeated-text matching',()=>{
 const before='old\nkeep\nold\n',after='first\nkeep\nlast\n',changes=suggestionHunks(before,after);expect(changes).toHaveLength(2);expect(suggestionText(before,changes,[true,false])).toBe('first\nkeep\nold\n');
 expect(()=>suggestionText('different',changes,[true,true])).toThrow();expect(suggestionHunks(before,before)).toEqual([]);
});
it('bounds whole preparation and strictly validates decision actions',()=>{
 expect(()=>suggestionHunks('a'.repeat(100001),'x')).toThrow('100,000');
 const proposal={artifactId:'proposal',revision:2,digest:'a'.repeat(64)},command={type:'document-suggestions.decide',taskId:'task',proposal,intentId:'intent',choice:'accept',index:0};
 expect(readDocumentSuggestionDecision(command)).toEqual(command);
 for(const value of [{...command,index:undefined},{...command,choice:'accept-all'},{...command,code:'execute'},{...command,proposal:{...proposal,digest:'bad'}}])expect(()=>readDocumentSuggestionDecision(value)).toThrow();
});
