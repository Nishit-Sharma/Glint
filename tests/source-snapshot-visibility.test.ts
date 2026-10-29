import {afterEach,expect,test,vi} from 'vitest';
const probe=vi.hoisted(()=>({focused:false,inViewport:false,focusChecks:0,viewportChecks:0}));
vi.mock('@playwright/test',()=>({expect:(value:unknown)=>value===probe?{toBeFocused:async()=>{probe.focusChecks++;if(!probe.focused)throw Error('not focused');},toBeInViewport:async(options:{ratio:number})=>{probe.viewportChecks++;if(!probe.inViewport||options.ratio!==1)throw Error('not in viewport');}}:{toBe:(expected:unknown)=>{if(value!==expected)throw Error('clipped');}}}));
import {assertRevealed} from './source-snapshot-visibility';

afterEach(()=>vi.unstubAllGlobals());
test('checks focus, full viewport and ancestor clipping without moving the element',async()=>{
 probe.focused=true;probe.inViewport=true;probe.focusChecks=0;probe.viewportChecks=0;vi.stubGlobal('innerWidth',360);vi.stubGlobal('innerHeight',640);vi.stubGlobal('getComputedStyle',()=>({overflowX:'hidden',overflowY:'auto'}));
 let clipped=false;const parent={parentElement:null,clientLeft:0,clientTop:0,clientWidth:200,clientHeight:200,getBoundingClientRect:()=>({left:0,top:0})};const element={parentElement:parent,getBoundingClientRect:()=>({left:10,top:10,right:clipped?250:100,bottom:40,width:90,height:30})};const heading=Object.assign(probe,{evaluate:async(fn:(element:unknown)=>unknown)=>fn(element)});
 await assertRevealed(heading as never);expect(probe.focusChecks).toBe(1);expect(probe.viewportChecks).toBe(1);clipped=true;await expect(assertRevealed(heading as never)).rejects.toThrow('clipped');clipped=false;probe.focused=false;await expect(assertRevealed(heading as never)).rejects.toThrow('not focused');probe.focused=true;probe.inViewport=false;await expect(assertRevealed(heading as never)).rejects.toThrow('not in viewport');
});
