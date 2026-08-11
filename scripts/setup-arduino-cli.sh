#!/usr/bin/env bash
# Install arduino-cli + product cores for Circuit Design Harness lab coach.
# Safe to re-run. Requires network. macOS (Homebrew) preferred; falls back to official install script.
set -euo pipefail

ESP32_INDEX_URL="https://espressif.github.io/arduino-esp32/package_esp32_index.json"

log() { printf '==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

ensure_cli() {
  if command -v arduino-cli >/dev/null 2>&1; then
    log "arduino-cli already on PATH: $(command -v arduino-cli)"
    arduino-cli version
    return
  fi

  if command -v brew >/dev/null 2>&1; then
    log "Installing arduino-cli via Homebrew…"
    brew install arduino-cli
  else
    log "Homebrew not found; using official install script into ~/.local/bin"
    mkdir -p "${HOME}/.local/bin"
    curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | BINDIR="${HOME}/.local/bin" sh
    export PATH="${HOME}/.local/bin:${PATH}"
  fi

  command -v arduino-cli >/dev/null 2>&1 || die "arduino-cli still not on PATH after install"
  arduino-cli version
}

configure_indexes() {
  log "Ensuring Espressif board manager URL is configured…"
  # config add is idempotent enough for repeated URLs in recent CLI versions
  arduino-cli config init --overwrite=false 2>/dev/null || true
  if arduino-cli config dump 2>/dev/null | grep -q "espressif.github.io/arduino-esp32"; then
    log "ESP32 package index already present"
  else
    arduino-cli config add board_manager.additional_urls "${ESP32_INDEX_URL}" || \
      arduino-cli config set board_manager.additional_urls "${ESP32_INDEX_URL}"
  fi
}

install_cores() {
  log "Updating core index…"
  arduino-cli core update-index

  log "Installing arduino:avr (Uno)…"
  arduino-cli core install arduino:avr

  log "Installing esp32:esp32 (ESP32-S3)…"
  arduino-cli core install esp32:esp32
}

verify() {
  log "Installed cores:"
  arduino-cli core list
  log "FQBN smoke (compile not run):"
  arduino-cli board details -b arduino:avr:uno >/dev/null && log "  arduino:avr:uno OK"
  arduino-cli board details -b esp32:esp32:esp32s3 >/dev/null && log "  esp32:esp32:esp32s3 OK"
  log "Done. Restart Circuit Design Harness so PATH is visible to the app."
  log "Lab coach: start a lesson → Load golden sketch → Compile (Pi tool or after wiring)."
}

ensure_cli
configure_indexes
install_cores
verify
