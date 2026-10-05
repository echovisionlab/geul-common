import { fromJson } from "@bufbuild/protobuf";
import { contentBlockCatalogFingerprint } from "@echovisionlab/geul-proto/content/block_catalog.ts";
import {
  LocalizedPageDocumentSchema,
  LocalizedRichTextDocumentSchema,
  RichTextBlockNodeSchema,
  RichTextBlockLocaleSchema,
  RichTextProfile,
  type LocalizedPageDocument,
  type LocalizedRichTextDocument,
  type RichTextBlockNode,
} from "@echovisionlab/geul-proto/content/block_content_pb.ts";
import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import {
  decodeCanonicalBlockRoom,
  deleteBlockRoomBaseNode,
  hydrateCanonicalBlockRoom,
  insertRichTextBlockNode,
  insertRichTextBlockLocale,
  moveRichTextBlockNode,
  replayBlockRoomChanges,
  replaceBlockRoomPayloadArray,
  setBlockRoomAtomicValue,
} from "../block-room-codec.ts";

const BLOCK_A = "d5e4c5d2-c628-47a9-8bc0-6b69dd725101";
const BLOCK_B = "d5e4c5d2-c628-47a9-8bc0-6b69dd725102";
const BLOCK_C = "d5e4c5d2-c628-47a9-8bc0-6b69dd725103";
const BLOCK_D = "d5e4c5d2-c628-47a9-8bc0-6b69dd725104";
const SECTION = "6cbe14ed-5cdd-4b23-8780-3a8126dc0101";
const CHILD = "6cbe14ed-5cdd-4b23-8780-3a8126dc0102";
const PEER_CHILD = "6cbe14ed-5cdd-4b23-8780-3a8126dc0103";
const ROW_1 = "8f93ce52-439a-4843-a694-f60595360101";
const ROW_LOCAL = "8f93ce52-439a-4843-a694-f60595360102";
const ROW_PEER = "8f93ce52-439a-4843-a694-f60595360103";
const CELL_1 = "8f93ce52-439a-4843-a694-f60595360201";

