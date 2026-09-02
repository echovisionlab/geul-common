import { describe, expect, it } from "vitest";
import {
  decodeReleaseTranslationContent,
  encodeReleaseTranslationContent,
  normalizeReleaseCreditNoteTranslations,
  normalizeReleaseDescriptionTranslation,
} from "./release.js";

const encoder = new TextEncoder();

describe("release translation content codec", () => {
  it("normalizes description and credit-note authorities independently", () => {
    expect(
      normalizeReleaseDescriptionTranslation([{ type: "paragraph" }]),
    ).toEqual([{ type: "paragraph" }]);
    expect(normalizeReleaseDescriptionTranslation({ combined: true })).toEqual(
      [],
    );
    expect(
      normalizeReleaseCreditNoteTranslations({ " credit-1 ": " Lead synth " }),
    ).toEqual({
      "credit-1": "Lead synth",
    });
  });

  it("decodes legacy array payloads as description-only content", () => {
    const payload = encoder.encode(
      JSON.stringify([{ type: "paragraph", content: "Legacy" }]),
    );

    expect(decodeReleaseTranslationContent(payload)).toEqual({
      description: [{ type: "paragraph", content: "Legacy" }],
      creditNotes: {},
    });
  });

  it("normalizes credit note IDs and values while dropping empty entries", () => {
    const payload = encoder.encode(
      JSON.stringify({
        description: [{ type: "paragraph" }],
        creditNotes: {
          " credit-1 ": "  Lead synth  ",
          " ": "ignored",
          "credit-2": "",
          "credit-3": 12,
        },
      }),
    );

    expect(decodeReleaseTranslationContent(payload)).toEqual({
      description: [{ type: "paragraph" }],
      creditNotes: { "credit-1": "Lead synth" },
    });
  });

  it("defaults missing object fields to empty durable content", () => {
    expect(decodeReleaseTranslationContent(encoder.encode("{}"))).toEqual({
      description: [],
      creditNotes: {},
    });
  });

  it("returns null for absent, empty, malformed, or non-object payloads", () => {
    expect(decodeReleaseTranslationContent()).toBeNull();
    expect(decodeReleaseTranslationContent(new Uint8Array())).toBeNull();
    expect(decodeReleaseTranslationContent(encoder.encode("{"))).toBeNull();
    expect(
      decodeReleaseTranslationContent(encoder.encode('"nope"')),
    ).toBeNull();
  });

  it("encodes normalized content and omits empty credit notes", () => {
    expect(
      JSON.parse(
        new TextDecoder().decode(
          encodeReleaseTranslationContent({
            description: "not-array" as unknown as [],
            creditNotes: { " note-1 ": " Thanks ", empty: " " },
          }),
        ),
      ),
    ).toEqual({
      description: [],
      creditNotes: { "note-1": "Thanks" },
    });

    expect(
      JSON.parse(
        new TextDecoder().decode(
          encodeReleaseTranslationContent({
            description: [{ type: "paragraph" }],
            creditNotes: {},
          }),
        ),
      ),
    ).toEqual({ description: [{ type: "paragraph" }] });
  });
});
