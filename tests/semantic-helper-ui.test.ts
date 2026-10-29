import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test} from 'vitest';
import {recordProcedure,SemanticHelperStudio} from '../src/renderer/src/components/SemanticHelperStudio';
import {semanticHelper} from '../src/learning/semantic-helper';
import {runSemanticProcedure} from '../src/learning/semantic-procedure';
import {helperExample} from '../src/learning/helper-example';

test('the record editor uses chosen typed field names and an explicit numeric comparison',()=>{
 const procedure=recordProcedure({inputName:'parcel',numberField:'weight',approvalField:'reviewed',sensitiveField:'private',outputField:'handling',threshold:'25',comparison:'gt',whenTrue:'manual',whenFalse:'regular'});
 expect(runSemanticProcedure(procedure,{weight:25,reviewed:true,private:false})).toMatchObject({status:'completed',output:{handling:'regular'},effectAuthority:'none'});
 expect(runSemanticProcedure(procedure,{weight:26,reviewed:true,private:false})).toMatchObject({status:'completed',output:{handling:'manual'}});
 expect(runSemanticProcedure(procedure,{weight:26,reviewed:false,private:false})).toMatchObject({status:'abstained',code:'precondition'});
 expect(runSemanticProcedure(procedure,{weight:26,reviewed:true,private:true})).toMatchObject({status:'abstained',code:'explicit-stop'});
 expect(()=>recordProcedure({inputName:'parcel',numberField:'same',approvalField:'same',sensitiveField:'private',outputField:'handling',threshold:'25',comparison:'gt',whenTrue:'manual',whenFalse:'regular'})).toThrow();
});

test('the initial semantic editor states its local scope without claiming an observation',()=>{
 const state=semanticHelper.initial(helperExample.id);
 const html=renderToStaticMarkup(createElement(SemanticHelperStudio,{data:helperExample,state,onAction:()=>{}}));
 expect(html).toContain('Local record helper');expect(html).toContain('does not observe a screen');expect(html).toContain('Save draft steps');
 expect(html).not.toContain('Run active record helper');
});
