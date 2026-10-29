/** Status only. Renderer messages cannot supply native points, target identity or authority. */
export type SourceDragState=
 | {kind:'idle'}
 | {kind:'searching'}
 | {kind:'target';title:string;ownerName:string}
 | {kind:'blocked';message:string};
