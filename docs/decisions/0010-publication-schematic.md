# ADR 0010: Shared conventional schematic geometry and bounded publication output

Status: accepted and implemented on 2026-08-09

## Decision

Render both the review canvas and exported schematic from one deterministic, declarative geometry engine. Use a light paper-oriented visual language: dark orthogonal wires, explicit junction dots, conventional component glyphs, restrained semantic accents, and horizontal reference/value labels even when a component rotates.

Represent common components through the stable schema-v3 catalog rather than component-specific renderer code. The implemented catalog contains 44 structural kinds, including a two-header ESP32-S3-DevKitC-1 v1.1 board glyph. Every non-IC entry has exact pin IDs and an explicit limitation; the separately governed built-in IC catalog retains its exact model and ordered-pin contracts.

Produce a revision-scoped publication package containing:

- a bordered A4/Letter page SVG with metadata title block;
- a tightly cropped transparent SVG for papers and slides;
- CSV and Markdown logical BOMs;
- a design report containing structural diagnostics and evidence limitations; and
- the canonical `circuit.json` revision used for the output.

Pi may inspect the catalog, stage typed design/metadata operations, and stage a deterministic grid-aligned layout. Only explicit user approval can apply a proposal.

## Why

- A paper figure must remain scalable, reproducible, and tied to an exact canonical revision.
- Sharing geometry between screen and export prevents a second renderer from silently changing connectivity or orientation.
- Declarative symbols and stable pins let agents reason about and extend designs without gaining executable rendering or filesystem authority.
- A complete export needs provenance and explicit limitations, not only an attractive bitmap.

## Verification boundary

Tests cover catalog ordering and pin uniqueness, all generic symbols rendering without invalid geometry, schema migration, transaction validation, deterministic agent layout proposals, physical page dimensions, title/safety content, conventional resistor geometry, the six exported files, and Electron review/export workflows.

“Publication-ready” means deterministic vector artwork, metadata, BOMs, revision provenance, and a limitations report. It does not establish journal acceptance, component availability, footprint/package correctness, electrical or timing behavior, physical connectivity, safe energization, or regulatory approval. PCB routing, manufacturing output, KiCad round-trip, SPICE, and qualified engineering review remain separate future work.
