import { describe, expect, it } from "vitest";
import {
  CollaborativeDocumentType,
  createDocumentName,
  parseDocumentSaveOptions,
  parseDocumentName,
  residentBlockDocumentType,
} from "./document.js";

const ENTITY_ID = "11111111-1111-4111-8111-abcdefabcdef";

const localizedDocumentTypes = [
  [CollaborativeDocumentType.POST, "post"],
  [CollaborativeDocumentType.PAGE, "page"],
  [CollaborativeDocumentType.WORK, "work"],
  [CollaborativeDocumentType.CAMPAIGN, "campaign"],
  [CollaborativeDocumentType.EMAIL_TEMPLATE, "email-template"],
  [CollaborativeDocumentType.EMAIL_LAYOUT, "email-layout"],
  [CollaborativeDocumentType.TERMS_HISTORY, "terms-history"],
  [CollaborativeDocumentType.PRIVACY_HISTORY, "privacy-history"],
  [CollaborativeDocumentType.ARTIST, "artist"],
  [CollaborativeDocumentType.RELEASE, "release"],
  [CollaborativeDocumentType.LABEL, "label"],
  [CollaborativeDocumentType.FORM, "form"],
  [CollaborativeDocumentType.PROGRAM_EVENT, "program-event"],
  [CollaborativeDocumentType.MENU, "menu"],
  [CollaborativeDocumentType.POST_SERIES, "post-series"],
] as const;

