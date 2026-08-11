# ADR 0003: Canonical typed circuit model with derived interchange

Date: 2026-08-09

## Decision

Use the versioned `circuit.json` domain schema in each project as the canonical logical schematic. It owns stable component, pin, net, constraint, and schematic-placement IDs. Electrical connectivity is independent from view coordinates. `assembly.json` is a separate, versioned physical-build document that references logical component/pin/net IDs rather than duplicating the circuit.

Circuit JSON, KiCad, SPICE netlists, SVG, BOM, and other ecosystem formats are import/export adapters. An import creates or proposes a validated conversion and must report unsupported or lossy fields. An export is deterministic and revision-scoped. Neither external format is edited as the application's live source of truth.

All mutations are typed domain transactions with a base revision, author/source, rationale, and bounded operations. A transaction validates before an atomic write, records before/after checkpoints and an audit entry, and increments the canonical revision. Pi can inspect both models and stage circuit or breadboard proposals, but cannot directly write project files. Proposal creation validates the complete operation set without mutating the canonical document; explicit user IPC approval performs a stale-revision check and applies it atomically.

## Why

- A schematic editor needs stable IDs, deterministic serialization, safe stale-write rejection, and application-specific evidence/provenance that external EDA formats do not guarantee.
- View placement and electrical connectivity must not become coupled accidentally.
- Breadboard observations and camera evidence evolve at a different rate from the logical circuit.
- KiCad's GUI-dependent IPC and incomplete schematic API coverage are not a reliable runtime foundation for this desktop harness.

## Implemented scope

Schema version 3 covers explicit pins, nets, constraints, schematic placements, publication metadata, and a declarative 44-kind structural component catalog. The catalog includes common sources, passives, rectifiers/indicators, bipolar and field-effect transistors, switches, relays, protection, electromechanical loads, connectors, supply/test symbols, op-amp/comparator/logic primitives, a structural ESP32-S3-DevKitC-1 v1.1 symbol, and references to the ten validated built-in IC models. The board symbol uses all 44 J1/J3 header positions from Espressif's official v1.1 header table and preserves its revision/module/voltage/reserved-pin limitations. Every catalog entry owns stable pin IDs, a reference prefix, default value policy, a conventional symbol family, and explicit structural limitations. Built-in IC pin maps and functional adapters remain a separate domain catalog so `circuit.json` stores a stable model ID instead of copied executable behavior.

Schema-v1 and schema-v2 documents migrate deterministically to v3. Populated v2 documents retain components, nets, constraints, and placements while gaining default publication metadata; the persistence service writes a version-labelled history backup before replacing the canonical document.

The schema intentionally does not claim footprints, PCB layout, SPICE equivalence, complete manufacturer-part data, or electrical behavior for a catalog symbol. Those capabilities require separate reviewed models and evidence.

The representative acceptance fixture is `tests/fixtures/circuits/led-current-limiter.json`: a 5 V source, 330 Ω series resistor, and LED with closed-loop connectivity and no ERC diagnostics.

## Consequences

- Schema migrations require explicit, tested converters and backups before destructive changes.
- Screen rendering and publication export share one deterministic symbol-geometry engine so visible connectivity cannot drift between artifacts.
- Unknown manufacturer or interchange data must be preserved in a loss report or rejected, never silently invented.
- Assembly/breadboard work can be added without destabilizing the logical schematic schema.
- External EDA round trips may be lossy until richer adapters and a larger component/footprint model exist.
