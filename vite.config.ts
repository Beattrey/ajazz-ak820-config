/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/ajazz-ak820-config/",
  // @ts-expect-error -- Vitest 3 bundles its own vite@7, causing a type mismatch
  // with vite@8 in the project. The `test` key is valid at runtime.
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    globals: false,
  },
});
