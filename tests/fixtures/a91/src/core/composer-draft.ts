export const composerKinds=['explain','create','experiment','procedure'] as const;
export type ComposerKind=typeof composerKinds[number];
export interface ComposerDraft {text:string;kind:ComposerKind;revision:number}

/** Pure composer projection; importing it never loads the task's tool schemas. */
export function readComposerDraft(session?:{readonly draft:string;readonly draftKind?:ComposerKind;readonly draftRevision?:number}):ComposerDraft{
 return {text:session?.draft??'',kind:session?.draftKind??'explain',revision:session?.draftRevision??0};
}
