import type { ReportMessage } from "../protocol/types";
import { DeviceFailure } from "./errors";
import type { DeviceController, SentReport } from "./types";

export class MockDeviceController implements DeviceController {
  public sent: SentReport[] = [];
  private connected = false;
  private disconnectHandlers = new Set<() => void>();

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
    this.sent.push({ ...report, kind: "feature" });
  }

  async sendReport(report: ReportMessage): Promise<void> {
    if (!this.connected) {
      throw new DeviceFailure({ kind: "device-disconnected" });
    }
    this.sent.push({ ...report, kind: "output" });
  }

  async receiveFeatureReport(_reportId: number): Promise<DataView | null> {
    if (!this.connected) {
      throw new DeviceFailure({ kind: "device-disconnected" });
    }
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
}
