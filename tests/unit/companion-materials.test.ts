import {expect,it} from 'vitest';
import {originalPalette,recolorOriginalMaterials} from '../../src/renderer/src/character-original/material-color.js';
// The project's bundled original Three module is untyped; these are its real CPU-side materials, with no WebGL renderer.
const bundledThree='../../src/renderer/src/character-original/vendor/three.module.min.js';
const THREE=await import(bundledThree);
it('all catalog colors update the existing body and authored darker eye rim without mutating the old snapshot',()=>{
 const body=new THREE.MeshPhysicalMaterial({color:originalPalette.dough}),rim=new THREE.MeshStandardMaterial({color:originalPalette.dough}),old=body.color.clone(),bodyId=body.uuid,rimId=rim.uuid;
 try{for(const [name,hex] of Object.entries(originalPalette)){expect(recolorOriginalMaterials(body,rim,undefined,name)).toBe(true);const expected=new THREE.Color(hex);expect(body.color.equals(expected)).toBe(true);expect(rim.color.equals(expected.clone().multiplyScalar(.9))).toBe(true);expect(body.uuid).toBe(bodyId);expect(rim.uuid).toBe(rimId);}expect(old.getHexString()).toBe('d6b590');}finally{body.dispose();rim.dispose();}
});
it('legacy folded material keeps its exact tint and material identity while recoloring',()=>{
 const body=new THREE.MeshPhysicalMaterial({color:originalPalette.dough}),rim=new THREE.MeshStandardMaterial({color:originalPalette.dough}),fold=body.clone();fold.roughness=.58;const id=fold.uuid;
 try{for(const name of ['iris','sage','dough']){expect(recolorOriginalMaterials(body,rim,fold,name)).toBe(true);expect(fold.color.equals(new THREE.Color(originalPalette[name]).lerp(new THREE.Color('#fff3dc'),.075))).toBe(true);expect(fold.uuid).toBe(id);expect(fold.roughness).toBe(.58);}}finally{body.dispose();rim.dispose();fold.dispose();}
});
it('unknown colors leave all actual materials unchanged',()=>{
 const body=new THREE.MeshPhysicalMaterial({color:originalPalette.iris}),rim=new THREE.MeshStandardMaterial({color:originalPalette.sage}),fold=body.clone(),before=[body.color.getHexString(),rim.color.getHexString(),fold.color.getHexString()];
 try{expect(recolorOriginalMaterials(body,rim,fold,'unknown')).toBe(false);expect([body.color.getHexString(),rim.color.getHexString(),fold.color.getHexString()]).toEqual(before);}finally{body.dispose();rim.dispose();fold.dispose();}
});
