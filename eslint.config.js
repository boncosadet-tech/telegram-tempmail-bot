import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: [
      "node_modules/**",
      "apps/**",
      "deploy-context/**",
      "coverage/**",
      "docs/**"
    ]
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.worker,
        crypto: "readonly",
        fetch: "readonly",
        Response: "readonly",
        Request: "readonly",
        Headers: "readonly",
        FormData: "readonly",
        Blob: "readonly",
        URL: "readonly",
        ReadableStream: "readonly",
        TextDecoder: "readonly",
        TextEncoder: "readonly",
        atob: "readonly",
        btoa: "readonly"
      }
    },
    rules: {
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_"
        }
      ],
      "no-console": "off",
      eqeqeq: ["error", "smart"],
      "prefer-const": "error",
      "no-var": "error",
      "no-throw-literal": "error",
      "no-implicit-coercion": "off"
    }
  },
  {
    // Browser-only code in the embedded dashboard script uses `location`,
    // `document`, `fetch`, etc. Skip stricter rules that assume Node globals.
    files: ["src/worker/dashboard.js"],
    languageOptions: {
      globals: {
        document: "readonly",
        navigator: "readonly",
        location: "readonly",
        confirm: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly"
      }
    }
  }
];
