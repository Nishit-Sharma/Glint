import {it,expect} from 'vitest';
import {parseBrowserPlan} from '../../src/host/browser/coordinator';

it('accepts a useful plain answer when the agent does not need an interactive module',()=>{
 expect(parseBrowserPlan(JSON.stringify({kind:'answer',markdown:'The observed page confirms the draft was saved.'}))).toEqual({kind:'answer',markdown:'The observed page confirms the draft was saved.',modules:[]});
});
it('still rejects executable fields and malformed module declarations',()=>{
 expect(()=>parseBrowserPlan(JSON.stringify({kind:'answer',markdown:'Answer',modules:'run code'}))).toThrow();
 expect(()=>parseBrowserPlan(JSON.stringify({kind:'answer',markdown:'Answer',execute:'approve'}))).toThrow();
});
it('parses bounded intended form values only on a click proposal',()=>{
 const action={kind:'click',targetId:'submit',expectedFields:[{targetId:'choice',value:'Mesa'}]};
 expect(parseBrowserPlan(JSON.stringify({kind:'action',reason:'Save the intended choice',action}))).toEqual({kind:'action',reason:'Save the intended choice',action});
 for(const expectedFields of ['choice=Mesa',[{targetId:'choice',value:5}],[{targetId:'choice',value:'Mesa',approve:true}],[{targetId:'choice',value:'x'.repeat(10001)}]])expect(()=>parseBrowserPlan(JSON.stringify({kind:'action',reason:'Save',action:{...action,expectedFields}}))).toThrow();
 expect(()=>parseBrowserPlan(JSON.stringify({kind:'action',reason:'Fill',action:{kind:'fill',targetId:'choice',value:'Mesa',expectedFields:[]}}))).toThrow();
});
