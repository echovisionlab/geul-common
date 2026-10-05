import { create, fromJson, type JsonValue } from "@bufbuild/protobuf";
import {
  contentBlockCatalogFingerprint,
  validateLocalizedPageDocument,
  validateLocalizedRichTextDocument,
} from "@echovisionlab/geul-proto/content/block_catalog.ts";
import {
  LocalizedPageDocumentSchema,
  LocalizedRichTextDocumentSchema,
  PageDocumentSchema,
  PageSectionLocaleSchema,
  PageSectionNodeSchema,
  RichTextDocumentSchema,
  RichTextProfile,
  type PageDocument,
  type RichTextDocument,
} from "@echovisionlab/geul-proto/content/block_content_pb.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  canonicalBlockRoomDocumentBytes,
  hydrateCanonicalBlockRoom as hydrateExactBlockRoom,
} from "./block-room-codec.js";
import {
  assertExactKeys,
  materializePageSectionPayload,
  fromYValue,
  jsonObject,
  pageSectionPayload,
} from "./block-room-codec/internal.ts";

vi.mock(
  "@echovisionlab/geul-proto/content/block_catalog.ts",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@echovisionlab/geul-proto/content/block_catalog.ts")
      >();
    return {
      ...actual,
      validateLocalizedPageDocument: vi.fn(),
      validateLocalizedRichTextDocument: vi.fn(),
    };
  },
);

const BLOCK_ID = "019cce25-dbc0-7d12-9f1f-735b1a6c6b13";
const BLOCK_ID_2 = "019cce25-dbc0-7d12-9f1f-735b1a6c6b14";
const SECTION_ID = "019cce25-f076-741b-aee6-bc0a81a7c506";
const SECTION_ID_2 = "019cce25-f076-741b-aee6-bc0a81a7c507";
const TABLE_ROW_ID = "019cce25-f076-741b-aee6-bc0a81a7c508";
const TABLE_CELL_ID = "019cce25-f076-741b-aee6-bc0a81a7c509";
const IMMERSIVE_UNIT_ID = "019cce25-f076-741b-aee6-bc0a81a7c50a";

function hydrateCanonicalBlockRoom(
  room: Y.Doc,
  documentType: "post" | "page",
  document: RichTextDocument | PageDocument,
): void {
  const locale = document.localeOverlays[0]?.locale;
  if (!locale) throw new Error("test fixture locale missing");
  hydrateExactBlockRoom(
    room,
    documentType,
    document.sourceLocale,
    document.$typeName === "api.content.v1.PageDocument"
      ? create(LocalizedPageDocumentSchema, {
          blockCatalogFingerprint: document.blockCatalogFingerprint,
          locale,
          base: document.base,
          localeOverlay: document.localeOverlays[0],
        })
      : create(LocalizedRichTextDocumentSchema, {
          blockCatalogFingerprint: document.blockCatalogFingerprint,
          profile: document.profile,
          locale,
          base: document.base,
          localeOverlay: document.localeOverlays[0],
        }),
    [],
  );
}

function richDocument(): RichTextDocument {
  return fromJson(RichTextDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    profile: RichTextProfile.POST,
    sourceLocale: "ko",
    base: {
      nodes: [
        {
          block: { id: BLOCK_ID, paragraph: { props: {} } },
          placement: { index: 0 },
        },
      ],
    },
    localeOverlays: [
      {
        locale: "ko",
        blocks: [
          {
            blockId: BLOCK_ID,
            paragraph: { props: {}, content: [{ text: { text: "본문" } }] },
          },
        ],
      },
    ],
  }) as RichTextDocument;
}

function pageDocument(): PageDocument {
  return fromJson(PageDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    sourceLocale: "ko",
    base: {
      nodes: [
        {
          section: { id: SECTION_ID, externalVideo: { props: {} } },
          placement: { index: 0 },
        },
      ],
    },
    localeOverlays: [
      {
        locale: "ko",
        sections: [{ sectionId: SECTION_ID, externalVideo: { props: {} } }],
      },
    ],
  }) as PageDocument;
}

