interface OriginalColor {set(value:string):OriginalColor;multiplyScalar(value:number):OriginalColor;copy(color:OriginalColor):OriginalColor;lerp(color:unknown,alpha:number):OriginalColor}
interface OriginalMaterial {color:OriginalColor}
export const originalPalette:Record<string,string>;
export function recolorOriginalMaterials(body:OriginalMaterial,rim:OriginalMaterial,fold:OriginalMaterial|undefined,color:string):boolean;
