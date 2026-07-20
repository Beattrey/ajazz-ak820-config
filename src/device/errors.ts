export type DeviceError =
  | { kind: "unsupported-browser" }
  | { kind: "no-device-selected" }
  | { kind: "device-disconnected" }
  | { kind: "operation-in-progress"; operation: string }
  | { kind: "transfer-failed"; reportId: number; cause: unknown }
  | { kind: "validation"; message: string };

export class DeviceFailure extends Error {
  public readonly error: DeviceError;
  constructor(error: DeviceError) {
    super(describe(error));
    this.name = "DeviceFailure";
    this.error = error;
  }
}

function describe(e: DeviceError): string {
  switch (e.kind) {
    case "unsupported-browser":
      return "WebHID is not supported in this browser. Use Chrome or Edge.";
    case "no-device-selected":
      return "No device selected. Click Connect and pick your AK820 Pro.";
    case "device-disconnected":
      return "Keyboard was disconnected.";
    case "operation-in-progress":
      return `Cannot start while ${e.operation} is in progress.`;
    case "transfer-failed":
      return `Transfer failed for report 0x${e.reportId.toString(16)}.`;
    case "validation":
      return e.message;
  }
}
