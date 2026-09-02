import { create, fromJson, toBinary } from "@bufbuild/protobuf";
import {
  contentBlockCatalogFingerprint,
  materializeLocalizedPageDocument,
  materializeLocalizedRichTextDocument,
} from "@echovisionlab/geul-proto/content/block_catalog.ts";
import {
  LocalizedRichTextDocumentSchema,
  PageLocaleOverlaySchema,
  PageDocumentSchema,
  RichTextBlockLocaleSchema,
  RichTextBlockNodeSchema,
  RichTextDocumentSchema,
  RichTextLocaleOverlaySchema,
  RichTextProfile,
  type LocalizedRichTextDocument,
  type PageDocument,
  type RichTextDocument,
} from "@echovisionlab/geul-proto/content/block_content_pb.ts";
import {
  AIDocumentFieldPathSegmentSchema,
  AIDocumentFieldTargetSchema,
  AIDocumentInlineContentSchema,
  AIDocumentInlineItemSchema,
  AIDocumentListItemSchema,
  AIDocumentListValueSchema,
  AIDocumentOperationSchema,
  AIDocumentFieldValueSchema,
  AIDocumentObjectValueSchema,
  AIDocumentValueSchema,
  type AIDocumentValue,
  type AIDocumentOperation,
} from "@echovisionlab/geul-proto/secure/ai_pb.ts";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  applyAIDocumentOperationsToBlockRoom as applyExactAIDocumentOperations,
  assertBlockRoomLocaleChangeAllowed,
  BlockRoomLocaleChangeError,
  BlockRoomLocaleChangeRejectionReason,
  blockRoomPresentLocaleValues,
  canonicalBlockRoomLocaleValueTarget,
  canonicalBlockRoomLocaleValueTargetKey,
  canonicalBlockRoomLocaleValueTargets,
  decodeCanonicalBlockRoomAffectedNodes,
  decodeCanonicalBlockRoom,
  hydrateCanonicalBlockRoom as hydrateExactBlockRoom,
  insertRichTextBlockLocale,
  insertRichTextBlockNode,
  moveRichTextBlockNode,
  markBlockRoomLocaleValuePresent,
  observeBlockRoomChanges,
  replaceBlockRoomCollaborativeText,
  replaceBlockRoomPayloadArray,
} from "../block-room-codec.ts";
import {
  attachAIDocumentFile,
  setAIDocumentField,
  unsetAIDocumentField,
} from "./ai-document-field-mutations.ts";
import { applyPageStructureAIDocumentOperation } from "./ai-document-page-structure-mutations.ts";
import {
  allBlockRoomLocaleValueTargets,
  blockRoomLocaleValue,
  blockRoomLocaleValueIsEncoded,
  sparseBlockRoomLocalePayload,
} from "./locale-presence.ts";

const PARAGRAPH_ID = "019cce25-dbc0-7d12-9f1f-735b1a6c6b13";
const FILE_BLOCK_ID = "019cce25-dbc0-7d12-9f1f-735b1a6c6b14";
const INSERTED_ID = "019cce25-dbc0-7d12-9f1f-735b1a6c6b15";
const FILE_ID = "019cce25-dbc0-7d12-9f1f-735b1a6c6b16";
const OLD_FILE_ID = "019cce25-dbc0-7d12-9f1f-735b1a6c6b17";
const PAGE_SECTION_ID = "019cce25-dbc0-7d12-9f1f-735b1a6c6b18";
const SHADER_ID = "019cce25-dbc0-7d12-9f1f-735b1a6c6b19";
const TABLE_ID = "019cce25-dbc0-7d12-9f1f-735b1a6c6b20";
const TABLE_ROW_ID = "019cce25-dbc0-7d12-9f1f-735b1a6c6b21";
const TABLE_CELL_ID = "019cce25-dbc0-7d12-9f1f-735b1a6c6b22";
const IMMERSIVE_UNIT_ID = "019cce25-dbc0-7d12-9f1f-735b1a6c6b23";
const PAGE_COLUMN_A_ID = "019cce25-dbc0-7d12-9f1f-735b1a6c6b24";
const PAGE_COLUMN_B_ID = "019cce25-dbc0-7d12-9f1f-735b1a6c6b25";
const PAGE_PARAGRAPH_ID = "019cce25-dbc0-7d12-9f1f-735b1a6c6b26";
const SECOND_IMMERSIVE_UNIT_ID = "019cce25-dbc0-7d12-9f1f-735b1a6c6b27";
const PAGE_SECTION_A_ID = "019cce25-dbc0-7d12-9f1f-735b1a6c6b28";
const PAGE_SECTION_B_ID = "019cce25-dbc0-7d12-9f1f-735b1a6c6b29";
const PAGE_SECTION_C_ID = "019cce25-dbc0-7d12-9f1f-735b1a6c6b2a";
const PAGE_COLUMN_C_ID = "019cce25-dbc0-7d12-9f1f-735b1a6c6b2b";
const PAGE_SECTION_D_ID = "019cce25-dbc0-7d12-9f1f-735b1a6c6b2c";
const PAGE_CODE_ID = "019cce25-dbc0-7d12-9f1f-735b1a6c6b2d";

function hydrateCanonicalBlockRoom(
  room: Y.Doc,
  documentType: "post" | "page",
  aggregate: RichTextDocument | PageDocument,
): void {
  const locale = aggregate.localeOverlays[0]?.locale;
  if (!locale) throw new Error("test fixture locale missing");
  hydrateExactBlockRoom(
    room,
    documentType,
    aggregate.sourceLocale,
    aggregate.$typeName === "api.content.v1.PageDocument"
      ? materializeLocalizedPageDocument(aggregate, locale)
      : materializeLocalizedRichTextDocument(aggregate, locale),
    [],
  );
  if (locale === aggregate.sourceLocale) {
    for (const target of allBlockRoomLocaleValueTargets(room))
      markBlockRoomLocaleValuePresent(room, target);
  }
}

function applyAIDocumentOperationsToBlockRoom(
  room: Y.Doc,
  documentType: "post" | "page",
  operations: readonly AIDocumentOperation[],
  options: { expectedRoomLocale?: string; origin?: object } = {},
): void {
  applyExactAIDocumentOperations(room, documentType as "post", operations, {
    expectedRoomLocale: options.expectedRoomLocale ?? "ko",
    origin: options.origin ?? {},
  });
}

function document(): RichTextDocument {
  return fromJson(RichTextDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    profile: RichTextProfile.POST,
    sourceLocale: "ko",
    base: {
      nodes: [
        {
          block: { id: PARAGRAPH_ID, paragraph: { props: {} } },
          placement: { index: 0 },
        },
        {
          block: {
            id: FILE_BLOCK_ID,
            file: {
              props: { attachment: { activeFileId: OLD_FILE_ID } },
            },
          },
          placement: { index: 1 },
        },
      ],
    },
    localeOverlays: [
      {
        locale: "ko",
        blocks: [
          {
            blockId: PARAGRAPH_ID,
            paragraph: {
              props: {},
              content: [{ text: { text: "원문" } }],
            },
          },
          { blockId: FILE_BLOCK_ID, file: { props: {} } },
        ],
      },
    ],
  }) as RichTextDocument;
}

function fieldTarget(blockId: string, field: string) {
  return create(AIDocumentFieldTargetSchema, {
    owner: { case: "blockHandle", value: blockId },
    fieldHandle: field,
  });
}

function nestedFieldTarget(
  blockId: string,
  field: string,
  path: readonly ({ field: string } | { item: string })[],
) {
  return create(AIDocumentFieldTargetSchema, {
    owner: { case: "blockHandle", value: blockId },
    fieldHandle: field,
    path: path.map((segment) =>
      create(AIDocumentFieldPathSegmentSchema, {
        selector:
          "field" in segment
            ? { case: "fieldHandle", value: segment.field }
            : { case: "itemHandle", value: segment.item },
      }),
    ),
  });
}

function setEmptyInline(blockId: string): AIDocumentOperation {
  return create(AIDocumentOperationSchema, {
    operation: {
      case: "setField",
      value: {
        target: fieldTarget(blockId, "content"),
        value: create(AIDocumentValueSchema, {
          value: {
            case: "inline",
            value: create(AIDocumentInlineContentSchema, { items: [] }),
          },
        }),
      },
    },
  });
}

function setInlineField(
  target: ReturnType<typeof fieldTarget>,
  text: string,
): AIDocumentOperation {
  return create(AIDocumentOperationSchema, {
    operation: {
      case: "setField",
      value: {
        target,
        value: create(AIDocumentValueSchema, {
          value: {
            case: "inline",
            value: create(AIDocumentInlineContentSchema, {
              items: [
                create(AIDocumentInlineItemSchema, {
                  item: { case: "text", value: text },
                }),
              ],
            }),
          },
        }),
      },
    },
  });
}

function setTextField(
  blockId: string,
  field: string,
  text: string,
): AIDocumentOperation {
  return create(AIDocumentOperationSchema, {
    operation: {
      case: "setField",
      value: {
        target: fieldTarget(blockId, field),
        value: create(AIDocumentValueSchema, {
          value: { case: "text", value: text },
        }),
      },
    },
  });
}

function objectValue(fields: Readonly<Record<string, AIDocumentValue>>) {
  return create(AIDocumentValueSchema, {
    value: {
      case: "object",
      value: create(AIDocumentObjectValueSchema, {
        fields: Object.entries(fields).map(([fieldHandle, value]) =>
          create(AIDocumentFieldValueSchema, { fieldHandle, value }),
        ),
      }),
    },
  });
}

function listValue(items: readonly [string, AIDocumentValue][]) {
  return create(AIDocumentValueSchema, {
    value: {
      case: "list",
      value: create(AIDocumentListValueSchema, {
        items: items.map(([itemHandle, value]) =>
          create(AIDocumentListItemSchema, { itemHandle, value }),
        ),
      }),
    },
  });
}

function tableRowValue(rowId: string, cellId: string): AIDocumentValue {
  return objectValue({
    rowId: create(AIDocumentValueSchema, {
      value: { case: "text", value: rowId },
    }),
    cells: listValue([
      [
        cellId,
        objectValue({
          cellId: create(AIDocumentValueSchema, {
            value: { case: "text", value: cellId },
          }),
          header: create(AIDocumentValueSchema, {
            value: { case: "boolean", value: false },
          }),
        }),
      ],
    ]),
  });
}

function tableSharedValue(
  rows: readonly [string, AIDocumentValue][],
): AIDocumentValue {
  return objectValue({
    columnWidths: listValue([
      [
        "0",
        create(AIDocumentValueSchema, {
          value: { case: "number", value: "100" },
        }),
      ],
    ]),
    rows: listValue(rows),
  });
}

function pageDocument(): PageDocument {
  return fromJson(PageDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    sourceLocale: "ko",
    base: {
      nodes: [
        {
          section: {
            id: PAGE_SECTION_ID,
            settings: {},
            externalVideo: {
              props: { uri: "https://example.com/video" },
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
            sectionId: PAGE_SECTION_ID,
            externalVideo: { props: { caption: "caption" } },
          },
        ],
      },
    ],
  }) as PageDocument;
}

function immersivePageDocument(): PageDocument {
  return fromJson(PageDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    sourceLocale: "ko",
    base: {
      nodes: [
        {
          section: {
            id: PAGE_SECTION_ID,
            settings: {},
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
            sectionId: PAGE_SECTION_ID,
            immersiveScene: {
              props: {},
              units: [{ unitId: IMMERSIVE_UNIT_ID, props: { title: "kept" } }],
            },
          },
        ],
      },
      {
        locale: "en",
        sections: [
          {
            sectionId: PAGE_SECTION_ID,
            immersiveScene: {
              props: {},
              units: [{ unitId: IMMERSIVE_UNIT_ID, props: { title: "old" } }],
            },
          },
        ],
      },
    ],
  }) as PageDocument;
}

