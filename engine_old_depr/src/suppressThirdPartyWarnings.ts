/**
 * Targeted suppression for Three.js deprecation warnings emitted by
 * third-party libraries we depend on, but cannot fix from our side.
 *
 * Each pattern below MUST be:
 *   1. emitted by code we don't own (verified by reading the dep source)
 *   2. impossible to silence by upgrading (verified against latest stable)
 *   3. matched by a tight, version-pinned substring so we don't accidentally
 *      hide warnings about *our* code if the message text changes.
 *
 * Re-evaluate this list on every dep upgrade. If the upstream library has
 * fixed its usage, drop the pattern.
 */

// As of three@0.184 (r184), `THREE.Clock` is deprecated in favour of
// `THREE.Timer` (r183 deprecation, see three.core.js line "Clock: This module
// has been deprecated."). @react-three/fiber@9.6.1 still does
// `new THREE.Clock()` once per Canvas in its store init
// (events-b389eeca.esm.js, ~line 1016). The latest stable r3f does not yet
// migrate to Timer. Until they ship the fix, we filter exactly this one
// console.warn so the dev console isn't permanently noisy.
const SUPPRESSED_PATTERNS: ReadonlyArray<string> = [
  "Clock: This module has been deprecated. Please use THREE.Timer instead.",
];

const originalWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  const first = args[0];
  if (typeof first === "string") {
    for (const pattern of SUPPRESSED_PATTERNS) {
      if (first.includes(pattern)) return;
    }
  }
  originalWarn(...args);
};
