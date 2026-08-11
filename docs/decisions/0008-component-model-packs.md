# ADR 0008: Datasheet-derived components use guarded declarative model packs

- Status: accepted
- Date: 2026-08-09

## Context

The harness should become more useful when a user attaches an unfamiliar component datasheet. Allowing an LLM to generate and execute JavaScript, C/C++, Rust, native plugins, or arbitrary simulator patches would make a document/model response a code-execution supply chain. Keeping generated data as metadata only would be safer but would not satisfy local functional evaluation.

## Decision

Use a strict schema-versioned JSON pack with no executable fields. Pi can inspect the contract and attached evidence and return a proposal, but only the user can install it from a validated IPC/UI action.

Every pack contains stable identity/revision, Uno/S3 applicability, pins/roles, electrical limits, one behavior declaration, explicit limitations, and project attachment UUID/page/claim/confidence provenance. Installation verifies the attachment and page, records the attachment hash, fingerprints the proposal, serializes project writes, requires an increasing revision, writes atomically, and preserves the replaced revision.

The only executable behavior is host-owned deterministic code for four fixed data formats:

- complete digital truth tables;
- strictly ordered analog points with clamped linear interpolation;
- bounded I²C register banks with width/access/reset state; and
- SPI mode/clock/opcode recognition with optional constant response bytes.

Unknown JSON fields, scripts, expressions, paths, network references, invalid pins/ranges, duplicate registers/opcodes, and incomplete truth-table rows are rejected.

## Consequences

- The LLM can extend functional coverage without receiving code-execution authority.
- Every evaluation repeats pack limitations and the global warning that timing, loading, thermal behavior, parasitics, and physical safety are not established.
- Complex components that cannot be represented faithfully by these four forms must remain unsupported or receive a reviewed, host-owned adapter in a normal code change.
- Page existence and hashes are verified today; finer claim-to-field provenance coverage is future validation work.
