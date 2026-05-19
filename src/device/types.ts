import type { ReportMessage } from "../protocol/types";

export type SentReport = ReportMessage & { kind: "feature" | "output" };

export interface DeviceController {
  isConnected(): boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendFeatureReport(report: ReportMessage): Promise<void>;
  sendReport(report: ReportMessage): Promise<void>;
  /**
   * Read a feature report from the control interface. Used as a handshake
   * after specific SET packets in the AJAZZ protocol — the firmware appears
   * to require this read to acknowledge the previous SET and unblock the
   * next one. Implementations may treat failures as non-fatal and return
   * null; the caller should not depend on the returned value's contents.
   */
  receiveFeatureReport(reportId: number): Promise<DataView | null>;
  /**
   * Wait for the next INPUT report from the data interface. Used as a
   * per-chunk ACK during image upload — the AK820 Pro firmware drops chunks
   * if the host doesn't read each ACK before sending the next one.
   * Resolves with the report data, or `null` if no report arrives within
   * `timeoutMs`. The timeout case is non-fatal — callers should continue.
   */
  waitForDataInputReport(timeoutMs: number): Promise<DataView | null>;
  onDisconnect(handler: () => void): () => void;
}