function richTextDocument(locale = "ko"): LocalizedRichTextDocument {
  return fromJson(LocalizedRichTextDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    profile: RichTextProfile.POST,
    locale,
    base: {
      nodes: [
        {
          block: {
            id: BLOCK_A,
            paragraph: {
              props: { backgroundColor: "#ffffff", textColor: "#111111" },
            },
          },
          placement: { index: 0 },
        },
        {
          block: {
            id: BLOCK_B,
            paragraph: {
              props: { backgroundColor: "#ffffff", textColor: "#111111" },
            },
          },
          placement: { index: 1 },
        },
      ],
    },
    localeOverlay: {
      locale,
      blocks: [
        {
          blockId: BLOCK_A,
          paragraph: { props: {}, content: [{ text: { text: "초기 본문" } }] },
        },
        {
          blockId: BLOCK_B,
          paragraph: { props: {}, content: [{ text: { text: "두 번째" } }] },
        },
      ],
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
            id: BLOCK_A,
            table: {
              props: {},
              content: {
                columnWidths: [100],
                rows: [
                  {
                    id: ROW_1,
                    cells: [
                      {
                        id: CELL_1,
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
          blockId: BLOCK_A,
          table: {
            props: {},
            content: {
              rows: [
                { rowId: ROW_1, cells: [{ cellId: CELL_1, content: [] }] },
              ],
            },
          },
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
            id: SECTION,
            settings: { paddingTop: 16, maxWidth: "MAX_WIDTH_CONTAINER" },
            externalVideo: { props: { uri: "https://example.com/a" } },
          },
          placement: { index: 0 },
        },
        {
          section: {
            id: CHILD,
            externalVideo: { props: { uri: "https://example.com/b" } },
          },
          placement: { index: 1 },
        },
      ],
    },
    localeOverlay: {
      locale: "ko",
      sections: [
        { sectionId: SECTION, externalVideo: { props: { caption: "설명" } } },
        { sectionId: CHILD, externalVideo: { props: { caption: "두 번째" } } },
      ],
    },
  }) as LocalizedPageDocument;
}

function pageWithRichTextSection(): LocalizedPageDocument {
  return fromJson(LocalizedPageDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    locale: "ko",
    base: {
      nodes: [
        {
          section: {
            id: SECTION,
            richText: {
              props: {},
              blocks: {
                nodes: [
                  {
                    block: { id: BLOCK_A, paragraph: { props: {} } },
                    placement: { index: 0 },
                  },
                ],
              },
            },
          },
          placement: { index: 0 },
        },
        {
          section: {
            id: CHILD,
            externalVideo: { props: { uri: "https://example.com/b" } },
          },
          placement: { index: 1 },
        },
      ],
    },
    localeOverlay: {
      locale: "ko",
      sections: [
        {
          sectionId: SECTION,
          richText: {
            props: {},
            blocks: {
              locale: "ko",
              blocks: [
                {
                  blockId: BLOCK_A,
                  paragraph: {
                    props: {},
                    content: [{ text: { text: "초기 본문" } }],
                  },
                },
              ],
            },
          },
        },
        { sectionId: CHILD, externalVideo: { props: { caption: "video" } } },
      ],
    },
  }) as LocalizedPageDocument;
}

function pageWithTwoRichTextSections(): LocalizedPageDocument {
  return fromJson(LocalizedPageDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    locale: "ko",
    base: {
      nodes: [
        {
          section: {
            id: SECTION,
            richText: {
              props: {},
              blocks: {
                nodes: [
                  {
                    block: { id: BLOCK_A, paragraph: { props: {} } },
                    placement: { index: 0 },
                  },
                ],
              },
            },
          },
          placement: { index: 0 },
        },
        {
          section: {
            id: CHILD,
            richText: {
              props: {},
              blocks: {
                nodes: [
                  {
                    block: {
                      id: BLOCK_B,
                      paragraph: {
                        props: { textColor: "#111111" },
                      },
                    },
                    placement: { index: 0 },
                  },
                ],
              },
            },
          },
          placement: { index: 1 },
        },
      ],
    },
    localeOverlay: {
      locale: "ko",
      sections: [
        {
          sectionId: SECTION,
          richText: {
            props: {},
            blocks: {
              locale: "ko",
              blocks: [
                {
                  blockId: BLOCK_A,
                  paragraph: { props: {}, content: [] },
                },
              ],
            },
          },
        },
        {
          sectionId: CHILD,
          richText: {
            props: {},
            blocks: {
              locale: "ko",
              blocks: [
                {
                  blockId: BLOCK_B,
                  paragraph: { props: {}, content: [] },
                },
              ],
            },
          },
        },
      ],
    },
  }) as LocalizedPageDocument;
}

function hydrateRichText(
  document: LocalizedRichTextDocument,
  sourceLocale = "ko",
): Y.Doc {
  const room = new Y.Doc();
  hydrateCanonicalBlockRoom(room, "post", sourceLocale, document, []);
  return room;
}

function hydratePage(document = pageDocument()): Y.Doc {
  const room = new Y.Doc();
  hydrateCanonicalBlockRoom(room, "page", "ko", document, []);
  return room;
}

function cloneRoom(source: Y.Doc): Y.Doc {
  const clone = new Y.Doc();
  Y.applyUpdate(clone, Y.encodeStateAsUpdate(source));
  return clone;
}

function snapshot(room: Y.Doc, type: "post" | "page") {
  return decodeCanonicalBlockRoom(room, type);
}

function paragraphNode(id: string, index: number): RichTextBlockNode {
  return fromJson(RichTextBlockNodeSchema, {
    block: { id, paragraph: { props: {} } },
    placement: { index },
  }) as RichTextBlockNode;
}

