import {createContext,useContext,type ReactNode} from 'react';
import type {Task} from '../../core/types';
import type {Command} from '../../shared/bridge';
import {resolvePageReference,type PageReference,type PageReferenceSource} from '../../shared/page-reference';

export type PageReadCommand=Extract<Command,{type:'tasks.list'|'tasks.get'}>;
type Open=(source:PageReferenceSource,target:PageReference)=>void;
const Context=createContext<{open:Open;returnTo?:PageReference}|undefined>(undefined);
export function PageReferenceNavigationProvider({open,returnTo,children}:{open:Open;returnTo?:PageReference;children:ReactNode}){return <Context.Provider value={{open,returnTo}}>{children}</Context.Provider>;}
export const usePageReferenceNavigation=()=>useContext(Context);

/** Both guard decisions and async reads remain bound to the initiating saved page. */
export function requestPageReferenceNavigation(source:PageReferenceSource,target:PageReference,options:{scope:()=>string;sourceCurrent:(source:PageReferenceSource)=>boolean;guard:(action:()=>void)=>boolean;flush:()=>Promise<void>;load:(taskId:string)=>Promise<Task>;apply:(task:Task,artifactId:string)=>void;error:(message:string)=>void}):boolean{
 const scope=options.scope(),current=()=>scope===options.scope()&&options.sourceCurrent(source);
 const read=()=>{void(async()=>{
  if(!current())return;
  try{
   await options.flush();if(!current())return;const owner=await options.load(target.taskId);if(!current())return;const preview=resolvePageReference(owner,target);
   let synchronous=true;options.guard(()=>{if(!current())return;if(!synchronous){read();return;}options.apply(owner,preview.reference.artifactId);});synchronous=false;
  }catch(error){if(current())options.error(error instanceof Error?error.message:'This saved page could not be opened.');}
 })();};
 return current()&&options.guard(read);
}
