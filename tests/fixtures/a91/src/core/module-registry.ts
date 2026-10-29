import { Schema } from 'effect';

type Data = { readonly kind: string; readonly schemaVersion: number };
type State = { readonly kind: string; readonly revision: number };
type Action = { readonly expectedRevision: number };
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };
const JsonValueSchema: Schema.Schema<JsonValue> = Schema.suspend(() => Schema.Union(Schema.String, Schema.Number.pipe(Schema.finite()), Schema.Boolean, Schema.Null, Schema.Array(JsonValueSchema), Schema.Record({ key: Schema.String, value: JsonValueSchema })));
/** Preserve installed/future module state without silently stripping extension fields. */
export const StoredModuleStateSchema = Schema.Struct({ kind: Schema.String, revision: Schema.Int.pipe(Schema.nonNegative()) }, { key: Schema.String, value: JsonValueSchema });

/** Installed definitions own their data, local actions, state and readable fallback. */
export function defineModule<D extends Data, S extends State, A extends Action>(definition: {
  kind: D['kind']; schemaVersion: D['schemaVersion']; description: string;
  data: Schema.Schema<D>; state: Schema.Schema<S>; action: Schema.Schema<A>;
  validate?: (data: NoInfer<D>) => void;
  initial: (data: NoInfer<D>) => NoInfer<S>; update: (data: NoInfer<D>, state: NoInfer<S>, action: NoInfer<A>) => NoInfer<S>; text: (data: NoInfer<D>, state: NoInfer<S>) => string;
}) {
  const parse = (value: unknown): D => { const data = Schema.decodeUnknownSync(definition.data, { onExcessProperty: 'error' })(value); definition.validate?.(data); return data; };
  const parseState = (value: unknown): S => Schema.decodeUnknownSync(definition.state, { onExcessProperty: 'error' })(value);
  const parseAction = (value: unknown): A => Schema.decodeUnknownSync(definition.action, { onExcessProperty: 'error' })(value);
  return Object.freeze({ kind: definition.kind, schemaVersion: definition.schemaVersion, description: definition.description, parse, parseState, parseAction,
    initial(value: unknown): S { return definition.initial(parse(value)); },
    update(value: unknown, previous: unknown, actionValue: unknown): S {
      const data = parse(value), state = parseState(previous), action = parseAction(actionValue);
      if (state.revision !== action.expectedRevision) throw Error('This module changed. Keep your selection and reload its current state.');
      return parseState(definition.update(data, state, action));
    },
    text(value: unknown, stateValue?: unknown): string { const data = parse(value); return definition.text(data, stateValue === undefined ? definition.initial(data) : parseState(stateValue)); },
  });
}
type Entry = { kind: string; schemaVersion: number; parse(value: unknown): Data; parseAction(value: unknown): Action; initial(value: unknown): State; update(value: unknown, state: unknown, action: unknown): State; text(value: unknown, state?: unknown): string };
export function createModuleRegistry<const R extends Record<string, Entry>>(entries: R) {
  const installed = Object.freeze({ ...entries });
  for (const [key, entry] of Object.entries(installed)) if (entry.kind !== key || !Number.isInteger(entry.schemaVersion) || entry.schemaVersion < 1) throw Error('Invalid installed module definition.');
  const entry = (value: unknown) => {
    const header = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.String }))(value);
    if (!Object.hasOwn(installed, header.kind)) throw Error('This module is not installed. A readable answer remains available.');
    // Membership is validated above; each entry then validates its full typed schema.
    return installed[header.kind as keyof R];
  };
  return Object.freeze({ entries: installed,
    parse(value: unknown): ReturnType<R[keyof R]['parse']> { return entry(value).parse(value) as ReturnType<R[keyof R]['parse']>; },
    initial(value: unknown): ReturnType<R[keyof R]['initial']> { return entry(value).initial(value) as ReturnType<R[keyof R]['initial']>; },
    update(value: unknown, state: unknown, action: unknown): ReturnType<R[keyof R]['update']> { return entry(value).update(value, state, action) as ReturnType<R[keyof R]['update']>; },
    action(value: unknown, action: unknown): ReturnType<R[keyof R]['parseAction']> { return entry(value).parseAction(action) as ReturnType<R[keyof R]['parseAction']>; },
    text(value: unknown, state?: unknown) { return entry(value).text(value, state); },
  });
}
