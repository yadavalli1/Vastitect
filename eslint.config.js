import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

const NOTATION_LITERAL = "/^(c4|archimate|ddd|togaf|generic|wardley)(:|$)/";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/src-tauri/**", "**/target/**", "**/test-results/**", "packages/create-vastitecture-plugin/templates/**"] },
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Comma sequences are used deliberately for short event handlers.
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },
  {
    // The core knows no notation: no imports of packs or formats, and no notation type ids in code.
    files: ["packages/core/src/**/*.ts"],
    ignores: ["packages/core/src/**/*.test.ts", "packages/core/src/defaults.ts", "packages/core/src/generate.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["@vastitecture/notation-*", "@vastitecture/io-*", "@vastitecture/connectors-*", "**/notations/**", "**/io/**"], message: "packages/core must not depend on notation packs or formats." }] }],
      "no-restricted-syntax": [
        "error",
        { selector: `Literal[value=${NOTATION_LITERAL}]`, message: "Notation-specific type ids belong in a notation pack, not in core." },
        { selector: `TemplateElement[value.raw=${NOTATION_LITERAL}]`, message: "Notation-specific type ids belong in a notation pack, not in core." },
      ],
    },
  },
  {
    // Every user-facing string goes through t() so it lands in the message files.
    files: ["apps/desktop/src/**/*.tsx"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "no-restricted-syntax": [
        "error",
        { selector: "JSXText[value=/[A-Za-z]{2,}/]", message: "Wrap user-facing text in t() so it can be translated." },
        { selector: "JSXAttribute[name.name=/^(aria-label|title|placeholder|alt)$/] > Literal[value=/[A-Za-z]{2,}/]", message: "Wrap user-facing text in t() so it can be translated." },
      ],
    },
  },
  { files: ["**/*.test.ts", "**/e2e/**"], rules: { "@typescript-eslint/no-unused-vars": "off" } },
);
