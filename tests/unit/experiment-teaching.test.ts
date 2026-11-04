import {expect,it} from 'vitest';
import type {ExperimentSpec} from '../../src/core/types';
import {evaluateExperiment} from '../../src/core/experiments';
import {experimentTeachingFeedback,nextExperimentCase} from '../../src/learning/experiment-teaching';

const linear:ExperimentSpec={title:'Bounded input',expression:{op:'variable',name:'x'},variables:[{name:'x',unit:'1',min:0,max:13}],assumptions:['Hypothetical input.']};

it('derives ordered intermediate steps, powers and units from the arithmetic trace',()=>{
 const spec:ExperimentSpec={title:'Squared distance per time',expression:{op:'subtract',left:{op:'divide',left:{op:'power',base:{op:'variable',name:'distance'},exponent:2},right:{op:'variable',name:'time'}},right:{op:'constant',value:2,unit:'m^2/s'}},variables:[{name:'distance',unit:'m',min:0,max:10},{name:'time',unit:'s',min:1,max:10}],assumptions:['Constant time.']};
 const feedback=experimentTeachingFeedback(spec,{distance:4,time:2},5);
 expect(feedback.result).toEqual({value:6,unit:'m^2 · s^-1',assumptions:['Constant time.']});
 expect(feedback.worked).toEqual(['(4 m) ^ 2 = 16 m^2','(16 m^2) ÷ (2 s) = 8 m^2 · s^-1','(8 m^2 · s^-1) − (2 m^2 · s^-1) = 6 m^2 · s^-1']);
 expect(feedback.matches).toBe(false);
 expect(feedback.adaptation).toContain('below the computed result by 1 m^2 · s^-1');
 expect(experimentTeachingFeedback(spec,{distance:4,time:2},7).adaptation).toContain('above the computed result by 1 m^2 · s^-1');
});

it('uses both absolute and magnitude-relative tolerances without grading reasoning',()=>{
 const spec={...linear,variables:[{...linear.variables[0],max:1e6}]};
 expect(experimentTeachingFeedback(spec,{x:0},5e-10)).toMatchObject({matches:true,tolerance:1e-9,worked:['0']});
 expect(experimentTeachingFeedback(spec,{x:0},2e-9).matches).toBe(false);
 expect(experimentTeachingFeedback(spec,{x:1e6},1e6+.0005)).toMatchObject({matches:true,tolerance:.001});
 expect(experimentTeachingFeedback(spec,{x:1e6},1e6+.002).matches).toBe(false);
 expect(experimentTeachingFeedback(spec,{x:2},2).adaptation).toContain('different input set before revealing');
 for(const prediction of [NaN,Infinity,1e16])expect(()=>experimentTeachingFeedback(spec,{x:2},prediction)).toThrow(/finite prediction/);
});

it('chooses deterministically and excludes vectors independent of object key order and equivalent outputs',()=>{
 const spec:ExperimentSpec={...linear,expression:{op:'add',left:{op:'variable',name:'x'},right:{op:'variable',name:'fee'}},variables:[...linear.variables,{name:'fee',unit:'1',min:0,max:13}]};
 const defaults={x:0,fee:1},previous={x:13,fee:1},examples=[{fee:1,x:1},{x:0,fee:3}];
 const before=structuredClone({spec,defaults,previous,examples});
 const next=nextExperimentCase(spec,defaults,previous,examples);
 expect(next).toEqual({x:3,fee:1});
 expect(nextExperimentCase(spec,defaults,previous,examples)).toEqual(next);
 expect({spec,defaults,previous,examples}).toEqual(before);
 expect([defaults,previous,...examples].map(input=>evaluateExperiment(spec,input).value)).not.toContain(evaluateExperiment(spec,next!).value);
});

it('keeps integer samples inside bounds and skips singular samples',()=>{
 const integer:ExperimentSpec={...linear,variables:[{...linear.variables[0],min:0,max:2,integer:true}]};
 expect(nextExperimentCase(integer,{x:0},{x:2},[])).toEqual({x:1});
 const singular:ExperimentSpec={...linear,expression:{op:'divide',left:{op:'constant',value:1},right:{op:'subtract',left:{op:'variable',name:'x'},right:{op:'constant',value:1}}}};
 expect(nextExperimentCase(singular,{x:0},{x:13},[])).toEqual({x:2});
});

it('reports bounded exhaustion for constant outputs, empty domains and missing combinations',()=>{
 const constant:ExperimentSpec={...linear,expression:{op:'constant',value:4}};
 expect(nextExperimentCase(constant,{x:0},{x:13},[])).toBeUndefined();
 expect(nextExperimentCase({...constant,variables:[]},{},{},[])).toBeUndefined();
 expect(nextExperimentCase({...linear,variables:[{...linear.variables[0],min:1,max:1}]},{x:1},{x:1},[])).toBeUndefined();
 const product:ExperimentSpec={...linear,expression:{op:'multiply',left:{op:'variable',name:'x'},right:{op:'variable',name:'y'}},variables:[...linear.variables,{name:'y',unit:'1',min:0,max:13}]};
 expect(nextExperimentCase(product,{x:0,y:0},{x:0,y:0},[])).toBeUndefined();
 // Single-variable sampling can exhaust even though changing both variables works.
 expect(evaluateExperiment(product,{x:1,y:1}).value).toBe(1);
});

it('rejects invalid prior observations instead of inventing an exclusion or answer',()=>{
 expect(()=>nextExperimentCase(linear,{x:0},{x:13},[{x:99}])).toThrow(/outside bounds/);
 expect(()=>experimentTeachingFeedback(linear,{x:-1},0)).toThrow(/outside bounds/);
});


it('adapts to a matching intermediate value only when its units agree, without inferring the learner reasoning',()=>{
 const spec:ExperimentSpec={...linear,expression:{op:'add',left:{op:'multiply',left:{op:'variable',name:'x'},right:{op:'constant',value:3}},right:{op:'constant',value:2}}};
 const feedback=experimentTeachingFeedback(spec,{x:5},15);
 expect(feedback.adaptation).toContain('matches an intermediate calculation (15)');
 expect(feedback.adaptation).toContain('Check the remaining operations');
 expect(feedback.adaptation).toContain('does not identify your reasoning');
 expect(experimentTeachingFeedback(spec,{x:5},14).adaptation).not.toContain('intermediate calculation');
 expect(experimentTeachingFeedback(spec,{x:5},17).adaptation).not.toContain('intermediate calculation');
 const differentUnits:ExperimentSpec={...linear,expression:{op:'divide',left:{op:'multiply',left:{op:'variable',name:'x'},right:{op:'constant',value:3,unit:'m'}},right:{op:'constant',value:2,unit:'s'}}};
 expect(experimentTeachingFeedback(differentUnits,{x:5},15).adaptation).not.toContain('intermediate calculation');
});
