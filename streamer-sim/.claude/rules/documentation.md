---
paths:
  - "streamer-sim/**"
  - "src/**"
  - "docs/**"
---

# Documentation on Large Changes

When editing Limelight (`streamer-sim/`), **update `docs/` in the same change** whenever
the work is large (see [`CLAUDE.md`](../CLAUDE.md) for the full checklist).

## Quick rules

1. **Read** `docs/README.md` before changing unfamiliar systems.
2. **Update** the numbered doc that owns the subsystem you touched.
3. **Record** fixes to UI/code/doc mismatches in `docs/09-expectation-vs-reality.md`.
4. **Never** put implementation details only in `IMPROVEMENTS.md`.
5. **Do not** mark a large task done until docs reflect the new behavior.

Docs must describe **current implementation** with concrete values from source — not
aspirational design.
