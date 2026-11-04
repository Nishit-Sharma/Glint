import type {CharacterProfile} from '../../../shared/character-catalog';
export interface OriginalActor {
 pause():void;resume():void;destroy():void;
 pose(x:number,y:number,options?:{blink?:number;tilt?:number;squish?:number;lift?:number;bx?:number;by?:number;phase?:string}):void;
 acknowledge():void;
 setColor(color:CharacterProfile['look']['color']):void;
 setPhase(phase:string):void;
 stats():{frames:number;near:boolean;phase:string;eye:number[];body:number[];active:boolean;idle:boolean;destroyed:boolean;activity:'quiet'|'playful';lift:number;gesture:boolean;color:CharacterProfile['look']['color']};
}
export function mountOriginal(canvas:HTMLCanvasElement,look:CharacterProfile['look'],onFailure?:(error:unknown)=>void,options?:{activity?:'quiet'|'playful';seed?:number;zoom?:number}):OriginalActor;
