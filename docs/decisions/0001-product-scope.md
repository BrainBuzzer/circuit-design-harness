# ADR 0001: Initial product scope

Status: accepted on 2026-08-09

## Decision

“Pi” means the customizable coding-agent harness from pi.dev. The first supported development and release target is macOS, followed by Windows and Linux. Provider choice remains Pi-native: users may use API keys, OAuth subscriptions, environment/file credentials, custom providers, or local endpoints supported by Pi.

The first safety envelope is extra-low-voltage, current-limited breadboard work. The product stores portable project content in a user-selected root. One project owns one logical circuit, one physical assembly model, and one primary Pi conversation. The first editor milestone covers a logical circuit plus breadboard assembly; PCB layout is a later view over the same connectivity model.

The application launches at 1440×960 and supports a minimum window of 960×640. Keyboard access, visible status text in addition to color/motion, reduced-motion support, screen-reader labels, and usable contrast are baseline requirements.

## Deferred decisions

A representative acceptance circuit and its known-good/known-bad fixtures still need to be selected. Circuit JSON/tscircuit canonical-format evaluation also remains open.

## Consequences

Cloud-only assumptions and provider-specific credential code are rejected. Camera analysis, simulation, and ERC may report evidence and uncertainty but cannot certify a physical build as safe or correct.
