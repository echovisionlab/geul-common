import { describe, expect, it } from "vitest";
import {
  EMAIL_LAYOUT_HTML_TEXT_NAME,
  emailLayoutLocaleValuesMap,
  extractEmailLayoutLocaleValues,
  hydrateEmailLayoutCanonicalRoom,
  materializeEmailLayoutUnits,
  setEmailLayoutLocaleValue,
  unsetEmailLayoutLocaleValue,
} from "./email-layout.ts";

describe("Email Layout collaboration room", () => {
  it("keeps target values sparse and keyed by stable unit handle", () => {
    const document = hydrateEmailLayoutCanonicalRoom({
      sourceLocale: "en",
      locale: "ko",
      localeExists: true,
      contentHtml: "",
      units: [
        {
          handle: "text:1",
          kind: "text",
          element: "p",
          attribute: "",
          order: 0,
          sourceValue: "Hello",
        },
      ],
      localeValues: {},
    });
    expect(materializeEmailLayoutUnits(document)[0]).toMatchObject({
      value: "Hello",
      localeValuePresent: false,
    });

    setEmailLayoutLocaleValue(document, "text:1", "");
    expect(extractEmailLayoutLocaleValues(document)).toEqual({ "text:1": "" });
    unsetEmailLayoutLocaleValue(document, "text:1");
    expect(extractEmailLayoutLocaleValues(document)).toEqual({});
  });

  it("hydrates source HTML without a target unit surface", () => {
    const populated = hydrateEmailLayoutCanonicalRoom({
      sourceLocale: "en",
      locale: "en",
      localeExists: true,
      contentHtml: "<main>Source</main>",
    });
    const empty = hydrateEmailLayoutCanonicalRoom({
      sourceLocale: "en",
      locale: "en",
      localeExists: true,
      contentHtml: "",
    });

    expect(populated.getText(EMAIL_LAYOUT_HTML_TEXT_NAME).toString()).toBe(
      "<main>Source</main>",
    );
    expect(empty.getText(EMAIL_LAYOUT_HTML_TEXT_NAME).toString()).toBe("");
    expect(materializeEmailLayoutUnits(populated)).toEqual([]);
  });

  it("sorts target units and ignores values outside the stable catalog", () => {
    const document = hydrateEmailLayoutCanonicalRoom({
      sourceLocale: "en",
      locale: "ko",
      localeExists: true,
      contentHtml: "",
      units: [
        {
          handle: "second",
          kind: "text",
          element: "p",
          attribute: "",
          order: 1,
          sourceValue: "Second",
        },
        {
          handle: "first",
          kind: "attribute",
          element: "img",
          attribute: "alt",
          order: 0,
          sourceValue: "First",
        },
      ],
      localeValues: { first: "첫째", unknown: "ignored" },
    });

    expect(materializeEmailLayoutUnits(document)).toEqual([
      expect.objectContaining({
        handle: "first",
        value: "첫째",
        localeValuePresent: true,
      }),
      expect.objectContaining({
        handle: "second",
        value: "Second",
        localeValuePresent: false,
      }),
    ]);
    emailLayoutLocaleValuesMap(document).set(
      "first",
      undefined as unknown as string,
    );
    expect(materializeEmailLayoutUnits(document)[0]?.value).toBe("");
    expect(
      materializeEmailLayoutUnits(
        hydrateEmailLayoutCanonicalRoom({
          sourceLocale: "en",
          locale: "ko",
          localeExists: false,
          contentHtml: "",
        }),
      ),
    ).toEqual([]);
  });

  it("rejects unknown values and malformed unit catalogs", () => {
    const document = hydrateEmailLayoutCanonicalRoom({
      sourceLocale: "en",
      locale: "ko",
      localeExists: true,
      contentHtml: "",
      units: [
        {
          handle: "known",
          kind: "text",
          element: "p",
          attribute: "",
          order: 0,
          sourceValue: "Known",
        },
      ],
    });
    expect(() =>
      setEmailLayoutLocaleValue(document, "unknown", "value"),
    ).toThrow("Unknown Email Layout unit handle");
    expect(() => unsetEmailLayoutLocaleValue(document, "unknown")).toThrow(
      "Unknown Email Layout unit handle",
    );
    emailLayoutLocaleValuesMap(document).set("unknown", "value");
    expect(() => extractEmailLayoutLocaleValues(document)).toThrow(
      "Unknown Email Layout unit handle",
    );

    const invalid = [
      [{ handle: "", order: 0 }],
      [
        { handle: "duplicate", order: 0 },
        { handle: "duplicate", order: 1 },
      ],
      [{ handle: "fractional", order: 0.5 }],
      [{ handle: "negative", order: -1 }],
    ];
    for (const units of invalid) {
      expect(() =>
        hydrateEmailLayoutCanonicalRoom({
          sourceLocale: "en",
          locale: "ko",
          localeExists: true,
          contentHtml: "",
          units: units.map((unit) => ({
            ...unit,
            kind: "text" as const,
            element: "p",
            attribute: "",
            sourceValue: "Source",
          })),
        }),
      ).toThrow("Invalid Email Layout unit catalog");
    }
  });
});
