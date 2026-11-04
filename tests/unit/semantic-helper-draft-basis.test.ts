import {expect,test} from 'vitest';
import {semanticHelper} from '../../src/learning/semantic-helper';
import {semanticHelperDraftBasis} from '../../src/renderer/src/semantic-helper-draft-basis';

test('semantic draft families track only their bounded exact state dependencies',()=>{
 const initial=semanticHelper.initial('owner'),atVersion={...initial,draftVersion:1};
 for(const family of ['steps','record','checks','correction'] as const)expect(semanticHelperDraftBasis(initial,family)).not.toBe(semanticHelperDraftBasis(atVersion,family));
 expect(semanticHelperDraftBasis(initial,'run')).toBe(semanticHelperDraftBasis(atVersion,'run'));
 expect(semanticHelperDraftBasis(initial,'run')).not.toBe(semanticHelperDraftBasis({...initial,activeVersion:1},'run'));
 const evidence={...atVersion,rationales:[{id:'route-reason',kind:'inferred-rationale' as const,stepId:'threshold',basis:[{recordingId:'one',traceStepId:'threshold'}],reason:'Old reason'}]};
 expect(semanticHelperDraftBasis(atVersion,'checks')).not.toBe(semanticHelperDraftBasis(evidence,'checks'));
 const corrected={...evidence,corrections:[{id:'c',proposalId:'route-reason',before:'Old reason',after:'New reason',reason:'Clarify'}]};
 expect(semanticHelperDraftBasis(evidence,'correction')).not.toBe(semanticHelperDraftBasis(corrected,'correction'));
 const replaced={...corrected,evidenceHistory:[{} as never]};
 expect(semanticHelperDraftBasis(corrected,'checks')).not.toBe(semanticHelperDraftBasis(replaced,'checks'));
 const stopped={...replaced,recordings:[{recordingId:'stop',result:{trace:[{stepId:'approval'}]}} as never]};
 expect(semanticHelperDraftBasis(replaced,'checks')).not.toBe(semanticHelperDraftBasis(stopped,'checks'));
 const threshold={...stopped,recordings:[...stopped.recordings,{recordingId:'seen',result:{trace:[{stepId:'threshold'}]}} as never]};
 expect(semanticHelperDraftBasis(stopped,'checks')).not.toBe(semanticHelperDraftBasis(threshold,'checks'));
 expect(semanticHelperDraftBasis(threshold,'checks').length).toBeLessThan(512);
});
