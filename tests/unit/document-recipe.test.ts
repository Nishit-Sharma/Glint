import {expect,test} from 'vitest';
import {documentRecipe,runDocumentRecipe,documentRecipeSuite,documentRecipeFields} from '../../src/learning/document-recipe';

test('demonstrated document layout becomes a checked reusable version and a later correction can roll back',()=>{
 let state=documentRecipe.initial();
 const send=(action:Record<string,unknown>)=>{state=documentRecipe.update(state,{...action,expectedRevision:state.revision});};
 send({kind:'document-recipe-start',name:'Team handoff',intent:'Make a handoff from labelled notes.',input:'Owner: Mira\nNext: Ship samples'});
 send({kind:'document-recipe-add',step:{kind:'text',text:'# Handoff\n\n'}});
 send({kind:'document-recipe-add',step:{kind:'field',name:'Owner'}});
 send({kind:'document-recipe-add',step:{kind:'text',text:' — '}});
 send({kind:'document-recipe-add',step:{kind:'field',name:'Next'}});
 expect(state.recording?.steps.at(-1)?.after).toBe('# Handoff\n\nMira — Ship samples');
 send({kind:'document-recipe-finish'});
 expect(state.activeVersion).toBeNull();expect(state.draft.template).toBe('# Handoff\n\n{{Owner}} — {{Next}}');
 expect(()=>send({kind:'document-recipe-save-version'})).toThrow(/distinct success/);
 send({kind:'document-recipe-exception',contains:'PRIVATE',reason:'Leave private notes for review.'});
 send({kind:'document-recipe-check',input:'Owner: Jules\nNext: Confirm delivery',expected:{kind:'output',text:'# Handoff\n\nJules — Confirm delivery'}});
 send({kind:'document-recipe-check',input:'PRIVATE\nOwner: Jules\nNext: Confirm delivery',expected:{kind:'stopped'}});
 expect(documentRecipeSuite(state.draft).ready).toBe(true);
 send({kind:'document-recipe-save-version'});expect(state.activeVersion).toBeNull();send({kind:'document-recipe-activate',version:1});
 expect(runDocumentRecipe(state.versions[0].definition,'Owner: Rowan\nNext: Inspect stock')).toEqual({kind:'output',text:'# Handoff\n\nRowan — Inspect stock'});
 send({kind:'document-recipe-edit',name:'Team handoff',intent:'Make a handoff from labelled notes.',template:'{{Owner}}: {{Next}}'});
 send({kind:'document-recipe-check',input:'Owner: Mira\nNext: Ship samples',expected:{kind:'output',text:'Mira: Ship samples'}});
 send({kind:'document-recipe-check',input:'Owner: Jules\nNext: Confirm delivery',expected:{kind:'output',text:'Jules: Confirm delivery'}});
 send({kind:'document-recipe-save-version'});send({kind:'document-recipe-activate',version:2});send({kind:'document-recipe-rollback'});
 expect(state.activeVersion).toBe(1);expect(state.versions[0].definition.template).toBe('# Handoff\n\n{{Owner}} — {{Next}}');
});

test('field extraction preserves values, handles CRLF, and refuses ambiguous or unsupported documents',()=>{
 expect(documentRecipeFields('Owner:  Mira  \r\n\r\nNext:Ship samples')).toEqual({Owner:' Mira  ',Next:'Ship samples'});
 for(const input of ['', 'ordinary unlabelled paragraph','Owner: A\nOwner: B','Owner: A\nOwner : B','__proto__: x',Array.from({length:7},(_,i)=>`Field${i}: x`).join('\n'),'Owner: '+ 'x'.repeat(1001)])expect(()=>documentRecipeFields(input)).toThrow();
 expect(Object.hasOwn(documentRecipeFields('constructor: local'),'constructor')).toBe(true);
});

function demonstration(){let state=documentRecipe.initial();for(const action of [{kind:'document-recipe-start',name:'Exact notes',intent:'Use exact labelled fields.',input:'Owner: Mira\nNext: Ship'}, {kind:'document-recipe-add',step:{kind:'text',text:'Owner: '}},{kind:'document-recipe-add',step:{kind:'field',name:'Owner'}},{kind:'document-recipe-add',step:{kind:'text',text:'\nNext: '}},{kind:'document-recipe-add',step:{kind:'field',name:'Next'}},{kind:'document-recipe-finish'}])state=documentRecipe.update(state,{...action,expectedRevision:state.revision});return state;}

test('required fields stop without a partial document; inserted values never become new template instructions',()=>{
 const definition=demonstration().draft;
 expect(runDocumentRecipe(definition,'Owner: Mira')).toMatchObject({kind:'stopped',reason:expect.stringContaining('Next')});
 expect(runDocumentRecipe(definition,'Owner: Mira\nNext:')).toMatchObject({kind:'stopped'});
 expect(runDocumentRecipe(definition,'Owner: {{Next}}\nNext: <script>not executed</script>')).toEqual({kind:'output',text:'Owner: {{Next}}\nNext: <script>not executed</script>'});
 expect(runDocumentRecipe({...definition,template:'{{Unknown}}'},'Owner: Mira\nNext: Ship')).toMatchObject({kind:'stopped'});
 expect(documentRecipeSuite({...definition,template:'{{Unknown}}'}).problem).toContain('not present');
});

test('malformed placeholders, forged recording results and stale actions are refused with prior state intact',()=>{
 const state=demonstration(),before=JSON.stringify(state);
 for(const template of ['No field here','{{Owner','{{Owner}}}}','{{Owner!}}'])expect(documentRecipeSuite({...state.draft,template}).ready).toBe(false);
 const forged={...state,draft:{...state.draft,observation:state.draft.observation?{...state.draft.observation,steps:state.draft.observation.steps.map((step,index)=>index===0?{...step,after:'invented'}:step)}:null}};expect(()=>documentRecipe.parseState(forged)).toThrow();
 expect(()=>documentRecipe.update(state,{kind:'document-recipe-save-version',expectedRevision:0})).toThrow(/changed/);
 expect(()=>documentRecipe.update(state,{kind:'document-recipe-rollback',expectedRevision:state.revision})).toThrow(/No earlier/);
 expect(JSON.stringify(state)).toBe(before);
});

test('the complete output limit refuses a large expansion rather than publishing a partial document',()=>{
 const definition={...demonstration().draft,template:'{{Owner}}'.repeat(800)};
 expect(runDocumentRecipe(definition,'Owner: '+ 'x'.repeat(1000))).toMatchObject({kind:'invalid',reason:expect.stringContaining('20,000')});
});
