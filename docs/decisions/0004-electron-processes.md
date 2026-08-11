# ADR 0004: Secure Electron prototype process model

Status: accepted for the prototype on 2026-08-09

## Decision

Use Electron 43 with electron-vite 5 and Vite 7. The renderer is sandboxed, context-isolated, and has Node integration disabled. A bundled CommonJS preload exposes purpose-specific methods only. Production assets load through the secure `circuit-harness://app/` protocol under a restrictive CSP.

The main process currently owns project persistence, Pi, dialogs, and external-link opening. It validates IPC senders and inputs, denies arbitrary windows/navigation, and grants media permission only to the trusted application origin. PDF parsing, OCR, rendering, phone signaling, and sustained Pi work must move to utility/child processes as those features arrive.

Vite 8 is intentionally not used: electron-vite 5 declares compatibility through Vite 7, and a smoke test demonstrated that Vite 8 bundled Electron's launcher into the sandboxed preload. Vite 7 correctly externalizes `require("electron")`.

## Verification

Playwright launches the production bundle, exercises the sandboxed preload, creates and restores an isolated project, opens/cancels a Pi authentication prompt, checks for renderer errors, and verifies the 960×640 minimum layout.
