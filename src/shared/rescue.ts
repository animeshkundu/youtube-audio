import type { ScriptletOperation } from './scriptlets';

export interface RescueConfig {
  schema: 1;
  version: number;
  flags: Readonly<Record<string, boolean>>;
  scriptlets: readonly ScriptletOperation[];
}

const BUNDLED_BASELINE: RescueConfig = Object.freeze({
  schema: 1,
  version: 1,
  flags: Object.freeze({ playerResponsePruning: true }),
  scriptlets: Object.freeze([
    Object.freeze({ id: 'neutralize-exposed-abnormality-callback', args: Object.freeze({}) }),
    Object.freeze({ id: 'set-inline-playback-no-ad', args: Object.freeze({}) }),
  ]),
});

/**
 * Returns the static, reviewed baseline shipped in this extension package.
 * Remote rescue-config is intentionally deferred until after the S5 AMO policy preflight.
 */
export async function loadRescueConfig(): Promise<RescueConfig> {
  return BUNDLED_BASELINE;
}
