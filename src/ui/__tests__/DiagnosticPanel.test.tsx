import React from "react";
import { describe, expect, test, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

afterEach(cleanup);
import { MockDeviceController } from "../../device/mock-controller";
import type { WebHIDDeviceController } from "../../device/webhid-controller";
import { DiagnosticPanel } from "../DiagnosticPanel";

describe("DiagnosticPanel", () => {
  test("SAFE upload controls are disabled when not connected", () => {
    const ctrl = new MockDeviceController();
    // DiagnosticPanel only reads isConnected()/onDisconnect() during render;
    // the concrete-type cast is test-only and never invokes any WebHID method.
    const { getByRole } = render(
      <DiagnosticPanel controller={ctrl as unknown as WebHIDDeviceController} />,
    );
    // The SAFE buttons live inside a collapsed <details>; hidden: true includes
    // them in the query.
    const pattern = getByRole("button", {
      name: /upload safe test pattern/i,
      hidden: true,
    }) as HTMLButtonElement;
    const animation = getByRole("button", {
      name: /upload safe animation/i,
      hidden: true,
    }) as HTMLButtonElement;
    expect(pattern.disabled).toBe(true);
    expect(animation.disabled).toBe(true);
  });
});
