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
  decodeCanonicalBlockRoom,
  deleteBlockRoomBaseNode,
  hydrateCanonicalBlockRoom,
  insertRichTextBlockLocale,
  insertRichTextBlockNode,
  insertPageSectionLocale,
  insertPageSectionNode,
  movePageSectionNode,
  moveRichTextBlockNode,
  replayBlockRoomChanges,
  replaceRichTextBlockData,
  setBlockRoomAtomicValue,
  type CanonicalBlockRoomSnapshot,
} from "../block-room-codec.ts";

const A = "10000000-0000-4000-8000-000000000001";
const B = "10000000-0000-4000-8000-000000000002";
const C = "10000000-0000-4000-8000-000000000003";
const D = "10000000-0000-4000-8000-000000000004";
const E = "10000000-0000-4000-8000-000000000005";
const F = "10000000-0000-4000-8000-000000000006";
const COLUMN_A = "10000000-0000-4000-8000-000000000007";
const COLUMN_B = "10000000-0000-4000-8000-000000000008";
const G = "10000000-0000-4000-8000-000000000009";

function postDocument(): LocalizedRichTextDocument {
  return fromJson(LocalizedRichTextDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    profile: RichTextProfile.POST,
    locale: "ko",
    base: {
      nodes: [A, B].map((id, index) => ({
        block: { id, paragraph: { props: { textColor: "#111111" } } },
        placement: { index },
      })),
    },
    localeOverlay: {
      locale: "ko",
      blocks: [A, B].map((blockId) => ({
        blockId,
        paragraph: { props: {}, content: [{ text: { text: blockId } }] },
      })),
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
            richText: {
              props: {},
              blocks: {
                nodes: [
                  {
                    block: { id: C, paragraph: { props: {} } },
                    placement: { index: 0 },
                  },
                  {
                    block: { id: E, paragraph: { props: {} } },
                    placement: { index: 1 },
                  },
                ],
              },
            },
          },
          placement: { index: 0 },
        },
        {
          section: {
            id: B,
            richText: {
              props: {},
              blocks: {
                nodes: [
                  {
                    block: { id: D, paragraph: { props: {} } },
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
          sectionId: A,
          richText: {
            props: {},
            blocks: {
              locale: "ko",
              blocks: [
                {
                  blockId: C,
                  paragraph: { props: {}, content: [{ text: { text: "c" } }] },
                },
                {
                  blockId: E,
                  paragraph: { props: {}, content: [{ text: { text: "e" } }] },
                },
              ],
            },
          },
        },
        {
          sectionId: B,
          richText: {
            props: {},
            blocks: {
              locale: "ko",
              blocks: [
                {
                  blockId: D,
                  paragraph: { props: {}, content: [{ text: { text: "d" } }] },
                },
              ],
            },
          },
        },
      ],
    },
  }) as LocalizedPageDocument;
}

function emptyRichTextSectionsPageDocument(): LocalizedPageDocument {
  return fromJson(LocalizedPageDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    locale: "ko",
    base: {
      nodes: [
        {
          section: {
            id: A,
            richText: {
              props: {},
              blocks: {
                nodes: [
                  {
                    block: { id: C, paragraph: { props: {} } },
                    placement: { index: 0 },
                  },
                ],
              },
            },
          },
          placement: { index: 0 },
        },
        {
          section: { id: B, richText: { props: {}, blocks: { nodes: [] } } },
          placement: { index: 1 },
        },
      ],
    },
    localeOverlay: {
      locale: "ko",
      sections: [
        {
          sectionId: A,
          richText: {
            props: {},
            blocks: {
              locale: "ko",
              blocks: [
                {
                  blockId: C,
                  paragraph: { props: {}, content: [{ text: { text: "c" } }] },
                },
              ],
            },
          },
        },
        {
          sectionId: B,
          richText: { props: {}, blocks: { locale: "ko", blocks: [] } },
        },
      ],
    },
  }) as LocalizedPageDocument;
}

