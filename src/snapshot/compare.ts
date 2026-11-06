import type { Snapshot } from './types';

// Key order is fixed by the Snapshot shape the collector builds, so JSON.stringify is a
// deep-equal here. generatedAt is blanked in place to keep the key order identical.
const content = (s: Snapshot) => JSON.stringify({ ...s, generatedAt: '' });

/** True when two snapshots differ at most in `generatedAt`. */
export function sameContent(a: Snapshot, b: Snapshot): boolean {
  return content(a) === content(b);
}
