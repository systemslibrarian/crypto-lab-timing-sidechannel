import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  base: "/crypto-lab-timing-sidechannel/",
  test: {
    include: ["src/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "e2e/**"]
  }
});
