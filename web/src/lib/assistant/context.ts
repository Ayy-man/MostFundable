export const ASSISTANT_CONTEXT_DENY_LIST = [
  "accounts",
  "balance",
  "bureau",
  "creditReport",
  "monitoring",
  "score",
  "snapshot",
  "tradelines",
  "utilization",
] as const;

export function assistantContextIsSafe(context: { readonly route: string; readonly entityRef: string }): boolean {
  const serialized = JSON.stringify(context).toLowerCase();
  return ASSISTANT_CONTEXT_DENY_LIST.every((field) => !serialized.includes(field.toLowerCase()));
}
