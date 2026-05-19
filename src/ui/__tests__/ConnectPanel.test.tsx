import React from "react";
import { describe, expect, test, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

afterEach(cleanup);
import { MockDeviceController } from "../../device/mock-controller";
import { ConnectPanel } from "../ConnectPanel";

describe("ConnectPanel", () => {
  test("renders a hint about wired USB connection", () => {
    const ctrl = new MockDeviceController();
    const { getByText } = render(<ConnectPanel controller={ctrl} />);
    // The hint must mention both the USB-C cable and the wired-mode switch,
    // since the TFT configuration interface is not exposed over Bluetooth
    // or the 2.4 GHz dongle.
    expect(getByText(/USB-C/i)).toBeTruthy();
    expect(getByText(/wired/i)).toBeTruthy();
  });

  test("renders Connect button when not connected", () => {
    const ctrl = new MockDeviceController();
    const { getByRole } = render(<ConnectPanel controller={ctrl} />);
    const btn = getByRole("button", { name: /connect keyboard/i });
    expect(btn).toBeTruthy();
  });
});
