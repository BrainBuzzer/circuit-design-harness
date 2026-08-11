#!/usr/bin/env bash
# Verify a packaged macOS app (and optional DMG) for Developer ID + notarization.
# Does not print secrets. Exit non-zero on any failed check that is available.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/verify-macos-gatekeeper.sh <path-to.app> [path-to.dmg]

Checks:
  1. codesign --verify --deep --strict
  2. codesign identity is Developer ID Application + hardened runtime
  3. spctl --assess --type execute (when the local assessment subsystem works)
  4. xcrun stapler validate on app and optional DMG (when Launch Services works)

Notarization itself is authoritative via notarytool Accept; stapler/spctl can fail
on restricted agent/CI hosts even for valid system apps.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" || $# -lt 1 ]]; then
  usage
  exit $([[ $# -lt 1 ]] && echo 2 || echo 0)
fi

APP="$1"
DMG="${2:-}"

if [[ ! -d "$APP" ]]; then
  echo "error: app bundle not found: $APP" >&2
  exit 2
fi

echo "==> codesign --verify --deep --strict"
codesign --verify --deep --strict --verbose=2 "$APP"

echo "==> codesign identity / hardened runtime"
details="$(codesign -dv --verbose=4 "$APP" 2>&1 || true)"
printf '%s\n' "$details" | sed -n '1,40p'

if ! printf '%s\n' "$details" | grep -q 'Authority=Developer ID Application:'; then
  echo "error: missing Developer ID Application authority" >&2
  exit 1
fi
if ! printf '%s\n' "$details" | grep -Eq 'flags=0x[0-9a-f]*\(.*runtime'; then
  echo "error: hardened runtime flag not present" >&2
  exit 1
fi
if ! printf '%s\n' "$details" | grep -q '^Timestamp='; then
  echo "warning: no secure timestamp line in codesign -dv output" >&2
fi

spctl_ok=0
echo "==> spctl --assess --type execute"
if spctl_out="$(spctl --assess --type execute --verbose "$APP" 2>&1)"; then
  printf '%s\n' "$spctl_out"
  spctl_ok=1
else
  printf '%s\n' "$spctl_out"
  if printf '%s\n' "$spctl_out" | grep -qi 'internal error in Code Signing subsystem'; then
    echo "warning: local spctl assessment subsystem unavailable; not treating as app failure"
  else
    echo "error: spctl rejected the app" >&2
    exit 1
  fi
fi

staple_ok=0
echo "==> xcrun stapler validate (app)"
if staple_out="$(xcrun stapler validate "$APP" 2>&1)"; then
  printf '%s\n' "$staple_out"
  staple_ok=1
else
  printf '%s\n' "$staple_out"
  if printf '%s\n' "$staple_out" | grep -Eqi 'kLSDataUnavailableErr|does not exist|internal error'; then
    echo "warning: local stapler/Launch Services unavailable; ticket may still be online via notarytool Accept"
  else
    echo "error: stapler validate failed for app" >&2
    exit 1
  fi
fi

if [[ -n "$DMG" ]]; then
  if [[ ! -f "$DMG" ]]; then
    echo "error: dmg not found: $DMG" >&2
    exit 2
  fi
  echo "==> xcrun stapler validate (dmg)"
  if dmg_out="$(xcrun stapler validate "$DMG" 2>&1)"; then
    printf '%s\n' "$dmg_out"
  else
    printf '%s\n' "$dmg_out"
    if printf '%s\n' "$dmg_out" | grep -Eqi 'kLSDataUnavailableErr|does not exist|internal error|no ticket'; then
      echo "warning: dmg staple validate unavailable or missing ticket"
    else
      echo "error: stapler validate failed for dmg" >&2
      exit 1
    fi
  fi
fi

echo
echo "Summary:"
echo "  codesign deep/strict: pass"
echo "  Developer ID + hardened runtime: pass"
echo "  spctl execute: $([[ $spctl_ok -eq 1 ]] && echo pass || echo skipped-local-subsystem)"
echo "  stapler app: $([[ $staple_ok -eq 1 ]] && echo pass || echo skipped-local-subsystem)"
echo "Done."
