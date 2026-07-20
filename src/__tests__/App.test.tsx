// biome-ignore lint/correctness/noUnusedImports: required by this test file's classic JSX transform
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { Configurator } from "../App";
import { DeviceSessionProvider } from "../device/DeviceSession";
import { MockDeviceController } from "../device/mock-controller";

afterEach(cleanup);

function renderConfigurator() {
  return render(
    <DeviceSessionProvider controller={new MockDeviceController()}>
      <Configurator />
    </DeviceSessionProvider>,
  );
}

describe("Configurator workspace", () => {
  test("opens on lighting and reveals one task workspace at a time", () => {
    const view = renderConfigurator();

    expect(view.getByRole("heading", { name: "Lighting" })).toBeTruthy();
    expect(view.queryByRole("heading", { name: "Display image" })).toBeNull();

    fireEvent.click(view.getByRole("button", { name: "Display: TFT image upload" }));
    expect(view.getByRole("heading", { name: "Display image" })).toBeTruthy();
    expect(view.queryByLabelText("Lighting effect")).toBeNull();

    fireEvent.click(view.getByRole("button", { name: "Device: Connection and time" }));
    expect(view.getByRole("heading", { name: "Device" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Connect keyboard" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Sync now" })).toBeTruthy();
  });

  test("connection summary is a shortcut to device settings", () => {
    const view = renderConfigurator();

    fireEvent.click(view.getByRole("button", { name: /Open device settings/ }));
    expect(view.getByRole("heading", { name: "Device" })).toBeTruthy();
  });
});
