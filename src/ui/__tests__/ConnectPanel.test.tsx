// biome-ignore lint/correctness/noUnusedImports: required by this test file's classic JSX transform
import React from "react";
import { describe, expect, test, afterEach } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

afterEach(cleanup);
import { MockDeviceController } from "../../device/mock-controller";
import { DeviceSessionProvider } from "../../device/DeviceSession";
import { ConnectPanel } from "../ConnectPanel";

function renderPanel(controller = new MockDeviceController()) {
  return render(
    <DeviceSessionProvider controller={controller}>
      <ConnectPanel />
    </DeviceSessionProvider>,
  );
}

describe("ConnectPanel", () => {
  test("renders a hint about wired USB connection", () => {
    const ctrl = new MockDeviceController();
    const { getByText } = renderPanel(ctrl);
    // The hint must mention both the USB-C cable and the wired-mode switch,
    // since the TFT configuration interface is not exposed over Bluetooth
    // or the 2.4 GHz dongle.
    expect(getByText(/USB-C/i)).toBeTruthy();
    expect(getByText(/wired/i)).toBeTruthy();
  });

  test("renders Connect button when not connected", () => {
    const ctrl = new MockDeviceController();
    const { getByRole } = renderPanel(ctrl);
    const btn = getByRole("button", { name: /connect keyboard/i });
    expect(btn).toBeTruthy();
  });

  test("shows when a connected keyboard responds to the health check", async () => {
    const ctrl = new MockDeviceController();
    await ctrl.connect();
    const { getByRole } = renderPanel(ctrl);

    await waitFor(() => expect(getByRole("status").textContent).toContain("Awake and responding"));
  });

  test("warns when a connected keyboard does not answer the health check", async () => {
    const ctrl = new MockDeviceController({ healthCheckResponds: false });
    await ctrl.connect();
    const { getByRole } = renderPanel(ctrl);

    await waitFor(() => expect(getByRole("status").textContent).toContain("Not responding"));
  });
});