describe("collaboration document names", () => {
  it("accepts Member contributor IDs and rejects malformed attribution values", () => {
    const memberId = "11111111-1111-4111-8111-111111111111";

    expect(
      parseDocumentSaveOptions({
        contributorMemberIds: [memberId],
        versionCheckpoint: true,
      }),
    ).toEqual({ contributorMemberIds: [memberId], versionCheckpoint: true });
    expect(() =>
      parseDocumentSaveOptions({ contributorMemberIds: ["not-a-uuid"] }),
    ).toThrow();
    expect(() =>
      parseDocumentSaveOptions({
        contributorMemberIds: [
          "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".toUpperCase(),
        ],
      }),
    ).toThrow();
    expect(() =>
      parseDocumentSaveOptions({ contributorMemberIds: [`{${memberId}}`] }),
    ).toThrow();
  });

  it.each(localizedDocumentTypes)(
    "round-trips document type %s with prefix %s for every canonical locale",
    (type, prefix) => {
      for (const locale of ["ko", "en", "en-US", "zh-Hant"]) {
        const name = createDocumentName(type, ENTITY_ID, locale);
        expect(name).toBe(`${prefix}:${ENTITY_ID}:${locale}`);
        expect(parseDocumentName(name)).toEqual({
          type,
          entityId: ENTITY_ID,
          locale,
        });
      }
    },
  );

  it("uses one locale-neutral room for Map Theme", () => {
    const name = createDocumentName(
      CollaborativeDocumentType.MAP_THEME,
      ENTITY_ID,
      "und",
    );
    expect(name).toBe(`map-theme:${ENTITY_ID}:und`);
    expect(parseDocumentName(name)).toEqual({
      type: CollaborativeDocumentType.MAP_THEME,
      entityId: ENTITY_ID,
      locale: "und",
    });
    expect(() =>
      createDocumentName(CollaborativeDocumentType.MAP_THEME, ENTITY_ID, "ko"),
    ).toThrow("locale-neutral und room");
    expect(() => parseDocumentName(`map-theme:${ENTITY_ID}:ko`)).toThrow(
      "locale-neutral und room",
    );
  });

  it("isolates locale rooms for the same domain entity", () => {
    const names = ["ko", "en", "en-US"].map((locale) =>
      createDocumentName(CollaborativeDocumentType.POST, ENTITY_ID, locale),
    );

    expect(new Set(names).size).toBe(names.length);
    expect(names.map((name) => parseDocumentName(name).locale)).toEqual([
      "ko",
      "en",
      "en-US",
    ]);
  });

  it.each([
    [CollaborativeDocumentType.POST, "post"],
    [CollaborativeDocumentType.PAGE, "page"],
    [CollaborativeDocumentType.WORK, "work"],
    [CollaborativeDocumentType.PROGRAM_EVENT, "program-event"],
    [CollaborativeDocumentType.ARTIST, "artist"],
    [CollaborativeDocumentType.LABEL, "label"],
    [CollaborativeDocumentType.RELEASE, "release"],
    [CollaborativeDocumentType.CAMPAIGN, "campaign"],
    [CollaborativeDocumentType.EMAIL_TEMPLATE, "email-template"],
    [CollaborativeDocumentType.TERMS_HISTORY, "terms-history"],
    [CollaborativeDocumentType.PRIVACY_HISTORY, "privacy-history"],
  ])(
    "maps resident Block document type %s to room type %s",
    (type, roomType) => {
      expect(residentBlockDocumentType(type)).toBe(roomType);
    },
  );

  it.each([
    CollaborativeDocumentType.EMAIL_LAYOUT,
    CollaborativeDocumentType.FORM,
    CollaborativeDocumentType.MAP_THEME,
    CollaborativeDocumentType.MENU,
    CollaborativeDocumentType.POST_SERIES,
  ])(
    "does not classify legacy generic Yjs type %s as a resident Block room",
    (type) => {
      expect(residentBlockDocumentType(type)).toBeUndefined();
    },
  );

  it.each([
    ...localizedDocumentTypes,
    [CollaborativeDocumentType.MAP_THEME, "map-theme"] as const,
  ])(
    "rejects legacy and role-bearing names for document type %s",
    (_type, prefix) => {
      expect(() => parseDocumentName(`${prefix}:${ENTITY_ID}`)).toThrow(
        "Invalid document name format",
      );
      expect(() =>
        parseDocumentName(`${prefix}:${ENTITY_ID}:locale:ko`),
      ).toThrow("Invalid document name format");
      expect(() => parseDocumentName(`${prefix}:${ENTITY_ID}:source`)).toThrow(
        "Invalid collaboration locale",
      );
      expect(() => parseDocumentName(`${prefix}:${ENTITY_ID}:target`)).toThrow(
        "Invalid collaboration locale",
      );
    },
  );

  it.each([
    "not-a-uuid",
    ENTITY_ID.toUpperCase(),
    `{${ENTITY_ID}}`,
    "11111111-1111-0111-8111-111111111111",
  ])("rejects non-canonical entity UUID %s", (entityId) => {
    expect(() =>
      createDocumentName(CollaborativeDocumentType.POST, entityId, "ko"),
    ).toThrow("Invalid collaboration entity UUID");
    expect(() => parseDocumentName(`post:${entityId}:ko`)).toThrow(
      "Invalid collaboration entity UUID",
    );
  });

  it.each([
    "",
    "EN-us",
    "en_US",
    " en",
    "en ",
    "source",
    "target",
    "not_a_locale",
  ])("rejects non-canonical or role locale %s", (locale) => {
    expect(() =>
      createDocumentName(CollaborativeDocumentType.POST, ENTITY_ID, locale),
    ).toThrow("Invalid collaboration locale");
  });

  it.each([
    "",
    "post",
    `post:${ENTITY_ID}`,
    `post:${ENTITY_ID}:ko:extra`,
    `unknown:${ENTITY_ID}:ko`,
    `: ${ENTITY_ID}:ko`,
  ])("rejects malformed document name %s", (name) => {
    expect(() => parseDocumentName(name)).toThrow(
      "Invalid document name format",
    );
  });

  it("rejects unspecified and unknown document enum values", () => {
    expect(() =>
      createDocumentName(
        CollaborativeDocumentType.UNSPECIFIED,
        ENTITY_ID,
        "ko",
      ),
    ).toThrow("Unknown document type");
    expect(() =>
      createDocumentName(9999 as CollaborativeDocumentType, ENTITY_ID, "ko"),
    ).toThrow("Unknown document type");
  });
});
