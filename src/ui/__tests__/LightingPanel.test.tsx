import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
// biome-ignore lint/correctness/noUnusedImports: required by this test file's classic JSX transform
import React from "react";
import { afterEach, describe, expect, test } from "vitest";
import { DeviceSessionProvider } from "../../device/DeviceSession";
import { MockDeviceController } from "../../device/mock-controller";
import { LightingMode } from "../../protocol/lighting";
import { LightingPanel } from "../LightingPanel";

afterEach(cleanup);

async function renderPanel(controller = new MockDeviceController()) {
  await controller.connect();
  const view = render(
    <DeviceSessionProvider controller={controller}>
      <LightingPanel />
    </DeviceSessionProvider>,
  );
  return { controller, ...view };
}

describe("LightingPanel", () => {
  test("previews the selected color on a virtual AK820 Pro keyboard", async () => {
    const view = await renderPanel();
    const preview = view.getByLabelText(/Virtual AK820 Pro lighting preview/);
    expect(preview.getAttribute("aria-label")).toContain("#ff0000");

    fireEvent.change(view.getByLabelText("Lighting color"), { target: { value: "#123456" } });
    expect(preview.getAttribute("aria-label")).toContain("#123456");
  });

  test("previews the selected lighting effect before it is applied", async () => {
    const view = await renderPanel();
    const preview = view.getByLabelText(/Virtual AK820 Pro lighting preview/);

    fireEvent.change(view.getByLabelText("Lighting effect"), {
      target: { value: LightingMode.Scrolling },
    });

    expect(preview.classList.contains("is-scrolling")).toBe(true);
    expect(preview.getAttribute("aria-label")).toContain("Scrolling effect");
  });

  test("shows only the directions supported by the selected mode", async () => {
    const view = await renderPanel();
    const effect = view.getByLabelText("Lighting effect");

    expect(view.queryByLabelText("Direction")).toBeNull();
    fireEvent.change(effect, { target: { value: LightingMode.Scrolling } });
    expect(view.getByLabelText("Direction").textContent).toContain("Up");
    expect(view.getByLabelText("Direction").textContent).toContain("Down");

    fireEvent.change(effect, { target: { value: LightingMode.Rolling } });
    expect(view.getByLabelText("Direction").textContent).toContain("Left");
    expect(view.getByLabelText("Direction").textContent).toContain("Right");

    fireEvent.change(effect, { target: { value: LightingMode.Static } });
    expect(view.queryByLabelText("Direction")).toBeNull();
  });

  test("submits lighting through the device transaction", async () => {
    const { controller, getByRole, getByText } = await renderPanel();
    fireEvent.click(getByRole("button", { name: "Apply lighting" }));
    expect(
      (getByRole("button", { name: "Applying lighting…" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(getByRole("status").textContent).toBe("Applying lighting…");
    await waitFor(() => expect(controller.sent).toHaveLength(4));
    await waitFor(() => expect(getByText("Lighting applied")).toBeTruthy());
  });

  test("displays a lighting transfer failure", async () => {
    const controller = new MockDeviceController({ failSendAt: 1 });
    const view = await renderPanel(controller);
    fireEvent.click(view.getByRole("button", { name: "Apply lighting" }));
    await waitFor(() => expect(view.getByRole("status").textContent).toMatch(/Transfer failed/));
  });

  test("submits the selected sleep timeout", async () => {
    const { controller, getByLabelText, getByRole, getByText } = await renderPanel();
    fireEvent.change(getByLabelText("Lighting sleep timeout"), { target: { value: "1" } });
    fireEvent.click(getByRole("button", { name: "Apply sleep timeout" }));
    await waitFor(() => expect(controller.sent).toHaveLength(3));
    expect(controller.sent[2].bytes[7]).toBe(1);
    await waitFor(() => expect(getByText("Sleep timeout applied")).toBeTruthy());
  });
});
