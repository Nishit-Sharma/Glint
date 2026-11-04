import {Schema} from 'effect';
const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200));
const digest=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/));
const basis=Schema.Struct({artifactId:id,revision:Schema.Int.pipe(Schema.positive()),digest});
export const AuthoredDocumentOriginSchema=Schema.Struct({kind:Schema.Literal('authored-document-v1'),taskId:id,artifactId:id,intentHash:digest,payloadDigest:digest,contentDigest:digest});
export type AuthoredDocumentOrigin=typeof AuthoredDocumentOriginSchema.Type;
/** Core-only creation evidence, never an editable document field or a waiver. */
export const ArtifactContextOriginSchema=Schema.Union(
 AuthoredDocumentOriginSchema,
 Schema.Struct({kind:Schema.Literal('module-notes-v1'),contentDigest:digest,basis,sessionRevision:Schema.Int.pipe(Schema.nonNegative())}),
 Schema.Struct({kind:Schema.Literal('source-comparison-v1'),contentDigest:digest,claimHash:digest,binding:digest})
);
export type ArtifactContextOrigin=typeof ArtifactContextOriginSchema.Type;
export const UNCERTAIN_ARTIFACT_CONTEXT="This document's original context cannot be verified. AI reuse and branching are unavailable; the local document is kept. Use a new copy saved from a current original answer.";

export const WITHHELD_ARTIFACT_CONTEXT="This document is withheld from the selected source or skill context. Review that context before copying it or using it with AI.";
