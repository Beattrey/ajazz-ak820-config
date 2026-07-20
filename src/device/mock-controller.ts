import type { ReportMessage } from "../protocol/types";
import { DeviceFailure } from "./errors";
import type { DeviceController, SentReport } from "./types";

export class MockDeviceController implements DeviceController {
  public sent: SentReport[] = [];
  public receivedFeatureReportIds: number[] = [];
  private connected = false;
  private disconnectHandlers = new Set<() => void>();
  private sendCount = 0;
  private readonly options: { failSendAt?: number; healthCheckResponds?: boolean };

  constructor(options: { failSendAt?: number; healthCheckResponds?: boolean } = {}) {
    this.options = options;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    for (const h of this.disconnectHandlers) h();
  }

  async sendFeatureReport(report: ReportMessage): Promise<void> {
    if (!this.connected) {
      throw new DeviceFailure({ kind: "device-disconnected" });
    }
    this.recordSend({ ...report, kind: "feature" });
  }

  async sendReport(report: ReportMessage): Promise<void> {
    if (!this.connected) {
      throw new DeviceFailure({ kind: "device-disconnected" });
    }
    this.recordSend({ ...report, kind: "output" });
  }

  async receiveFeatureReport(reportId: number): Promise<DataView | null> {
    if (!this.connected) {
      throw new DeviceFailure({ kind: "device-disconnected" });
    }
    this.receivedFeatureReportIds.push(reportId);
    if (this.options.healthCheckResponds === false) return null;
    return new DataView(new ArrayBuffer(0));
  }

  async waitForDataInputReport(_timeoutMs: number): Promise<DataView | null> {
    if (!this.connected) {
      throw new DeviceFailure({ kind: "device-disconnected" });
    }
    return new DataView(new ArrayBuffer(0));
  }

  onDisconnect(handler: () => void): () => void {
    this.disconnectHandlers.add(handler);
    return () => {
      this.disconnectHandlers.delete(handler);
    };
  }

  private recordSend(report: SentReport): void {
    this.sendCount += 1;
    if (this.sendCount === this.options.failSendAt) {
      throw new DeviceFailure({
        kind: "transfer-failed",
        reportId: report.reportId,
        cause: new Error("Injected mock transfer failure"),
      });
    }
    this.sent.push(report);
  }
}
