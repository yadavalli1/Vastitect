import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const p = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@vastitecture/core": p("./packages/core/src/index.ts"),
      "@vastitecture/plugin-sdk": p("./packages/plugin-sdk/src/index.ts"),
      "@vastitecture/render": p("./packages/render/src/index.ts"),
    },
  },
  test: { include: ["packages/**/*.test.ts"], environment: "node" },
});
