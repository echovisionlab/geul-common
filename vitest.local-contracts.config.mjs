import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import baseConfig from "./vitest.config.ts";

const protoRoot = resolve(
  import.meta.dirname,
  "../event-contracts/packages/proto/gen/api",
);

export default defineConfig({
  ...baseConfig,
  resolve: {
    alias: [
      {
        find: /^@geul\/proto\/common\/(.+)$/,
        replacement: `${protoRoot}/common/v1/$1`,
      },
      {
        find: /^@geul\/proto\/content\/(.+)$/,
        replacement: `${protoRoot}/content/v1/$1`,
      },
      {
        find: /^@geul\/proto\/intra\/(.+)$/,
        replacement: `${protoRoot}/intra/v1/$1`,
      },
      {
        find: /^@geul\/proto\/public\/(.+)$/,
        replacement: `${protoRoot}/open/v1/$1`,
      },
      {
        find: /^@geul\/proto\/secure\/(.+)$/,
        replacement: `${protoRoot}/manage/v1/$1`,
      },
      {
        find: "@echovisionlab/geul-common",
        replacement: resolve(import.meta.dirname, "src"),
      },
    ],
  },
});
