import {expect,test} from 'vitest';
import {conceptCitationRange} from '../../src/shared/concept-map';

test('human citation positions count graphemes while stored excerpt offsets remain UTF-16',()=>{
 const prefix='🌞 e\u0301 👩🏽‍🔬 ',quote='Sunlight 🌞 heats surface water.',content=prefix+quote;
 expect(conceptCitationRange(content,{start:prefix.length,quote})).toEqual({start:7,end:37});
 expect(conceptCitationRange(content,{start:3,quote:'e\u0301'})).toEqual({start:3,end:3});
 expect(conceptCitationRange(content,{start:prefix.length+9,quote:'🌞'})).toEqual({start:16,end:16});
 expect(content.slice(prefix.length,prefix.length+quote.length)).toBe(quote);
 expect(conceptCitationRange('Alpha. Beta.',{start:7,quote:'Beta.'})).toEqual({start:8,end:12});
});
test('ranges require the exact excerpt and include a partial grapheme only once',()=>{
 expect(conceptCitationRange('e\u0301x',{start:1,quote:'\u0301'})).toEqual({start:1,end:1});
 for(const citation of [{start:-1,quote:'a'},{start:0.5,quote:'a'},{start:0,quote:''},{start:0,quote:'b'},{start:2,quote:'a'}])expect(conceptCitationRange('a',citation)).toBeUndefined();
});