function shaderDocument(): RichTextDocument {
  const stageKinds = [
    "KIND_COMMON",
    "KIND_VERTEX",
    "KIND_BUFFER_A",
    "KIND_BUFFER_B",
    "KIND_BUFFER_C",
    "KIND_BUFFER_D",
    "KIND_CUBEMAP",
    "KIND_SOUND",
    "KIND_IMAGE",
  ];
  return fromJson(RichTextDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    profile: RichTextProfile.POST,
    sourceLocale: "ko",
    base: {
      nodes: [
        {
          block: {
            id: SHADER_ID,
            shader: {
              props: {
                stages: stageKinds.map((kind) => ({
                  kind,
                  source: "",
                  channels: Array.from({ length: 4 }, () => ({
                    kind: "KIND_NONE",
                  })),
                })),
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
          { blockId: SHADER_ID, shader: { props: { title: "Shader" } } },
        ],
      },
    ],
  }) as RichTextDocument;
}

function targetDocument(): LocalizedRichTextDocument {
  const aggregate = document();
  aggregate.localeOverlays.push(
    fromJson(RichTextLocaleOverlaySchema, {
      locale: "en",
      blocks: [
        {
          blockId: PARAGRAPH_ID,
          paragraph: {
            props: {},
            content: [{ text: { text: "Source translation" } }],
          },
        },
        {
          blockId: FILE_BLOCK_ID,
          file: { props: { alt: "Target alt" } },
        },
      ],
    }),
  );
  return materializeLocalizedRichTextDocument(aggregate, "en");
}

function tableDocument(): RichTextDocument {
  return fromJson(RichTextDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    profile: RichTextProfile.POST,
    sourceLocale: "ko",
    base: {
      nodes: [
        {
          block: {
            id: TABLE_ID,
            table: {
              props: {},
              content: {
                columnWidths: [100],
                rows: [
                  {
                    id: TABLE_ROW_ID,
                    cells: [{ id: TABLE_CELL_ID, header: false, props: {} }],
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
            blockId: TABLE_ID,
            table: {
              props: {},
              content: {
                rows: [
                  {
                    rowId: TABLE_ROW_ID,
                    cells: [
                      {
                        cellId: TABLE_CELL_ID,
                        content: [{ text: { text: "cell" } }],
                      },
                    ],
                  },
                ],
              },
            },
          },
        ],
      },
    ],
  }) as RichTextDocument;
}

describe("AI document Block Room applicator", () => {
  it("classifies every target-room rejection while allowing source and locale-only changes", () => {
    const target = new Y.Doc();
    hydrateExactBlockRoom(target, "post", "ko", targetDocument(), []);
    const clone = () => {
      const copied = new Y.Doc();
      Y.applyUpdate(copied, Y.encodeStateAsUpdate(target));
      return copied;
    };
    const rejection = (
      after: Y.Doc,
      documentType: "post" | "work" | "page" = "post",
      before: Y.Doc = target,
    ) => {
      try {
        assertBlockRoomLocaleChangeAllowed(before, after, documentType);
        throw new Error("expected target-room rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(BlockRoomLocaleChangeError);
        return (error as BlockRoomLocaleChangeError).reason;
      }
    };

    const wrongType = clone();
    expect(rejection(wrongType, "work")).toBe(
      BlockRoomLocaleChangeRejectionReason.RoomLocaleMismatch,
    );
    const identity = clone();
    identity.getMap("block-document").set("roomLocale", "fr");
    expect(rejection(identity)).toBe(
      BlockRoomLocaleChangeRejectionReason.RoomLocaleMismatch,
    );
    const structure = clone();
    moveRichTextBlockNode(structure, FILE_BLOCK_ID, { index: 0 });
    expect(rejection(structure)).toBe(
      BlockRoomLocaleChangeRejectionReason.NonSourceStructure,
    );
    const shared = clone();
    const sharedNodes = shared
      .getMap("block-document")
      .get("baseNodes") as Y.Map<Y.Map<unknown>>;
    const sharedProps = (
      sharedNodes.get(PARAGRAPH_ID)?.get("payload") as Y.Map<unknown>
    ).get("props") as Y.Map<unknown>;
    sharedProps.set("aspectRatio", "ASPECT_RATIO_X_4_3");
    expect(rejection(shared)).toBe(
      BlockRoomLocaleChangeRejectionReason.NonSourceSharedField,
    );
    const file = clone();
    const fileNodes = file.getMap("block-document").get("baseNodes") as Y.Map<
      Y.Map<unknown>
    >;
    const fileProps = (
      fileNodes.get(FILE_BLOCK_ID)?.get("payload") as Y.Map<unknown>
    ).get("props") as Y.Map<unknown>;
    const attachment = fileProps.get("attachment") as Y.Map<unknown>;
    attachment.set("activeFileId", FILE_ID);
    expect(rejection(file)).toBe(
      BlockRoomLocaleChangeRejectionReason.NonSourceFileRelation,
    );
    const metadata = clone();
    metadata.getMap("block-document").set("blockCatalogFingerprint", "changed");
    expect(rejection(metadata)).toBe(
      BlockRoomLocaleChangeRejectionReason.NonSourceDocumentMetadata,
    );
    const localeOnly = clone();
    setAIDocumentField(
      localeOnly,
      fieldTarget(PARAGRAPH_ID, "content"),
      create(AIDocumentValueSchema, {
        value: {
          case: "inline",
          value: create(AIDocumentInlineContentSchema, {
            items: [
              create(AIDocumentInlineItemSchema, {
                item: { case: "text", value: "Changed translation" },
              }),
            ],
          }),
        },
      }),
    );
    expect(() =>
      assertBlockRoomLocaleChangeAllowed(target, localeOnly, "post"),
    ).not.toThrow();
    const styledLocale = clone();
    setAIDocumentField(
      styledLocale,
      fieldTarget(PARAGRAPH_ID, "content"),
      create(AIDocumentValueSchema, {
        value: {
          case: "inline",
          value: create(AIDocumentInlineContentSchema, {
            items: [
              create(AIDocumentInlineItemSchema, {
                item: {
                  case: "mark",
                  value: {
                    mark: "bold",
                    children: [
                      create(AIDocumentInlineItemSchema, {
                        item: { case: "text", value: "hello" },
                      }),
                    ],
                  },
                },
              }),
            ],
          }),
        },
      }),
    );
    const plainLocale = new Y.Doc();
    Y.applyUpdate(plainLocale, Y.encodeStateAsUpdate(styledLocale));
    setAIDocumentField(
      plainLocale,
      fieldTarget(PARAGRAPH_ID, "content"),
      create(AIDocumentValueSchema, {
        value: {
          case: "inline",
          value: create(AIDocumentInlineContentSchema, {
            items: [
              create(AIDocumentInlineItemSchema, {
                item: { case: "text", value: "hello" },
              }),
            ],
          }),
        },
      }),
    );
    expect(() =>
      assertBlockRoomLocaleChangeAllowed(styledLocale, plainLocale, "post"),
    ).not.toThrow();
    const deletedLocaleNode = clone();
    (
      deletedLocaleNode
        .getMap("block-document")
        .get("localeOverlay") as Y.Map<unknown>
    ).delete(PARAGRAPH_ID);
    expect(rejection(deletedLocaleNode)).toBe(
      BlockRoomLocaleChangeRejectionReason.NonSourceStructure,
    );
    const deletedLocaleLeaf = clone();
    const deletedLocaleNodes = deletedLocaleLeaf
      .getMap("block-document")
      .get("localeOverlay") as Y.Map<Y.Map<unknown>>;
    (
      deletedLocaleNodes.get(PARAGRAPH_ID)?.get("payload") as Y.Map<unknown>
    ).delete("content");
    expect(rejection(deletedLocaleLeaf)).toBe(
      BlockRoomLocaleChangeRejectionReason.NonSourceSharedField,
    );
    for (const value of [null, undefined]) {
      const nullishLocaleLeaf = clone();
      const nullishLocaleNodes = nullishLocaleLeaf
        .getMap("block-document")
        .get("localeOverlay") as Y.Map<Y.Map<unknown>>;
      const nullishFilePayload = nullishLocaleNodes
        .get(FILE_BLOCK_ID)
        ?.get("payload") as Y.Map<unknown>;
      const nullishFileProps = nullishFilePayload.get(
        "props",
      ) as Y.Map<unknown>;
      nullishFileProps.set("alt", value);
      expect(rejection(nullishLocaleLeaf)).toBe(
        BlockRoomLocaleChangeRejectionReason.NonSourceSharedField,
      );
    }
    const tableAggregate = tableDocument();
    tableAggregate.localeOverlays.push(
      create(RichTextLocaleOverlaySchema, {
        locale: "en",
        blocks: tableAggregate.localeOverlays[0]!.blocks,
      }),
    );
    const tableBefore = new Y.Doc();
    hydrateExactBlockRoom(
      tableBefore,
      "post",
      "ko",
      materializeLocalizedRichTextDocument(tableAggregate, "en"),
      [],
    );
    const tableAfter = new Y.Doc();
    Y.applyUpdate(tableAfter, Y.encodeStateAsUpdate(tableBefore));
    const tableLocaleNodes = tableAfter
      .getMap("block-document")
      .get("localeOverlay") as Y.Map<Y.Map<unknown>>;
    const tableLocalePayload = tableLocaleNodes
      .get(TABLE_ID)
      ?.get("payload") as Y.Map<unknown>;
    const tableLocaleContent = tableLocalePayload.get(
      "content",
    ) as Y.Map<unknown>;
    const tableLocaleRows = tableLocaleContent.get("rows") as Y.Array<
      Y.Map<unknown>
    >;
    tableLocaleRows.get(0)?.set("rowId", "changed-row-id");
    expect(rejection(tableAfter, "post", tableBefore)).toBe(
      BlockRoomLocaleChangeRejectionReason.NonSourceStructure,
    );
    const sourceTableBefore = new Y.Doc();
    hydrateCanonicalBlockRoom(sourceTableBefore, "post", tableDocument());
    const sourceTableAfter = new Y.Doc();
    Y.applyUpdate(sourceTableAfter, Y.encodeStateAsUpdate(sourceTableBefore));
    const sourceTableRows = (
      (
        (
          sourceTableAfter
            .getMap("block-document")
            .get("localeOverlay") as Y.Map<Y.Map<unknown>>
        )
          .get(TABLE_ID)
          ?.get("payload") as Y.Map<unknown>
      ).get("content") as Y.Map<unknown>
    ).get("rows") as Y.Array<Y.Map<unknown>>;
    sourceTableRows.get(0)?.set("rowId", "changed-row-id");
    expect(rejection(sourceTableAfter, "post", sourceTableBefore)).toBe(
      BlockRoomLocaleChangeRejectionReason.NonSourceStructure,
    );
    const sourceTableEmpty = new Y.Doc();
    Y.applyUpdate(sourceTableEmpty, Y.encodeStateAsUpdate(sourceTableBefore));
    const emptyRows = (
      (
        (
          sourceTableEmpty
            .getMap("block-document")
            .get("localeOverlay") as Y.Map<Y.Map<unknown>>
        )
          .get(TABLE_ID)
          ?.get("payload") as Y.Map<unknown>
      ).get("content") as Y.Map<unknown>
    ).get("rows") as Y.Array<Y.Map<unknown>>;
    emptyRows.delete(0, emptyRows.length);
    expect(rejection(sourceTableEmpty, "post", sourceTableBefore)).toBe(
      BlockRoomLocaleChangeRejectionReason.NonSourceStructure,
    );
    const sourceTableInvalidCells = new Y.Doc();
    Y.applyUpdate(
      sourceTableInvalidCells,
      Y.encodeStateAsUpdate(sourceTableBefore),
    );
    const invalidCellRows = (
      (
        (
          sourceTableInvalidCells
            .getMap("block-document")
            .get("localeOverlay") as Y.Map<Y.Map<unknown>>
        )
          .get(TABLE_ID)
          ?.get("payload") as Y.Map<unknown>
      ).get("content") as Y.Map<unknown>
    ).get("rows") as Y.Array<Y.Map<unknown>>;
    invalidCellRows.get(0)?.set("cells", "invalid");
    expect(rejection(sourceTableInvalidCells, "post", sourceTableBefore)).toBe(
      BlockRoomLocaleChangeRejectionReason.NonSourceStructure,
    );
    const immersiveAggregate = immersivePageDocument();
    const immersiveBefore = new Y.Doc();
    hydrateExactBlockRoom(
      immersiveBefore,
      "page",
      "ko",
      materializeLocalizedPageDocument(immersiveAggregate, "en"),
      [],
    );
    const immersiveAfter = new Y.Doc();
    Y.applyUpdate(immersiveAfter, Y.encodeStateAsUpdate(immersiveBefore));
    const immersiveLocaleNodes = immersiveAfter
      .getMap("block-document")
      .get("localeOverlay") as Y.Map<Y.Map<unknown>>;
    const immersivePayload = immersiveLocaleNodes
      .get(PAGE_SECTION_ID)
      ?.get("payload") as Y.Map<unknown>;
    const immersiveUnits = immersivePayload.get("units") as Y.Array<
      Y.Map<unknown>
    >;
    immersiveUnits.get(0)?.set("unitId", "changed-unit-id");
    expect(rejection(immersiveAfter, "page", immersiveBefore)).toBe(
      BlockRoomLocaleChangeRejectionReason.NonSourceStructure,
    );

    const sourceBefore = new Y.Doc();
    hydrateCanonicalBlockRoom(sourceBefore, "post", document());
    const sourceAfter = new Y.Doc();
    Y.applyUpdate(sourceAfter, Y.encodeStateAsUpdate(sourceBefore));
    const sourceNodes = sourceAfter
      .getMap("block-document")
      .get("baseNodes") as Y.Map<Y.Map<unknown>>;
    const sourceProps = (
      sourceNodes.get(PARAGRAPH_ID)?.get("payload") as Y.Map<unknown>
    ).get("props") as Y.Map<unknown>;
    sourceProps.set("aspectRatio", "ASPECT_RATIO_X_4_3");
    expect(() =>
      assertBlockRoomLocaleChangeAllowed(sourceBefore, sourceAfter, "post"),
    ).not.toThrow();
    const sourceNull = new Y.Doc();
    Y.applyUpdate(sourceNull, Y.encodeStateAsUpdate(sourceBefore));
    const sourceFileProps = (
      (
        sourceNull.getMap("block-document").get("localeOverlay") as Y.Map<
          Y.Map<unknown>
        >
      )
        .get(FILE_BLOCK_ID)
        ?.get("payload") as Y.Map<unknown>
    ).get("props") as Y.Map<unknown>;
    sourceFileProps.set("alt", null);
    expect(rejection(sourceNull, "post", sourceBefore)).toBe(
      BlockRoomLocaleChangeRejectionReason.NonSourceSharedField,
    );
    const sourceDeleted = new Y.Doc();
    Y.applyUpdate(sourceDeleted, Y.encodeStateAsUpdate(sourceBefore));
    (
      (
        sourceDeleted.getMap("block-document").get("localeOverlay") as Y.Map<
          Y.Map<unknown>
        >
      )
        .get(PARAGRAPH_ID)
        ?.get("payload") as Y.Map<unknown>
    ).delete("content");
    expect(rejection(sourceDeleted, "post", sourceBefore)).toBe(
      BlockRoomLocaleChangeRejectionReason.NonSourceSharedField,
    );
  });

  it("applies one accepted batch as one transaction without losing block identity, order, explicit empty, or File attachment", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "post", document());
    const origin = { kind: "accepted-ai", memberId: "member-1" };
    const transactions: Y.Transaction[] = [];
    room.on("afterTransaction", (transaction) =>
      transactions.push(transaction),
    );

    applyAIDocumentOperationsToBlockRoom(
      room,
      "post",
      [
        create(AIDocumentOperationSchema, {
          operation: {
            case: "insertBlock",
            value: {
              blockHandle: INSERTED_ID,
              kind: "paragraph",
              afterBlockHandle: PARAGRAPH_ID,
            },
          },
        }),
        setEmptyInline(INSERTED_ID),
        create(AIDocumentOperationSchema, {
          operation: {
            case: "setField",
            value: {
              target: fieldTarget(PARAGRAPH_ID, "aspectRatio"),
              value: create(AIDocumentValueSchema, {
                value: { case: "text", value: "16:9" },
              }),
            },
          },
        }),
        create(AIDocumentOperationSchema, {
          operation: {
            case: "moveBlock",
            value: {
              blockHandle: FILE_BLOCK_ID,
              afterBlockHandle: INSERTED_ID,
            },
          },
        }),
        create(AIDocumentOperationSchema, {
          operation: {
            case: "attachFile",
            value: {
              target: fieldTarget(FILE_BLOCK_ID, "attachment"),
              fileHandle: FILE_ID,
            },
          },
        }),
      ],
      { origin },
    );

    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.origin).toBe(origin);
    const snapshot = decodeCanonicalBlockRoom(room, "post");
    expect(
      snapshot.baseNodes
        .sort((left, right) => left.position - right.position)
        .map(({ id }) => id),
    ).toEqual([PARAGRAPH_ID, INSERTED_ID, FILE_BLOCK_ID]);
    expect(snapshot.baseNodes.map(({ id }) => id)).toEqual(
      expect.arrayContaining([PARAGRAPH_ID, INSERTED_ID, FILE_BLOCK_ID]),
    );
    expect(
      snapshot.baseNodes.find(({ id }) => id === PARAGRAPH_ID),
    ).toMatchObject({
      payload: { props: { aspectRatio: "ASPECT_RATIO_X_16_9" } },
    });
    const inserted = snapshot.localeOverlay.find(
      ({ id }) => id === INSERTED_ID,
    );
    expect(inserted).toMatchObject({
      id: INSERTED_ID,
      kind: "paragraph",
      payload: { content: [] },
    });
    const attached = snapshot.baseNodes.find(({ id }) => id === FILE_BLOCK_ID);
    expect(attached).toMatchObject({
      payload: { props: { attachment: { activeFileId: FILE_ID } } },
    });
  });

  it("uses only canonical persisted locale leaves for hidden room presence", () => {
    const source = new Y.Doc();
    hydrateCanonicalBlockRoom(source, "post", document());
    const content = fieldTarget(PARAGRAPH_ID, "content");
    const alt = fieldTarget(FILE_BLOCK_ID, "alt");
    const tableCellContent = nestedFieldTarget(TABLE_ID, "tableContent", [
      { field: "rows" },
      { item: TABLE_ROW_ID },
      { field: "cells" },
      { item: TABLE_CELL_ID },
      { field: "content" },
    ]);
    expect(canonicalBlockRoomLocaleValueTarget(source, content)).toEqual(
      content,
    );
    expect(canonicalBlockRoomLocaleValueTarget(source, alt)).toEqual(alt);
    expect(
      canonicalBlockRoomLocaleValueTargets(source, [alt, content, alt]),
    ).toEqual([content, alt]);

    const table = new Y.Doc();
    hydrateCanonicalBlockRoom(table, "post", tableDocument());
    expect(
      canonicalBlockRoomLocaleValueTarget(table, tableCellContent),
    ).toEqual(tableCellContent);

    const page = new Y.Doc();
    hydrateCanonicalBlockRoom(page, "page", pageDocument());
    const caption = nestedFieldTarget(PAGE_SECTION_ID, "locale-data", [
      { field: "props" },
      { field: "caption" },
    ]);
    expect(canonicalBlockRoomLocaleValueTarget(page, caption)).toEqual(caption);

    const immersive = new Y.Doc();
    hydrateCanonicalBlockRoom(immersive, "page", immersivePageDocument());
    const immersiveTitle = nestedFieldTarget(PAGE_SECTION_ID, "locale-data", [
      { field: "units" },
      { item: IMMERSIVE_UNIT_ID },
      { field: "props" },
      { field: "title" },
    ]);
    expect(
      canonicalBlockRoomLocaleValueTarget(immersive, immersiveTitle),
    ).toEqual(immersiveTitle);

    const invalidTargets = [
      create(AIDocumentFieldTargetSchema, {
        owner: {
          case: "relationItem",
          value: {
            blockHandle: PARAGRAPH_ID,
            relationHandle: "authors",
            itemHandle: FILE_ID,
          },
        },
        fieldHandle: "content",
      }),
      fieldTarget("not-a-uuid", "content"),
      fieldTarget(INSERTED_ID, "content"),
      fieldTarget(PARAGRAPH_ID, "aspectRatio"),
      nestedFieldTarget(PARAGRAPH_ID, "content", [{ field: "text" }]),
      fieldTarget(FILE_BLOCK_ID, "attachment"),
    ];
    for (const target of invalidTargets) {
      expect(() => canonicalBlockRoomLocaleValueTarget(source, target)).toThrow(
        "block_room_invalid:locale_presence:",
      );
    }
    for (const target of [
      fieldTarget(TABLE_ID, "tableContent"),
      nestedFieldTarget(TABLE_ID, "tableContent", [
        { field: "rows" },
        { item: TABLE_ROW_ID },
      ]),
      nestedFieldTarget(TABLE_ID, "tableContent", [
        { field: "rows" },
        { item: INSERTED_ID },
        { field: "cells" },
        { item: TABLE_CELL_ID },
        { field: "content" },
      ]),
      nestedFieldTarget(TABLE_ID, "tableContent", [
        { field: "rows" },
        { item: TABLE_ROW_ID },
        { field: "cells" },
        { item: INSERTED_ID },
        { field: "content" },
      ]),
      fieldTarget(TABLE_ID, "table"),
    ]) {
      expect(() => canonicalBlockRoomLocaleValueTarget(table, target)).toThrow(
        "block_room_invalid:locale_presence:",
      );
    }
    for (const target of [
      fieldTarget(PAGE_SECTION_ID, "locale-data"),
      nestedFieldTarget(PAGE_SECTION_ID, "locale-data", [{ field: "props" }]),
      nestedFieldTarget(PAGE_SECTION_ID, "data", [
        { field: "props" },
        { field: "uri" },
      ]),
    ]) {
      expect(() => canonicalBlockRoomLocaleValueTarget(page, target)).toThrow(
        "block_room_invalid:locale_presence:",
      );
    }
    for (const target of [
      nestedFieldTarget(PAGE_SECTION_ID, "locale-data", [
        { field: "units" },
        { item: IMMERSIVE_UNIT_ID },
        { field: "unitId" },
      ]),
      nestedFieldTarget(PAGE_SECTION_ID, "locale-data", [
        { field: "units" },
        { item: INSERTED_ID },
        { field: "props" },
        { field: "title" },
      ]),
      nestedFieldTarget(PAGE_SECTION_ID, "locale-data", [
        { field: "units" },
        { item: IMMERSIVE_UNIT_ID },
        { field: "props" },
        { field: "mesh" },
      ]),
      nestedFieldTarget(PAGE_SECTION_ID, "locale-data", [
        { field: "units" },
        { item: IMMERSIVE_UNIT_ID },
        { field: "props" },
        { field: "textureFile" },
      ]),
    ]) {
      expect(() =>
        canonicalBlockRoomLocaleValueTarget(immersive, target),
      ).toThrow("block_room_invalid:locale_presence:");
    }

    const malformedTargets = [
      create(AIDocumentFieldTargetSchema, {
        owner: { case: "blockHandle", value: "" },
        fieldHandle: "content",
      }),
      create(AIDocumentFieldTargetSchema, {
        owner: { case: "blockHandle", value: PARAGRAPH_ID },
        fieldHandle: "",
      }),
      create(AIDocumentFieldTargetSchema, {
        owner: { case: "blockHandle", value: PARAGRAPH_ID },
        fieldHandle: "content",
        path: [create(AIDocumentFieldPathSegmentSchema, {})],
      }),
      create(AIDocumentFieldTargetSchema, {
        owner: { case: "blockHandle", value: PARAGRAPH_ID },
        fieldHandle: "content",
        path: [
          create(AIDocumentFieldPathSegmentSchema, {
            selector: { case: "fieldHandle", value: "" },
          }),
        ],
      }),
    ];
    for (const target of malformedTargets)
      expect(() => canonicalBlockRoomLocaleValueTarget(source, target)).toThrow(
        "block_room_invalid:locale_presence:",
      );
    expect(() =>
      canonicalBlockRoomLocaleValueTarget(source, undefined),
    ).toThrow("locale_presence:target:missing");
    expect(() =>
      canonicalBlockRoomLocaleValueTarget(
        source,
        fieldTarget(PARAGRAPH_ID, "tableContent"),
      ),
    ).toThrow("locale_presence:catalog:table");
    expect(
      blockRoomLocaleValueIsEncoded(
        source,
        fieldTarget(PARAGRAPH_ID, "unknown-locale-field"),
      ),
    ).toBe(false);
    expect(() =>
      sparseBlockRoomLocalePayload(source, INSERTED_ID, [content]),
    ).toThrow("locale_presence:sparse:block_missing");
    expect(() =>
      sparseBlockRoomLocalePayload(source, FILE_BLOCK_ID, [content]),
    ).toThrow("locale_presence:sparse:block_owner");

    const pageAggregate = pageDocument();
    pageAggregate.localeOverlays.push(
      fromJson(PageLocaleOverlaySchema, {
        locale: "en",
        sections: [
          {
            sectionId: PAGE_SECTION_ID,
            externalVideo: { props: { caption: "" } },
          },
        ],
      }),
    );
    const pageCaption = nestedFieldTarget(PAGE_SECTION_ID, "locale-data", [
      { field: "props" },
      { field: "caption" },
    ]);
    const pageTargetRoom = new Y.Doc();
    hydrateExactBlockRoom(
      pageTargetRoom,
      "page",
      "ko",
      materializeLocalizedPageDocument(pageAggregate, "en"),
      [pageCaption],
    );
    const pageLocaleNode = (
      pageTargetRoom.getMap("block-document").get("localeOverlay") as Y.Map<
        Y.Map<unknown>
      >
    ).get(PAGE_SECTION_ID)!;
    const pageLocaleProps = (
      pageLocaleNode.get("payload") as Y.Map<unknown>
    ).get("props") as Y.Map<unknown>;
    pageLocaleProps.delete("caption");
    expect(blockRoomLocaleValueIsEncoded(pageTargetRoom, pageCaption)).toBe(
      false,
    );
    observeBlockRoomChanges(pageTargetRoom, () => {})();

    const shader = new Y.Doc();
    hydrateCanonicalBlockRoom(shader, "post", shaderDocument());
    expect(() =>
      canonicalBlockRoomLocaleValueTarget(
        shader,
        fieldTarget(SHADER_ID, "stages"),
      ),
    ).toThrow("locale_presence:catalog:composite_terminal");

    const invalidFamily = new Y.Doc();
    Y.applyUpdate(invalidFamily, Y.encodeStateAsUpdate(source));
    const invalidFamilyNode = (
      invalidFamily.getMap("block-document").get("baseNodes") as Y.Map<
        Y.Map<unknown>
      >
    ).get(PARAGRAPH_ID)!;
    invalidFamilyNode.set("family", "invalid");
    expect(() =>
      canonicalBlockRoomLocaleValueTarget(invalidFamily, content),
    ).toThrow("locale_presence:target:block_family");
    invalidFamilyNode.set("family", "page_section");
    expect(() =>
      canonicalBlockRoomLocaleValueTarget(invalidFamily, content),
    ).toThrow("locale_presence:target:block_family");
    invalidFamilyNode.delete("kind");
    expect(() =>
      canonicalBlockRoomLocaleValueTarget(invalidFamily, content),
    ).toThrow("locale_presence:target:block_kind");
    invalidFamilyNode.set("family", "rich_text");
    invalidFamilyNode.set("kind", "unknown");
    expect(() =>
      canonicalBlockRoomLocaleValueTarget(invalidFamily, content),
    ).toThrow("locale_presence:catalog:block_kind");

    const invalidPageKind = new Y.Doc();
    hydrateCanonicalBlockRoom(invalidPageKind, "page", pageDocument());
    (
      invalidPageKind.getMap("block-document").get("baseNodes") as Y.Map<
        Y.Map<unknown>
      >
    )
      .get(PAGE_SECTION_ID)!
      .set("kind", "unknown");
    expect(() =>
      canonicalBlockRoomLocaleValueTarget(
        invalidPageKind,
        nestedFieldTarget(PAGE_SECTION_ID, "locale-data", [
          { field: "props" },
          { field: "caption" },
        ]),
      ),
    ).toThrow("locale_presence:page:kind");

    for (const invalidContent of ["invalid", { rows: "invalid" }]) {
      const invalidTable = new Y.Doc();
      Y.applyUpdate(invalidTable, Y.encodeStateAsUpdate(table));
      const baseTablePayload = (
        invalidTable.getMap("block-document").get("baseNodes") as Y.Map<
          Y.Map<unknown>
        >
      )
        .get(TABLE_ID)!
        .get("payload") as Y.Map<unknown>;
      if (typeof invalidContent === "string") {
        baseTablePayload.set("content", invalidContent);
      } else {
        const invalidContentMap = new Y.Map<unknown>();
        invalidContentMap.set("rows", "invalid");
        baseTablePayload.set("content", invalidContentMap);
      }
      expect(() =>
        canonicalBlockRoomLocaleValueTarget(
          invalidTable,
          nestedFieldTarget(TABLE_ID, "tableContent", [
            { field: "rows" },
            { item: TABLE_ROW_ID },
            { field: "cells" },
            { item: TABLE_CELL_ID },
            { field: "content" },
          ]),
        ),
      ).toThrow("locale_presence:table:");
    }

    const missingLocale = new Y.Doc();
    Y.applyUpdate(missingLocale, Y.encodeStateAsUpdate(source));
    (
      missingLocale
        .getMap("block-document")
        .get("localeOverlay") as Y.Map<unknown>
    ).delete(PARAGRAPH_ID);
    expect(() => observeBlockRoomChanges(missingLocale, () => {})).toThrow(
      "locale_presence:target:locale_missing",
    );

    const targetAggregate = document();
    targetAggregate.localeOverlays.push(
      fromJson(RichTextLocaleOverlaySchema, {
        locale: "en",
        blocks: [
          {
            blockId: PARAGRAPH_ID,
            paragraph: { props: {}, content: [] },
          },
          { blockId: FILE_BLOCK_ID, file: { props: {} } },
        ],
      }),
    );
    const targetRoom = new Y.Doc();
    hydrateExactBlockRoom(
      targetRoom,
      "post",
      "ko",
      materializeLocalizedRichTextDocument(targetAggregate, "en"),
      [],
    );
    expect(blockRoomPresentLocaleValues(targetRoom)).toEqual([]);
    expect(() =>
      hydrateExactBlockRoom(
        new Y.Doc(),
        "post",
        "ko",
        materializeLocalizedRichTextDocument(targetAggregate, "en"),
        [content, content],
      ),
    ).toThrow("locale_presence:order_or_duplicate");
    expect(() =>
      hydrateExactBlockRoom(
        new Y.Doc(),
        "post",
        "ko",
        materializeLocalizedRichTextDocument(targetAggregate, "en"),
        [alt, content],
      ),
    ).toThrow("locale_presence:order_or_duplicate");
    const origins: unknown[] = [];
    const changes: Parameters<
      typeof decodeCanonicalBlockRoomAffectedNodes
    >[2][] = [];
    const stopChanges = observeBlockRoomChanges(targetRoom, ({ changeSet }) =>
      changes.push(changeSet),
    );
    targetRoom.on("afterTransaction", (transaction) => {
      if (transaction.origin !== "canonical-bootstrap")
        origins.push(transaction.origin);
    });
    const origin = {};
    applyExactAIDocumentOperations(
      targetRoom,
      "post",
      [setEmptyInline(PARAGRAPH_ID)],
      {
        expectedRoomLocale: "en",
        origin,
      },
    );
    stopChanges();
    expect(origins).toEqual([origin]);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.affectedLocaleValueTargets).toEqual([content]);
    expect(
      decodeCanonicalBlockRoomAffectedNodes(targetRoom, "post", changes[0]!)
        .localeNodes,
    ).toEqual([
      expect.objectContaining({
        id: PARAGRAPH_ID,
        payload: { content: [] },
      }),
    ]);
    expect(blockRoomPresentLocaleValues(targetRoom)).toEqual([content]);
    expect(
      canonicalBlockRoomLocaleValueTargetKey(targetRoom, content),
    ).toContain(PARAGRAPH_ID);

    markBlockRoomLocaleValuePresent(targetRoom, alt);
    expect(blockRoomPresentLocaleValues(targetRoom)).toEqual([content, alt]);
    const removed = new Y.Doc();
    Y.applyUpdate(removed, Y.encodeStateAsUpdate(targetRoom));
    (
      removed.getMap("block-document").get("localePresence") as Y.Map<unknown>
    ).delete(canonicalBlockRoomLocaleValueTargetKey(removed, content));
    try {
      assertBlockRoomLocaleChangeAllowed(targetRoom, removed, "post");
      throw new Error("expected presence removal rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(BlockRoomLocaleChangeError);
      expect((error as BlockRoomLocaleChangeError).reason).toBe(
        BlockRoomLocaleChangeRejectionReason.NonSourceSharedField,
      );
    }

    const sourcePresenceRemoved = new Y.Doc();
    Y.applyUpdate(sourcePresenceRemoved, Y.encodeStateAsUpdate(source));
    (
      sourcePresenceRemoved
        .getMap("block-document")
        .get("localePresence") as Y.Map<unknown>
    ).delete(
      canonicalBlockRoomLocaleValueTargetKey(sourcePresenceRemoved, content),
    );
    expect(() =>
      assertBlockRoomLocaleChangeAllowed(source, sourcePresenceRemoved, "post"),
    ).toThrow("locale_room:locale_presence_removed");

    const missingPresenceMap = new Y.Doc();
    Y.applyUpdate(missingPresenceMap, Y.encodeStateAsUpdate(source));
    missingPresenceMap.getMap("block-document").delete("localePresence");
    expect(() => blockRoomPresentLocaleValues(missingPresenceMap)).toThrow(
      "locale_presence:map",
    );

    for (const [key, value] of [
      ["{", true],
      ["[]", true],
      [JSON.stringify([1, "content", []]), true],
      [JSON.stringify([PARAGRAPH_ID, "content", [["field"]]]), true],
      [canonicalBlockRoomLocaleValueTargetKey(source, content), false],
    ] as const) {
      const malformed = new Y.Doc();
      hydrateExactBlockRoom(
        malformed,
        "post",
        "ko",
        materializeLocalizedRichTextDocument(targetAggregate, "en"),
        [],
      );
      (
        malformed
          .getMap("block-document")
          .get("localePresence") as Y.Map<unknown>
      ).set(key, value);
      expect(() => blockRoomPresentLocaleValues(malformed)).toThrow(
        "locale_presence:",
      );
    }

    const unmarkedBefore = new Y.Doc();
    hydrateExactBlockRoom(
      unmarkedBefore,
      "post",
      "ko",
      materializeLocalizedRichTextDocument(targetAggregate, "en"),
      [],
    );
    const unmarkedAfter = new Y.Doc();
    Y.applyUpdate(unmarkedAfter, Y.encodeStateAsUpdate(unmarkedBefore));
    replaceBlockRoomPayloadArray(
      unmarkedAfter,
      {
        family: "rich_text",
        id: PARAGRAPH_ID,
        locale: true,
        path: "content",
      },
      [{ text: { text: "unmarked" } }],
    );
    expect(() =>
      assertBlockRoomLocaleChangeAllowed(unmarkedBefore, unmarkedAfter, "post"),
    ).toThrow("target_room:unmarked_locale_value_change");

    const presentEmpty = new Y.Doc();
    hydrateExactBlockRoom(
      presentEmpty,
      "post",
      "ko",
      materializeLocalizedRichTextDocument(targetAggregate, "en"),
      [content],
    );
    let stopPresent: (() => void) | undefined;
    expect(() => {
      stopPresent = observeBlockRoomChanges(presentEmpty, () => {});
    }).not.toThrow();
    stopPresent?.();

    const encodedBefore = new Y.Doc();
    hydrateExactBlockRoom(encodedBefore, "post", "ko", targetDocument(), [alt]);
    const encodedAfter = new Y.Doc();
    Y.applyUpdate(encodedAfter, Y.encodeStateAsUpdate(encodedBefore));
    const encodedFilePayload = (
      (
        encodedAfter.getMap("block-document").get("localeOverlay") as Y.Map<
          Y.Map<unknown>
        >
      )
        .get(FILE_BLOCK_ID)!
        .get("payload") as Y.Map<unknown>
    ).get("props") as Y.Map<unknown>;
    encodedFilePayload.delete("alt");
    expect(() =>
      assertBlockRoomLocaleChangeAllowed(encodedBefore, encodedAfter, "post"),
    ).toThrow("target_room:locale_value_removed");

    const unmarkedSource = new Y.Doc();
    Y.applyUpdate(unmarkedSource, Y.encodeStateAsUpdate(source));
    insertRichTextBlockNode(
      unmarkedSource,
      fromJson(RichTextBlockNodeSchema, {
        block: { id: INSERTED_ID, paragraph: { props: {} } },
        placement: { index: 2 },
      }),
    );
    insertRichTextBlockLocale(
      unmarkedSource,
      fromJson(RichTextBlockLocaleSchema, {
        blockId: INSERTED_ID,
        paragraph: { props: {}, content: [] },
      }),
    );
    const insertedContent = fieldTarget(INSERTED_ID, "content");
    (
      unmarkedSource
        .getMap("block-document")
        .get("localePresence") as Y.Map<unknown>
    ).delete(
      canonicalBlockRoomLocaleValueTargetKey(unmarkedSource, insertedContent),
    );
    expect(() =>
      assertBlockRoomLocaleChangeAllowed(source, unmarkedSource, "post"),
    ).toThrow("locale_room:unmarked_locale_value_change");
  });

  it("rejects a sparse resident projection before applying an explicit empty value", () => {
    const sparse = document();
    sparse.localeOverlays[0]!.blocks = sparse.localeOverlays[0]!.blocks.filter(
      ({ blockId }) => blockId !== PARAGRAPH_ID,
    );
    const room = new Y.Doc();
    expect(() => hydrateCanonicalBlockRoom(room, "post", sparse)).toThrow(
      `locale:${PARAGRAPH_ID}:missing`,
    );
  });

  it("persists all present sibling leaves while reporting only the changed target", () => {
    const aggregate = document();
    aggregate.localeOverlays.push(
      fromJson(RichTextLocaleOverlaySchema, {
        locale: "en",
        blocks: [
          {
            blockId: PARAGRAPH_ID,
            paragraph: { props: {}, content: [] },
          },
          {
            blockId: FILE_BLOCK_ID,
            file: { props: { alt: "old alt", caption: "keep caption" } },
          },
        ],
      }),
    );
    const alt = fieldTarget(FILE_BLOCK_ID, "alt");
    const caption = fieldTarget(FILE_BLOCK_ID, "caption");
    const room = new Y.Doc();
    hydrateExactBlockRoom(
      room,
      "post",
      "ko",
      materializeLocalizedRichTextDocument(aggregate, "en"),
      [alt, caption],
    );
    const changes: Parameters<
      typeof decodeCanonicalBlockRoomAffectedNodes
    >[2][] = [];
    const stop = observeBlockRoomChanges(room, ({ changeSet }) =>
      changes.push(changeSet),
    );

    expect(
      applyExactAIDocumentOperations(
        room,
        "post",
        [setTextField(FILE_BLOCK_ID, "alt", "new alt")],
        { expectedRoomLocale: "en", origin: {} },
      ),
    ).toBe(true);
    stop();

    expect(changes).toHaveLength(1);
    expect(changes[0]?.affectedLocaleValueTargets).toEqual([alt]);
    expect(
      decodeCanonicalBlockRoomAffectedNodes(room, "post", changes[0]!)
        .localeNodes,
    ).toEqual([
      expect.objectContaining({
        id: FILE_BLOCK_ID,
        payload: {
          props: { alt: "new alt", caption: "keep caption" },
        },
      }),
    ]);
  });

  it("applies exact table-cell locale targets in source and target rooms", () => {
    const target = nestedFieldTarget(TABLE_ID, "tableContent", [
      { field: "rows" },
      { item: TABLE_ROW_ID },
      { field: "cells" },
      { item: TABLE_CELL_ID },
      { field: "content" },
    ]);
    const source = new Y.Doc();
    hydrateCanonicalBlockRoom(source, "post", tableDocument());
    const sourceChanges: Parameters<
      typeof decodeCanonicalBlockRoomAffectedNodes
    >[2][] = [];
    const stopSource = observeBlockRoomChanges(source, ({ changeSet }) =>
      sourceChanges.push(changeSet),
    );
    expect(
      applyExactAIDocumentOperations(
        source,
        "post",
        [setInlineField(target, "source changed")],
        { expectedRoomLocale: "ko", origin: {} },
      ),
    ).toBe(true);
    stopSource();
    expect(
      decodeCanonicalBlockRoomAffectedNodes(source, "post", sourceChanges[0]!)
        .localeNodes[0]?.payload,
    ).toMatchObject({
      content: {
        rows: [
          {
            rowId: TABLE_ROW_ID,
            cells: [{ cellId: TABLE_CELL_ID }],
          },
        ],
      },
    });

    const aggregate = tableDocument();
    aggregate.localeOverlays.push(
      fromJson(RichTextLocaleOverlaySchema, {
        locale: "en",
        blocks: [
          {
            blockId: TABLE_ID,
            table: {
              props: {},
              content: {
                rows: [
                  {
                    rowId: TABLE_ROW_ID,
                    cells: [
                      {
                        cellId: TABLE_CELL_ID,
                        content: [{ text: { text: "cell" } }],
                      },
                    ],
                  },
                ],
              },
            },
          },
        ],
      }),
    );
    const targetRoom = new Y.Doc();
    hydrateExactBlockRoom(
      targetRoom,
      "post",
      "ko",
      materializeLocalizedRichTextDocument(aggregate, "en"),
      [],
    );
    expect(
      applyExactAIDocumentOperations(
        targetRoom,
        "post",
        [setInlineField(target, "target changed")],
        { expectedRoomLocale: "en", origin: {} },
      ),
    ).toBe(true);
    expect(blockRoomPresentLocaleValues(targetRoom)).toEqual([target]);
  });

  it("observes Page and immersive locale leaves through canonical presence", () => {
    const page = new Y.Doc();
    hydrateCanonicalBlockRoom(page, "page", pageDocument());
    const pageChanges: Parameters<
      typeof decodeCanonicalBlockRoomAffectedNodes
    >[2][] = [];
    const stopPage = observeBlockRoomChanges(page, ({ changeSet }) =>
      pageChanges.push(changeSet),
    );
    replaceBlockRoomCollaborativeText(
      page,
      {
        family: "page_section",
        id: PAGE_SECTION_ID,
        locale: true,
        path: "props.caption",
      },
      "changed caption",
    );
    stopPage();
    expect(
      decodeCanonicalBlockRoomAffectedNodes(page, "page", pageChanges[0]!)
        .localeNodes[0]?.payload,
    ).toEqual({ props: { caption: "changed caption" } });

    const immersive = new Y.Doc();
    hydrateCanonicalBlockRoom(immersive, "page", immersivePageDocument());
    const immersiveChanges: Parameters<
      typeof decodeCanonicalBlockRoomAffectedNodes
    >[2][] = [];
    const stopImmersive = observeBlockRoomChanges(immersive, ({ changeSet }) =>
      immersiveChanges.push(changeSet),
    );
    replaceBlockRoomCollaborativeText(
      immersive,
      {
        family: "page_section",
        id: PAGE_SECTION_ID,
        locale: true,
        path: "units[0].props.title",
      },
      "changed title",
    );
    stopImmersive();
    expect(
      decodeCanonicalBlockRoomAffectedNodes(
        immersive,
        "page",
        immersiveChanges[0]!,
      ).localeNodes[0]?.payload,
    ).toEqual({
      units: [
        {
          unitId: IMMERSIVE_UNIT_ID,
          props: { text: "", title: "changed title" },
        },
      ],
    });
  });

  it("allows only locale-owned RichText changes in a target room and verifies the exact locale", () => {
    const room = new Y.Doc();
    hydrateExactBlockRoom(room, "post", "ko", targetDocument(), []);
    const acceptedOrigin = { kind: "accepted-ai-target" };

    applyExactAIDocumentOperations(
      room,
      "post",
      [setEmptyInline(PARAGRAPH_ID)],
      { expectedRoomLocale: "en", origin: acceptedOrigin },
    );
    expect(
      decodeCanonicalBlockRoom(room, "post").localeOverlay.find(
        ({ id }) => id === PARAGRAPH_ID,
      ),
    ).toMatchObject({ payload: { content: [] } });

    let transactions = 0;
    room.on("afterTransaction", () => {
      transactions += 1;
    });
    expect(() =>
      applyExactAIDocumentOperations(
        room,
        "post",
        [
          create(AIDocumentOperationSchema, {
            operation: {
              case: "setField",
              value: {
                target: fieldTarget(PARAGRAPH_ID, "aspectRatio"),
                value: create(AIDocumentValueSchema, {
                  value: { case: "text", value: "4:3" },
                }),
              },
            },
          }),
        ],
        { expectedRoomLocale: "en", origin: {} },
      ),
    ).toThrow("block_room_invalid:target_room:shared_graph_changed");
    for (const [operation, detail] of [
      [
        create(AIDocumentOperationSchema, {
          operation: {
            case: "attachFile",
            value: {
              target: fieldTarget(FILE_BLOCK_ID, "attachment"),
              fileHandle: FILE_ID,
            },
          },
        }),
        "shared_graph_changed",
      ],
      [
        create(AIDocumentOperationSchema, {
          operation: {
            case: "insertBlock",
            value: { blockHandle: INSERTED_ID, kind: "paragraph" },
          },
        }),
        "shared_graph_changed",
      ],
    ] as const) {
      expect(() =>
        applyExactAIDocumentOperations(room, "post", [operation], {
          expectedRoomLocale: "en",
          origin: {},
        }),
      ).toThrow(`block_room_invalid:target_room:${detail}`);
    }
    expect(() =>
      applyExactAIDocumentOperations(
        room,
        "post",
        [setEmptyInline(PARAGRAPH_ID)],
        { expectedRoomLocale: "ko", origin: {} },
      ),
    ).toThrow("block_room_invalid:ai_operation:room_locale");
    expect(() =>
      applyExactAIDocumentOperations(
        room,
        "post",
        [setEmptyInline(PARAGRAPH_ID)],
        { expectedRoomLocale: "en", origin: null as never },
      ),
    ).toThrow("block_room_invalid:ai_operation:origin");
    expect(() =>
      applyExactAIDocumentOperations(
        room,
        "post",
        [
          create(AIDocumentOperationSchema, {
            operation: {
              case: "unsetField",
              value: { target: fieldTarget(PARAGRAPH_ID, "content") },
            },
          }),
        ],
        { expectedRoomLocale: "en", origin: {} },
      ),
    ).toThrow("block_room_invalid:ai_operation:locale_clear");
    expect(transactions).toBe(0);
  });

  it("fails closed before touching the resident document when a later operation is invalid", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "post", document());
    const before = toBinary(
      LocalizedRichTextDocumentSchema,
      decodeCanonicalBlockRoom(room, "post")
        .document as LocalizedRichTextDocument,
    );
    let transactionCount = 0;
    room.on("afterTransaction", () => {
      transactionCount += 1;
    });

    expect(() =>
      applyAIDocumentOperationsToBlockRoom(room, "post", [
        setEmptyInline(PARAGRAPH_ID),
        create(AIDocumentOperationSchema, {
          operation: {
            case: "setField",
            value: {
              target: fieldTarget(PARAGRAPH_ID, "not-in-catalog"),
              value: create(AIDocumentValueSchema, {
                value: { case: "text", value: "bad" },
              }),
            },
          },
        }),
      ]),
    ).toThrow("block_room_invalid:ai_operation:field:not-in-catalog");

    expect(transactionCount).toBe(0);
    expect(
      toBinary(
        LocalizedRichTextDocumentSchema,
        decodeCanonicalBlockRoom(room, "post")
          .document as LocalizedRichTextDocument,
      ),
    ).toEqual(before);
  });

  it("rejects missing and relation operations instead of partially interpreting them", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "post", document());

    expect(() =>
      applyAIDocumentOperationsToBlockRoom(room, "post", [
        create(AIDocumentOperationSchema),
      ]),
    ).toThrow("block_room_invalid:ai_operation:missing_kind");
    expect(() =>
      applyAIDocumentOperationsToBlockRoom(room, "post", [
        create(AIDocumentOperationSchema, {
          operation: {
            case: "insertRelationItem",
            value: {
              blockHandle: PARAGRAPH_ID,
              relationHandle: "unsupported",
              itemHandle: "item-1",
              itemKind: "unsupported",
            },
          },
        }),
      ]),
    ).toThrow("block_room_invalid:ai_operation:unsupported:insertRelationItem");
    expect(() =>
      applyAIDocumentOperationsToBlockRoom(room, "post", [
        create(AIDocumentOperationSchema, {
          operation: { case: "createTranslation", value: {} },
        }),
      ]),
    ).toThrow("block_room_invalid:ai_operation:unsupported:createTranslation");
  });

  it("handles every RichText structural and File operation and rejects malformed variants atomically", () => {
    const operation = (typed: {
      case: AIDocumentOperation["operation"]["case"];
      value: unknown;
    }): AIDocumentOperation =>
      create(AIDocumentOperationSchema, {
        operation: typed as AIDocumentOperation["operation"],
      });
    const fresh = () => {
      const room = new Y.Doc();
      hydrateCanonicalBlockRoom(room, "post", document());
      return room;
    };

    const replaced = fresh();
    applyAIDocumentOperationsToBlockRoom(replaced, "post", [
      operation({
        case: "replaceBlockKind",
        value: { blockHandle: PARAGRAPH_ID, kind: "heading" },
      }),
    ]);
    expect(decodeCanonicalBlockRoom(replaced, "post").baseNodes[0]?.kind).toBe(
      "heading",
    );

    const detached = new Y.Doc();
    hydrateCanonicalBlockRoom(detached, "post", shaderDocument());
    const detachedKind = nestedFieldTarget(SHADER_ID, "stages", [
      { item: "bufferA" },
      { field: "channels" },
      { item: "channel-a" },
      { field: "kind" },
    ]);
    const detachedFile = nestedFieldTarget(SHADER_ID, "stages", [
      { item: "bufferA" },
      { field: "channels" },
      { item: "channel-a" },
      { field: "file" },
    ]);
    applyAIDocumentOperationsToBlockRoom(detached, "post", [
      operation({
        case: "setField",
        value: {
          target: detachedKind,
          value: create(AIDocumentValueSchema, {
            value: { case: "text", value: "textureFile" },
          }),
        },
      }),
      operation({
        case: "attachFile",
        value: { target: detachedFile, fileHandle: FILE_ID },
      }),
    ]);
    applyAIDocumentOperationsToBlockRoom(detached, "post", [
      operation({
        case: "setField",
        value: {
          target: detachedKind,
          value: create(AIDocumentValueSchema, {
            value: { case: "text", value: "none" },
          }),
        },
      }),
      operation({ case: "detachFile", value: { target: detachedFile } }),
    ]);
    expect(
      (
        decodeCanonicalBlockRoom(detached, "post").baseNodes[0]?.payload as {
          props: { stages: Array<{ channels: Array<{ file?: unknown }> }> };
        }
      ).props.stages[2]?.channels[0],
    ).not.toHaveProperty("file");

    const moved = fresh();
    applyAIDocumentOperationsToBlockRoom(moved, "post", [
      operation({
        case: "moveBlock",
        value: { blockHandle: FILE_BLOCK_ID },
      }),
    ]);
    expect(
      decodeCanonicalBlockRoom(moved, "post")
        .baseNodes.sort((left, right) => left.position - right.position)
        .map(({ id }) => id),
    ).toEqual([FILE_BLOCK_ID, PARAGRAPH_ID]);

    const deleted = fresh();
    applyAIDocumentOperationsToBlockRoom(deleted, "post", [
      operation({
        case: "deleteBlock",
        value: { blockHandle: PARAGRAPH_ID },
      }),
    ]);
    expect(decodeCanonicalBlockRoom(deleted, "post").baseNodes).toHaveLength(1);

    const noOp = new Y.Doc();
    hydrateCanonicalBlockRoom(noOp, "post", document());
    let noOpTransactions = 0;
    noOp.on("afterTransaction", () => {
      noOpTransactions += 1;
    });
    expect(() =>
      applyAIDocumentOperationsToBlockRoom(noOp, "post", [
        operation({
          case: "unsetField",
          value: { target: fieldTarget(PARAGRAPH_ID, "content") },
        }),
      ]),
    ).toThrow("block_room_invalid:ai_operation:locale_clear");
    expect(noOpTransactions).toBe(0);
    expect(() =>
      applyAIDocumentOperationsToBlockRoom(fresh(), "post", [
        operation({
          case: "unsetField",
          value: { target: fieldTarget(FILE_BLOCK_ID, "alt") },
        }),
      ]),
    ).toThrow("block_room_invalid:ai_operation:locale_clear");

    const empty = fresh();
    let emptyTransactions = 0;
    empty.on("afterTransaction", () => {
      emptyTransactions += 1;
    });
    applyAIDocumentOperationsToBlockRoom(empty, "post", []);
    expect(emptyTransactions).toBe(0);

    const invalidCalls: Array<[AIDocumentOperation[], string]> = [
      [
        [operation({ case: "insertBlock", value: { kind: "paragraph" } })],
        "insert:block",
      ],
      [
        [
          operation({
            case: "insertBlock",
            value: { blockHandle: INSERTED_ID },
          }),
        ],
        "insert:kind",
      ],
      [
        [
          operation({
            case: "insertBlock",
            value: { blockHandle: INSERTED_ID, kind: "unknown" },
          }),
        ],
        "block_kind:unknown",
      ],
      [
        [
          operation({
            case: "insertBlock",
            value: {
              blockHandle: INSERTED_ID,
              kind: "paragraph",
              afterBlockHandle: "missing",
            },
          }),
        ],
        "after_block:missing:not_sibling",
      ],
      [[operation({ case: "moveBlock", value: {} })], "move:block"],
      [
        [operation({ case: "moveBlock", value: { blockHandle: "missing" } })],
        "move:block:missing",
      ],
      [
        [
          operation({
            case: "moveBlock",
            value: { blockHandle: FILE_BLOCK_ID, afterBlockHandle: "missing" },
          }),
        ],
        "after_block:missing:not_sibling",
      ],
      [[operation({ case: "replaceBlockKind", value: {} })], "replace:block"],
      [
        [
          operation({
            case: "replaceBlockKind",
            value: { blockHandle: "missing", kind: "heading" },
          }),
        ],
        "replace:block:missing",
      ],
      [
        [
          operation({
            case: "replaceBlockKind",
            value: { blockHandle: PARAGRAPH_ID, kind: "unknown" },
          }),
        ],
        "replace:kind:unknown",
      ],
      [[operation({ case: "deleteBlock", value: {} })], "delete:block"],
      [
        [
          operation({
            case: "attachFile",
            value: { target: fieldTarget(FILE_BLOCK_ID, "attachment") },
          }),
        ],
        "file:handle",
      ],
      [
        [
          operation({
            case: "attachFile",
            value: {
              target: fieldTarget(PARAGRAPH_ID, "content"),
              fileHandle: FILE_ID,
            },
          }),
        ],
        "file:field",
      ],
      [
        [
          operation({
            case: "detachFile",
            value: { target: fieldTarget(PARAGRAPH_ID, "content") },
          }),
        ],
        "file:field",
      ],
      [
        [operation({ case: "deleteRelationItem", value: {} })],
        "unsupported:deleteRelationItem",
      ],
      [
        [operation({ case: "moveRelationItem", value: {} })],
        "unsupported:moveRelationItem",
      ],
      [
        [operation({ case: "deleteTranslation", value: {} })],
        "unsupported:deleteTranslation",
      ],
      [
        [
          operation({
            case: "setField",
            value: {
              target: fieldTarget(FILE_BLOCK_ID, "content"),
              value: create(AIDocumentValueSchema, {
                value: { case: "text", value: "invalid" },
              }),
            },
          }),
        ],
        "field:content",
      ],
      [
        [
          operation({
            case: "setField",
            value: {
              target: fieldTarget("missing", "content"),
              value: create(AIDocumentValueSchema, {
                value: { case: "text", value: "invalid" },
              }),
            },
          }),
        ],
        "block:missing:missing",
      ],
      [
        [
          operation({
            case: "unsetField",
            value: { target: fieldTarget(PARAGRAPH_ID, "aspectRatio") },
          }),
        ],
        "field_path:missing",
      ],
    ];
    for (const [operations, reason] of invalidCalls) {
      expect(() =>
        applyAIDocumentOperationsToBlockRoom(fresh(), "post", operations),
      ).toThrow(`block_room_invalid:ai_operation:${reason}`);
    }
    expect(() =>
      applyExactAIDocumentOperations(fresh(), "work", [], {
        expectedRoomLocale: "ko",
        origin: {},
      }),
    ).toThrow("block_room_invalid:ai_operation:document_type");
    expect(() =>
      applyExactAIDocumentOperations(fresh(), "post", [], {
        expectedRoomLocale: "",
        origin: {},
      }),
    ).toThrow("block_room_invalid:ai_operation:room_locale");
    for (const origin of [undefined, "origin", () => undefined]) {
      expect(() =>
        applyExactAIDocumentOperations(fresh(), "post", [], {
          expectedRoomLocale: "ko",
          origin: origin as never,
        }),
      ).toThrow("block_room_invalid:ai_operation:origin");
    }

    const sharedTable = new Y.Doc();
    hydrateCanonicalBlockRoom(sharedTable, "post", tableDocument());
    for (const invalidValue of [
      create(AIDocumentValueSchema, {
        value: { case: "text", value: "invalid" },
      }),
      objectValue({}),
    ]) {
      const invalidTable = new Y.Doc();
      hydrateCanonicalBlockRoom(invalidTable, "post", tableDocument());
      expect(() =>
        applyAIDocumentOperationsToBlockRoom(invalidTable, "post", [
          operation({
            case: "setField",
            value: {
              target: fieldTarget(TABLE_ID, "table"),
              value: invalidValue,
            },
          }),
        ]),
      ).toThrow("block_room_invalid:ai_operation:table:");
    }
    const secondRowId = INSERTED_ID;
    const secondCellId = FILE_ID;
    const tableValue = tableSharedValue([
      [TABLE_ROW_ID, tableRowValue(TABLE_ROW_ID, TABLE_CELL_ID)],
      [secondRowId, tableRowValue(secondRowId, secondCellId)],
    ]);
    applyAIDocumentOperationsToBlockRoom(sharedTable, "post", [
      operation({
        case: "setField",
        value: { target: fieldTarget(TABLE_ID, "table"), value: tableValue },
      }),
    ]);
    const tableSnapshot = decodeCanonicalBlockRoom(sharedTable, "post");
    expect(
      (
        tableSnapshot.localeOverlay[0]?.payload as {
          content: { rows: Array<{ cells: Array<{ content: unknown[] }> }> };
        }
      ).content.rows,
    ).toEqual([
      {
        rowId: TABLE_ROW_ID,
        cells: [
          { cellId: TABLE_CELL_ID, content: [{ text: { text: "cell" } }] },
        ],
      },
      {
        rowId: secondRowId,
        cells: [{ cellId: secondCellId, content: [] }],
      },
    ]);
    applyAIDocumentOperationsToBlockRoom(sharedTable, "post", [
      operation({
        case: "setField",
        value: {
          target: fieldTarget(TABLE_ID, "table"),
          value: tableSharedValue([
            [secondRowId, tableRowValue(secondRowId, secondCellId)],
          ]),
        },
      }),
    ]);
    expect(
      (
        decodeCanonicalBlockRoom(sharedTable, "post").localeOverlay[0]
          ?.payload as { content: { rows: unknown[] } }
      ).content.rows,
    ).toEqual([
      {
        rowId: secondRowId,
        cells: [{ cellId: secondCellId, content: [] }],
      },
    ]);
    expect(() =>
      applyAIDocumentOperationsToBlockRoom(sharedTable, "post", [
        operation({
          case: "unsetField",
          value: { target: fieldTarget(TABLE_ID, "table") },
        }),
      ]),
    ).toThrow("block_room_invalid:locale_room:invalid_projection");
    const localeTable = new Y.Doc();
    hydrateCanonicalBlockRoom(localeTable, "post", tableDocument());
    expect(() =>
      applyAIDocumentOperationsToBlockRoom(localeTable, "post", [
        operation({
          case: "unsetField",
          value: { target: fieldTarget(TABLE_ID, "tableContent") },
        }),
      ]),
    ).toThrow("block_room_invalid:ai_operation:locale_clear");
    const tableDefaultRoom = new Y.Doc();
    hydrateCanonicalBlockRoom(tableDefaultRoom, "post", tableDocument());
    const cellContent = nestedFieldTarget(TABLE_ID, "tableContent", [
      { field: "rows" },
      { item: TABLE_ROW_ID },
      { field: "cells" },
      { item: TABLE_CELL_ID },
      { field: "content" },
    ]);
    unsetAIDocumentField(tableDefaultRoom, cellContent);
    expect(blockRoomLocaleValue(tableDefaultRoom, cellContent)).toEqual([]);
    for (const structural of [
      operation({
        case: "insertBlock",
        value: {
          blockHandle: INSERTED_ID,
          kind: "paragraph",
          parentBlockHandle: PARAGRAPH_ID,
        },
      }),
      operation({
        case: "moveBlock",
        value: { blockHandle: FILE_BLOCK_ID, parentBlockHandle: PARAGRAPH_ID },
      }),
    ]) {
      applyAIDocumentOperationsToBlockRoom(fresh(), "post", [structural]);
    }
  });

  it("resolves shader stage and channel handles from generated identities for nested set, attach, and unset", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "post", shaderDocument());
    const stageSource = nestedFieldTarget(SHADER_ID, "stages", [
      { item: "bufferA" },
      { field: "source" },
    ]);
    const channelKind = nestedFieldTarget(SHADER_ID, "stages", [
      { item: "bufferA" },
      { field: "channels" },
      { item: "channel-a" },
      { field: "kind" },
    ]);
    const channelFile = nestedFieldTarget(SHADER_ID, "stages", [
      { item: "bufferA" },
      { field: "channels" },
      { item: "channel-a" },
      { field: "file" },
    ]);

    applyAIDocumentOperationsToBlockRoom(room, "post", [
      create(AIDocumentOperationSchema, {
        operation: {
          case: "setField",
          value: {
            target: stageSource,
            value: create(AIDocumentValueSchema, {
              value: { case: "text", value: "void main() {}" },
            }),
          },
        },
      }),
      create(AIDocumentOperationSchema, {
        operation: {
          case: "setField",
          value: {
            target: channelKind,
            value: create(AIDocumentValueSchema, {
              value: { case: "text", value: "textureFile" },
            }),
          },
        },
      }),
      create(AIDocumentOperationSchema, {
        operation: {
          case: "attachFile",
          value: { target: channelFile, fileHandle: FILE_ID },
        },
      }),
    ]);

    const shader = decodeCanonicalBlockRoom(room, "post").baseNodes[0]!;
    const appliedStages = (
      shader.payload as {
        props: {
          stages: Array<{
            kind: string;
            source?: string;
            channels: Array<{ kind: string; file?: unknown }>;
          }>;
        };
      }
    ).props.stages;
    const bufferA = appliedStages.find(({ kind }) => kind === "KIND_BUFFER_A");
    expect(bufferA?.source).toBe("void main() {}");
    expect(bufferA?.channels[0]).toMatchObject({
      kind: "KIND_TEXTURE_FILE",
      file: { activeFileId: FILE_ID },
    });

    applyAIDocumentOperationsToBlockRoom(room, "post", [
      create(AIDocumentOperationSchema, {
        operation: { case: "unsetField", value: { target: channelFile } },
      }),
    ]);
    const updated = decodeCanonicalBlockRoom(room, "post").baseNodes[0]!;
    const stages = (updated.payload as { props: { stages: unknown[] } }).props
      .stages as Array<{
      kind: string;
      channels: Array<{ file?: unknown }>;
    }>;
    expect(
      stages.find(({ kind }) => kind === "KIND_BUFFER_A")?.channels[0],
    ).not.toHaveProperty("file");
  });

  it("updates native Y.Text, Y.Array, Y.Map, missing nested maps, and array-item parents losslessly", () => {
    const shaderRoom = new Y.Doc();
    hydrateCanonicalBlockRoom(shaderRoom, "post", shaderDocument());
    const shaderNodes = shaderRoom
      .getMap("block-document")
      .get("baseNodes") as Y.Map<Y.Map<unknown>>;
    const shaderPayload = shaderNodes
      .get(SHADER_ID)
      ?.get("payload") as Y.Map<unknown>;
    const shaderProps = shaderPayload.get("props") as Y.Map<unknown>;
    const stages = shaderProps.get("stages") as Y.Array<Y.Map<unknown>>;
    const bufferA = stages.get(2)!;
    const source = new Y.Text("old");
    bufferA.set("source", source);
    const sourceTarget = nestedFieldTarget(SHADER_ID, "stages", [
      { item: "bufferA" },
      { field: "source" },
    ]);
    setAIDocumentField(
      shaderRoom,
      sourceTarget,
      create(AIDocumentValueSchema, {
        value: { case: "text", value: "new" },
      }),
    );
    expect(source.toString()).toBe("new");
    setAIDocumentField(
      shaderRoom,
      sourceTarget,
      create(AIDocumentValueSchema, { value: { case: "text", value: "" } }),
    );
    expect(source.toString()).toBe("");
    setAIDocumentField(
      shaderRoom,
      sourceTarget,
      create(AIDocumentValueSchema, {
        value: { case: "text", value: "restored" },
      }),
    );
    expect(source.toString()).toBe("restored");
    const replaceTextRoom = new Y.Doc();
    hydrateCanonicalBlockRoom(replaceTextRoom, "post", shaderDocument());
    setAIDocumentField(
      replaceTextRoom,
      sourceTarget,
      create(AIDocumentValueSchema, {
        value: { case: "number", value: "1" },
      }),
    );

    const samplerVFlip = nestedFieldTarget(SHADER_ID, "stages", [
      { item: "bufferA" },
      { field: "channels" },
      { item: "channel-a" },
      { field: "sampler" },
      { field: "vflip" },
    ]);
    setAIDocumentField(
      shaderRoom,
      samplerVFlip,
      create(AIDocumentValueSchema, {
        value: { case: "boolean", value: true },
      }),
    );

    const paragraphRoom = new Y.Doc();
    hydrateCanonicalBlockRoom(paragraphRoom, "post", document());
    const localeNodes = paragraphRoom
      .getMap("block-document")
      .get("localeOverlay") as Y.Map<Y.Map<unknown>>;
    const paragraphPayload = localeNodes
      .get(PARAGRAPH_ID)
      ?.get("payload") as Y.Map<unknown>;
    const content = new Y.Array<unknown>();
    paragraphPayload.set("content", content);
    setAIDocumentField(
      paragraphRoom,
      fieldTarget(PARAGRAPH_ID, "content"),
      create(AIDocumentValueSchema, {
        value: {
          case: "inline",
          value: create(AIDocumentInlineContentSchema, {
            items: [
              create(AIDocumentInlineItemSchema, {
                item: { case: "text", value: "text" },
              }),
            ],
          }),
        },
      }),
    );
    expect(content.length).toBe(1);
    setAIDocumentField(
      paragraphRoom,
      fieldTarget(PARAGRAPH_ID, "content"),
      create(AIDocumentValueSchema, {
        value: {
          case: "inline",
          value: create(AIDocumentInlineContentSchema),
        },
      }),
    );
    expect(content.length).toBe(0);

    const fileNodes = paragraphRoom
      .getMap("block-document")
      .get("baseNodes") as Y.Map<Y.Map<unknown>>;
    const fileProps = (
      fileNodes.get(FILE_BLOCK_ID)?.get("payload") as Y.Map<unknown>
    ).get("props") as Y.Map<unknown>;
    const attachment = new Y.Map<unknown>();
    attachment.set("activeFileId", OLD_FILE_ID);
    fileProps.set("attachment", attachment);
    attachAIDocumentFile(
      paragraphRoom,
      fieldTarget(FILE_BLOCK_ID, "attachment"),
      FILE_ID,
    );
    expect(attachment.get("activeFileId")).toBe(FILE_ID);

    setAIDocumentField(
      shaderRoom,
      nestedFieldTarget(SHADER_ID, "stages", [{ item: "bufferA" }]),
      create(AIDocumentValueSchema, {
        value: {
          case: "object",
          value: create(AIDocumentObjectValueSchema, {
            fields: [
              create(AIDocumentFieldValueSchema, {
                fieldHandle: "kind",
                value: create(AIDocumentValueSchema, {
                  value: { case: "text", value: "bufferA" },
                }),
              }),
              create(AIDocumentFieldValueSchema, {
                fieldHandle: "source",
                value: create(AIDocumentValueSchema, {
                  value: { case: "text", value: "source" },
                }),
              }),
            ],
          }),
        },
      }),
    );
    const replaceArrayRoom = new Y.Doc();
    hydrateCanonicalBlockRoom(replaceArrayRoom, "post", shaderDocument());
    setAIDocumentField(
      replaceArrayRoom,
      nestedFieldTarget(SHADER_ID, "stages", [{ item: "bufferA" }]),
      create(AIDocumentValueSchema, {
        value: { case: "text", value: "replace-array-item" },
      }),
    );
    const deleteArrayRoom = new Y.Doc();
    hydrateCanonicalBlockRoom(deleteArrayRoom, "post", shaderDocument());
    unsetAIDocumentField(
      deleteArrayRoom,
      nestedFieldTarget(SHADER_ID, "stages", [{ item: "bufferA" }]),
    );
  });

  it("applies Page fields, sections, columns, and nested RichText through the same atomic DCDP boundary", () => {
    const operation = (typed: {
      case: AIDocumentOperation["operation"]["case"];
      value: unknown;
    }): AIDocumentOperation =>
      create(AIDocumentOperationSchema, {
        operation: typed as AIDocumentOperation["operation"],
      });
    const fieldRoom = new Y.Doc();
    hydrateCanonicalBlockRoom(fieldRoom, "page", pageDocument());
    applyAIDocumentOperationsToBlockRoom(fieldRoom, "page", [
      operation({
        case: "setField",
        value: {
          target: nestedFieldTarget(PAGE_SECTION_ID, "data", [
            { field: "props" },
            { field: "uri" },
          ]),
          value: create(AIDocumentValueSchema, {
            value: { case: "text", value: "https://example.com/updated" },
          }),
        },
      }),
      operation({
        case: "setField",
        value: {
          target: nestedFieldTarget(PAGE_SECTION_ID, "locale-data", [
            { field: "props" },
            { field: "caption" },
          ]),
          value: create(AIDocumentValueSchema, {
            value: { case: "text", value: "updated caption" },
          }),
        },
      }),
    ]);
    let snapshot = decodeCanonicalBlockRoom(fieldRoom, "page");
    expect(snapshot.baseNodes[0]?.payload).toMatchObject({
      props: { uri: "https://example.com/updated" },
    });
    expect(snapshot.localeOverlay[0]?.payload).toMatchObject({
      props: { caption: "updated caption" },
    });

    applyAIDocumentOperationsToBlockRoom(fieldRoom, "page", [
      operation({
        case: "replaceBlockKind",
        value: { blockHandle: PAGE_SECTION_ID, kind: "columns" },
      }),
      operation({
        case: "insertBlock",
        value: {
          blockHandle: PAGE_COLUMN_A_ID,
          kind: "page-column",
          parentBlockHandle: PAGE_SECTION_ID,
        },
      }),
      operation({
        case: "insertBlock",
        value: {
          blockHandle: PAGE_COLUMN_B_ID,
          kind: "page-column",
          parentBlockHandle: PAGE_SECTION_ID,
          afterBlockHandle: PAGE_COLUMN_A_ID,
        },
      }),
      operation({
        case: "setField",
        value: {
          target: fieldTarget(PAGE_COLUMN_A_ID, "ratio"),
          value: create(AIDocumentValueSchema, {
            value: { case: "number", value: "2" },
          }),
        },
      }),
    ]);
    snapshot = decodeCanonicalBlockRoom(fieldRoom, "page");
    expect(snapshot.baseNodes[0]).toMatchObject({
      kind: "columns",
      payload: {
        props: {
          columns: [
            { id: PAGE_COLUMN_A_ID, ratio: 2 },
            { id: PAGE_COLUMN_B_ID, ratio: 1 },
          ],
        },
      },
    });

    applyAIDocumentOperationsToBlockRoom(fieldRoom, "page", [
      operation({
        case: "moveBlock",
        value: {
          blockHandle: PAGE_COLUMN_B_ID,
          parentBlockHandle: PAGE_SECTION_ID,
        },
      }),
    ]);
    snapshot = decodeCanonicalBlockRoom(fieldRoom, "page");
    expect(
      (
        snapshot.baseNodes[0]?.payload as {
          props: { columns: Array<{ id: string }> };
        }
      ).props.columns.map(({ id }) => id),
    ).toEqual([PAGE_COLUMN_B_ID, PAGE_COLUMN_A_ID]);

    applyAIDocumentOperationsToBlockRoom(fieldRoom, "page", [
      operation({
        case: "deleteBlock",
        value: { blockHandle: PAGE_COLUMN_B_ID },
      }),
      operation({
        case: "deleteBlock",
        value: { blockHandle: PAGE_COLUMN_A_ID },
      }),
      operation({
        case: "replaceBlockKind",
        value: { blockHandle: PAGE_SECTION_ID, kind: "rich-text" },
      }),
      operation({
        case: "insertBlock",
        value: {
          blockHandle: PAGE_PARAGRAPH_ID,
          kind: "paragraph",
          parentBlockHandle: PAGE_SECTION_ID,
        },
      }),
      operation({
        case: "insertBlock",
        value: {
          blockHandle: PAGE_CODE_ID,
          kind: "code-block",
          parentBlockHandle: PAGE_SECTION_ID,
          afterBlockHandle: PAGE_PARAGRAPH_ID,
        },
      }),
      setInlineField(
        fieldTarget(PAGE_PARAGRAPH_ID, "content"),
        "nested Page text",
      ),
    ]);
    snapshot = decodeCanonicalBlockRoom(fieldRoom, "page");
    expect(
      snapshot.baseNodes.find(({ id }) => id === PAGE_SECTION_ID)?.kind,
    ).toBe("richText");
    expect(
      snapshot.baseNodes.find(({ id }) => id === PAGE_PARAGRAPH_ID),
    ).toMatchObject({
      family: "rich_text",
      kind: "paragraph",
      parentId: PAGE_SECTION_ID,
    });
    expect(
      snapshot.localeOverlay.find(({ id }) => id === PAGE_PARAGRAPH_ID)
        ?.payload,
    ).toMatchObject({
      content: [{ text: { text: "nested Page text" } }],
    });
    unsetAIDocumentField(fieldRoom, fieldTarget(PAGE_CODE_ID, "content"));
    expect(
      blockRoomLocaleValue(fieldRoom, fieldTarget(PAGE_CODE_ID, "content")),
    ).toBe("");
  });

  it("keeps resident Page scalar, topology, replacement, and empty-content rules atomic", () => {
    const operation = (typed: {
      case: AIDocumentOperation["operation"]["case"];
      value: unknown;
    }): AIDocumentOperation =>
      create(AIDocumentOperationSchema, {
        operation: typed as AIDocumentOperation["operation"],
      });
    const text = (value: string) =>
      create(AIDocumentValueSchema, {
        value: { case: "text", value },
      });
    const set = (
      target: ReturnType<typeof fieldTarget>,
      value: AIDocumentValue,
    ) => operation({ case: "setField", value: { target, value } });

    const enumRoom = new Y.Doc();
    hydrateCanonicalBlockRoom(enumRoom, "page", pageDocument());
    applyAIDocumentOperationsToBlockRoom(enumRoom, "page", [
      set(
        nestedFieldTarget(PAGE_SECTION_ID, "data", [
          { field: "props" },
          { field: "aspectRatio" },
        ]),
        text("16:9"),
      ),
    ]);
    expect(
      decodeCanonicalBlockRoom(enumRoom, "page").baseNodes[0]?.payload,
    ).toMatchObject({
      props: { aspectRatio: "ASPECT_RATIO_X_16_9" },
    });

    const replacementRoom = new Y.Doc();
    hydrateCanonicalBlockRoom(replacementRoom, "page", pageDocument());
    applyAIDocumentOperationsToBlockRoom(replacementRoom, "page", [
      set(
        nestedFieldTarget(PAGE_SECTION_ID, "data", [{ field: "props" }]),
        objectValue({ uri: text("https://example.com/replacement") }),
      ),
    ]);
    expect(
      decodeCanonicalBlockRoom(replacementRoom, "page").baseNodes[0]?.payload,
    ).toEqual({
      settings: {},
      props: { uri: "https://example.com/replacement" },
    });

    const beforeAtomic = decodeCanonicalBlockRoom(replacementRoom, "page");
    expect(() =>
      applyAIDocumentOperationsToBlockRoom(replacementRoom, "page", [
        set(
          nestedFieldTarget(PAGE_SECTION_ID, "data", [
            { field: "props" },
            { field: "uri" },
          ]),
          text("https://example.com/rolled-back"),
        ),
        set(
          nestedFieldTarget(PAGE_SECTION_ID, "data", [
            { field: "props" },
            { field: "columns" },
          ]),
          listValue([]),
        ),
      ]),
    ).toThrow("field:columns");
    expect(decodeCanonicalBlockRoom(replacementRoom, "page")).toEqual(
      beforeAtomic,
    );

    const immersive = immersivePageDocument();
    const immersiveRoom = new Y.Doc();
    hydrateCanonicalBlockRoom(immersiveRoom, "page", immersive);
    applyAIDocumentOperationsToBlockRoom(immersiveRoom, "page", [
      set(
        nestedFieldTarget(PAGE_SECTION_ID, "data", [{ field: "units" }]),
        listValue([
          [
            SECOND_IMMERSIVE_UNIT_ID,
            objectValue({
              id: text(SECOND_IMMERSIVE_UNIT_ID),
              props: objectValue({ name: text("new") }),
            }),
          ],
          [
            IMMERSIVE_UNIT_ID,
            objectValue({
              id: text(IMMERSIVE_UNIT_ID),
              props: objectValue({ name: text("existing") }),
            }),
          ],
        ]),
      ),
    ]);
    const immersiveSnapshot = decodeCanonicalBlockRoom(immersiveRoom, "page");
    expect(
      (
        immersiveSnapshot.localeOverlay[0]?.payload as {
          units: Array<{ unitId: string; props: { title?: string } }>;
        }
      ).units,
    ).toEqual([
      { unitId: SECOND_IMMERSIVE_UNIT_ID, props: {} },
      { unitId: IMMERSIVE_UNIT_ID, props: { title: "kept" } },
    ]);

    const targetAggregate = immersivePageDocument();
    const targetTitle = nestedFieldTarget(PAGE_SECTION_ID, "locale-data", [
      { field: "units" },
      { item: IMMERSIVE_UNIT_ID },
      { field: "props" },
      { field: "title" },
    ]);
    const targetRoom = new Y.Doc();
    hydrateExactBlockRoom(
      targetRoom,
      "page",
      "ko",
      materializeLocalizedPageDocument(targetAggregate, "en"),
      [targetTitle],
    );
    applyAIDocumentOperationsToBlockRoom(
      targetRoom,
      "page",
      [set(targetTitle, text("translated"))],
      { expectedRoomLocale: "en" },
    );
    expect(
      (
        decodeCanonicalBlockRoom(targetRoom, "page").localeOverlay[0]
          ?.payload as {
          units: Array<{ props: { title: string } }>;
        }
      ).units[0]?.props.title,
    ).toBe("translated");
    const targetBeforeInvalid = decodeCanonicalBlockRoom(targetRoom, "page");
    expect(() =>
      applyAIDocumentOperationsToBlockRoom(
        targetRoom,
        "page",
        [
          set(
            nestedFieldTarget(PAGE_SECTION_ID, "locale-data", [
              { field: "units" },
            ]),
            listValue([]),
          ),
        ],
        { expectedRoomLocale: "en" },
      ),
    ).toThrow("target_locale_scalar_required");
    expect(() =>
      applyAIDocumentOperationsToBlockRoom(
        targetRoom,
        "page",
        [
          set(
            nestedFieldTarget(PAGE_SECTION_ID, "locale-data", [
              { field: "props" },
            ]),
            objectValue({}),
          ),
        ],
        { expectedRoomLocale: "en" },
      ),
    ).toThrow("target_locale_scalar_required");
    expect(decodeCanonicalBlockRoom(targetRoom, "page")).toEqual(
      targetBeforeInvalid,
    );

    const columnsRoom = new Y.Doc();
    hydrateCanonicalBlockRoom(columnsRoom, "page", pageDocument());
    applyAIDocumentOperationsToBlockRoom(columnsRoom, "page", [
      operation({
        case: "replaceBlockKind",
        value: { blockHandle: PAGE_SECTION_ID, kind: "columns" },
      }),
      operation({
        case: "insertBlock",
        value: {
          blockHandle: PAGE_COLUMN_A_ID,
          kind: "page-column",
          parentBlockHandle: PAGE_SECTION_ID,
        },
      }),
      operation({
        case: "insertBlock",
        value: {
          blockHandle: PAGE_COLUMN_B_ID,
          kind: "page-column",
          parentBlockHandle: PAGE_SECTION_ID,
          afterBlockHandle: PAGE_COLUMN_A_ID,
        },
      }),
    ]);
    expect(() =>
      applyAIDocumentOperationsToBlockRoom(columnsRoom, "page", [
        set(
          nestedFieldTarget(PAGE_SECTION_ID, "data", [
            { field: "props" },
            { field: "columns" },
          ]),
          listValue([]),
        ),
      ]),
    ).toThrow("field:columns");
    expect(() =>
      applyAIDocumentOperationsToBlockRoom(columnsRoom, "page", [
        operation({
          case: "replaceBlockKind",
          value: { blockHandle: PAGE_SECTION_ID, kind: "external-video" },
        }),
      ]),
    ).toThrow("not_empty");

    const nestedRoom = new Y.Doc();
    hydrateCanonicalBlockRoom(nestedRoom, "page", pageDocument());
    applyAIDocumentOperationsToBlockRoom(nestedRoom, "page", [
      operation({
        case: "replaceBlockKind",
        value: { blockHandle: PAGE_SECTION_ID, kind: "rich-text" },
      }),
      operation({
        case: "insertBlock",
        value: {
          blockHandle: PAGE_PARAGRAPH_ID,
          kind: "paragraph",
          parentBlockHandle: PAGE_SECTION_ID,
        },
      }),
    ]);
    expect(
      blockRoomLocaleValueIsEncoded(
        nestedRoom,
        fieldTarget(PAGE_PARAGRAPH_ID, "content"),
      ),
    ).toBe(true);
    expect(
      decodeCanonicalBlockRoom(nestedRoom, "page").localeOverlay.find(
        ({ id }) => id === PAGE_PARAGRAPH_ID,
      )?.payload,
    ).toEqual({ content: [] });
    expect(() =>
      applyAIDocumentOperationsToBlockRoom(nestedRoom, "page", [
        operation({
          case: "replaceBlockKind",
          value: { blockHandle: PAGE_SECTION_ID, kind: "external-video" },
        }),
      ]),
    ).toThrow("not_empty");
  });

  it("inserts, nests, moves, and deletes Page sections by column-aware placement", () => {
    const operation = (typed: {
      case: AIDocumentOperation["operation"]["case"];
      value: unknown;
    }): AIDocumentOperation =>
      create(AIDocumentOperationSchema, {
        operation: typed as AIDocumentOperation["operation"],
      });
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "page", pageDocument());

    const inserted = [
      operation({
        case: "insertBlock",
        value: {
          blockHandle: PAGE_SECTION_A_ID,
          kind: "columns",
          afterBlockHandle: PAGE_SECTION_ID,
        },
      }),
      operation({
        case: "insertBlock",
        value: {
          blockHandle: PAGE_COLUMN_A_ID,
          kind: "page-column",
          parentBlockHandle: PAGE_SECTION_A_ID,
        },
      }),
      operation({
        case: "insertBlock",
        value: {
          blockHandle: PAGE_COLUMN_B_ID,
          kind: "page-column",
          parentBlockHandle: PAGE_SECTION_A_ID,
          afterBlockHandle: PAGE_COLUMN_A_ID,
        },
      }),
      operation({
        case: "insertBlock",
        value: {
          blockHandle: PAGE_COLUMN_C_ID,
          kind: "page-column",
          parentBlockHandle: PAGE_SECTION_A_ID,
          afterBlockHandle: PAGE_COLUMN_B_ID,
        },
      }),
      operation({
        case: "insertBlock",
        value: {
          blockHandle: PAGE_SECTION_B_ID,
          kind: "rich-text",
          parentBlockHandle: PAGE_COLUMN_A_ID,
        },
      }),
      operation({
        case: "insertBlock",
        value: {
          blockHandle: PAGE_SECTION_C_ID,
          kind: "rich-text",
          parentBlockHandle: PAGE_COLUMN_A_ID,
          afterBlockHandle: PAGE_SECTION_B_ID,
        },
      }),
      operation({
        case: "insertBlock",
        value: {
          blockHandle: PAGE_SECTION_D_ID,
          kind: "rich-text",
          parentBlockHandle: PAGE_COLUMN_A_ID,
          afterBlockHandle: PAGE_SECTION_C_ID,
        },
      }),
    ];
    applyAIDocumentOperationsToBlockRoom(room, "page", inserted);

    let snapshot = decodeCanonicalBlockRoom(room, "page");
    expect(
      snapshot.baseNodes
        .filter(({ parentId }) => parentId === PAGE_SECTION_A_ID)
        .sort((left, right) => left.position - right.position)
        .map(({ id, columnId }) => ({ id, columnId })),
    ).toEqual([
      { id: PAGE_SECTION_B_ID, columnId: PAGE_COLUMN_A_ID },
      { id: PAGE_SECTION_C_ID, columnId: PAGE_COLUMN_A_ID },
      { id: PAGE_SECTION_D_ID, columnId: PAGE_COLUMN_A_ID },
    ]);

    applyAIDocumentOperationsToBlockRoom(room, "page", [
      operation({
        case: "moveBlock",
        value: {
          blockHandle: PAGE_SECTION_C_ID,
          parentBlockHandle: PAGE_COLUMN_A_ID,
        },
      }),
      operation({
        case: "moveBlock",
        value: {
          blockHandle: PAGE_SECTION_ID,
          afterBlockHandle: PAGE_SECTION_A_ID,
        },
      }),
    ]);
    snapshot = decodeCanonicalBlockRoom(room, "page");
    expect(
      snapshot.baseNodes
        .filter(({ parentId }) => parentId === PAGE_SECTION_A_ID)
        .sort((left, right) => left.position - right.position)
        .map(({ id }) => id),
    ).toEqual([PAGE_SECTION_C_ID, PAGE_SECTION_B_ID, PAGE_SECTION_D_ID]);
    expect(
      snapshot.baseNodes
        .filter(({ parentId }) => parentId === null)
        .sort((left, right) => left.position - right.position)
        .map(({ id }) => id),
    ).toEqual([PAGE_SECTION_A_ID, PAGE_SECTION_ID]);

    expect(() =>
      applyAIDocumentOperationsToBlockRoom(room, "page", [
        operation({
          case: "deleteBlock",
          value: { blockHandle: PAGE_COLUMN_A_ID },
        }),
      ]),
    ).toThrow(`page_column:${PAGE_COLUMN_A_ID}:not_empty`);

    applyAIDocumentOperationsToBlockRoom(room, "page", [
      operation({
        case: "deleteBlock",
        value: { blockHandle: PAGE_SECTION_C_ID },
      }),
      operation({
        case: "deleteBlock",
        value: { blockHandle: PAGE_SECTION_D_ID },
      }),
      operation({
        case: "deleteBlock",
        value: { blockHandle: PAGE_SECTION_B_ID },
      }),
      operation({
        case: "deleteBlock",
        value: { blockHandle: PAGE_COLUMN_A_ID },
      }),
    ]);
    snapshot = decodeCanonicalBlockRoom(room, "page");
    expect(
      snapshot.baseNodes.some(
        ({ id }) =>
          id === PAGE_SECTION_B_ID ||
          id === PAGE_SECTION_C_ID ||
          id === PAGE_SECTION_D_ID ||
          id === PAGE_COLUMN_A_ID,
      ),
    ).toBe(false);
  });

  it("fails closed for malformed Page section and column topology mutations", () => {
    const operation = (typed: {
      case: AIDocumentOperation["operation"]["case"];
      value: unknown;
    }): AIDocumentOperation =>
      create(AIDocumentOperationSchema, {
        operation: typed as AIDocumentOperation["operation"],
      });
    const insert = (
      blockHandle: string,
      kind: string,
      parentBlockHandle?: string,
      afterBlockHandle?: string,
    ) =>
      operation({
        case: "insertBlock",
        value: {
          blockHandle,
          kind,
          parentBlockHandle,
          afterBlockHandle,
        },
      });
    const columnsRoom = (): Y.Doc => {
      const room = new Y.Doc();
      hydrateCanonicalBlockRoom(room, "page", pageDocument());
      applyAIDocumentOperationsToBlockRoom(room, "page", [
        operation({
          case: "replaceBlockKind",
          value: { blockHandle: PAGE_SECTION_ID, kind: "columns" },
        }),
        insert(PAGE_COLUMN_A_ID, "page-column", PAGE_SECTION_ID),
        insert(
          PAGE_COLUMN_B_ID,
          "page-column",
          PAGE_SECTION_ID,
          PAGE_COLUMN_A_ID,
        ),
      ]);
      return room;
    };
    const expectRejected = (
      room: Y.Doc,
      candidate: AIDocumentOperation,
      message: string,
    ) => {
      const before = decodeCanonicalBlockRoom(room, "page");
      expect(() =>
        applyAIDocumentOperationsToBlockRoom(room, "page", [candidate]),
      ).toThrow(message);
      expect(decodeCanonicalBlockRoom(room, "page")).toEqual(before);
    };

    const noParent = new Y.Doc();
    hydrateCanonicalBlockRoom(noParent, "page", pageDocument());
    expectRejected(
      noParent,
      insert(PAGE_COLUMN_A_ID, "page-column"),
      "page_column:parent",
    );
    expectRejected(
      noParent,
      insert(PAGE_COLUMN_A_ID, "page-column", PAGE_SECTION_ID),
      `page_column:parent:${PAGE_SECTION_ID}`,
    );
    expectRejected(
      noParent,
      insert(PAGE_SECTION_A_ID, "external-video", PAGE_SECTION_ID),
      `page_parent:${PAGE_SECTION_ID}:not_column`,
    );
    expectRejected(
      noParent,
      insert(PAGE_SECTION_A_ID, "external-video", undefined, PAGE_SECTION_B_ID),
      `after_block:${PAGE_SECTION_B_ID}:not_sibling`,
    );

    const duplicateNode = columnsRoom();
    expectRejected(
      duplicateNode,
      insert(PAGE_SECTION_ID, "page-column", PAGE_SECTION_ID),
      `page_column:${PAGE_SECTION_ID}:exists`,
    );
    expectRejected(
      duplicateNode,
      insert(PAGE_COLUMN_A_ID, "page-column", PAGE_SECTION_ID),
      `page_column:${PAGE_COLUMN_A_ID}:exists`,
    );
    expectRejected(
      duplicateNode,
      insert(PAGE_COLUMN_A_ID, "external-video"),
      `page_section:${PAGE_COLUMN_A_ID}:column_exists`,
    );
    expectRejected(
      duplicateNode,
      insert(
        PAGE_COLUMN_C_ID,
        "page-column",
        PAGE_SECTION_ID,
        PAGE_SECTION_B_ID,
      ),
      `after_block:${PAGE_SECTION_B_ID}:not_sibling`,
    );

    const columnMutation = columnsRoom();
    const text = create(AIDocumentValueSchema, {
      value: { case: "text", value: "invalid" },
    });
    const number = create(AIDocumentValueSchema, {
      value: { case: "number", value: "2" },
    });
    expectRejected(
      columnMutation,
      operation({
        case: "setField",
        value: {
          target: fieldTarget(PAGE_COLUMN_A_ID, "width"),
          value: number,
        },
      }),
      "page_column:ratio",
    );
    expectRejected(
      columnMutation,
      operation({
        case: "setField",
        value: {
          target: nestedFieldTarget(PAGE_COLUMN_A_ID, "ratio", [
            { field: "nested" },
          ]),
          value: number,
        },
      }),
      "page_column:ratio",
    );
    expectRejected(
      columnMutation,
      operation({
        case: "setField",
        value: { target: fieldTarget(PAGE_COLUMN_A_ID, "ratio"), value: text },
      }),
      "page_column:ratio",
    );
    expectRejected(
      columnMutation,
      operation({
        case: "moveBlock",
        value: {
          blockHandle: PAGE_COLUMN_A_ID,
          parentBlockHandle: PAGE_SECTION_A_ID,
        },
      }),
      `page_column:${PAGE_COLUMN_A_ID}:parent`,
    );
    expectRejected(
      columnMutation,
      operation({
        case: "moveBlock",
        value: {
          blockHandle: PAGE_COLUMN_A_ID,
          parentBlockHandle: PAGE_SECTION_ID,
          afterBlockHandle: PAGE_COLUMN_C_ID,
        },
      }),
      `after_block:${PAGE_COLUMN_C_ID}:not_sibling`,
    );
    expectRejected(
      columnMutation,
      operation({
        case: "unsetField",
        value: { target: fieldTarget(PAGE_COLUMN_A_ID, "ratio") },
      }),
      "page_column:ratio_required",
    );
    expectRejected(
      columnMutation,
      operation({
        case: "replaceBlockKind",
        value: { blockHandle: PAGE_COLUMN_A_ID, kind: "image" },
      }),
      "page_column:replace_kind",
    );
    expectRejected(
      columnMutation,
      operation({
        case: "attachFile",
        value: {
          target: fieldTarget(PAGE_COLUMN_A_ID, "attachment"),
          fileHandle: FILE_ID,
        },
      }),
      "page_column:file",
    );
    expectRejected(
      columnMutation,
      operation({
        case: "detachFile",
        value: { target: fieldTarget(PAGE_COLUMN_A_ID, "attachment") },
      }),
      "page_column:file",
    );

    const invalidKind = new Y.Doc();
    hydrateCanonicalBlockRoom(invalidKind, "page", pageDocument());
    expectRejected(
      invalidKind,
      operation({
        case: "replaceBlockKind",
        value: { blockHandle: PAGE_SECTION_ID, kind: "not-a-page-section" },
      }),
      "page_section:kind:not-a-page-section",
    );

    const malformedColumns = columnsRoom();
    const payload = (
      malformedColumns.getMap("block-document").get("baseNodes") as Y.Map<
        Y.Map<unknown>
      >
    )
      .get(PAGE_SECTION_ID)!
      .get("payload") as Y.Map<unknown>;
    (payload.get("props") as Y.Map<unknown>).set("columns", "invalid");
    expect(() =>
      applyAIDocumentOperationsToBlockRoom(malformedColumns, "page", [
        operation({
          case: "deleteBlock",
          value: { blockHandle: PAGE_COLUMN_A_ID },
        }),
      ]),
    ).toThrow(`page_columns:${PAGE_SECTION_ID}:shape`);

    const missingColumns = columnsRoom();
    const missingColumnsPayload = (
      missingColumns.getMap("block-document").get("baseNodes") as Y.Map<
        Y.Map<unknown>
      >
    )
      .get(PAGE_SECTION_ID)!
      .get("payload") as Y.Map<unknown>;
    (missingColumnsPayload.get("props") as Y.Map<unknown>).delete("columns");
    expect(
      applyPageStructureAIDocumentOperation(
        missingColumns,
        insert(PAGE_COLUMN_C_ID, "page-column", PAGE_SECTION_ID),
      ),
    ).toBe(true);

    const missingInsertID = columnsRoom();
    const missingInsertColumns = (
      (
        (
          missingInsertID.getMap("block-document").get("baseNodes") as Y.Map<
            Y.Map<unknown>
          >
        )
          .get(PAGE_SECTION_ID)!
          .get("payload") as Y.Map<unknown>
      ).get("props") as Y.Map<unknown>
    ).get("columns") as Y.Array<Y.Map<unknown>>;
    missingInsertColumns.get(0)?.delete("id");
    expect(
      applyPageStructureAIDocumentOperation(
        missingInsertID,
        insert(PAGE_COLUMN_C_ID, "page-column", PAGE_SECTION_ID),
      ),
    ).toBe(true);

    const missingMoveID = columnsRoom();
    const missingMoveColumns = (
      (
        (
          missingMoveID.getMap("block-document").get("baseNodes") as Y.Map<
            Y.Map<unknown>
          >
        )
          .get(PAGE_SECTION_ID)!
          .get("payload") as Y.Map<unknown>
      ).get("props") as Y.Map<unknown>
    ).get("columns") as Y.Array<Y.Map<unknown>>;
    missingMoveColumns.get(0)?.delete("id");
    expect(
      applyPageStructureAIDocumentOperation(
        missingMoveID,
        operation({
          case: "moveBlock",
          value: {
            blockHandle: PAGE_COLUMN_B_ID,
            parentBlockHandle: PAGE_SECTION_ID,
          },
        }),
      ),
    ).toBe(true);
  });

  it("applies Page settings and source locale aggregates while rejecting invalid Page field ownership", () => {
    const operation = (typed: {
      case: AIDocumentOperation["operation"]["case"];
      value: unknown;
    }): AIDocumentOperation =>
      create(AIDocumentOperationSchema, {
        operation: typed as AIDocumentOperation["operation"],
      });
    const text = (value: string) =>
      create(AIDocumentValueSchema, { value: { case: "text", value } });
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "page", pageDocument());
    applyAIDocumentOperationsToBlockRoom(room, "page", [
      operation({
        case: "setField",
        value: {
          target: nestedFieldTarget(PAGE_SECTION_ID, "settings", [
            { field: "backgroundColor" },
          ]),
          value: text("#112233"),
        },
      }),
      operation({
        case: "setField",
        value: {
          target: nestedFieldTarget(PAGE_SECTION_ID, "locale-data", [
            { field: "props" },
          ]),
          value: objectValue({ caption: text("whole replacement") }),
        },
      }),
    ]);
    const snapshot = decodeCanonicalBlockRoom(room, "page");
    expect(snapshot.baseNodes[0]?.payload).toMatchObject({
      settings: { backgroundColor: "#112233" },
    });
    expect(snapshot.localeOverlay[0]?.payload).toMatchObject({
      props: { caption: "whole replacement" },
    });

    expect(() =>
      applyAIDocumentOperationsToBlockRoom(room, "page", [
        operation({
          case: "setField",
          value: {
            target: fieldTarget(PAGE_SECTION_ID, "content"),
            value: text("invalid"),
          },
        }),
      ]),
    ).toThrow("field:content");

    const invalidKind = new Y.Doc();
    hydrateCanonicalBlockRoom(invalidKind, "page", pageDocument());
    const invalidBaseNode = (
      invalidKind.getMap("block-document").get("baseNodes") as Y.Map<
        Y.Map<unknown>
      >
    ).get(PAGE_SECTION_ID)!;
    invalidBaseNode.set("kind", "unknown");
    expect(() =>
      setAIDocumentField(
        invalidKind,
        nestedFieldTarget(PAGE_SECTION_ID, "data", [{ field: "props" }]),
        objectValue({}),
      ),
    ).toThrow("page_kind:unknown");
  });

  it("validates required Page fields once at the end of an atomic AI mutation batch", () => {
    const operation = (typed: {
      case: AIDocumentOperation["operation"]["case"];
      value: unknown;
    }): AIDocumentOperation =>
      create(AIDocumentOperationSchema, {
        operation: typed as AIDocumentOperation["operation"],
      });
    const insertExternalVideo = operation({
      case: "insertBlock",
      value: {
        blockHandle: PAGE_SECTION_A_ID,
        kind: "external-video",
        afterBlockHandle: PAGE_SECTION_ID,
      },
    });
    const setUri = operation({
      case: "setField",
      value: {
        target: nestedFieldTarget(PAGE_SECTION_A_ID, "data", [
          { field: "props" },
          { field: "uri" },
        ]),
        value: create(AIDocumentValueSchema, {
          value: { case: "text", value: "https://example.com/inserted" },
        }),
      },
    });

    const accepted = new Y.Doc();
    hydrateCanonicalBlockRoom(accepted, "page", pageDocument());
    applyAIDocumentOperationsToBlockRoom(accepted, "page", [
      insertExternalVideo,
      setUri,
    ]);
    expect(
      decodeCanonicalBlockRoom(accepted, "page").baseNodes.find(
        ({ id }) => id === PAGE_SECTION_A_ID,
      )?.payload,
    ).toMatchObject({ props: { uri: "https://example.com/inserted" } });

    const rejected = new Y.Doc();
    hydrateCanonicalBlockRoom(rejected, "page", pageDocument());
    const before = Y.encodeStateAsUpdate(rejected);
    expect(() =>
      applyAIDocumentOperationsToBlockRoom(rejected, "page", [
        insertExternalVideo,
      ]),
    ).toThrow("locale_room:invalid_projection");
    expect(Y.encodeStateAsUpdate(rejected)).toEqual(before);
  });

  it("keeps Page structure replacement role-aware at the direct applicator seam", () => {
    const operation = (typed: {
      case: AIDocumentOperation["operation"]["case"];
      value: unknown;
    }): AIDocumentOperation =>
      create(AIDocumentOperationSchema, {
        operation: typed as AIDocumentOperation["operation"],
      });
    const aggregate = pageDocument();
    aggregate.localeOverlays.push(
      fromJson(PageLocaleOverlaySchema, {
        locale: "en",
        sections: [
          {
            sectionId: PAGE_SECTION_ID,
            externalVideo: { props: { caption: "English" } },
          },
        ],
      }),
    );
    const target = new Y.Doc();
    hydrateExactBlockRoom(
      target,
      "page",
      "ko",
      materializeLocalizedPageDocument(aggregate, "en"),
      [],
    );
    const basePayload = (
      target.getMap("block-document").get("baseNodes") as Y.Map<Y.Map<unknown>>
    )
      .get(PAGE_SECTION_ID)!
      .get("payload") as Y.Map<unknown>;
    basePayload.delete("settings");
    expect(
      applyPageStructureAIDocumentOperation(
        target,
        operation({
          case: "replaceBlockKind",
          value: { blockHandle: PAGE_SECTION_ID, kind: "map" },
        }),
      ),
    ).toBe(true);
    expect(
      decodeCanonicalBlockRoom(target, "page").baseNodes[0]?.payload,
    ).toEqual({});

    expect(
      applyPageStructureAIDocumentOperation(
        target,
        operation({
          case: "createTranslation",
          value: { locale: "ja" },
        }),
      ),
    ).toBe(false);
  });
});
