# ADR 0002: Embed Pi through its TypeScript SDK

Status: accepted for the prototype on 2026-08-09

## Decision

Use `@earendil-works/pi-coding-agent` directly in the Electron main process for the first vertical slice. Each project points Pi's `SessionManager` at `<project>/chat`, while `ModelRuntime` remains authoritative for built-in/custom providers and Pi's existing credential resolution.

The renderer receives a narrow event protocol for snapshots, transcript restoration, text deltas, terminal errors, and provider-login interactions. It never receives stored credentials or raw Pi objects. Interactive secret answers exist only transiently in a masked form control and one validated IPC request; Pi persists them in its own credential store. Normal sessions start with `noTools: "builtin"` plus the harness's purpose-specific circuit inspection/proposal tools, so the model has no shell or general file authority.

Embedded sessions use a harness-owned `ResourceLoader`: global/project Pi extensions, packages, skills, prompt templates, themes, system-prompt overrides, and append-prompt overrides are empty. Only the active circuit project's generated `AGENTS.md` is retained as context. This prevents a user-global Pi extension from registering commands/tools, changing the tool allowlist, or spawning the packaged Electron executable as though it were the Pi CLI.

The harness may append its own static engineering guidance and narrowly route a recognized actionable product intent. The ESP32 Pomodoro route treats the user's word “create” as authorization to stage a non-applying proposal in that turn, supplies conservative component defaults, and still requires the ordinary explicit approval IPC before application. Harness-only request-routing, evidence, and voice-style blocks are removed from the visible transcript. This is not an extension command or a second design database; the model still uses the typed catalog/read/proposal tools against the canonical revision.

Project switches abort an in-flight response before the old session is disposed. Events carry project IDs and the renderer stores transcripts per project to prevent late output appearing in the wrong workbench.

## Alternatives considered

- Pi RPC subprocess: stronger crash and authority isolation, but more protocol and lifecycle work before the product contract is stable.
- A provider-specific abstraction: rejected because it would duplicate Pi authentication, models, and custom-provider behavior.

## Follow-up

Move Pi to a utility or child process before wider testing, preserve the typed contract, and add provider-backed persistence/cancellation tests without using personal credentials or paid calls in CI.
