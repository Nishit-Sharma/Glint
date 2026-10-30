import {Color} from './vendor/three.module.min.js';
export const originalPalette={dough:'#d6b590',iris:'#8793d0',sage:'#81a993',apricot:'#d29b82',rose:'#c68d9e',sky:'#7aabca',butter:'#ccb66e'};
const foldTint=new Color('#fff3dc');
/** Reuse the exact materials and their authored rim/fold tint; geometry and contexts stay owned by the actor. */
export function recolorOriginalMaterials(body,rim,fold,color){
 const hex=originalPalette[color];if(!hex)return false;
 body.color.set(hex);rim.color.set(hex).multiplyScalar(.9);
 if(fold)fold.color.copy(body.color).lerp(foldTint,.075);
 return true;
}
