export type ScriptletOperation = Readonly<{
  id: string;
  args: Readonly<Record<string, string | number | boolean>>;
}>;

export function applyScriptletOperations(_operations: readonly ScriptletOperation[]): void {
  // TODO(M2): Dispatch allowlisted, pre-shipped uBO-derived operations only.
}
