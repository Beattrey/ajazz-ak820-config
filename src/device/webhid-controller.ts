import type { ReportMessage } from "../protocol/types";
import {
  AJAZZ_VENDOR_ID,
  AK820_PRO_PRODUCT_IDS,
  CONTROL_USAGE_PAGE,
  DATA_USAGE_PAGE,
} from "../protocol/constants";
import { DeviceFailure } from "./errors";
import type { DeviceController } from "./types";
import { logInfo, logVerbose, logError } from "../log";

function findByUsagePage(devices: readonly HIDDevice[], usagePage: number): HIDDevice | undefined {
  return devices.find((d) =>
    d.collections.some((c) => c.usagePage === usagePage),
  );
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
    return (
      this.controlDevice?.opened === true && this.dataDevice?.opened === true
    );
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

    // Verbose diagnostics: dump every HID device the user selected, before we
    // try to match. Pure inspection of descriptors already provided by the
    // browser — no report is sent to the keyboard here. Enable "Verbose
    // protocol logging" in Advanced / Diagnostics to see this.
    logVerbose(`[WebHID] requestDevice returned ${devices.length} HID device(s)`);
    for (const [i, d] of devices.entries()) {
      const vid = `0x${d.vendorId.toString(16).padStart(4, "0")}`;
      const pid = `0x${d.productId.toString(16).padStart(4, "0")}`;
      logVerbose(`[WebHID] device[${i}] "${d.productName}" VID=${vid} PID=${pid} opened=${d.opened}`);
      for (const [ci, c] of d.collections.entries()) {
        const up = `0x${(c.usagePage ?? 0).toString(16).padStart(4, "0")}`;
        const us = `0x${(c.usage ?? 0).toString(16).padStart(4, "0")}`;
        const inIds = (c.inputReports ?? []).map((r) => r.reportId);
        const outIds = (c.outputReports ?? []).map((r) => r.reportId);
        const featIds = (c.featureReports ?? []).map((r) => r.reportId);
        logVerbose(
          `[WebHID]   collection[${ci}] usagePage=${up} usage=${us} ` +
            `input=[${inIds}] output=[${outIds}] feature=[${featIds}]`,
        );
      }
    }

    const control = findByUsagePage(devices, CONTROL_USAGE_PAGE);
    const data = findByUsagePage(devices, DATA_USAGE_PAGE);
    if (!control || !data) {
      throw new DeviceFailure({ kind: "no-device-selected" });
    }

    try {
      if (!control.opened) await control.open();
    } catch (cause) {
      logError("[WebHID] control interface open failed:", cause);
      throw cause;
    }
    try {
      if (!data.opened) await data.open();
    } catch (cause) {
      logError("[WebHID] data interface open failed:", cause);
      throw cause;
    }

    this.controlDevice = control;
    this.dataDevice = data;

    logInfo("[WebHID] device connected (control 0xFF13 + data 0xFF68 open)");
    // Full descriptor dump — surfaces the declared max output report size,
    // report IDs, etc. Verbose only.
    logVerbose("[WebHID] control collections:", JSON.stringify(control.collections, null, 2));
    logVerbose("[WebHID] data collections:", JSON.stringify(data.collections, null, 2));

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
    if (!device || !device.opened) {
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
    if (!device || !device.opened) {
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
    if (!device || !device.opened) {
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
    if (!device || !device.opened) {
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

  /**
   * READ-ONLY diagnostic GET_REPORT on the control interface.
   *
   * Unlike `receiveFeatureReport`, this does NOT swallow errors — it lets a
   * STALL/failure propagate so the diagnostic UI can distinguish "device
   * returned no data" from "device refused the read". This issues a single
   * USB GET_REPORT (control IN) transfer: it only READS the current value of
   * the feature report and cannot modify device state, flash, or firmware.
   * It never sends a feature/output report.
   */
  async diagnosticReadFeatureReport(reportId: number): Promise<DataView> {
    const device = this.controlDevice;
    if (!device || !device.opened) {
      throw new DeviceFailure({ kind: "device-disconnected" });
    }
    return await device.receiveFeatureReport(reportId);
  }

  onDisconnect(handler: () => void): () => void {
    this.disconnectHandlers.add(handler);
    return () => {
      this.disconnectHandlers.delete(handler);
    };
  }
}
