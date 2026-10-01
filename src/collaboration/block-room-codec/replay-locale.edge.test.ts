import { fromJson } from "@bufbuild/protobuf";
import { contentBlockCatalogFingerprint } from "@echovisionlab/geul-proto/content/block_catalog.ts";
import {
  LocalizedPageDocumentSchema,
  LocalizedRichTextDocumentSchema,
  PageSectionLocaleSchema,
  PageSectionNodeSchema,
  RichTextBlockDataSchema,
  RichTextBlockLocaleSchema,
  RichTextBlockLocaleDataSchema,
  RichTextBlockNodeSchema,
  RichTextProfile,
  type LocalizedPageDocument,
  type LocalizedRichTextDocument,
  type RichTextBlockNode,
} from "@echovisionlab/geul-proto/content/block_content_pb.ts";
import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import {
  blockRoomPresentLocaleValues,
  decodeCanonicalBlockRoom,
  deleteBlockRoomBaseNode,
  hydrateCanonicalBlockRoom,
  insertRichTextBlockLocale,
  insertRichTextBlockNode,
  insertPageSectionLocale,
  insertPageSectionNode,
  replayBlockRoomChanges,
  replaceBlockRoomCollaborativeText,
  replaceBlockRoomPayloadArray,
  replaceRichTextBlockData,
} from "../block-room-codec.ts";

const A = "20000000-0000-4000-8000-000000000001";
const B = "20000000-0000-4000-8000-000000000002";
const C = "20000000-0000-4000-8000-000000000003";
const ROW = "20000000-0000-4000-8000-000000000011";
const CELL = "20000000-0000-4000-8000-000000000012";
const CELL_2 = "20000000-0000-4000-8000-000000000013";
const ROW_2 = "20000000-0000-4000-8000-000000000014";
const CELL_3 = "20000000-0000-4000-8000-000000000015";
const CELL_4 = "20000000-0000-4000-8000-000000000016";
const ROW_3 = "20000000-0000-4000-8000-000000000017";
const CELL_5 = "20000000-0000-4000-8000-000000000018";
const CELL_6 = "20000000-0000-4000-8000-000000000019";
const UNIT = "20000000-0000-4000-8000-000000000021";
const UNIT_2 = "20000000-0000-4000-8000-000000000022";
const UNIT_3 = "20000000-0000-4000-8000-000000000023";
const UNIT_4 = "20000000-0000-4000-8000-000000000024";
const LOW_CHILD = "20000000-0000-4000-8000-000000000031";
const HIGH_SECTION = "20000000-0000-4000-8000-000000000032";

function postDocument(
  locale = "ko",
  localeBlockIds: readonly string[] = [A, B],
): LocalizedRichTextDocument {
  return fromJson(LocalizedRichTextDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    profile: RichTextProfile.POST,
    locale,
    base: {
      nodes: [A, B].map((id, index) => ({
        block: { id, paragraph: { props: {} } },
        placement: { index },
      })),
    },
    localeOverlay: {
      locale,
      blocks: localeBlockIds.map((blockId) => ({
        blockId,
        paragraph: {
          props: {},
          content: [{ text: { text: `${locale}:${blockId}` } }],
        },
      })),
    },
  }) as LocalizedRichTextDocument;
}

function tableDocument(): LocalizedRichTextDocument {
  return fromJson(LocalizedRichTextDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    profile: RichTextProfile.POST,
    locale: "ko",
    base: {
      nodes: [
        {
          block: {
            id: A,
            table: {
              props: {},
              content: {
                columnWidths: [100],
                rows: [
                  {
                    id: ROW,
                    cells: [
                      {
                        id: CELL,
                        header: false,
                        props: { backgroundColor: "#ffffff" },
                      },
                      {
                        id: CELL_2,
                        header: false,
                        props: { backgroundColor: "#ffffff" },
                      },
                    ],
                  },
                  {
                    id: ROW_2,
                    cells: [
                      {
                        id: CELL_3,
                        header: false,
                        props: { backgroundColor: "#ffffff" },
                      },
                      {
                        id: CELL_4,
                        header: false,
                        props: { backgroundColor: "#ffffff" },
                      },
                    ],
                  },
                ],
              },
            },
          },
          placement: { index: 0 },
        },
      ],
    },
    localeOverlay: {
      locale: "ko",
      blocks: [
        {
          blockId: A,
          table: {
            props: {},
            content: {
              rows: [
                {
                  rowId: ROW,
                  cells: [
                    { cellId: CELL, content: [] },
                    { cellId: CELL_2, content: [] },
                  ],
                },
                {
                  rowId: ROW_2,
                  cells: [
                    { cellId: CELL_3, content: [] },
                    { cellId: CELL_4, content: [] },
                  ],
                },
              ],
            },
          },
        },
      ],
    },
  }) as LocalizedRichTextDocument;
}

