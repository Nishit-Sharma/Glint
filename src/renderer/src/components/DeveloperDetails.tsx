import type {ReactNode} from 'react';
// Never enabled by default, and compiled out of packaged production builds.
export const developerMode=import.meta.env.DEV&&new URLSearchParams(globalThis.location?.search??'').get('developer')==='1';
if(developerMode)document.documentElement.dataset.developerMode='true';
export function DeveloperDetails({title='Developer diagnostics',children}:{title?:string;children:ReactNode}){
 return developerMode?<details className="developer-details"><summary>{title}</summary>{children}</details>:null;
}
