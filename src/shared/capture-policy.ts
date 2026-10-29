import {Schema} from 'effect';

export const CURRENT_CAPTURE_POLICY_VERSION=1;
const revision=Schema.Number.pipe(Schema.int(),Schema.between(0,Number.MAX_SAFE_INTEGER));
const bundleId=Schema.String.pipe(Schema.filter(value=>value.length<=255&&/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(value)));
const executablePath=Schema.String.pipe(Schema.filter(value=>value.startsWith('/')&&value.length<=4096&&!/[\p{Cc}\p{Cf}]/u.test(value)&&!value.split('/').some(part=>part==='.'||part==='..')&&!value.includes('//')&&!value.endsWith('/')));
export const CaptureApplicationIdentitySchema=Schema.Union(
 Schema.Struct({kind:Schema.Literal('bundle-id'),value:bundleId}),
 Schema.Struct({kind:Schema.Literal('executable-path'),value:executablePath}),
);
export type CaptureApplicationIdentity=typeof CaptureApplicationIdentitySchema.Type;
export const CapturePolicySchema=Schema.Struct({
 policyVersion:Schema.Literal(CURRENT_CAPTURE_POLICY_VERSION),
 setupApproval:Schema.Literal('not-approved','approved'),
 privateApps:Schema.Array(CaptureApplicationIdentitySchema),
});
export const CaptureSnapshotSchema=Schema.Struct({revision,policy:CapturePolicySchema});
export type CapturePolicy=typeof CapturePolicySchema.Type;
export type CaptureSnapshot=typeof CaptureSnapshotSchema.Type;
export type CaptureState={kind:'available';current:CaptureSnapshot}|{kind:'unavailable';message:string};
export type CaptureCommit={kind:'saved';current:CaptureSnapshot}|{kind:'conflict';current:CaptureSnapshot}|{kind:'unavailable';message:string};
const CaptureUpdateSchema=Schema.Union(
 Schema.Struct({kind:Schema.Literal('approve-setup'),expectedRevision:revision,policyVersion:Schema.Literal(CURRENT_CAPTURE_POLICY_VERSION),privateApps:Schema.Array(CaptureApplicationIdentitySchema)}),
 Schema.Struct({kind:Schema.Literal('revoke-setup'),expectedRevision:revision}),
 Schema.Struct({kind:Schema.Literal('replace-private-apps'),expectedRevision:revision,privateApps:Schema.Array(CaptureApplicationIdentitySchema)}),
);
export const readCaptureUpdate=Schema.decodeUnknownSync(CaptureUpdateSchema,{onExcessProperty:'error'});

/** These facts come from the host identity provider, never a renderer or window title. */
export type CaptureHostFacts={
 trigger:'shortcut'|'launch';
 screenPermission:'granted'|'not-granted'|'unsupported';
 target:{application:CaptureApplicationIdentity|null;self:boolean;knownProtected:boolean}|null;
};
export type CaptureDecision={kind:'eligible';revision:number}|{kind:'blocked';reason:
 'settings-unavailable'|'setup-required'|'not-shortcut'|'os-permission'|'target-unavailable'|'self-window'|'protected-window'|'application-unidentified'|'private-application'};
const isApplicationIdentity=Schema.is(CaptureApplicationIdentitySchema);
export function evaluateCapturePolicy(state:CaptureState,facts:CaptureHostFacts):CaptureDecision{
 if(state.kind==='unavailable')return {kind:'blocked',reason:'settings-unavailable'};
 if(state.current.policy.setupApproval!=='approved')return {kind:'blocked',reason:'setup-required'};
 if(facts.trigger!=='shortcut')return {kind:'blocked',reason:'not-shortcut'};
 return evaluateCapturePrivacy(state,facts);
}
/** Manual review and frozen-pixel use share privacy checks without manufacturing setup approval. */
export function evaluateCapturePrivacy(state:CaptureState,facts:Omit<CaptureHostFacts,'trigger'>):CaptureDecision{
 if(state.kind==='unavailable')return {kind:'blocked',reason:'settings-unavailable'};
 if(facts.screenPermission!=='granted')return {kind:'blocked',reason:'os-permission'};
 if(!facts.target)return {kind:'blocked',reason:'target-unavailable'};
 if(facts.target.self)return {kind:'blocked',reason:'self-window'};
 if(facts.target.knownProtected)return {kind:'blocked',reason:'protected-window'};
 const privateApps=state.current.policy.privateApps,application=facts.target.application;
 if(privateApps.length){
  if(!isApplicationIdentity(application))return {kind:'blocked',reason:'application-unidentified'};
  for(const excluded of privateApps){
   if(excluded.kind!==application.kind)return {kind:'blocked',reason:'application-unidentified'};
   const match=application.kind==='bundle-id'?excluded.value.toLowerCase()===application.value.toLowerCase():excluded.value===application.value;
   if(match)return {kind:'blocked',reason:'private-application'};
  }
 }
 return {kind:'eligible',revision:state.current.revision};
}
