import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import baseConfig from "./vitest.config.ts";

const protoRoot = resolve(
  import.meta.dirname,
  "../geul-event-contracts/packages/proto/gen/api",
);

export default defineConfig({
  ...baseConfig,
  resolve: {
    alias: [
      {
        find: /^@echovisionlab\/geul-proto\/common\/(.+)$/,
        replacement: `${protoRoot}/common/v1/$1`,
      },
      {
        find: /^@echovisionlab\/geul-proto\/content\/(.+)$/,
        replacement: `${protoRoot}/content/v1/$1`,
      },
      {
        find: /^@echovisionlab\/geul-proto\/intra\/(.+)$/,
        replacement: `${protoRoot}/intra/v1/$1`,
      },
      {
        find: /^@echovisionlab\/geul-proto\/public\/(.+)$/,
        replacement: `${protoRoot}/open/v1/$1`,
      },
      {
        find: /^@echovisionlab\/geul-proto\/secure\/(.+)$/,
        replacement: `${protoRoot}/manage/v1/$1`,
      },
      {
        find: "@echovisionlab/geul-common",
        replacement: resolve(import.meta.dirname, "src"),
      },
    ],
  },
});
