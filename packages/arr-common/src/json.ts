// Structurally identical to core's JsonValue; plugins cannot import @transcoda/shared.
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
