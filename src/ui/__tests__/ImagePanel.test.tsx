import React from "react";
import { describe, expect, test, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

afterEach(cleanup);
import { MockDeviceController } from "../../device/mock-controller";
import { ImagePanel } from "../ImagePanel";

describe("ImagePanel", () => {
  test("file input is disabled when not connected", () => {
    const ctrl = new MockDeviceController();
    const { container } = render(<ImagePanel controller={ctrl} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  test("upload buttons are disabled when nothing is prepared", () => {
    const ctrl = new MockDeviceController();
    const { getByRole } = render(<ImagePanel controller={ctrl} />);
    const img = getByRole("button", { name: /upload selected image/i }) as HTMLButtonElement;
    const gif = getByRole("button", { name: /upload selected gif/i }) as HTMLButtonElement;
    expect(img.disabled).toBe(true);
    expect(gif.disabled).toBe(true);
  });
});
