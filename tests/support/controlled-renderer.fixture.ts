/** Test-only deterministic hook/effect delivery and host tree. This substitutes
 * React scheduling and DOM rendering; component functions and cache stay real. */
type Slot={value?:unknown;deps?:readonly unknown[];cleanup?:()=>void};
type Fiber={slots:Slot[];index:number};
type Host={type:string;props:Record<string,any>;children:Host[]};
type Controller={fibers:Map<string,Fiber>;current?:Fiber;effects:Array<()=>void>;dirty:boolean;nextId:number};
let active:Controller|undefined;
function slot(){if(!active?.current)throw Error('Hook outside controlled component');const fiber=active.current,index=fiber.index++;return fiber.slots[index]??(fiber.slots[index]={});}
function same(a:readonly unknown[]|undefined,b:readonly unknown[]|undefined){return !!a&&!!b&&a.length===b.length&&a.every((item,index)=>Object.is(item,b[index]));}
function effect(fn:()=>void|(()=>void),deps?:readonly unknown[]){const item=slot();if(!same(item.deps,deps)){item.deps=deps;active!.effects.push(()=>{item.cleanup?.();const result=fn();item.cleanup=typeof result==='function'?result:undefined;});}}
export const hooks={
 useState(initial:unknown){const item=slot(),controller=active!;if(!('value' in item))item.value=typeof initial==='function'?(initial as ()=>unknown)():initial;return [item.value,(next:unknown)=>{const value=typeof next==='function'?(next as (current:unknown)=>unknown)(item.value):next;if(!Object.is(value,item.value)){item.value=value;controller.dirty=true;}}];},
 useRef(initial:unknown){const item=slot();if(!('value' in item))item.value={current:initial};return item.value;},
 useMemo(fn:()=>unknown,deps:readonly unknown[]){const item=slot();if(!same(item.deps,deps)){item.value=fn();item.deps=deps;}return item.value;},
 useCallback(fn:unknown,deps:readonly unknown[]){return hooks.useMemo(()=>fn,deps);},
 useEffect:effect,useLayoutEffect:effect,
 useContext(context:{_currentValue:unknown}){return context._currentValue;},
 useSyncExternalStore(_subscribe:unknown,getSnapshot:()=>unknown){return getSnapshot();},
 useId(){const item=slot();if(!('value' in item))item.value='controlled-'+(++active!.nextId);return item.value;},
};
export function createControlledRenderer(factory:()=>unknown){
 const controller:Controller={fibers:new Map(),effects:[],dirty:false,nextId:0};let tree:Host[]=[];
 function walk(node:any,path:string):Host[]{
  if(node===null||node===undefined||typeof node==='boolean')return [];
  if(Array.isArray(node))return node.flatMap((child,index)=>walk(child,path+'/'+(child?.key??index)));
  if(typeof node==='string'||typeof node==='number')return [{type:'#text',props:{text:String(node)},children:[]}];
  const {type,props}=node;if(type===Symbol.for('react.fragment'))return walk(props.children,path+'/fragment');
  if(typeof type==='function'){
   const key=path+'/'+(type.name||'component'),fiber=controller.fibers.get(key)??{slots:[],index:0};controller.fibers.set(key,fiber);fiber.index=0;const parent=controller.current;controller.current=fiber;
   let output:unknown;try{output=type(props);}finally{controller.current=parent;}return walk(output,key);
  }
  if(type&&typeof type==='object'&&type.$$typeof===Symbol.for('react.context')){const previous=type._currentValue;type._currentValue=props.value;try{return walk(props.children,path+'/provider');}finally{type._currentValue=previous;}}
  if(typeof type==='string')return [{type,props,children:walk(props.children,path+'/'+type)}];
  throw Error('Unsupported controlled renderer element: '+String(type));
 }
 function render(){for(let pass=0;pass<30;pass++){controller.dirty=false;controller.effects=[];const previous=active;active=controller;try{tree=walk(factory(),'root');for(const callback of controller.effects)callback();}finally{active=previous;}if(!controller.dirty)return tree;}throw Error('Controlled effects did not settle');}
 function nodes(){const result:Host[]=[];const visit=(items:Host[])=>{for(const item of items){result.push(item);visit(item.children);}};visit(tree);return result;}
 return {render,nodes,find(predicate:(node:Host)=>boolean){const found=nodes().filter(predicate);if(found.length!==1)throw Error('Expected exactly one host node, found '+found.length);return found[0];}};
}
