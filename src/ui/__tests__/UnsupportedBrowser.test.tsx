// biome-ignore lint/correctness/noUnusedImports: required by this test file's classic JSX transform
import React from "react";
import { describe, expect, test } from "vitest";
import { render } from "@testing-library/react";
import { UnsupportedBrowser } from "../UnsupportedBrowser";

describe("UnsupportedBrowser", () => {
  test("mentions Chrome and Edge", () => {
    const { getAllByText } = render(<UnsupportedBrowser />);
    const matches = getAllByText(/Chrome.*Edge/i);
    expect(matches.length).toBeGreaterThan(0);
  });
});