function codeBlockDocument(): LocalizedRichTextDocument {
  return fromJson(LocalizedRichTextDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    profile: RichTextProfile.POST,
    locale: "ko",
    base: {
      nodes: [
        {
          block: { id: A, codeBlock: { props: {} } },
          placement: { index: 0 },
        },
      ],
    },
    localeOverlay: {
      locale: "ko",
      blocks: [
        {
          blockId: A,
          codeBlock: { props: { title: "before" }, content: "print(1)" },
        },
      ],
    },
  }) as LocalizedRichTextDocument;
}

function pageDocument(): LocalizedPageDocument {
  return fromJson(LocalizedPageDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    locale: "ko",
    base: {
      nodes: [
        {
          section: {
            id: A,
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
          sectionId: A,
          externalVideo: { props: { caption: "before" } },
        },
      ],
    },
  }) as LocalizedPageDocument;
}

function immersivePageDocument(): LocalizedPageDocument {
  return fromJson(LocalizedPageDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    locale: "ko",
    base: {
      nodes: [
        {
          section: {
            id: A,
            immersiveScene: {
              props: {},
              units: [
                { id: UNIT, props: {} },
                { id: UNIT_2, props: {} },
                { id: UNIT_3, props: {} },
              ],
            },
          },
          placement: { index: 0 },
        },
      ],
    },
    localeOverlay: {
      locale: "ko",
      sections: [
        {
          sectionId: A,
          immersiveScene: {
            props: {},
            units: [
              { unitId: UNIT, props: {} },
              { unitId: UNIT_2, props: { title: "before" } },
              { unitId: UNIT_3 },
            ],
          },
        },
      ],
    },
  }) as LocalizedPageDocument;
}

function room<T extends LocalizedRichTextDocument | LocalizedPageDocument>(
  document: T,
  type: "post" | "page",
  sourceLocale = "ko",
): Y.Doc {
  const result = new Y.Doc();
  hydrateCanonicalBlockRoom(result, type, sourceLocale, document, []);
  return result;
}

function clone(source: Y.Doc): Y.Doc {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(source));
  return copy;
}

function snapshot(roomDoc: Y.Doc, type: "post" | "page") {
  return decodeCanonicalBlockRoom(roomDoc, type);
}

function paragraph(id: string, index: number): RichTextBlockNode {
  return fromJson(RichTextBlockNodeSchema, {
    block: { id, paragraph: { props: {} } },
    placement: { index },
  }) as RichTextBlockNode;
}

function replaceInlineText(document: Y.Doc, blockId: string, value: string) {
  const root = document.getMap("block-document");
  const overlays = root.get("localeOverlay") as Y.Map<unknown>;
  const node = overlays.get(blockId) as Y.Map<unknown>;
  const payload = node.get("payload") as Y.Map<unknown>;
  const content = payload.get("content") as Y.Array<unknown>;
  const inline = content.get(0) as Y.Map<unknown>;
  const text = inline.get("text") as Y.Map<unknown>;
  const yText = text.get("text") as Y.Text;
  yText.delete(0, yText.length);
  yText.insert(0, value);
}

