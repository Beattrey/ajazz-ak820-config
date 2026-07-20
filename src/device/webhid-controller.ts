import type { ReportMessage } from "../protocol/types";
import {
  AJAZZ_VENDOR_ID,
  AK820_PRO_PRODUCT_IDS,
  CONTROL_USAGE_PAGE,
  DATA_USAGE_PAGE,
} from "../protocol/constants";
import { DeviceFailure } from "./errors";
import type { DeviceController } from "./types";

function findByUsagePage(devices: readonly HIDDevice[], usagePage: number): HIDDevice | undefined {
  return devices.find((d) => d.collections.some((c) => c.usagePage === usagePage));
}

/**
 * Adapt a `ReportMessage` (hidapi convention: first byte of the wire payload is
 * carried in `reportId`) to WebHID's send-shape for an unnumbered HID report.
 *
 * AJAZZ AK820 Pro's control interface declares unnumbered feature reports
 * (declared report ID = 0, full 64-byte payload). hidapi accepts the byte at
 * position 0 as the report ID and routes accordingly; Chrome's WebHID is
 * stricter and rejects any non-zero `reportId` that isn't declared in the
 * HID descriptor. So we always send unnumbered (reportId=0) with the
 * original leading byte spliced back to the front of the payload.
 */
function toUnnumberedWire(report: ReportMessage): { reportId: 0; bytes: Uint8Array } {
  const wire = new Uint8Array(report.bytes.byteLength + 1);
  wire[0] = report.reportId;
  wire.set(report.bytes, 1);
  return { reportId: 0, bytes: wire };
}

export class WebHIDDeviceController implements DeviceController {
  private controlDevice: HIDDevice | null = null;
  private dataDevice: HIDDevice | null = null;
  private disconnectHandlers = new Set<() => void>();
  private boundDisconnectListener: ((event: HIDConnectionEvent) => void) | null = null;

  // Data-interface INPUT report plumbing: chunks of an image upload generate
  // an ACK input report each. Queue arrivals so `waitForDataInputReport` can
  // consume them one-by-one (handles the case where an ACK arrives before
  // the caller starts awaiting).
  private dataInputQueue: DataView[] = [];
  private dataInputWaiters: Array<(report: DataView | null) => void> = [];
  private boundDataInputListener: ((event: HIDInputReportEvent) => void) | null = null;

  isConnected(): boolean {
    return this.controlDevice?.opened === true && this.dataDevice?.opened === true;
  }

  async connect(): Promise<void> {
    if (typeof navigator === "undefined" || !("hid" in navigator)) {
      throw new DeviceFailure({ kind: "unsupported-browser" });
    }

    const filters = AK820_PRO_PRODUCT_IDS.map((productId) => ({
      vendorId: AJAZZ_VENDOR_ID,
      productId,
    }));

    const devices = await navigator.hid.requestDevice({ filters });
    if (devices.length === 0) {
      throw new DeviceFailure({ kind: "no-device-selected" });
    }

    const control = findByUsagePage(devices, CONTROL_USAGE_PAGE);
    const data = findByUsagePage(devices, DATA_USAGE_PAGE);
    if (!control || !data) {
      throw new DeviceFailure({ kind: "no-device-selected" });
    }

    if (!control.opened) await control.open();
    if (!data.opened) await data.open();

    this.controlDevice = control;
    this.dataDevice = data;

    // Diagnostic dump — surfaces what the keyboard's HID descriptor really
    // declares for the data interface. Helps identify the actual max output
    // report size, the report IDs, etc. Look in DevTools Console.
    // eslint-disable-next-line no-console
    console.log("[WebHID] control collections:", JSON.stringify(control.collections, null, 2));
    // eslint-disable-next-line no-console
    console.log("[WebHID] data collections:", JSON.stringify(data.collections, null, 2));

    this.boundDataInputListener = (event: HIDInputReportEvent) => {
      const waiter = this.dataInputWaiters.shift();
      if (waiter) {
        waiter(event.data);
      } else {
        this.dataInputQueue.push(event.data);
      }
    };
    data.addEventListener("inputreport", this.boundDataInputListener);

    this.boundDisconnectListener = (event: HIDConnectionEvent) => {
      if (event.device === control || event.device === data) {
        this.handleDisconnect();
      }
    };
    navigator.hid.addEventListener("disconnect", this.boundDisconnectListener);
  }

