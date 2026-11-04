/** A bounded ledger for one open review; overflow holds new practice, never ordinary exploration. */
export const experimentExampleLimits=Object.freeze({examples:14,rawCharacters:16384});
export const OPEN_REVIEW_EXAMPLES='open-review-v1' as const;
export type ExperimentExampleContext=typeof OPEN_REVIEW_EXAMPLES;
