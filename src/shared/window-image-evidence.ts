import {Schema} from 'effect';

function safeText(value:string){
 return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069\uD800-\uDFFF]/u.test(value)
  &&!/(?:\b[a-z][a-z0-9+.-]*:\/\/|\b(?:javascript|vbscript|data|mailto|tel|sms|intent|blob|file|vscode|codex):|\bwww\.)/iu.test(value)
  &&!/```|~~~|<\/?[a-z][^>]*>|<!--|\]\s*(?:\(|\[)|^\s*\[[^\]]+\]:/imu.test(value);
}
export const windowImageText=(max:number)=>Schema.String.pipe(Schema.minLength(1),Schema.maxLength(max),Schema.filter(value=>value.trim().length>0&&safeText(value)));

export const WindowImageRegionSchema=Schema.Struct({kind:Schema.Literal('image-region'),x:Schema.Number.pipe(Schema.between(0,1)),y:Schema.Number.pipe(Schema.between(0,1)),width:Schema.Number.pipe(Schema.greaterThan(0),Schema.lessThanOrEqualTo(1)),height:Schema.Number.pipe(Schema.greaterThan(0),Schema.lessThanOrEqualTo(1)),quote:windowImageText(500)});
export type WindowImageRegion=typeof WindowImageRegionSchema.Type;
/** Symmetric bounds preserve every representable positive edge, including subnormal numbers. */
export function windowImageRegionIsBounded(location:WindowImageRegion):boolean{return !(location.x>=1||location.y>=1||location.width>1-location.x||location.x>1-location.width||location.height>1-location.y||location.y>1-location.height);}
