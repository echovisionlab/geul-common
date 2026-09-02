import { describe, expect, it } from "vitest";
import {
  extractPostSeriesStoredLocaleFields,
  hydratePostSeriesCanonicalRoom,
  materializePostSeriesLocaleFields,
  postSeriesLocaleFieldsMap,
  setPostSeriesLocaleField,
  unsetPostSeriesLocaleField,
} from "./post-series.ts";

describe("Post Series collaboration room", () => {
  it("preserves absent and explicit empty target fields", () => {
    const document = hydratePostSeriesCanonicalRoom({
      sourceLocale: "en",
      locale: "ko",
      localeExists: true,
      source: { title: "Series", summary: "Source summary" },
      requested: {},
    });
    expect(materializePostSeriesLocaleFields(document)).toEqual({
      title: "Series",
      summary: "Source summary",
    });

    setPostSeriesLocaleField(document, "summary", "");
    expect(extractPostSeriesStoredLocaleFields(document)).toEqual({
      summary: "",
    });
    unsetPostSeriesLocaleField(document, "summary");
    expect(extractPostSeriesStoredLocaleFields(document)).toEqual({});
  });

  it("preserves explicit values for both fields", () => {
    const document = hydratePostSeriesCanonicalRoom({
      sourceLocale: "en",
      locale: "ko",
      localeExists: true,
      source: {},
      requested: { title: "", summary: "요약" },
    });

    expect(materializePostSeriesLocaleFields(document)).toEqual({
      title: "",
      summary: "요약",
    });
    expect(extractPostSeriesStoredLocaleFields(document)).toEqual({
      title: "",
      summary: "요약",
    });
    setPostSeriesLocaleField(document, "title", "제목");
    expect(extractPostSeriesStoredLocaleFields(document)).toEqual({
      title: "제목",
      summary: "요약",
    });
    unsetPostSeriesLocaleField(document, "title");
    expect(materializePostSeriesLocaleFields(document).title).toBe("");

    const missing = hydratePostSeriesCanonicalRoom({
      sourceLocale: "en",
      locale: "ko",
      localeExists: false,
      source: {},
      requested: {},
    });
    expect(materializePostSeriesLocaleFields(missing)).toEqual({
      title: "",
      summary: "",
    });
    postSeriesLocaleFieldsMap(missing).set(
      "title",
      undefined as unknown as string,
    );
    postSeriesLocaleFieldsMap(missing).set(
      "summary",
      undefined as unknown as string,
    );
    expect(materializePostSeriesLocaleFields(missing)).toEqual({
      title: "",
      summary: "",
    });
    expect(extractPostSeriesStoredLocaleFields(missing)).toEqual({
      title: "",
      summary: "",
    });
  });
});
