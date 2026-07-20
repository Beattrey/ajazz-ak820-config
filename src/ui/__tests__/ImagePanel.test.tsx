// biome-ignore lint/correctness/noUnusedImports: required by this test file's classic JSX transform
import React from "react";
import { describe, expect, test, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

afterEach(cleanup);
import { MockDeviceController } from "../../device/mock-controller";
import { DeviceSessionProvider } from "../../device/DeviceSession";
import { ImagePanel } from "../ImagePanel";

function renderPanel(controller: MockDeviceController) {
  return render(
    <DeviceSessionProvider controller={controller}>
      <ImagePanel />
    </DeviceSessionProvider>,
  );
}

describe("ImagePanel", () => {
  test("file input is disabled when not connected", () => {
    const ctrl = new MockDeviceController();
    const { container } = renderPanel(ctrl);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  test("upload button is disabled when no file is prepared", () => {
    const ctrl = new MockDeviceController();
    const { getByRole } = renderPanel(ctrl);
    const btn = getByRole("button", { name: /upload/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
