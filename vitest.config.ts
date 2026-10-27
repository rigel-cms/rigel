import { defineConfig } from "vitest/config";
import { rigelManifestPlugin } from "./src/vite/manifest-plugin";
import { localeNames, type Locale } from "./src/editor/i18n/locales";

export default defineConfig({
  plugins: [rigelManifestPlugin({ copyDir: "src/content/copy", backend: "local", languages: Object.keys(localeNames) as Locale[] })],
  test: { include: ["src/**/*.test.ts"] },
});
