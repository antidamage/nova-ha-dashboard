import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    exclude: ["**/node_modules/**", "**/.next/**", "**/.tmp/**", "**/e2e/**", "lib/aircon-control.test.ts"],
    globals: true,
    setupFiles: ["./test/setup.ts"],
    coverage: {
      provider: "v8",
      // `include` makes vitest report every matching file, covered or not.
      include: ["lib/**/*.ts", "app/**/*.{ts,tsx}"],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/*.d.ts",
        // Type-only modules: nothing executable to cover.
        "lib/types.ts",
        "lib/modules/types.ts",
        "app/components/tasks/task-model.ts",
        // Aircon control has its own dedicated Node test runner (test:aircon).
        "lib/aircon-control.ts",
      ],
      reporter: ["text-summary", "html", "json-summary"],
      reportsDirectory: "coverage",
    },
  },
});