describe("invalid canonical bootstrap defense", () => {
  it("rejects malformed JSON values, unknown keys, and non-JSON Y values", () => {
    expect(() => jsonObject(null, "test_object")).toThrow(
      "block_room_invalid:test_object",
    );

    const document = new Y.Doc();
    const map = document.getMap<unknown>("test");
    map.set("unexpected", true);
    expect(() => assertExactKeys(map, new Set(["known"]), "test_map")).toThrow(
      "block_room_invalid:test_map:unknown_key:unexpected",
    );
    document.destroy();

    expect(() => fromYValue(Number.NaN)).toThrow(
      "block_room_invalid:non_json_value",
    );
  });

  beforeEach(() => {
    vi.mocked(validateLocalizedPageDocument).mockClear();
    vi.mocked(validateLocalizedRichTextDocument).mockClear();
  });

  it("rejects sparse rich-text order after contract validation", () => {
    const document = richDocument();
    document.base!.nodes.push({
      ...document.base!.nodes[0]!,
      block: {
        ...document.base!.nodes[0]!.block!,
        id: BLOCK_ID_2,
      },
      placement: { ...document.base!.nodes[0]!.placement!, index: 2 },
    });
    expect(() =>
      hydrateCanonicalBlockRoom(new Y.Doc(), "post", document),
    ).toThrow("not_dense");
  });

  it("normalizes canonical rich-text and Page bytes and rejects mismatched document types", () => {
    const rich = richDocument();
    const localizedRich = create(LocalizedRichTextDocumentSchema, {
      blockCatalogFingerprint: rich.blockCatalogFingerprint,
      profile: rich.profile,
      locale: rich.localeOverlays[0]!.locale,
      base: rich.base,
      localeOverlay: rich.localeOverlays[0],
    });
    expect(
      canonicalBlockRoomDocumentBytes("post", localizedRich),
    ).toBeInstanceOf(Uint8Array);

    const localizedPage = fromJson(LocalizedPageDocumentSchema, {
      blockCatalogFingerprint: contentBlockCatalogFingerprint,
      locale: "ko",
      base: {
        nodes: [
          {
            section: {
              id: SECTION_ID,
              externalVideo: { props: { uri: "https://example.com/video" } },
            },
            placement: { index: 0 },
          },
        ],
      },
      localeOverlay: {
        locale: "ko",
        sections: [
          {
            sectionId: SECTION_ID,
            externalVideo: { props: {} },
          },
        ],
      },
    });
    expect(
      canonicalBlockRoomDocumentBytes("page", localizedPage),
    ).toBeInstanceOf(Uint8Array);
    expect(() =>
      canonicalBlockRoomDocumentBytes("post", localizedPage),
    ).toThrow("document_type");
    expect(() =>
      canonicalBlockRoomDocumentBytes("page", localizedRich),
    ).toThrow("document_type");

    const wrongProfile = create(LocalizedRichTextDocumentSchema, {
      ...localizedRich,
      profile: RichTextProfile.WORK,
    });
    expect(() => canonicalBlockRoomDocumentBytes("post", wrongProfile)).toThrow(
      "document_profile",
    );
  });

  it("preserves Page section settings when projecting canonical payloads", () => {
    const withSettings = pageSectionPayload(
      {
        id: SECTION_ID,
        externalVideo: { props: { uri: "https://example.com/video" } },
        settings: { contentHeight: "content" },
      },
      "page_section",
    );
    expect(withSettings.payload).toEqual({
      props: { uri: "https://example.com/video" },
      settings: { contentHeight: "content" },
    });
    expect(
      materializePageSectionPayload(withSettings.payload, "page_section"),
    ).toEqual({
      value: { props: { uri: "https://example.com/video" } },
      settings: { contentHeight: "content" },
    });

    const withoutSettings = pageSectionPayload(
      {
        id: SECTION_ID,
        externalVideo: { props: { uri: "https://example.com/video" } },
      },
      "page_section",
    );
    expect(
      materializePageSectionPayload(withoutSettings.payload, "page_section"),
    ).toEqual({
      value: { props: { uri: "https://example.com/video" } },
    });
  });

  it("rejects missing rich and Page placements", () => {
    const rich = richDocument();
    rich.base!.nodes[0]!.placement = undefined;
    expect(() => hydrateCanonicalBlockRoom(new Y.Doc(), "post", rich)).toThrow(
      "placement",
    );

    const page = pageDocument();
    page.base!.nodes[0]!.placement = undefined;
    expect(() => hydrateCanonicalBlockRoom(new Y.Doc(), "page", page)).toThrow(
      "placement",
    );
  });

  it("rejects duplicate locale node ids", () => {
    const rich = richDocument();
    rich.localeOverlays[0]!.blocks.push(rich.localeOverlays[0]!.blocks[0]!);
    expect(() => hydrateCanonicalBlockRoom(new Y.Doc(), "post", rich)).toThrow(
      "duplicate_id",
    );

    const page = pageDocument();
    page.localeOverlays[0]!.sections.push(page.localeOverlays[0]!.sections[0]!);
    expect(() => hydrateCanonicalBlockRoom(new Y.Doc(), "page", page)).toThrow(
      "duplicate_id",
    );
  });

  it("rejects locale nodes without bases and bases without exact locale wrappers", () => {
    const rich = richDocument();
    rich.base = undefined;
    expect(() => hydrateCanonicalBlockRoom(new Y.Doc(), "post", rich)).toThrow(
      `locale:${BLOCK_ID}:missing_base`,
    );

    const page = pageDocument();
    page.base = undefined;
    expect(() => hydrateCanonicalBlockRoom(new Y.Doc(), "page", page)).toThrow(
      `locale:${SECTION_ID}:missing_base`,
    );

    const richSection = pageDocument();
    richSection.base!.nodes.push(
      fromJson(PageSectionNodeSchema, {
        section: { id: SECTION_ID_2, richText: { props: {} } },
        placement: { index: 1 },
      }),
    );
    expect(() =>
      hydrateCanonicalBlockRoom(new Y.Doc(), "page", richSection),
    ).toThrow(`locale:${SECTION_ID_2}:missing`);
  });

  it("rejects missing rich and Page oneof payloads", () => {
    const rich = richDocument();
    rich.base!.nodes[0]!.block!.value = { case: undefined };
    expect(() => hydrateCanonicalBlockRoom(new Y.Doc(), "post", rich)).toThrow(
      "invalid_oneof",
    );

    const page = pageDocument();
    page.base!.nodes[0]!.section!.value = { case: undefined };
    expect(() => hydrateCanonicalBlockRoom(new Y.Doc(), "page", page)).toThrow(
      "invalid_oneof",
    );
  });

  it("rejects a nested section whose locale kind differs from its base kind", () => {
    const page = pageDocument();
    page.base!.nodes.push(
      fromJson(PageSectionNodeSchema, {
        section: { id: SECTION_ID_2, externalVideo: { props: {} } },
        placement: {
          parentSectionId: SECTION_ID,
          columnId: "column-a",
          index: 0,
        },
      }),
    );
    page.localeOverlays[0]!.sections.push(
      fromJson(PageSectionLocaleSchema, {
        sectionId: SECTION_ID_2,
        richText: { props: {} },
      }),
    );
    expect(() => hydrateCanonicalBlockRoom(new Y.Doc(), "page", page)).toThrow(
      `locale:${SECTION_ID_2}:identity_mismatch`,
    );
  });

  it("rejects table and immersive locale identity mismatch at bootstrap", () => {
    const table = fromJson(RichTextDocumentSchema, {
      blockCatalogFingerprint: contentBlockCatalogFingerprint,
      profile: RichTextProfile.POST,
      sourceLocale: "ko",
      base: {
        nodes: [
          {
            block: {
              id: BLOCK_ID,
              table: {
                props: {},
                content: {
                  columnWidths: [100],
                  rows: [
                    {
                      id: TABLE_ROW_ID,
                      cells: [{ id: TABLE_CELL_ID, props: {} }],
                    },
                  ],
                },
              },
            },
            placement: { index: 0 },
          },
        ],
      },
      localeOverlays: [
        {
          locale: "ko",
          blocks: [
            {
              blockId: BLOCK_ID,
              table: {
                props: {},
                content: {
                  rows: [
                    {
                      rowId: BLOCK_ID_2,
                      cells: [{ cellId: TABLE_CELL_ID, content: [] }],
                    },
                  ],
                },
              },
            },
          ],
        },
      ],
    }) as RichTextDocument;
    expect(() => hydrateCanonicalBlockRoom(new Y.Doc(), "post", table)).toThrow(
      `locale:${BLOCK_ID}:table_identity_mismatch`,
    );
    const tableLocale = table.localeOverlays[0]!.blocks[0]!.value;
    if (tableLocale.case !== "table") throw new Error("expected table locale");
    tableLocale.value.content!.rows = [];
    expect(() => hydrateCanonicalBlockRoom(new Y.Doc(), "post", table)).toThrow(
      `locale:${BLOCK_ID}:table_identity_mismatch`,
    );

    const immersive = fromJson(PageDocumentSchema, {
      blockCatalogFingerprint: contentBlockCatalogFingerprint,
      sourceLocale: "ko",
      base: {
        nodes: [
          {
            section: {
              id: SECTION_ID,
              immersiveScene: {
                props: {},
                units: [{ id: IMMERSIVE_UNIT_ID, props: {} }],
              },
            },
            placement: { index: 0 },
          },
        ],
      },
      localeOverlays: [
        {
          locale: "ko",
          sections: [
            {
              sectionId: SECTION_ID,
              immersiveScene: {
                props: {},
                units: [{ unitId: BLOCK_ID_2, props: {} }],
              },
            },
          ],
        },
      ],
    }) as PageDocument;
    expect(() =>
      hydrateCanonicalBlockRoom(new Y.Doc(), "page", immersive),
    ).toThrow(`locale:${SECTION_ID}:immersive_identity_mismatch`);
    const immersiveLocale = immersive.localeOverlays[0]!.sections[0]!.value;
    if (immersiveLocale.case !== "immersiveScene")
      throw new Error("expected immersive locale");
    immersiveLocale.value.units = [];
    expect(() =>
      hydrateCanonicalBlockRoom(new Y.Doc(), "page", immersive),
    ).toThrow(`locale:${SECTION_ID}:immersive_identity_mismatch`);
  });

  it("requires durable table UUID identities while preserving empty rows and cells", () => {
    const tableDocument = (baseRows: JsonValue[], localeRows: JsonValue[]) =>
      fromJson(RichTextDocumentSchema, {
        blockCatalogFingerprint: contentBlockCatalogFingerprint,
        profile: RichTextProfile.POST,
        sourceLocale: "ko",
        base: {
          nodes: [
            {
              block: {
                id: BLOCK_ID,
                table: { props: {}, content: { rows: baseRows } },
              },
              placement: { index: 0 },
            },
          ],
        },
        localeOverlays: [
          {
            locale: "ko",
            blocks: [
              {
                blockId: BLOCK_ID,
                table: { props: {}, content: { rows: localeRows } },
              },
            ],
          },
        ],
      }) as RichTextDocument;

    expect(() =>
      hydrateCanonicalBlockRoom(
        new Y.Doc(),
        "post",
        tableDocument(
          [{ cells: [{ props: {} }] }],
          [
            {
              rowId: TABLE_ROW_ID,
              cells: [{ cellId: TABLE_CELL_ID, content: [] }],
            },
          ],
        ),
      ),
    ).toThrow(`block_room_invalid:locale_identity:table_row_id`);

    expect(() =>
      hydrateCanonicalBlockRoom(
        new Y.Doc(),
        "post",
        tableDocument(
          [{ id: "not-a-uuid", cells: [] }],
          [{ rowId: "not-a-uuid", cells: [] }],
        ),
      ),
    ).toThrow(`block_room_invalid:locale_identity:table_row_id`);

    expect(() =>
      hydrateCanonicalBlockRoom(
        new Y.Doc(),
        "post",
        tableDocument(
          [{ id: TABLE_ROW_ID, cells: [{ props: {} }] }],
          [{ rowId: TABLE_ROW_ID, cells: [{ content: [] }] }],
        ),
      ),
    ).toThrow(`block_room_invalid:locale_identity:table_cell_id`);

    expect(() =>
      hydrateCanonicalBlockRoom(
        new Y.Doc(),
        "post",
        tableDocument(
          [{ id: TABLE_ROW_ID, cells: [] }],
          [{ rowId: TABLE_ROW_ID, cells: [] }],
        ),
      ),
    ).not.toThrow();
    expect(() =>
      hydrateCanonicalBlockRoom(new Y.Doc(), "post", tableDocument([], [])),
    ).not.toThrow();

    expect(() =>
      hydrateCanonicalBlockRoom(
        new Y.Doc(),
        "post",
        tableDocument(
          [
            { id: TABLE_ROW_ID, cells: [] },
            { id: TABLE_ROW_ID, cells: [] },
          ],
          [
            { rowId: TABLE_ROW_ID, cells: [] },
            { rowId: TABLE_ROW_ID, cells: [] },
          ],
        ),
      ),
    ).toThrow(`block_room_invalid:locale_identity:table_duplicate_row_id`);

    expect(() =>
      hydrateCanonicalBlockRoom(
        new Y.Doc(),
        "post",
        tableDocument(
          [
            {
              id: TABLE_ROW_ID,
              cells: [{ id: TABLE_CELL_ID }, { id: TABLE_CELL_ID }],
            },
          ],
          [
            {
              rowId: TABLE_ROW_ID,
              cells: [{ cellId: TABLE_CELL_ID }, { cellId: TABLE_CELL_ID }],
            },
          ],
        ),
      ),
    ).toThrow(`block_room_invalid:locale_identity:table_duplicate_cell_id`);
  });
});