function columnsPageDocument(): LocalizedPageDocument {
  return fromJson(LocalizedPageDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    locale: "ko",
    base: {
      nodes: [
        {
          section: {
            id: A,
            columns: {
              props: {
                columns: [
                  { id: COLUMN_A, ratio: 1 },
                  { id: COLUMN_B, ratio: 1 },
                ],
              },
            },
          },
          placement: { index: 0 },
        },
        {
          section: {
            id: B,
            externalVideo: { props: { uri: "https://example.com/b" } },
          },
          placement: { index: 1 },
        },
      ],
    },
    localeOverlay: {
      locale: "ko",
      sections: [
        { sectionId: A, columns: { props: {} } },
        { sectionId: B, externalVideo: { props: { caption: "b" } } },
      ],
    },
  }) as LocalizedPageDocument;
}

function nestedRichTextPageDocument(): LocalizedPageDocument {
  return fromJson(LocalizedPageDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    locale: "ko",
    base: {
      nodes: [
        {
          section: {
            id: A,
            richText: {
              props: {},
              blocks: {
                nodes: [
                  {
                    block: { id: C, paragraph: { props: {} } },
                    placement: { index: 0 },
                  },
                  {
                    block: { id: D, paragraph: { props: {} } },
                    placement: { index: 1 },
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
      sections: [
        {
          sectionId: A,
          richText: {
            props: {},
            blocks: {
              locale: "ko",
              blocks: [
                {
                  blockId: C,
                  paragraph: { props: {}, content: [] },
                },
                {
                  blockId: D,
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

function room<T extends LocalizedRichTextDocument | LocalizedPageDocument>(
  document: T,
  type: "post" | "page",
  locale = "ko",
): Y.Doc {
  const result = new Y.Doc();
  hydrateCanonicalBlockRoom(result, type, locale, document, []);
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

function nodeIds(value: CanonicalBlockRoomSnapshot) {
  return value.baseNodes.map((node) => node.id);
}

function orderedIds(value: CanonicalBlockRoomSnapshot) {
  return [...value.baseNodes]
    .sort((left, right) => left.position - right.position)
    .map((node) => node.id);
}

describe("base-intent replay boundary cases", () => {
  it("treats an empty journal as a no-op and rejects target-base drift atomically", () => {
    const target = room(postDocument(), "post", "en");
    const before = snapshot(target, "post");
    const original = Y.encodeStateAsUpdate(target);
    replayBlockRoomChanges(target, []);
    expect(Y.encodeStateAsUpdate(target)).toEqual(original);

    const after = structuredClone(before);
    after.baseNodes[0]!.payload = { props: { textColor: "#ff0000" } };
    expect(() => replayBlockRoomChanges(target, [{ before, after }])).toThrow(
      "block_room_invalid:replay:target_base_changed",
    );
    expect(Y.encodeStateAsUpdate(target)).toEqual(original);
  });

  it("keeps peer edits when a retried local addition is already resident", () => {
    const original = room(postDocument(), "post");
    const local = clone(original);
    const current = clone(original);
    const before = snapshot(local, "post");
    insertRichTextBlockNode(local, paragraph(D, 1));
    insertRichTextBlockLocale(
      local,
      fromJson(RichTextBlockLocaleSchema, {
        blockId: D,
        paragraph: { props: {}, content: [{ text: { text: "local" } }] },
      }),
    );
    const after = snapshot(local, "post");
    insertRichTextBlockNode(current, paragraph(D, 1));
    insertRichTextBlockLocale(
      current,
      fromJson(RichTextBlockLocaleSchema, {
        blockId: D,
        paragraph: { props: {}, content: [{ text: { text: "peer" } }] },
      }),
    );
    setBlockRoomAtomicValue(
      current,
      { id: D, family: "rich_text", path: "props.textColor" },
      "#abcabc",
    );

    replayBlockRoomChanges(current, [{ before, after }]);
    const result = snapshot(current, "post");
    expect(nodeIds(result)).toEqual([A, B, D]);
    expect(
      result.baseNodes.find((node) => node.id === D)?.payload,
    ).toMatchObject({ props: { textColor: "#abcabc" } });
    expect(
      result.localeOverlay.find((node) => node.id === D)?.payload,
    ).toMatchObject({ content: [{ text: { text: "peer" } }] });
  });

  it("inserts a new Page section and its nested blocks exactly once", () => {
    const original = room(pageDocument(), "page");
    const local = clone(original);
    const current = clone(original);
    const before = snapshot(local, "page");
    insertPageSectionNode(
      local,
      fromJson(PageSectionNodeSchema, {
        section: {
          id: F,
          richText: {
            props: {},
            blocks: {
              nodes: [
                {
                  block: { id: G, paragraph: { props: {} } },
                  placement: { index: 0 },
                },
              ],
            },
          },
        },
        placement: { index: 2 },
      }),
    );
    insertPageSectionLocale(
      local,
      fromJson(PageSectionLocaleSchema, {
        sectionId: F,
        richText: {
          props: {},
          blocks: {
            locale: "ko",
            blocks: [
              {
                blockId: G,
                paragraph: { props: {}, content: [{ text: { text: "e" } }] },
              },
            ],
          },
        },
      }),
    );
    const after = snapshot(local, "page");

    replayBlockRoomChanges(current, [{ before, after }]);
    const result = snapshot(current, "page");
    expect(
      result.baseNodes.filter(({ id }) => id === F || id === G),
    ).toHaveLength(2);
    expect(
      result.localeOverlay.filter(({ id }) => id === F || id === G),
    ).toHaveLength(2);
  });

  it("keeps a new descendant absent when a peer deleted its observed parent", () => {
    const original = room(pageDocument(), "page");
    const local = clone(original);
    const current = clone(original);
    const before = snapshot(local, "page");
    insertRichTextBlockNode(local, paragraph(F, 0), { pageSectionId: A });
    insertRichTextBlockLocale(
      local,
      fromJson(RichTextBlockLocaleSchema, {
        blockId: F,
        paragraph: { props: {}, content: [] },
      }),
    );
    const after = snapshot(local, "page");
    deleteBlockRoomBaseNode(current, A);

    replayBlockRoomChanges(current, [{ before, after }]);
    const result = snapshot(current, "page");
    expect(nodeIds(result)).toEqual([B, D]);
    expect(result.localeOverlay.map(({ id }) => id)).toEqual([B, D]);
  });

  it("orders simultaneous additions with tied positions in separate containers", () => {
    const original = room(pageDocument(), "page");
    const local = clone(original);
    const current = clone(original);
    const before = snapshot(local, "page");
    insertRichTextBlockNode(local, paragraph(F, 0), { pageSectionId: A });
    insertRichTextBlockLocale(
      local,
      fromJson(RichTextBlockLocaleSchema, {
        blockId: F,
        paragraph: { props: {}, content: [] },
      }),
    );
    insertRichTextBlockNode(local, paragraph(G, 0), { pageSectionId: B });
    insertRichTextBlockLocale(
      local,
      fromJson(RichTextBlockLocaleSchema, {
        blockId: G,
        paragraph: { props: {}, content: [] },
      }),
    );
    const after = snapshot(local, "page");

    replayBlockRoomChanges(current, [{ before, after }]);
    const result = snapshot(current, "page");
    expect(result.baseNodes.find(({ id }) => id === F)?.parentId).toBe(A);
    expect(result.baseNodes.find(({ id }) => id === G)?.parentId).toBe(B);
  });

  it("replays explicit subtree deletion over unseen peer descendants", () => {
    const original = room(pageDocument(), "page");
    const local = clone(original);
    const current = clone(original);
    const before = snapshot(local, "page");
    deleteBlockRoomBaseNode(local, A);
    const after = snapshot(local, "page");
    insertRichTextBlockNode(current, paragraph(F, 0), { pageSectionId: A });
    insertRichTextBlockLocale(
      current,
      fromJson(RichTextBlockLocaleSchema, {
        blockId: F,
        paragraph: { props: {}, content: [] },
      }),
    );

    replayBlockRoomChanges(current, [{ before, after }]);
    expect(nodeIds(snapshot(current, "page"))).toEqual([B, D]);
  });

  it("orders multiple escaping children before deleting their old section", () => {
    const original = room(pageDocument(), "page");
    const local = clone(original);
    const current = clone(original);
    const before = snapshot(local, "page");
    moveRichTextBlockNode(local, C, { index: 0 }, { pageSectionId: B });
    moveRichTextBlockNode(local, E, { index: 1 }, { pageSectionId: B });
    deleteBlockRoomBaseNode(local, A);
    const after = snapshot(local, "page");

    replayBlockRoomChanges(current, [{ before, after }]);
    const result = snapshot(current, "page");
    expect(result.baseNodes.find((node) => node.id === C)?.parentId).toBe(B);
    expect(result.baseNodes.find((node) => node.id === E)?.parentId).toBe(B);
    expect(nodeIds(result)).toContain(B);
    expect(nodeIds(result)).not.toContain(A);
  });

  it("sorts and applies multiple top-level subtree deletions", () => {
    const original = room(pageDocument(), "page");
    const local = clone(original);
    const current = clone(original);
    const before = snapshot(local, "page");
    deleteBlockRoomBaseNode(local, A);
    deleteBlockRoomBaseNode(local, B);
    const after = snapshot(local, "page");

    replayBlockRoomChanges(current, [{ before, after }]);
    expect(snapshot(current, "page").baseNodes).toEqual([]);
  });

  it("walks a surviving ancestor chain for a leaf-only deletion", () => {
    const original = room(pageDocument(), "page");
    const local = clone(original);
    const current = clone(original);
    const before = snapshot(local, "page");
    deleteBlockRoomBaseNode(local, C);
    const after = snapshot(local, "page");

    replayBlockRoomChanges(current, [{ before, after }]);
    expect(nodeIds(snapshot(current, "page"))).toEqual([A, B, D, E]);
  });

  it("does not resurrect a moved child under a peer-deleted ancestor", () => {
    const original = room(pageDocument(), "page");
    const local = clone(original);
    const current = clone(original);
    const before = snapshot(local, "page");
    moveRichTextBlockNode(local, D, { index: 0 }, { pageSectionId: A });
    const after = snapshot(local, "page");
    deleteBlockRoomBaseNode(current, A);

    replayBlockRoomChanges(current, [{ before, after }]);
    const result = snapshot(current, "page");
    expect(nodeIds(result)).toEqual([B, D]);
    expect(result.baseNodes.find((node) => node.id === D)?.parentId).toBe(B);
  });

  it("replays a section move between parent containers and keeps stable order", () => {
    const original = room(pageDocument(), "page");
    const local = clone(original);
    const current = clone(original);
    const before = snapshot(local, "page");
    movePageSectionNode(local, B, { index: 0 });
    const after = snapshot(local, "page");

    replayBlockRoomChanges(current, [{ before, after }]);
    const result = snapshot(current, "page");
    const moved = result.baseNodes.find((node) => node.id === B);
    expect(moved?.parentId).toBeNull();
    expect(moved?.position).toBe(0);
    expect(nodeIds(result)).toContain(B);
  });

  it("replays a valid nested-block hierarchy inversion without creating a cycle", () => {
    const original = room(postDocument(), "post");
    const local = clone(original);
    moveRichTextBlockNode(local, B, { parentBlockId: A, index: 0 });
    const current = clone(local);
    const before = snapshot(local, "post");
    expect(before.baseNodes.find(({ id }) => id === B)?.parentId).toBe(A);

    moveRichTextBlockNode(local, B, { index: 1 });
    moveRichTextBlockNode(local, A, { parentBlockId: B, index: 0 });
    const after = snapshot(local, "post");
    expect(after.baseNodes.find(({ id }) => id === B)?.parentId).toBeNull();
    expect(after.baseNodes.find(({ id }) => id === A)?.parentId).toBe(B);

    replayBlockRoomChanges(current, [{ before, after }]);
    const result = snapshot(current, "post");
    expect(result.baseNodes.find(({ id }) => id === B)?.parentId).toBeNull();
    expect(result.baseNodes.find(({ id }) => id === A)?.parentId).toBe(B);
  });

  it("moves a rich-text block into a peer section while retaining other peer content", () => {
    const original = room(pageDocument(), "page");
    const local = clone(original);
    const current = clone(original);
    const before = snapshot(local, "page");
    moveRichTextBlockNode(local, C, { index: 0 }, { pageSectionId: B });
    const after = snapshot(local, "page");
    insertRichTextBlockNode(current, paragraph(F, 0), { pageSectionId: B });
    insertRichTextBlockLocale(
      current,
      fromJson(RichTextBlockLocaleSchema, {
        blockId: F,
        paragraph: { props: {}, content: [] },
      }),
    );

    replayBlockRoomChanges(current, [{ before, after }]);
    const result = snapshot(current, "page");
    expect(result.baseNodes.find((node) => node.id === C)?.parentId).toBe(B);
    expect(result.baseNodes.find((node) => node.id === F)?.parentId).toBe(B);
  });

  it("orders more than one reordered base node by the desired stable order", () => {
    const doc = fromJson(LocalizedRichTextDocumentSchema, {
      blockCatalogFingerprint: contentBlockCatalogFingerprint,
      profile: RichTextProfile.POST,
      locale: "ko",
      base: {
        nodes: [A, B, E].map((id, index) => ({
          block: { id, paragraph: { props: {} } },
          placement: { index },
        })),
      },
      localeOverlay: {
        locale: "ko",
        blocks: [A, B, E].map((blockId) => ({
          blockId,
          paragraph: { props: {}, content: [] },
        })),
      },
    }) as LocalizedRichTextDocument;
    const original = room(doc, "post");
    const local = clone(original);
    const current = clone(original);
    const before = snapshot(local, "post");
    moveRichTextBlockNode(local, E, { index: 0 });
    moveRichTextBlockNode(local, A, { index: 2 });
    const after = snapshot(local, "post");
    expect(orderedIds(after)).toEqual([E, B, A]);

    replayBlockRoomChanges(current, [{ before, after }]);
    expect(orderedIds(snapshot(current, "post"))).toEqual([E, B, A]);
  });

  it("replays multiple reorder intents around a peer addition and deletion", () => {
    const doc = fromJson(LocalizedRichTextDocumentSchema, {
      blockCatalogFingerprint: contentBlockCatalogFingerprint,
      profile: RichTextProfile.POST,
      locale: "ko",
      base: {
        nodes: [A, B, E].map((id, index) => ({
          block: { id, paragraph: { props: {} } },
          placement: { index },
        })),
      },
      localeOverlay: {
        locale: "ko",
        blocks: [A, B, E].map((blockId) => ({
          blockId,
          paragraph: { props: {}, content: [] },
        })),
      },
    }) as LocalizedRichTextDocument;
    const original = room(doc, "post");
    const local = clone(original);
    const current = clone(original);
    const before = snapshot(local, "post");
    moveRichTextBlockNode(local, E, { index: 0 });
    moveRichTextBlockNode(local, A, { index: 2 });
    const after = snapshot(local, "post");

    insertRichTextBlockNode(current, paragraph(D, 1));
    insertRichTextBlockLocale(
      current,
      fromJson(RichTextBlockLocaleSchema, {
        blockId: D,
        paragraph: { props: {}, content: [{ text: { text: "peer" } }] },
      }),
    );
    deleteBlockRoomBaseNode(current, B);

    replayBlockRoomChanges(current, [{ before, after }]);
    expect(orderedIds(snapshot(current, "post"))).toEqual([D, E, A]);
  });

  it("keeps independent cross-container moves stable when their positions tie", () => {
    const original = room(pageDocument(), "page");
    const local = clone(original);
    const current = clone(original);
    const before = snapshot(local, "page");
    moveRichTextBlockNode(local, C, { index: 0 }, { pageSectionId: B });
    moveRichTextBlockNode(local, D, { index: 0 }, { pageSectionId: A });
    const after = snapshot(local, "page");
    expect(after.baseNodes.find((node) => node.id === C)?.position).toBe(0);
    expect(after.baseNodes.find((node) => node.id === D)?.position).toBe(0);

    replayBlockRoomChanges(current, [{ before, after }]);
    const result = snapshot(current, "page");
    expect(result.baseNodes.find((node) => node.id === C)?.parentId).toBe(B);
    expect(result.baseNodes.find((node) => node.id === D)?.parentId).toBe(A);
  });

  it("uses safe destination indices for empty section and column containers", () => {
    const sectionOriginal = room(emptyRichTextSectionsPageDocument(), "page");
    const sectionLocal = clone(sectionOriginal);
    const sectionCurrent = clone(sectionOriginal);
    const sectionBefore = snapshot(sectionLocal, "page");
    moveRichTextBlockNode(sectionLocal, C, { index: 0 }, { pageSectionId: B });
    const sectionAfter = snapshot(sectionLocal, "page");
    replayBlockRoomChanges(sectionCurrent, [
      { before: sectionBefore, after: sectionAfter },
    ]);
    expect(
      snapshot(sectionCurrent, "page").baseNodes.find(({ id }) => id === C)
        ?.parentId,
    ).toBe(B);

    const columnOriginal = room(columnsPageDocument(), "page");
    const columnLocal = clone(columnOriginal);
    const columnCurrent = clone(columnOriginal);
    const columnBefore = snapshot(columnLocal, "page");
    movePageSectionNode(columnLocal, B, {
      parentSectionId: A,
      columnId: COLUMN_A,
      index: 0,
    });
    const columnAfter = snapshot(columnLocal, "page");
    replayBlockRoomChanges(columnCurrent, [
      { before: columnBefore, after: columnAfter },
    ]);
    const moved = snapshot(columnCurrent, "page").baseNodes.find(
      ({ id }) => id === B,
    );
    expect(moved?.parentId).toBe(A);
    expect(moved?.columnId).toBe(COLUMN_A);
  });

  it("skips a move when the peer already deleted the moved node", () => {
    const original = room(postDocument(), "post");
    const local = clone(original);
    const current = clone(original);
    const before = snapshot(local, "post");
    moveRichTextBlockNode(local, B, { index: 0 });
    const after = snapshot(local, "post");
    deleteBlockRoomBaseNode(current, B);

    replayBlockRoomChanges(current, [{ before, after }]);
    expect(nodeIds(snapshot(current, "post"))).toEqual([A]);
  });

  it("rejects a moved node whose peer changed its canonical kind", () => {
    const original = room(pageDocument(), "page");
    const local = clone(original);
    const current = clone(original);
    const before = snapshot(local, "page");
    moveRichTextBlockNode(local, D, { index: 0 }, { pageSectionId: A });
    const after = snapshot(local, "page");
    replaceRichTextBlockData(
      current,
      D,
      fromJson(RichTextBlockDataSchema, {
        heading: { props: { level: 2 } },
      }),
      {
        expectedKind: "paragraph",
        localeData: fromJson(RichTextBlockLocaleDataSchema, {
          heading: { props: {}, content: [] },
        }),
      },
    );
    const originalCurrent = Y.encodeStateAsUpdate(current);

    expect(() => replayBlockRoomChanges(current, [{ before, after }])).toThrow(
      `block_room_invalid:replay:kind_changed:${D}`,
    );
    expect(Y.encodeStateAsUpdate(current)).toEqual(originalCurrent);
  });

  it("rejects a local base-payload edit when a peer changed that node kind", () => {
    const original = room(postDocument(), "post");
    const local = clone(original);
    const current = clone(original);
    const before = snapshot(local, "post");
    setBlockRoomAtomicValue(
      local,
      { id: A, family: "rich_text", path: "props.textColor" },
      "#ff0000",
    );
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
          heading: { props: {}, content: [] },
        }),
      },
    );
    const originalCurrent = Y.encodeStateAsUpdate(current);

    expect(() => replayBlockRoomChanges(current, [{ before, after }])).toThrow(
      `block_room_invalid:replay:kind_changed:${A}`,
    );
    expect(Y.encodeStateAsUpdate(current)).toEqual(originalCurrent);
  });

  it("replays a block moved under another rich-text block", () => {
    const original = room(nestedRichTextPageDocument(), "page");
    const local = clone(original);
    const current = clone(original);
    const before = snapshot(local, "page");
    moveRichTextBlockNode(local, D, { parentBlockId: C, index: 0 });
    const after = snapshot(local, "page");

    replayBlockRoomChanges(current, [{ before, after }]);
    expect(
      snapshot(current, "page").baseNodes.find(({ id }) => id === D)?.parentId,
    ).toBe(C);
  });

  it("does not repeat a base deletion already committed by a peer", () => {
    const original = room(postDocument(), "post");
    const local = clone(original);
    const current = clone(original);
    const before = snapshot(local, "post");
    deleteBlockRoomBaseNode(local, B);
    const after = snapshot(local, "post");
    deleteBlockRoomBaseNode(current, B);

    replayBlockRoomChanges(current, [{ before, after }]);
    expect(nodeIds(snapshot(current, "post"))).toEqual([A]);
  });
});
