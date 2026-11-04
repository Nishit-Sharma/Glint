import {expect,it} from 'vitest';
import {encodeProjectCreation,findProjectCreation} from '../../src/core/project-creation-receipt';

it('keeps creation receipts bounded and fails closed for reserved, conflicting or orphaned records',()=>{
 const receipt={intentHash:'a'.repeat(64),payloadDigest:'b'.repeat(64),projectId:'12345678-1234-4123-8123-123456789abc'},encoded=encodeProjectCreation(receipt),entries=['opaque-legacy',receipt.intentHash,encoded];
 expect(encoded.length).toBeLessThanOrEqual(512);expect(findProjectCreation(entries,receipt.intentHash)).toEqual(receipt);expect(findProjectCreation(entries,'c'.repeat(64))).toBeUndefined();expect(entries).toEqual(['opaque-legacy',receipt.intentHash,encoded]);
 const second={...receipt,intentHash:'c'.repeat(64)};
 for(const invalid of [[encoded],[receipt.intentHash,encoded,encoded],[receipt.intentHash,second.intentHash,encoded,encodeProjectCreation(second)],[receipt.intentHash,encoded+' '],[receipt.intentHash,'project-create:v2:{}'],[receipt.intentHash,'project-create:v1:'+JSON.stringify({...receipt,extra:true})],[receipt.intentHash,'project-create:v1:'+'x'.repeat(513)]])expect(()=>findProjectCreation(invalid,receipt.intentHash)).toThrow('unreadable or conflicting');
});
