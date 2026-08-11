export function userFacingProjectError(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  if (/\bENOSPC\b|no space left on device/i.test(message)) {
    return "The selected project folder could not be written because its disk is full. Free some space or choose another project folder in Settings, then try again.";
  }
  if (/\bEACCES\b|\bEPERM\b|permission denied|operation not permitted/i.test(message)) {
    return "Circuit Harness does not have permission to write the selected project folder. Choose a writable folder in Settings, then try again.";
  }
  if (/\bEROFS\b|read-only file system/i.test(message)) {
    return "The selected project folder is read-only. Choose a writable folder in Settings, then try again.";
  }
  return message || "An unexpected error occurred.";
}
