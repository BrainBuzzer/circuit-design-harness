const { execFileSync } = require("node:child_process");
const path = require("node:path");

const UNUSED_PERMISSION_KEYS = [
  "NSAppTransportSecurity",
  "NSAudioCaptureUsageDescription",
  "NSBluetoothAlwaysUsageDescription",
  "NSBluetoothPeripheralUsageDescription",
];

/**
 * Local/dev packages stay ad-hoc. Release packages let electron-builder apply
 * Developer ID + hardened runtime after this hook (and notarize when Apple
 * credentials are present in the environment).
 *
 * Never ad-hoc re-sign when MAC_RELEASE_SIGN / CSC_* indicate a Developer ID
 * path: overwriting nested Mach-O (simulators/, voice/, .node) breaks notarization.
 */
function shouldAdHocSign(context) {
  if (process.env.MAC_ADHOC_SIGN === "1" || process.env.CSC_IDENTITY_AUTO_DISCOVERY === "false") {
    return true;
  }
  if (process.env.MAC_RELEASE_SIGN === "1" || process.env.CSC_NAME || process.env.CSC_LINK) {
    return false;
  }

  const identity = context.packager?.platformSpecificBuildOptions?.identity;
  // Explicit null forces ad-hoc for package:dir smoke builds.
  if (identity === null) {
    return true;
  }
  // A concrete identity string means electron-builder will re-sign for release.
  // Do not include the "Developer ID Application:" prefix in CSC_NAME — electron-builder rejects it.
  if (typeof identity === "string" && identity.length > 0 && identity !== "-") {
    return false;
  }
  return true;
}

module.exports = async (context) => {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const plistPath = path.join(appPath, "Contents", "Info.plist");

  for (const key of UNUSED_PERMISSION_KEYS) {
    try {
      execFileSync("/usr/bin/plutil", ["-remove", key, plistPath], { stdio: "pipe" });
    } catch {
      // Key may already be absent depending on Electron version.
    }
  }

  if (shouldAdHocSign(context)) {
    // Development/smoke target: restore a valid ad-hoc signature after plist edits.
    execFileSync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", appPath]);
  }
};
