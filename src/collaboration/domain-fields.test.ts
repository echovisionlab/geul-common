import { describe, expect, it } from "vitest";
import {
  ARTIST_SOURCE_OWNED_FIELD_KEYS,
  ARTIST_SHARED_FIELD_KEYS,
  extractArtistFields,
} from "./artist.js";
import { extractCampaignFields } from "./campaign.js";
import { extractFormFields } from "./form.js";
import { extractLabelFields, LABEL_SHARED_FIELD_KEYS } from "./label.js";
import {
  getMapThemeVariantMapName,
  MAP_THEME_META_MAP_NAME,
  MAP_THEME_SETTINGS_MAP_NAME,
  MapThemeColorSchema,
  MapThemeDocumentEditingMetaSchema,
  MapThemeDocumentMetaSchema,
  MapThemeDocumentSnapshotSchema,
  MapThemeDocumentSettingsSchema,
  MapThemeDocumentVariantSchema,
} from "./map-theme.js";
import {
  getRichTextBlockLocalePropKeys,
  isPageRichTextBlockContentSourceOwned,
  hasRichTextBlockLocaleProps,
  mergeLocalizedBlockProps,
  mergePageLocaleSectionProps,
  pickPageLocaleSectionProps,
  stripPageLocaleSectionProps,
} from "./page.js";
import {
  POST_SHARED_FIELD_KEYS,
  POST_SOURCE_OWNED_FIELD_KEYS,
  extractPostFields,
  pickPostSharedFields,
} from "./post.js";
import { extractReleaseFields, pickReleaseSharedFields } from "./release.js";
import {
  extractWorkFields,
  pickWorkSharedFields,
  WORK_SOURCE_OWNED_FIELD_KEYS,
} from "./work.js";

const uuid = {
  artist: "11111111-1111-4111-8111-111111111111",
  member: "11111111-1111-4111-8111-111111111112",
  credit: "22222222-2222-4222-8222-222222222222",
  label: "33333333-3333-4333-8333-333333333333",
  genre: "44444444-4444-4444-8444-444444444444",
  category: "55555555-5555-4555-8555-555555555555",
  style: "66666666-6666-4666-8666-666666666666",
  format: "77777777-7777-4777-8777-777777777777",
  track: "88888888-8888-4888-8888-888888888888",
  file: "99999999-9999-4999-8999-999999999999",
};

function mapFields(values: Record<string, unknown>): Map<string, never> {
  return new Map(Object.entries(values)) as Map<string, never>;
}

