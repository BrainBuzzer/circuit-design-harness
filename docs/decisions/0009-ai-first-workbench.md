# ADR 0009: AI-first workbench with approval-gated canonical design

Status: accepted and implemented on 2026-08-09

## Decision

Use a three-column desktop composition: collapsible project sidebar, full-height Pi assistant, and a right laboratory column whose build camera sits above the schematic/breadboard design surface. Both laboratory splits are resizable. At the supported 960×640 minimum, toolbars wrap without document-level scrolling.

Do not expose a manual firmware/simulator dashboard in the main workbench. Firmware and local processor engines are a constrained Pi playground. Pi receives narrow tools to read project firmware, replace and compile complete Arduino/ESPHome sources, assess target coverage, run supported artifacts, and execute the reviewed Uno pin-to-net scenario. These tools expose no general shell or arbitrary filesystem/network authority.

Keep `circuit.json` and `assembly.json` canonical. Pi may read them and stage typed circuit or breadboard operations. Every proposal carries a base revision, rationale, semantic diff, and complete bounded operations; validation occurs before presentation. Only explicit renderer IPC approval applies it. Stale proposals fail.

Treat the schematic and breadboard as review surfaces, not manual editors. The renderer may inspect symbols, pins, diagnostics, catalog limitations, zoom, and exports, but the preload exposes no direct circuit transaction, assembly transaction, or undo method. Pi receives constrained catalog, read, proposal, and deterministic publication-layout tools. It can stage changes but cannot approve its own proposal.

## Why

- The assistant, live build evidence, and canonical design are the primary user loop; manual compiler forms dilute it.
- Hidden direct LLM mutation would make connectivity, stale-state, and safety changes unauditable.
- Logical connectivity and physical breadboard placement require different schemas and validators even though both appear in one design area.

## Verification boundary

- Electron E2E measures sidebar/assistant/laboratory ordering, same-column camera/design geometry, full-height assistant alignment, and no document overflow in normal and 960×640 minimum-window workflows.
- E2E verifies that no firmware/simulation tab remains and Settings, Eve, phone pairing, schematic, and breadboard controls remain reachable.
- E2E verifies that schematic/breadboard mutation controls and renderer undo authority are absent, while proposal approval/rejection remains functional.
- E2E verifies conventional schematic symbols, the catalog/inspector, zoom, the six-file publication export, and control fit at the minimum viewport.
- Domain/service tests cover circuit and breadboard proposal reference resolution, no-mutation staging, approval/rejection, and stale revision denial.

This decision does not make Pi autonomous authority over the design, does not make functional simulation electrical proof, and does not add PCB routing/manufacturing capability.
