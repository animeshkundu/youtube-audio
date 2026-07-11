export interface RescueConfig {
  schema: number;
  version: number;
  flags: Readonly<Record<string, boolean>>;
}

export async function loadRescueConfig(): Promise<RescueConfig | null> {
  // TODO(M2): Verify a bounded declarative schema, signature, expiry, and anti-rollback.
  return null;
}