describe("collaboration domain field extraction", () => {
  it("extracts form fields while ignoring unrelated keys", () => {
    const fields = new Map<string, unknown>([
      ["title", "Contact"],
      ["schema", JSON.stringify({ fields: [{ id: "email" }] })],
      ["allowedRoles", JSON.stringify(["admin", "author"])],
      ["unrelated", "ignored"],
    ]);

    expect(extractFormFields(fields as Map<string, never>)).toMatchObject({
      title: "Contact",
      schema: { fields: [{ id: "email" }] },
    });
  });

  it("throws a field-specific error for malformed JSON field values", () => {
    expect(() => extractFormFields(mapFields({ schema: "{" }))).toThrow(
      'Failed to parse JSON for form field "schema"',
    );
    expect(() => extractArtistFields(mapFields({ socialLinks: "{" }))).toThrow(
      'Failed to parse JSON for artist field "socialLinks"',
    );
    expect(() => extractLabelFields(mapFields({ socialLinks: "{" }))).toThrow(
      'Failed to parse JSON for label field "socialLinks"',
    );
    expect(() => extractPostFields(mapFields({ categoryIds: "{" }))).toThrow(
      'Failed to parse JSON for post field "categoryIds"',
    );
    expect(() => extractReleaseFields(mapFields({ tracks: "{" }))).toThrow(
      'Failed to parse JSON for release field "tracks"',
    );
    expect(() => extractWorkFields(mapFields({ metadata: "{" }))).toThrow(
      'Failed to parse JSON for work field "metadata"',
    );
  });

  it("extracts artist, label, and campaign shared fields from primitive and JSON values", () => {
    expect(
      extractArtistFields(
        mapFields({
          status: "published",
          realName: "Jane Doe",
          countryCode: "KR",
          socialLinks: JSON.stringify({ instagram: "example-studio" }),
          labelIds: JSON.stringify(["label-1"]),
          parentArtistId: "parent-artist",
        }),
      ),
    ).toMatchObject({
      status: "published",
      socialLinks: { instagram: "example-studio" },
      labelIds: ["label-1"],
      parentArtistId: "parent-artist",
    });
    expect(ARTIST_SOURCE_OWNED_FIELD_KEYS).toEqual(["name"]);
    expect(ARTIST_SHARED_FIELD_KEYS).toContain("socialLinks");
    expect(ARTIST_SHARED_FIELD_KEYS).toContain("parentArtistId");

    expect(
      extractLabelFields(
        mapFields({
          slug: "main-label",
          socialLinks: JSON.stringify({ bandcamp: "label" }),
          parentLabelId: null,
        }),
      ),
    ).toEqual({
      slug: "main-label",
      socialLinks: { bandcamp: "label" },
      parentLabelId: null,
    });
    expect(LABEL_SHARED_FIELD_KEYS).toEqual([
      "slug",
      "countryCode",
      "website",
      "socialLinks",
      "parentLabelId",
    ]);

    expect(
      extractCampaignFields(
        mapFields({
          segmentId: "segment-1",
          layoutId: null,
          recipientScope: "ALL_MATCHING_USERS",
        }),
      ),
    ).toEqual({
      segmentId: "segment-1",
      layoutId: null,
      recipientScope: "ALL_MATCHING_USERS",
    });
    expect(extractCampaignFields(mapFields({}))).toEqual({
      recipientScope: "SUBSCRIBED_USERS",
    });
    expect(() =>
      extractCampaignFields(mapFields({ recipientScope: "UNSUPPORTED" })),
    ).toThrow();
    expect(extractPostFields(mapFields({}))).toEqual({});
  });

  it("keeps source-owned metadata distinct from shared post and work fields", () => {
    const post = extractPostFields(
      mapFields({
        title: "Local title",
        summary: "Local summary",
        categoryIds: JSON.stringify(["cat-1"]),
        tagIds: JSON.stringify(["tag-1"]),
      }),
    );
    expect(pickPostSharedFields(post)).toEqual({
      categoryIds: ["cat-1"],
      tagIds: ["tag-1"],
    });
    expect(POST_SHARED_FIELD_KEYS).toEqual(["categoryIds", "tagIds"]);
    expect(POST_SOURCE_OWNED_FIELD_KEYS).toEqual(["title", "summary"]);

    const work = extractWorkFields(
      mapFields({
        title: "Localized",
        slug: "project",
        type: "installation",
        featured: true,
        year: 2026,
        metadata: JSON.stringify({ room: "A" }),
        creditOrder: JSON.stringify([{ type: "group", id: "group-1" }]),
        clients: JSON.stringify(["client-1"]),
      }),
    );
    expect(pickWorkSharedFields(work)).toMatchObject({
      slug: "project",
      type: "installation",
      featured: true,
      year: 2026,
      metadata: { room: "A" },
      creditOrder: [{ type: "group", id: "group-1" }],
      clients: ["client-1"],
    });
    expect(WORK_SOURCE_OWNED_FIELD_KEYS).toEqual(["title", "summary"]);
  });

  it("extracts release JSON arrays and picks only shared release fields", () => {
    const release = extractReleaseFields(
      mapFields({
        title: "Localized title",
        type: "album",
        status: "legacy-collab-status-must-be-ignored",
        releaseDate: "2026-06-25",
        artists: JSON.stringify([
          {
            artist_id: uuid.artist,
            artist_name: "Artist",
            artist_slug: "artist",
            sort_order: 0,
          },
        ]),
        credits: JSON.stringify([
          {
            id: uuid.credit,
            credit_type: "artist",
            artist_id: uuid.artist,
            artist_name: "Artist",
            artist_slug: "artist",
            member_id: null,
            member_name: null,
            credited_name: null,
            credit_role: "Producer",
            sort_order: 0,
          },
        ]),
        labels: JSON.stringify([
          {
            label_id: uuid.label,
            label_name: "Label",
            label_slug: null,
            catalog_number: null,
            sort_order: 0,
          },
        ]),
        categories: JSON.stringify([
          { id: uuid.category, name: "Album", slug: "album" },
        ]),
        genres: JSON.stringify([
          { id: uuid.genre, name: "Electronic", slug: "electronic" },
        ]),
        styles: JSON.stringify([
          { id: uuid.style, name: "Ambient", slug: "ambient" },
        ]),
        formats: JSON.stringify([
          {
            id: uuid.format,
            name: "Digital",
            slug: "digital",
            format_description: null,
          },
        ]),
        tracks: JSON.stringify([
          {
            id: uuid.track,
            track_number: 1,
            title: "Track",
            audio_original_file_id: uuid.file,
            credits: [],
          },
        ]),
      }),
    );

    expect(pickReleaseSharedFields(release)).toMatchObject({
      type: "album",
      artists: [
        {
          artist_id: uuid.artist,
          artist_name: "Artist",
          artist_slug: "artist",
          sort_order: 0,
        },
      ],
      tracks: [
        { id: uuid.track, title: "Track", audio_original_file_id: uuid.file },
      ],
    });
    expect(pickReleaseSharedFields(release)).not.toHaveProperty("status");
  });

  it("accepts Member credit targets and rejects malformed Member credit data", () => {
    const baseCredit = {
      id: uuid.credit,
      credit_type: "member",
      artist_id: null,
      artist_name: null,
      artist_slug: null,
      member_id: uuid.member,
      member_name: "Member",
      credited_name: null,
      credit_role: "Producer",
      sort_order: 0,
    };

    expect(
      extractReleaseFields(mapFields({ credits: JSON.stringify([baseCredit]) }))
        .credits,
    ).toEqual([baseCredit]);
    expect(() =>
      extractReleaseFields(
        mapFields({
          credits: JSON.stringify([
            {
              ...baseCredit,
              member_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".toUpperCase(),
            },
          ]),
        }),
      ),
    ).toThrow("Expected a canonical Member UUID");
    expect(() =>
      extractReleaseFields(
        mapFields({
          credits: JSON.stringify([{ ...baseCredit, member_id: null }]),
        }),
      ),
    ).toThrow("Member credit requires member_id");
  });

  it("splits page locale section props and merges localized block props by block type", () => {
    expect(
      pickPageLocaleSectionProps({
        title: "Title",
        label: "Label",
        description: 12,
        unitsJson: "[]",
      }),
    ).toEqual({ title: "Title", label: "Label" });
    expect(
      stripPageLocaleSectionProps({ title: "Title", unitsJson: "[]" }),
    ).toEqual({
      unitsJson: "[]",
    });
    expect(
      mergePageLocaleSectionProps({ unitsJson: "[]", caption: "source" }, null),
    ).toEqual({
      unitsJson: "[]",
    });

    expect(getRichTextBlockLocalePropKeys("audio")).toEqual([]);
    expect(getRichTextBlockLocalePropKeys("video")).toEqual([]);
    expect(getRichTextBlockLocalePropKeys("attachment")).toEqual([]);
    expect(getRichTextBlockLocalePropKeys("codeBlock")).toEqual(["title"]);
    expect(getRichTextBlockLocalePropKeys("file")).toEqual(["alt", "caption"]);
    expect(getRichTextBlockLocalePropKeys("image")).toEqual([]);
    expect(getRichTextBlockLocalePropKeys("p5Sketch")).toEqual(["title"]);
    expect(getRichTextBlockLocalePropKeys("threeScene")).toEqual(["title"]);
    expect(getRichTextBlockLocalePropKeys("shader")).toEqual(["title"]);
    expect(isPageRichTextBlockContentSourceOwned("p5Sketch")).toBe(true);
    expect(isPageRichTextBlockContentSourceOwned("paragraph")).toBe(false);
    expect(hasRichTextBlockLocaleProps("map")).toBe(true);
    expect(hasRichTextBlockLocaleProps("paragraph")).toBe(false);
    expect(
      mergeLocalizedBlockProps(
        {
          fileId: "file-1",
          name: "field-recording.wav",
          url: "blob:local",
          hlsUrl: " https://cdn.test/audio.m3u8 ",
          caption: "source caption",
          processingProgress: 50,
        },
        { title: " Legacy localized title ", caption: " Local caption " },
        "file",
      ),
    ).toEqual({
      fileId: "file-1",
      name: "field-recording.wav",
      caption: "Local caption",
    });
    expect(
      mergeLocalizedBlockProps({ source: "void setup() {}" }, null, "p5Sketch"),
    ).toEqual({ source: "void setup() {}" });
  });

  it("validates map-theme metadata, settings, and variant maps", () => {
    expect(MAP_THEME_META_MAP_NAME).toBe("map-theme-meta");
    expect(MAP_THEME_SETTINGS_MAP_NAME).toBe("map-theme-settings");
    expect(getMapThemeVariantMapName("dark")).toBe("map-theme-dark-variant");
    expect(
      MapThemeDocumentMetaSchema.parse({
        name: "Default",
      }),
    ).toEqual({ name: "Default" });
    expect(MapThemeDocumentEditingMetaSchema.parse({ name: "New " })).toEqual({
      name: "New ",
    });
    expect(MapThemeDocumentMetaSchema.parse({ name: " New Theme " })).toEqual({
      name: "New Theme",
    });
    expect(
      MapThemeDocumentEditingMetaSchema.safeParse({ name: " ".repeat(4) })
        .success,
    ).toBe(false);
    expect(
      MapThemeDocumentEditingMetaSchema.safeParse({ name: "🎧".repeat(255) })
        .success,
    ).toBe(true);
    expect(
      MapThemeDocumentEditingMetaSchema.safeParse({ name: "🎧".repeat(256) })
        .success,
    ).toBe(false);
    expect(() =>
      MapThemeDocumentMetaSchema.parse({
        name: "Legacy",
        hasLight: true,
        hasDark: true,
      }),
    ).toThrow();
    const settings = {
      calloutScale: 1,
      calloutOffsetX: 0,
      calloutOffsetY: -10,
      calloutFields: ["name", "address"] as const,
      showAreaLabels: true,
      showPoiLabels: false,
      attributionFontSize: 12,
    };
    expect(MapThemeDocumentSettingsSchema.parse(settings)).toMatchObject({
      calloutFields: ["name", "address"],
    });
    expect(() =>
      MapThemeDocumentSettingsSchema.parse({
        calloutScale: 3,
        calloutOffsetX: 0,
        calloutOffsetY: 0,
        calloutFields: [],
        showAreaLabels: true,
        showPoiLabels: true,
        attributionFontSize: 12,
      }),
    ).toThrow();
    expect(() =>
      MapThemeDocumentSettingsSchema.parse({
        ...settings,
        calloutOffsetX: 0.5,
      }),
    ).toThrow();
    expect(() =>
      MapThemeDocumentSettingsSchema.parse({
        ...settings,
        arbitrarySetting: true,
      }),
    ).toThrow();
    const variant = {
      backgroundColor: "#000",
      waterColor: "#1111",
      landColor: "#222222",
      roadColor: "#333333ff",
      buildingFillColor: "rgb(4, 44, 255)",
      buildingStrokeEnabled: true,
      buildingStrokeColor: "rgba(5, 55, 155, 0.5)",
      calloutLineColor: "#666",
      calloutHoverLineColor: "#777",
      calloutTextColor: "#888",
      calloutHoverTextColor: "#999",
      calloutDescriptionColor: "#aaa",
      calloutHoverDescriptionColor: "#bbb",
      calloutBackgroundColor: "transparent",
      calloutHoverBackgroundColor: "#ddd",
      attributionColor: "#eee",
      labelTextColor: "#fff",
      clusterColor: "#123",
      clusterHoverColor: "#234",
      clusterTextColor: "#345",
      clusterTextHoverColor: "#456",
    };
    expect(MapThemeDocumentVariantSchema.parse(variant)).toMatchObject({
      buildingStrokeEnabled: true,
      clusterTextHoverColor: "#456",
    });
    expect(() =>
      MapThemeDocumentVariantSchema.parse({ ...variant, scheme: "light" }),
    ).toThrow();
    expect(
      MapThemeDocumentSnapshotSchema.parse({
        name: "Default",
        settings,
        lightVariant: variant,
        darkVariant: variant,
      }),
    ).toMatchObject({ name: "Default" });
    for (const invalidColor of [
      "",
      "red",
      "var(--brand)",
      "url(https://example.test/color)",
      "#12",
      "#12345",
      "rgb(256,0,0)",
      "rgb(1.5,0,0)",
      "rgba(0,0,0,1.1)",
      "hsl(0, 100%, 50%)",
    ]) {
      expect(() => MapThemeColorSchema.parse(invalidColor)).toThrow();
    }
  });
});
