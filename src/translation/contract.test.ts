import { TranslationService } from "@echovisionlab/geul-proto/secure/translation_pb.ts";
import { describe, expect, it } from "vitest";

describe("translation contract", () => {
  it("does not expose the removed same-job retry RPC", () => {
    expect(Object.keys(TranslationService.method)).not.toContain(
      "retryTranslationJob",
    );
    expect(Object.keys(TranslationService.method)).toContain(
      "regenerateEntityTranslations",
    );
  });
});
