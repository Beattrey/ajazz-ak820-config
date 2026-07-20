// biome-ignore lint/correctness/noUnusedImports: required by this test file's classic JSX transform
import React from "react";
import { describe, expect, test, afterEach } from "vitest";
import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";

afterEach(cleanup);
import { MockDeviceController } from "../../device/mock-controller";
import { DeviceSessionProvider } from "../../device/DeviceSession";
import { TimeSyncPanel } from "../TimeSyncPanel";

function renderPanel(controller: MockDeviceController) {
  return render(
    <DeviceSessionProvider controller={controller}>
      <TimeSyncPanel />
    </DeviceSessionProvider>,
  );
}

describe("TimeSyncPanel", () => {
  test("clicking 'Sync Now' sends the 4-packet time-sync sequence", async () => {
    const ctrl = new MockDeviceController();
    await ctrl.connect();
    const { getByRole } = renderPanel(ctrl);
    fireEvent.click(getByRole("button", { name: /sync/i }));
    // Time sync is 4 reports.
    await waitFor(() => expect(ctrl.sent.length).toBe(4));
  });

  test("button is disabled when not connected", () => {
    const ctrl = new MockDeviceController();
    const { getByRole } = renderPanel(ctrl);
    expect((getByRole("button", { name: /sync/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
