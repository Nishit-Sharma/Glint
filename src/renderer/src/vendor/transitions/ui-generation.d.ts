export interface GenerationRun {finished:Promise<HTMLElement>;cancel:()=>void;element:HTMLElement}
export function generate(element:HTMLElement,options?:{variant?:'ui'|'image';mode?:'skeleton';duration?:number;maxParts?:number;keys?:number}):GenerationRun;
export function timeline(element:HTMLElement,options:{variant:'image';duration:number;parent:HTMLElement;particles?:boolean}):{end:number;seek:(ms:number)=>void;destroy:()=>void};
