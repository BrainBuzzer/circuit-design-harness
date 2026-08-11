# ADR 0006: Token-scoped private-LAN camera relay before WebRTC

Status: accepted and implemented on 2026-08-09

## Decision

Provide two explicit private-LAN camera paths:

1. The primary phone path starts an ephemeral HTTPS page and WSS receiver on the Mac, advertises only a private/link-local IPv4 address, and shows a QR code. A random 256-bit bearer token scopes both page and stream URLs. The self-signed P-256 certificate lasts at most 24 hours and its SHA-256 fingerprint is shown for manual comparison. Only one phone remains connected. JPEG frames are dimension-prefixed, capped at 12 MiB, validated, and retained only as the latest in-memory preview.
2. The compatibility path polls a literal private/loopback JPEG endpoint with the existing no-redirect, content-type, size, and address restrictions.

Neither path uploads continuous video to Pi. Preview remains ephemeral. An explicit manual save or consented `inspect_build_camera` tool call records one frame through the normal capture service with project, revision, source, timestamp, and hash provenance. The tool returns that JPEG as multimodal content in the active Pi turn.

Requests such as “take a look,” “check this with the camera,” and “does this design look correct?” are deterministically recognized before the Pi prompt and routed through the same capture operation as the Pi camera tool. The resulting frame is attached to that exact turn, and the prompt tells Pi not to duplicate the capture. The tool remains available inside longer Pi-directed workflows. Settings can deny automatic visual-request capture independently of preview.

## Security boundary

- The QR/token protects against accidental discovery but is not device-identity authentication.
- The user must compare the displayed SHA-256 fingerprint before accepting the phone browser's one-session certificate warning.
- The relay binds to the LAN but advertises no public/DNS address, embeds no credential in logs or project files, performs no redirect, accepts no audio, and rotates its token whenever stopped/restarted.
- Project changes and application shutdown stop the relay and clear the in-memory preview.

## Verification boundary

- Unit tests establish a live WSS connection to the ephemeral server, verify QR/fingerprint output, send a bounded JPEG packet, confirm project/revision forwarding, and stop the relay.
- Electron E2E starts/cancels QR pairing and verifies both local and compatibility-camera capture workflows.
- A physical Galaxy S23, hostile-LAN conditions, Wi-Fi roaming, background-browser behavior, torch/focus controls, and long-session thermal/battery behavior remain unverified.

## Why not call this WebRTC

This implementation is encrypted WebSocket frame transport, not WebRTC. It has no authenticated signaling, ICE/STUN/TURN, NAT traversal, adaptive media congestion control, device identity, or real-time audio/video track lifecycle. Those features require a separate reviewed design. The product must label the current behavior as private-LAN WSS.
