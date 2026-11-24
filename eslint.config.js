import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const nativeDialogs = ["alert", "confirm", "prompt"];

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "DELETE/", ".wrangler/", "app-ui/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      "no-restricted-globals": ["error", ...nativeDialogs],
      "no-restricted-properties": [
        "error",
        ...nativeDialogs.map((property) => ({ object: "window", property })),
      ],
      "no-console": ["error", { allow: ["error", "warn", "info"] }],
    },
  },
  {
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: ["hono", "hono/*", "react", "react/*", "react-dom", "react-dom/*", "react-router*", "cloudflare:*", "@cloudflare/*", "**/app/**", "**/admin/**"] },
      ],
    },
  },
);
