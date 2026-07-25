// Lightweight logging switch for the WebHID protocol layer.
//
// Milestone logs (info/warn/error) always print; verbose per-chunk, per-ACK,
// handshake and HID-descriptor detail is gated behind a runtime flag that the
// Advanced / Diagnostics UI can toggle (default off).
//
// Logging NEVER affects protocol behaviour: the ACK fail-fast and every HID
// transfer run identically regardless of this flag.
let verbose = false;

export function setVerboseLogging(on: boolean): void {
  verbose = on;
}

export function isVerboseLogging(): boolean {
  return verbose;
}

export function logInfo(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log(...args);
}

export function logVerbose(...args: unknown[]): void {
  if (!verbose) return;
  // eslint-disable-next-line no-console
  console.log(...args);
}

export function logWarn(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.warn(...args);
}

export function logError(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.error(...args);
}
