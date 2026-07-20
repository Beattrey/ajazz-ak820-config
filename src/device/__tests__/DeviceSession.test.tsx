import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
// biome-ignore lint/correctness/noUnusedImports: required by this test file's classic JSX transform
import React from "react";
import { afterEach, describe, expect, test } from "vitest";
import { MockDeviceController } from "../mock-controller";
import { DeviceSessionProvider, useDeviceSession } from "../DeviceSession";

afterEach(cleanup);

function SessionProbe({ firstWork }: { firstWork: () => Promise<void> }) {
  const { activeOperation, runOperation } = useDeviceSession();
  const startFirst = () =>
    runOperation("lighting", firstWork).catch((error: Error) => {
      document.body.dataset.firstError = error.message;
    });
  const startSecond = () =>
    runOperation("time sync", async () => {}).catch((error: Error) => {
      document.body.dataset.overlapError = error.message;
    });
  return (
    <>
      <p>{activeOperation ?? "idle"}</p>
      <button type="button" onClick={startFirst}>
        first
      </button>
      <button type="button" onClick={startSecond}>
        second
      </button>
    </>
  );
}

describe("DeviceSessionProvider", () => {
  test("rejects overlapping operations and releases the lock after completion", async () => {
    const controller = new MockDeviceController();
    await controller.connect();
    let finish: () => void = () => {};
    const work = () => new Promise<void>((resolve) => (finish = resolve));
    const view = render(
      <DeviceSessionProvider controller={controller}>
        <SessionProbe firstWork={work} />
      </DeviceSessionProvider>,
    );

    fireEvent.click(view.getByRole("button", { name: "first" }));
    expect(view.getByText("lighting")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "second" }));
    await waitFor(() => expect(document.body.dataset.overlapError).toMatch(/lighting/));

    finish();
    await waitFor(() => expect(view.getByText("idle")).toBeTruthy());
    delete document.body.dataset.overlapError;
  });

  test("releases the lock when an operation fails or times out", async () => {
    const controller = new MockDeviceController();
    await controller.connect();
    const work = () => Promise.reject(new Error("Operation timed out"));
    const view = render(
      <DeviceSessionProvider controller={controller}>
        <SessionProbe firstWork={work} />
      </DeviceSessionProvider>,
    );

    fireEvent.click(view.getByRole("button", { name: "first" }));
    await waitFor(() => expect(document.body.dataset.firstError).toMatch(/timed out/));
    expect(view.getByText("idle")).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: "second" }));
    await waitFor(() => expect(view.getByText("idle")).toBeTruthy());
    delete document.body.dataset.firstError;
  });

  test("clears an active operation after physical disconnect", async () => {
    const controller = new MockDeviceController();
    await controller.connect();
    const work = () => new Promise<void>(() => {});
    const view = render(
      <DeviceSessionProvider controller={controller}>
        <SessionProbe firstWork={work} />
      </DeviceSessionProvider>,
    );

    fireEvent.click(view.getByRole("button", { name: "first" }));
    expect(view.getByText("lighting")).toBeTruthy();
    await controller.disconnect();
    await waitFor(() => expect(view.getByText("idle")).toBeTruthy());
  });
});