function headingNode(id: string, index: number): RichTextBlockNode {
  return fromJson(RichTextBlockNodeSchema, {
    block: { id, heading: { props: { level: 2 } } },
    placement: { index },
  }) as RichTextBlockNode;
}

describe("replayBlockRoomChanges", () => {
  it("merges disjoint Post and Page payload leaves", () => {
    const postBase = hydrateRichText(richTextDocument());
    const postLocal = cloneRoom(postBase);
    const postCurrent = cloneRoom(postBase);
    const postBefore = snapshot(postLocal, "post");
    setBlockRoomAtomicValue(
      postLocal,
      { id: BLOCK_A, family: "rich_text", path: "props.backgroundColor" },
      "#000000",
    );
    const postAfter = snapshot(postLocal, "post");
    setBlockRoomAtomicValue(
      postCurrent,
      { id: BLOCK_A, family: "rich_text", path: "props.textColor" },
      "#222222",
    );
    replayBlockRoomChanges(postCurrent, [
      { before: postBefore, after: postAfter },
    ]);
    expect(
      snapshot(postCurrent, "post").baseNodes.find(
        (node) => node.id === BLOCK_A,
      )?.payload,
    ).toMatchObject({
      props: { backgroundColor: "#000000", textColor: "#222222" },
    });

    const pageBase = hydratePage();
    const pageLocal = cloneRoom(pageBase);
    const pageCurrent = cloneRoom(pageBase);
    const pageBefore = snapshot(pageLocal, "page");
    setBlockRoomAtomicValue(
      pageLocal,
      { id: SECTION, family: "page_section", path: "settings.paddingTop" },
      40,
    );
    const pageAfter = snapshot(pageLocal, "page");
    setBlockRoomAtomicValue(
      pageCurrent,
      { id: SECTION, family: "page_section", path: "props.uri" },
      "https://example.com/peer",
    );
    replayBlockRoomChanges(pageCurrent, [
      { before: pageBefore, after: pageAfter },
    ]);
    expect(
      snapshot(pageCurrent, "page").baseNodes.find(
        (node) => node.id === SECTION,
      )?.payload,
    ).toMatchObject({
      props: { uri: "https://example.com/peer" },
      settings: { paddingTop: 40 },
    });
  });

  it("does not resurrect a node that a peer deleted", () => {
    const base = hydrateRichText(richTextDocument());
    const local = cloneRoom(base);
    const current = cloneRoom(base);
    const before = snapshot(local, "post");
    setBlockRoomAtomicValue(
      local,
      { id: BLOCK_B, family: "rich_text", path: "props.backgroundColor" },
      "#000000",
    );
    const after = snapshot(local, "post");
    deleteBlockRoomBaseNode(current, BLOCK_B);

    replayBlockRoomChanges(current, [{ before, after }]);
    expect(snapshot(current, "post").baseNodes.map((node) => node.id)).toEqual([
      BLOCK_A,
    ]);
  });

  it("cascades an explicit section deletion through an unseen peer child", () => {
    const base = hydratePage(pageWithRichTextSection());
    const local = cloneRoom(base);
    const current = cloneRoom(base);
    const before = snapshot(local, "page");
    deleteBlockRoomBaseNode(local, SECTION);
    const after = snapshot(local, "page");
    insertRichTextBlockNode(current, paragraphNode(PEER_CHILD, 0), {
      pageSectionId: SECTION,
    });
    insertRichTextBlockLocale(
      current,
      fromJson(RichTextBlockLocaleSchema, {
        blockId: PEER_CHILD,
        paragraph: { props: {}, content: [{ text: { text: "peer" } }] },
      }),
    );

    replayBlockRoomChanges(current, [{ before, after }]);
    expect(snapshot(current, "page").baseNodes.map((node) => node.id)).toEqual([
      CHILD,
    ]);
  });

  it("skips local descendants under a peer-deleted Page section and replays sibling leaves", () => {
    const base = hydratePage(pageWithRichTextSection());
    const local = cloneRoom(base);
    const current = cloneRoom(base);
    const before = snapshot(local, "page");
    setBlockRoomAtomicValue(
      local,
      { id: CHILD, family: "page_section", path: "props.uri" },
      "https://example.com/local",
    );
    insertRichTextBlockNode(local, paragraphNode(BLOCK_D, 1), {
      pageSectionId: SECTION,
    });
    insertRichTextBlockNode(
      local,
      fromJson(RichTextBlockNodeSchema, {
        block: { id: BLOCK_C, paragraph: { props: {} } },
        placement: { parentBlockId: BLOCK_D, index: 0 },
      }) as RichTextBlockNode,
    );
    insertRichTextBlockLocale(
      local,
      fromJson(RichTextBlockLocaleSchema, {
        blockId: BLOCK_D,
        paragraph: { props: {}, content: [] },
      }),
    );
    insertRichTextBlockLocale(
      local,
      fromJson(RichTextBlockLocaleSchema, {
        blockId: BLOCK_C,
        paragraph: {
          props: {},
          content: [{ text: { text: "local nested block" } }],
        },
      }),
    );
    const after = snapshot(local, "page");
    deleteBlockRoomBaseNode(current, SECTION);

    replayBlockRoomChanges(current, [{ before, after }]);
    const result = snapshot(current, "page");
    expect(result.baseNodes.map((node) => node.id)).toEqual([CHILD]);
    expect(
      result.baseNodes.find((node) => node.id === CHILD)?.payload,
    ).toMatchObject({ props: { uri: "https://example.com/local" } });
    expect(result.localeOverlay.map((node) => node.id)).toEqual([CHILD]);
  });

  it("keeps a local Page block in its current container when its target section was deleted", () => {
    const base = hydratePage(pageWithTwoRichTextSections());
    const local = cloneRoom(base);
    const current = cloneRoom(base);
    const before = snapshot(local, "page");
    setBlockRoomAtomicValue(
      local,
      { id: BLOCK_B, family: "rich_text", path: "props.textColor" },
      "#222222",
    );
    moveRichTextBlockNode(
      local,
      BLOCK_B,
      { index: 1 },
      { pageSectionId: SECTION },
    );
    const after = snapshot(local, "page");
    deleteBlockRoomBaseNode(current, SECTION);

    replayBlockRoomChanges(current, [{ before, after }]);
    const result = snapshot(current, "page");
    const moved = result.baseNodes.find((node) => node.id === BLOCK_B);
    expect(moved?.parentId).toBe(CHILD);
    expect(moved?.payload).toMatchObject({ props: { textColor: "#222222" } });
    expect(result.baseNodes.map((node) => node.id)).toEqual([CHILD, BLOCK_B]);
  });

  it("places a local addition by stable siblings and keeps a peer addition in order", () => {
    const base = hydrateRichText(richTextDocument());
    const local = cloneRoom(base);
    const current = cloneRoom(base);
    const before = snapshot(local, "post");
    insertRichTextBlockNode(local, paragraphNode(BLOCK_C, 1));
    insertRichTextBlockLocale(
      local,
      fromJson(RichTextBlockLocaleSchema, {
        blockId: BLOCK_C,
        paragraph: { props: {}, content: [{ text: { text: "local" } }] },
      }),
    );
    const after = snapshot(local, "post");
    insertRichTextBlockNode(current, paragraphNode(BLOCK_D, 1));
    insertRichTextBlockLocale(
      current,
      fromJson(RichTextBlockLocaleSchema, {
        blockId: BLOCK_D,
        paragraph: { props: {}, content: [{ text: { text: "peer" } }] },
      }),
    );

    replayBlockRoomChanges(current, [{ before, after }]);
    expect(
      snapshot(current, "post")
        .baseNodes.sort((a, b) => a.position - b.position)
        .map((node) => node.id),
    ).toEqual([BLOCK_A, BLOCK_D, BLOCK_C, BLOCK_B]);
  });

  it("merges stable-ID array membership and leaves while preserving peer additions", () => {
    const base = hydrateRichText(tableDocument());
    const local = cloneRoom(base);
    const current = cloneRoom(base);
    const before = snapshot(local, "post");
    setBlockRoomAtomicValue(
      local,
      {
        id: BLOCK_A,
        family: "rich_text",
        path: "content.rows[0].cells[0].props.backgroundColor",
      },
      "#111111",
    );
    const rowsRef = {
      id: BLOCK_A,
      family: "rich_text" as const,
      path: "content.rows",
    };
    replaceBlockRoomPayloadArray(local, rowsRef, [
      {
        id: ROW_1,
        cells: [
          { id: CELL_1, header: false, props: { backgroundColor: "#111111" } },
        ],
      },
      { id: ROW_LOCAL, cells: [] },
    ]);
    replaceBlockRoomPayloadArray(local, { ...rowsRef, locale: true }, [
      {
        rowId: ROW_1,
        cells: [{ cellId: CELL_1, content: [] }],
      },
      { rowId: ROW_LOCAL, cells: [] },
    ]);
    const after = snapshot(local, "post");
    setBlockRoomAtomicValue(
      current,
      {
        id: BLOCK_A,
        family: "rich_text",
        path: "content.rows[0].cells[0].props.colspan",
      },
      2,
    );
    replaceBlockRoomPayloadArray(current, rowsRef, [
      {
        id: ROW_1,
        cells: [
          {
            id: CELL_1,
            header: false,
            props: { backgroundColor: "#ffffff", colspan: 2 },
          },
        ],
      },
      { id: ROW_PEER, cells: [] },
    ]);
    replaceBlockRoomPayloadArray(current, { ...rowsRef, locale: true }, [
      {
        rowId: ROW_1,
        cells: [{ cellId: CELL_1, content: [] }],
      },
      { rowId: ROW_PEER, cells: [] },
    ]);

    replayBlockRoomChanges(current, [{ before, after }]);
    const rows = snapshot(current, "post").baseNodes.find(
      (node) => node.id === BLOCK_A,
    )?.payload as {
      content: {
        rows: Array<{
          id: string;
          cells: Array<{ props?: Record<string, unknown> }>;
        }>;
      };
    };
    expect(rows.content.rows.map((row) => row.id)).toEqual([
      ROW_1,
      ROW_PEER,
      ROW_LOCAL,
    ]);
    expect(rows.content.rows[0]?.cells[0]?.props).toMatchObject({
      backgroundColor: "#111111",
      colspan: 2,
    });
  });

  it("replays target-locale intent without changing its shared base mask", () => {
    const base = hydrateRichText(richTextDocument("en"), "ko");
    const local = cloneRoom(base);
    const current = cloneRoom(base);
    const before = snapshot(local, "post");
    // Target-locale editing is represented in the sparse locale overlay.
    const text = local.getMap("block-document");
    expect(text).toBeDefined();
    const localeNode = (text.get("localeOverlay") as Y.Map<unknown>).get(
      BLOCK_A,
    ) as Y.Map<unknown>;
    const payload = localeNode.get("payload") as Y.Map<unknown>;
    const content = payload.get("content") as Y.Array<unknown>;
    const inline = content.get(0) as Y.Map<unknown>;
    const textNode = inline.get("text") as Y.Map<unknown>;
    const yText = textNode.get("text") as Y.Text;
    yText.delete(0, yText.length);
    yText.insert(0, "로컬 번역");
    const after = snapshot(local, "post");
    setBlockRoomAtomicValue(
      current,
      { id: BLOCK_A, family: "rich_text", path: "props.backgroundColor" },
      "#333333",
    );

    replayBlockRoomChanges(current, [{ before, after }]);
    const result = snapshot(current, "post");
    expect(
      result.baseNodes.find((node) => node.id === BLOCK_A)?.payload,
    ).toMatchObject({
      props: { backgroundColor: "#333333" },
    });
    expect(
      result.localeOverlay.find((node) => node.id === BLOCK_A)?.payload,
    ).toMatchObject({
      content: [{ text: { text: "로컬 번역" } }],
    });
  });

  it("lets a pending same-field write win over the current value", () => {
    const base = hydrateRichText(richTextDocument());
    const local = cloneRoom(base);
    const current = cloneRoom(base);
    const before = snapshot(local, "post");
    setBlockRoomAtomicValue(
      local,
      { id: BLOCK_A, family: "rich_text", path: "props.backgroundColor" },
      "#000000",
    );
    const after = snapshot(local, "post");
    setBlockRoomAtomicValue(
      current,
      { id: BLOCK_A, family: "rich_text", path: "props.backgroundColor" },
      "#abcdef",
    );

    replayBlockRoomChanges(current, [{ before, after }]);
    expect(
      snapshot(current, "post").baseNodes.find((node) => node.id === BLOCK_A)
        ?.payload,
    ).toMatchObject({
      props: { backgroundColor: "#000000" },
    });
  });

  it("rejects a same-ID kind collision", () => {
    const base = hydrateRichText(richTextDocument());
    const local = cloneRoom(base);
    const current = cloneRoom(base);
    const before = snapshot(local, "post");
    insertRichTextBlockNode(local, paragraphNode(BLOCK_C, 1));
    insertRichTextBlockLocale(
      local,
      fromJson(RichTextBlockLocaleSchema, {
        blockId: BLOCK_C,
        paragraph: { props: {}, content: [{ text: { text: "local" } }] },
      }),
    );
    const after = snapshot(local, "post");
    insertRichTextBlockNode(current, headingNode(BLOCK_C, 1));
    insertRichTextBlockLocale(
      current,
      fromJson(RichTextBlockLocaleSchema, {
        blockId: BLOCK_C,
        heading: {
          props: {},
          content: [{ text: { text: "peer" } }],
        },
      }),
    );
    const currentBytes = Y.encodeStateAsUpdate(current);

    expect(() => replayBlockRoomChanges(current, [{ before, after }])).toThrow(
      `block_room_invalid:replay:kind_changed:${BLOCK_C}`,
    );
    expect(Y.encodeStateAsUpdate(current)).toEqual(currentBytes);
  });

  it("rejects a missing parent atomically after an earlier intent was staged", () => {
    const base = hydrateRichText(richTextDocument());
    const local = cloneRoom(base);
    const current = cloneRoom(base);
    const beforeFirst = snapshot(local, "post");
    setBlockRoomAtomicValue(
      local,
      { id: BLOCK_A, family: "rich_text", path: "props.textColor" },
      "#222222",
    );
    const afterFirst = snapshot(local, "post");
    insertRichTextBlockNode(local, paragraphNode(BLOCK_C, 1));
    insertRichTextBlockLocale(
      local,
      fromJson(RichTextBlockLocaleSchema, {
        blockId: BLOCK_C,
        paragraph: { props: {}, content: [{ text: { text: "local" } }] },
      }),
    );
    const invalidAfter = snapshot(local, "post");
    const addedNode = invalidAfter.baseNodes.find(
      (node) => node.id === BLOCK_C,
    );
    expect(addedNode).toBeDefined();
    addedNode!.parentId = "ac491343-4c84-4e85-9b05-a3a85cd242d5";
    const currentBytes = Y.encodeStateAsUpdate(current);

    expect(() =>
      replayBlockRoomChanges(current, [
        { before: beforeFirst, after: afterFirst },
        { before: afterFirst, after: invalidAfter },
      ]),
    ).toThrow("missing_parent");
    expect(Y.encodeStateAsUpdate(current)).toEqual(currentBytes);
  });
});
