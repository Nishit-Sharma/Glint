import {createHash} from 'node:crypto';
import type {NativeWindow} from './native';

type WindowMetadata=Pick<NativeWindow,'osId'|'title'|'owner'|'bounds'|'displayId'|'scaleFactor'>;

/** Keep the persisted metadata token's field order and optional-field encoding. */
export function windowMetadataToken(window:WindowMetadata):string{
 const {osId,title,owner,bounds,displayId,scaleFactor}=window;
 const identity={osId,title,owner:{name:owner.name,processId:owner.processId,...(owner.path?{path:owner.path}:{}),...(owner.bundleId?{bundleId:owner.bundleId}:{})},bounds:{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height},displayId,scaleFactor};
 return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}