describe("locale-intent replay boundary cases", () => {
  it("replays only changed table-cell locale values and preserves a peer cell edit", () => {
    const original = room(tableDocument(), "post");
    const local = clone(original);
    const current = clone(original);
    const before = snapshot(local, "post");
    replaceBlockRoomPayloadArray(
      local,
      {
        id: A,
        family: "rich_text",
        locale: true,
        path: "content.rows[1].cells[1].content",
      },
      [{ text: { text: "local cell" } }],
    );
    const after = snapshot(local, "post");
    replaceBlockRoomPayloadArray(
      current,
      {
        id: A,
        family: "rich_text",
        locale: true,
        path: "content.rows[0].cells[0].content",
      },
      [{ text: { text: "peer cell" } }],
    );
    replaceBlockRoomPayloadArray(
      current,
      { id: A, family: "rich_text", path: "content.rows" },
      [
        {
          id: ROW,
          cells: [
            { id: CELL, header: false, props: { backgroundColor: "#ffffff" } },
            {
              id: CELL_2,
              header: false,
              props: { backgroundColor: "#ffffff" },
            },
            {
              id: CELL_5,
              header: false,
              props: { backgroundColor: "#ffffff" },
            },
          ],
        },
        {
          id: ROW_2,
          cells: [
            {
              id: CELL_3,
              header: false,
              props: { backgroundColor: "#ffffff" },
            },
            {
              id: CELL_4,
              header: false,
              props: { backgroundColor: "#ffffff" },
            },
          ],
        },
        {
          id: ROW_3,
          cells: [
            {
              id: CELL_6,
              header: false,
              props: { backgroundColor: "#ffffff" },
            },
          ],
        },
      ],
    );
    replaceBlockRoomPayloadArray(
      current,
      {
        id: A,
        family: "rich_text",
        locale: true,
        path: "content.rows",
      },
      [
        {
          rowId: ROW,
          cells: [
            { cellId: CELL, content: [{ text: { text: "peer cell" } }] },
            { cellId: CELL_2 },
            { cellId: CELL_5 },
          ],
        },
        {
          rowId: ROW_2,
          cells: [{ cellId: CELL_3 }, { cellId: CELL_4 }],
        },
        { rowId: ROW_3, cells: [{ cellId: CELL_6 }] },
      ],
    );

    replayBlockRoomChanges(current, [{ before, after }]);
    const result = snapshot(current, "post");
    expect(result.localeOverlay[0]?.payload).toMatchObject({
      content: {
        rows: [
          {
            cells: [
              { content: [{ text: { text: "peer cell" } }] },
              { cellId: CELL_2 },
              { cellId: CELL_5 },
            ],
          },
          {
            cells: [
              { cellId: CELL_3 },
              { content: [{ text: { text: "local cell" } }] },
            ],
          },
          {
            cells: [{ cellId: CELL_6 }],
          },
        ],
      },
    });
    expect(blockRoomPresentLocaleValues(current).length).toBeGreaterThan(0);
  });

  it("adds multiple source overlays by stable base identity", () => {
    const original = room(postDocument(), "post");
    const local = clone(original);
    const current = clone(original);
    const before = snapshot(local, "post");
    for (const [index, id] of [
      C,
      "20000000-0000-4000-8000-000000000004",
    ].entries()) {
      insertRichTextBlockNode(local, paragraph(id, index + 2));
      insertRichTextBlockLocale(
        local,
        fromJson(RichTextBlockLocaleSchema, {
          blockId: id,
          paragraph: { props: {}, content: [{ text: { text: id } }] },
        }),
      );
    }
    const after = snapshot(local, "post");

    replayBlockRoomChanges(current, [{ before, after }]);
    const result = snapshot(current, "post");
    expect(result.baseNodes.map(({ id }) => id)).toContain(C);
    expect(result.localeOverlay.map(({ id }) => id)).toContain(C);
    expect(result.localeOverlay).toHaveLength(4);
  });

  it("adds a Page section with an empty locale props message", () => {
    const original = room(pageDocument(), "page");
    const local = clone(original);
    const current = clone(original);
    const before = snapshot(local, "page");
    insertPageSectionNode(
      local,
      fromJson(PageSectionNodeSchema, {
        section: {
          id: C,
          externalVideo: { props: { uri: "https://example.com/new" } },
        },
        placement: { index: 1 },
      }),
    );
    insertPageSectionLocale(
      local,
      fromJson(PageSectionLocaleSchema, {
        sectionId: C,
        externalVideo: {},
      }),
    );
    const after = snapshot(local, "page");

    replayBlockRoomChanges(current, [{ before, after }]);
    const result = snapshot(current, "page");
    expect(result.baseNodes.map(({ id }) => id)).toContain(C);
    expect(result.localeOverlay.map(({ id }) => id)).toContain(C);
  });

  it("orders an added section before a nested block with a lower UUID", () => {
    const original = room(pageDocument(), "page");
    const local = clone(original);
    const current = clone(original);
    const before = snapshot(local, "page");
    insertPageSectionNode(
      local,
      fromJson(PageSectionNodeSchema, {
        section: {
          id: HIGH_SECTION,
          richText: {
            props: {},
            blocks: {
              nodes: [
                {
                  block: { id: LOW_CHILD, paragraph: { props: {} } },
                  placement: { index: 0 },
                },
              ],
            },
          },
        },
        placement: { index: 1 },
      }),
    );
    insertPageSectionLocale(
      local,
      fromJson(PageSectionLocaleSchema, {
        sectionId: HIGH_SECTION,
        richText: {
          props: {},
          blocks: {
            locale: "ko",
            blocks: [
              {
                blockId: LOW_CHILD,
                paragraph: { props: {}, content: [] },
              },
            ],
          },
        },
      }),
    );
    const after = snapshot(local, "page");

    replayBlockRoomChanges(current, [{ before, after }]);
    const result = snapshot(current, "page");
    expect(result.baseNodes.map(({ id }) => id)).toContain(HIGH_SECTION);
    expect(result.baseNodes.map(({ id }) => id)).toContain(LOW_CHILD);
    expect(result.localeOverlay.map(({ id }) => id)).toContain(HIGH_SECTION);
    expect(result.localeOverlay.map(({ id }) => id)).toContain(LOW_CHILD);
  });

  it("deletes locale nodes without affecting the shared base", () => {
    const original = room(postDocument(), "post");
    const local = clone(original);
    const current = clone(original);
    const before = snapshot(local, "post");
    deleteBlockRoomBaseNode(local, B);
    const after = snapshot(local, "post");

    replayBlockRoomChanges(current, [{ before, after }]);
    const result = snapshot(current, "post");
    expect(result.baseNodes.map(({ id }) => id)).toEqual([A]);
    expect(result.localeOverlay.map(({ id }) => id)).toEqual([A]);
  });

  it("applies sparse page props and immersive-unit locale leaves", () => {
    const pageBase = room(pageDocument(), "page");
    const pageLocal = clone(pageBase);
    const pageCurrent = clone(pageBase);
    const pageBefore = snapshot(pageLocal, "page");
    replaceBlockRoomCollaborativeText(
      pageLocal,
      { id: A, family: "page_section", locale: true, path: "props.caption" },
      "after",
    );
    const pageAfter = snapshot(pageLocal, "page");
    replayBlockRoomChanges(pageCurrent, [
      { before: pageBefore, after: pageAfter },
    ]);
    expect(
      snapshot(pageCurrent, "page").localeOverlay[0]?.payload,
    ).toMatchObject({ props: { caption: "after" } });

    const immersiveBase = room(immersivePageDocument(), "page");
    const immersiveLocal = clone(immersiveBase);
    const immersiveCurrent = clone(immersiveBase);
    const immersiveBefore = snapshot(immersiveLocal, "page");
    replaceBlockRoomCollaborativeText(
      immersiveLocal,
      {
        id: A,
        family: "page_section",
        locale: true,
        path: "units[1].props.title",
      },
      "after unit title",
    );
    const immersiveAfter = snapshot(immersiveLocal, "page");
    replaceBlockRoomPayloadArray(
      immersiveCurrent,
      { id: A, family: "page_section", path: "units" },
      [
        { id: UNIT, props: {} },
        { id: UNIT_2, props: {} },
        { id: UNIT_3, props: {} },
        { id: UNIT_4, props: {} },
      ],
    );
    replaceBlockRoomPayloadArray(
      immersiveCurrent,
      { id: A, family: "page_section", locale: true, path: "units" },
      [
        { unitId: UNIT, props: {} },
        { unitId: UNIT_2, props: { title: "before" } },
        { unitId: UNIT_3 },
        { unitId: UNIT_4, props: { title: "peer unit" } },
      ],
    );
    replayBlockRoomChanges(immersiveCurrent, [
      { before: immersiveBefore, after: immersiveAfter },
    ]);
    expect(
      snapshot(immersiveCurrent, "page").localeOverlay[0]?.payload,
    ).toMatchObject({
      units: [
        { unitId: UNIT, props: {} },
        { unitId: UNIT_2, props: { title: "after unit title" } },
        { unitId: UNIT_3 },
        { unitId: UNIT_4, props: { title: "peer unit" } },
      ],
    });
  });

  it("replays a rich-text locale scalar stored under block props", () => {
    const original = room(codeBlockDocument(), "post");
    const local = clone(original);
    const current = clone(original);
    const before = snapshot(local, "post");
    replaceBlockRoomCollaborativeText(
      local,
      { id: A, family: "rich_text", locale: true, path: "props.title" },
      "after",
    );
    const after = snapshot(local, "post");

    replayBlockRoomChanges(current, [{ before, after }]);
    expect(snapshot(current, "post").localeOverlay[0]?.payload).toMatchObject({
      props: { title: "after" },
    });
  });

  it("replays canonical target locale edits without changing the shared base", () => {
    const residentTarget = room(postDocument("en"), "post", "ko");
    const local = clone(residentTarget);
    const current = clone(residentTarget);
    const before = snapshot(local, "post");
    replaceInlineText(local, A, "local target edit");
    const after = snapshot(local, "post");
    replaceInlineText(current, B, "peer target edit");

    replayBlockRoomChanges(current, [{ before, after }]);
    const result = snapshot(current, "post");
    expect(
      result.localeOverlay.find(({ id }) => id === A)?.payload,
    ).toMatchObject({
      content: [{ text: { text: "local target edit" } }],
    });
    expect(
      result.localeOverlay.find(({ id }) => id === B)?.payload,
    ).toMatchObject({
      content: [{ text: { text: "peer target edit" } }],
    });
    expect(result.baseNodes).toEqual(before.baseNodes);
  });

  it("records source text edits as locale presence and skips peer-deleted overlays", () => {
    const original = room(postDocument(), "post");
    const local = clone(original);
    const current = clone(original);
    const before = snapshot(local, "post");
    replaceInlineText(local, A, "translated intent");
    replaceInlineText(local, B, "peer-deleted intent");
    const after = snapshot(local, "post");
    deleteBlockRoomBaseNode(current, B);

    replayBlockRoomChanges(current, [{ before, after }]);
    const result = snapshot(current, "post");
    expect(result.localeOverlay.find(({ id }) => id === B)).toBeUndefined();
    expect(
      result.localeOverlay.find(({ id }) => id === A)?.payload,
    ).toMatchObject({
      content: [{ text: { text: "translated intent" } }],
    });
    expect(blockRoomPresentLocaleValues(current).length).toBeGreaterThan(0);
  });

  it("rejects a locale payload edit when a peer changed the canonical node kind", () => {
    const original = room(postDocument(), "post");
    const local = clone(original);
    const current = clone(original);
    const before = snapshot(local, "post");
    replaceInlineText(local, A, "local translation");
    const after = snapshot(local, "post");
    replaceRichTextBlockData(
      current,
      A,
      fromJson(RichTextBlockDataSchema, {
        heading: { props: { level: 2 } },
      }),
      {
        expectedKind: "paragraph",
        localeData: fromJson(RichTextBlockLocaleDataSchema, {
          heading: { props: {}, content: [{ text: { text: "peer" } }] },
        }),
      },
    );
    const originalCurrent = Y.encodeStateAsUpdate(current);

    expect(() => replayBlockRoomChanges(current, [{ before, after }])).toThrow(
      `block_room_invalid:replay:kind_changed:${A}`,
    );
    expect(Y.encodeStateAsUpdate(current)).toEqual(originalCurrent);
  });
});
