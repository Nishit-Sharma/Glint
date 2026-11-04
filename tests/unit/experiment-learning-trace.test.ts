import {expect,it} from 'vitest';
import {evaluateExperiment,evaluateExperimentWithTrace} from '../../src/core/experiments';
import type {ExperimentSpec} from '../../src/core/types';

const spec:ExperimentSpec={title:'Travel cost',expression:{op:'add',left:{op:'multiply',left:{op:'variable',name:'rate'},right:{op:'variable',name:'time'}},right:{op:'variable',name:'fee'}},variables:[{name:'rate',unit:'USD/s',min:0,max:100},{name:'time',unit:'s',min:0,max:100},{name:'fee',unit:'USD',min:0,max:100}],assumptions:['Constant rate; fee charged once.']};

it('explains an actual nested expression in dependency order with checked values and units',()=>{
 const before=JSON.stringify(spec),trace=evaluateExperimentWithTrace(spec,{rate:3,time:4,fee:2});
 expect(trace.result).toEqual(evaluateExperiment(spec,{rate:3,time:4,fee:2}));
 expect(trace.steps).toEqual([
  {id:'result.left.left',op:'variable',name:'rate',inputs:[],value:3,unit:'USD · s^-1'},
  {id:'result.left.right',op:'variable',name:'time',inputs:[],value:4,unit:'s'},
  {id:'result.left',op:'multiply',inputs:['result.left.left','result.left.right'],value:12,unit:'USD'},
  {id:'result.right',op:'variable',name:'fee',inputs:[],value:2,unit:'USD'},
  {id:'result',op:'add',inputs:['result.left','result.right'],value:14,unit:'USD'}
 ]);
 expect(JSON.stringify(spec)).toBe(before);
});

it('uses the same arithmetic and refusal boundaries as ordinary evaluation',()=>{
 const expression:ExperimentSpec={title:'Energy',expression:{op:'divide',left:{op:'power',base:{op:'variable',name:'speed'},exponent:2},right:{op:'constant',value:2}},variables:[{name:'speed',unit:'m/s',min:-10,max:10}],assumptions:['Arithmetic example.']};
 const trace=evaluateExperimentWithTrace(expression,{speed:4});expect(trace.result).toEqual({value:8,unit:'m^2 · s^-2',assumptions:expression.assumptions});expect(trace.steps.find(step=>step.op==='power')).toMatchObject({exponent:2,value:16});
 for(const candidate of [
  {...expression,expression:{op:'divide',left:{op:'constant',value:1},right:{op:'constant',value:0}}},
  {...expression,expression:{op:'add',left:{op:'variable',name:'speed'},right:{op:'constant',value:1,unit:'kg'}}},
  {...expression,expression:{op:'constant',value:Infinity}},
  {...expression,expression:{op:'variable',name:'missing'}}
 ] as ExperimentSpec[]){expect(()=>evaluateExperimentWithTrace(candidate,{speed:4})).toThrow();expect(()=>evaluateExperiment(candidate,{speed:4})).toThrow();}
 expect(()=>evaluateExperimentWithTrace(expression,{speed:11})).toThrow(/outside bounds/);
 expect(()=>evaluateExperimentWithTrace(expression,{speed:4,extra:1})).toThrow(/unknown input/);
 let deep:ExperimentSpec['expression']={op:'constant',value:1};for(let i=0;i<21;i++)deep={op:'power',base:deep,exponent:1};expect(()=>evaluateExperimentWithTrace({...expression,expression:deep},{speed:4})).toThrow(/exceeds bounds/);
});
