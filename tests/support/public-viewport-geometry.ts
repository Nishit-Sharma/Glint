/** Pure controls for the existing public-frame gate. Coordinates are observed
 * CSS pixels. A small ratio by itself is never classified as rounding. */
export type ViewportRect={left:number;top:number;right:number;bottom:number};
export type ViewportFit=
 | {valid:false;contained:false;fits:false;reason:string}
 | {valid:true;contained:boolean;fits:boolean;maxOverflow:number;overflow:ViewportRect;legacyEdgeToleranceCSS:.5};
export function viewportFit(rect:ViewportRect,clip:ViewportRect):ViewportFit {
 if(![rect.left,rect.top,rect.right,rect.bottom,clip.left,clip.top,clip.right,clip.bottom].every(Number.isFinite)||rect.right<=rect.left||rect.bottom<=rect.top||clip.right<=clip.left||clip.bottom<=clip.top)return {valid:false,contained:false,fits:false,reason:'Nonfinite or empty observed rectangle/clip.'};
 const overflow={left:Math.max(0,clip.left-rect.left),top:Math.max(0,clip.top-rect.top),right:Math.max(0,rect.right-clip.right),bottom:Math.max(0,rect.bottom-clip.bottom)},maxOverflow=Math.max(...Object.values(overflow));
 // This was already the shared helper's edge envelope. It cannot override its
 // separate strict complete-intersection requirement.
 return {valid:true,contained:maxOverflow===0,fits:maxOverflow<=.5,maxOverflow,overflow,legacyEdgeToleranceCSS:.5};
}
export function viewportAdmission(fit:ViewportFit,intersectionRatio:number|undefined,painted:boolean,centerUnoccluded:boolean){return fit.valid&&fit.fits&&intersectionRatio===1&&painted&&centerUnoccluded;}