  async disconnect(): Promise<void> {
    if (this.controlDevice?.opened) await this.controlDevice.close();
    if (this.dataDevice?.opened) await this.dataDevice.close();
    this.handleDisconnect();
  }

  private handleDisconnect(): void {
    if (this.boundDataInputListener && this.dataDevice) {
      this.dataDevice.removeEventListener("inputreport", this.boundDataInputListener);
    }
    this.boundDataInputListener = null;
    // Resolve any pending waiters with null so callers don't hang forever.
    for (const w of this.dataInputWaiters) w(null);
    this.dataInputWaiters = [];
    this.dataInputQueue = [];

    this.controlDevice = null;
    this.dataDevice = null;
    if (this.boundDisconnectListener) {
      navigator.hid.removeEventListener("disconnect", this.boundDisconnectListener);
      this.boundDisconnectListener = null;
    }
    for (const h of this.disconnectHandlers) h();
  }

  async sendFeatureReport(report: ReportMessage): Promise<void> {
    const device = this.controlDevice;
    if (!device?.opened) {
      throw new DeviceFailure({ kind: "device-disconnected" });
    }
    const wire = toUnnumberedWire(report);
    try {
      await device.sendFeatureReport(wire.reportId, wire.bytes as BufferSource);
    } catch (cause) {
      throw new DeviceFailure({
        kind: "transfer-failed",
        reportId: report.reportId,
        cause,
      });
    }
  }

  async sendReport(report: ReportMessage): Promise<void> {
    const device = this.dataDevice;
    if (!device?.opened) {
      throw new DeviceFailure({ kind: "device-disconnected" });
    }
    // Data-interface OUTPUT reports are pure 4096-byte chunks sent as
    // unnumbered reports. We send `report.bytes` as-is with reportId=0 —
    // no leading byte to splice (operations.ts already supplies reportId=0).
    try {
      await device.sendReport(report.reportId, report.bytes as BufferSource);
    } catch (cause) {
      throw new DeviceFailure({
        kind: "transfer-failed",
        reportId: report.reportId,
        cause,
      });
    }
  }

  async waitForDataInputReport(timeoutMs: number): Promise<DataView | null> {
    const device = this.dataDevice;
    if (!device?.opened) {
      throw new DeviceFailure({ kind: "device-disconnected" });
    }
    // If a report has already arrived since the last wait, return it.
    const queued = this.dataInputQueue.shift();
    if (queued) return queued;
    return new Promise<DataView | null>((resolve) => {
      const timer = setTimeout(() => {
        const idx = this.dataInputWaiters.indexOf(wrappedResolver);
        if (idx >= 0) this.dataInputWaiters.splice(idx, 1);
        resolve(null);
      }, timeoutMs);
      const wrappedResolver = (report: DataView | null) => {
        clearTimeout(timer);
        resolve(report);
      };
      this.dataInputWaiters.push(wrappedResolver);
    });
  }

  async receiveFeatureReport(reportId: number): Promise<DataView | null> {
    const device = this.controlDevice;
    if (!device?.opened) {
      throw new DeviceFailure({ kind: "device-disconnected" });
    }
    try {
      return await device.receiveFeatureReport(reportId);
    } catch {
      // Handshake reads are non-fatal — reference implementations ignore
      // errors and continue. Treat any failure here as "no data."
      return null;
    }
  }

  onDisconnect(handler: () => void): () => void {
    this.disconnectHandlers.add(handler);
    return () => {
      this.disconnectHandlers.delete(handler);
    };
  }
}
