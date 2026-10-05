import { create, fromJson } from "@bufbuild/protobuf";
import { contentBlockCatalogFingerprint } from "@echovisionlab/geul-proto/content/block_catalog.ts";
import {
  LocalizedPageDocumentSchema,
  LocalizedRichTextDocumentSchema,
  RichTextBlockLocaleSchema,
  RichTextBlockNodeSchema,
  RichTextProfile,
  type LocalizedPageDocument,
  type LocalizedRichTextDocument,
} from "@echovisionlab/geul-proto/content/block_content_pb.ts";
import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import { hydrateCanonicalBlockRoom } from "../block-room-codec.ts";
import {
  blockRoomBaseNodes,
  blockRoomBaseOrder,
  blockRoomLocaleOverlay,
  decodeCanonicalBlockRoom,
  type BlockRoomBaseNodeSnapshot,
  type BlockRoomLocaleNodeSnapshot,
} from "./materialization.ts";
import { orderContainerKey } from "./internal.ts";
import {
  baseDepth,
  compareBaseState,
  currentBaseNodes,
  currentNodeType,
  destinationUnderDeletedObservedAncestor,
  insertBaseNode,
  insertLocaleNode,
  localeNodeDeleteOrder,
  longestCommonSubsequence,
  movedBaseIds,
  nodeMap,
  safeIndex,
  sameContainer,
  sameNodeType,
  stableTreeAnchor,
  validateSnapshotDocument,
} from "./replay-structure.ts";

const SECTION = "f8490e65-ecbd-41e7-b5b1-308e419c9301";
const CHILD_SECTION = "f8490e65-ecbd-41e7-b5b1-308e419c9302";
const BLOCK_A = "f8490e65-ecbd-41e7-b5b1-308e419c9303";
const BLOCK_B = "f8490e65-ecbd-41e7-b5b1-308e419c9304";
const BLOCK_C = "f8490e65-ecbd-41e7-b5b1-308e419c9305";

function richDocument(ids: readonly string[] = [BLOCK_A, BLOCK_B]) {
  return fromJson(LocalizedRichTextDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    profile: RichTextProfile.POST,
    locale: "ko",
    base: {
      nodes: ids.map((id, index) => ({
        block: { id, paragraph: { props: { textColor: "#111111" } } },
        placement: { index },
      })),
    },
    localeOverlay: {
      locale: "ko",
      blocks: ids.map((blockId) => ({
        blockId,
        paragraph: { props: {}, content: [] },
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
            id: CHILD_SECTION,
            externalVideo: { props: { uri: "https://example.com/video" } },
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
                { blockId: BLOCK_A, paragraph: { props: {}, content: [] } },
              ],
            },
          },
        },
        {
          sectionId: CHILD_SECTION,
          externalVideo: { props: { caption: "video" } },
        },
      ],
    },
  }) as LocalizedPageDocument;
}

function emptyRichTextSectionPage(): LocalizedPageDocument {
  return fromJson(LocalizedPageDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    locale: "ko",
    base: {
      nodes: [
        {
          section: { id: SECTION, richText: { props: {} } },
          placement: { index: 0 },
        },
      ],
    },
    localeOverlay: {
      locale: "ko",
      sections: [{ sectionId: SECTION, richText: { props: {} } }],
    },
  }) as LocalizedPageDocument;
}

function hydrated(
  type: "post" | "page",
  document: LocalizedRichTextDocument | LocalizedPageDocument,
): Y.Doc {
  const yDocument = new Y.Doc();
  hydrateCanonicalBlockRoom(yDocument, type, "ko", document, []);
  return yDocument;
}

function emptyRichRoom(): Y.Doc {
  return hydrated("post", richDocument([]));
}

function emptyPageRoom(): Y.Doc {
  return hydrated(
    "page",
    fromJson(LocalizedPageDocumentSchema, {
      blockCatalogFingerprint: contentBlockCatalogFingerprint,
      locale: "ko",
      base: { nodes: [] },
      localeOverlay: { locale: "ko", sections: [] },
    }) as LocalizedPageDocument,
  );
}

function baseNode(
  id: string,
  overrides: Partial<BlockRoomBaseNodeSnapshot> = {},
): BlockRoomBaseNodeSnapshot {
  return {
    id,
    family: "rich_text",
    kind: "paragraph",
    payload: { props: {} },
    parentId: null,
    containerSlot: "root",
    position: 0,
    ...overrides,
  };
}

function localeNode(
  id: string,
  family: BlockRoomLocaleNodeSnapshot["family"] = "rich_text",
): BlockRoomLocaleNodeSnapshot {
  return { id, family, kind: "paragraph", payload: { props: {} } };
}

describe("replay structure edge cases", () => {
  it("compares base state across identity, type, container, order, and payload changes", () => {
    const a = baseNode(BLOCK_A);
    const b = baseNode(BLOCK_B, { position: 1 });
    expect(
      compareBaseState(
        [a, b],
        [baseNode(BLOCK_A, { position: 1 }), baseNode(BLOCK_B)],
      ),
    ).toBe(false);
    expect(compareBaseState([a], [{ ...a }])).toBe(true);
    expect(compareBaseState([a], [])).toBe(false);
    expect(() => nodeMap([a, a])).toThrow(`replay:duplicate_id:${BLOCK_A}`);
    expect(sameContainer(a, { ...a, columnId: "column" })).toBe(false);
    expect(sameContainer(a, { ...a })).toBe(true);
    expect(sameNodeType(a, { family: "page_section", kind: "paragraph" })).toBe(
      false,
    );
    expect(sameNodeType(a, { family: "rich_text", kind: "paragraph" })).toBe(
      true,
    );
    expect(longestCommonSubsequence(["a", "b"], ["b", "a"])).toEqual(
      new Set(["b"]),
    );
    expect(longestCommonSubsequence(["b", "a"], ["a", "b"])).toEqual(
      new Set(["a"]),
    );
  });

  it("finds moved nodes and rejects kind changes and duplicate snapshot IDs", () => {
    const before = [
      baseNode(BLOCK_A, { position: 0 }),
      baseNode(BLOCK_B, { position: 1 }),
      baseNode(BLOCK_C, { position: 2 }),
    ];
    const reordered = [
      baseNode(BLOCK_B, { position: 0 }),
      baseNode(BLOCK_C, { position: 1 }),
      baseNode(BLOCK_A, { position: 2 }),
      baseNode("f8490e65-ecbd-41e7-b5b1-308e419c9306", { position: 3 }),
    ];
    expect([...movedBaseIds(before, reordered)]).toEqual([BLOCK_A]);
    expect(
      movedBaseIds(
        [baseNode(BLOCK_A)],
        [baseNode(BLOCK_A, { parentId: SECTION })],
      ),
    ).toEqual(new Set([BLOCK_A]));
    expect(movedBaseIds(before, before)).toEqual(new Set());
    expect(() =>
      movedBaseIds(
        [baseNode(BLOCK_A)],
        [baseNode(BLOCK_A, { kind: "heading" })],
      ),
    ).toThrow(`replay:kind_changed:${BLOCK_A}`);
    expect(() =>
      movedBaseIds([baseNode(BLOCK_A), baseNode(BLOCK_A)], []),
    ).toThrow(`replay:duplicate_id:${BLOCK_A}`);
  });

  it("reads node types and base nodes while validating malformed Y shapes", () => {
    const document = hydrated("post", richDocument([BLOCK_A]));
    const nodes = blockRoomBaseNodes(document);
    expect(currentBaseNodes(document, "post").has(BLOCK_A)).toBe(true);
    expect(currentNodeType(nodes, "missing")).toBeUndefined();
    expect(currentNodeType(nodes, BLOCK_A)).toEqual({
      family: "rich_text",
      kind: "paragraph",
    });
    const page = hydrated("page", pageDocument());
    expect(currentNodeType(blockRoomBaseNodes(page), SECTION)).toEqual({
      family: "page_section",
      kind: "richText",
    });

    nodes.set("bad-shape", { family: "rich_text" });
    expect(() => currentNodeType(nodes, "bad-shape")).toThrow(
      "replay:node_shape:bad-shape",
    );
    const badType = new Y.Map<unknown>();
    badType.set("family", "unsupported");
    badType.set("kind", "paragraph");
    nodes.set("bad-type", badType);
    expect(() => currentNodeType(nodes, "bad-type")).toThrow(
      "replay:node_type:bad-type",
    );
    const emptyKind = new Y.Map<unknown>();
    emptyKind.set("family", "rich_text");
    emptyKind.set("kind", "");
    nodes.set("empty-kind", emptyKind);
    expect(() => currentNodeType(nodes, "empty-kind")).toThrow(
      "replay:node_type:empty-kind",
    );
  });

  it("uses stable tree anchors and safe indexes for existing and absent containers", () => {
    const document = hydrated("post", richDocument([BLOCK_A, BLOCK_B]));
    const snapshot = decodeCanonicalBlockRoom(document, "post");
    const node = {
      ...snapshot.baseNodes[0]!,
      id: BLOCK_C,
      position: 1,
    };
    expect(stableTreeAnchor(document, snapshot.baseNodes, node)).toBeDefined();
    expect(
      safeIndex(
        document,
        snapshot.baseNodes.find(({ id }) => id === BLOCK_A)!,
      ),
    ).toBe(2);

    const missingContainer = { ...node, containerSlot: "missing" };
    expect(stableTreeAnchor(document, [], missingContainer)).toBeUndefined();
    expect(safeIndex(document, missingContainer)).toBe(0);

    blockRoomBaseOrder(document).set(
      orderContainerKey(null, node.containerSlot),
      new Y.Map<unknown>(),
    );
    expect(() => stableTreeAnchor(document, [], node)).toThrow(
      `replay:order_shape:${BLOCK_C}`,
    );
    expect(() => safeIndex(document, node)).toThrow(
      `replay:order_shape:${BLOCK_C}`,
    );
  });

  it("computes ancestor depth and distinguishes deleted, unknown, and cyclic parents", () => {
    const root = baseNode(SECTION, { family: "page_section", parentId: null });
    const child = baseNode(BLOCK_A, {
      parentId: SECTION,
      containerSlot: "content",
    });
    const nested = new Map([
      [SECTION, root],
      [BLOCK_A, child],
    ]);
    expect(baseDepth(nested, SECTION)).toBe(0);
    expect(baseDepth(nested, BLOCK_A)).toBe(1);
    expect(baseDepth(nested, "absent")).toBe(0);
    expect(() =>
      baseDepth(
        new Map([[BLOCK_A, baseNode(BLOCK_A, { parentId: SECTION })]]),
        BLOCK_A,
      ),
    ).toThrow(`replay:missing_parent:${BLOCK_A}:${SECTION}`);
    expect(() =>
      baseDepth(
        new Map([
          [BLOCK_A, baseNode(BLOCK_A, { parentId: BLOCK_B })],
          [BLOCK_B, baseNode(BLOCK_B, { parentId: BLOCK_A })],
        ]),
        BLOCK_A,
      ),
    ).toThrow(`replay:parent_cycle:${BLOCK_A}`);

    const after = new Map([
      [SECTION, root],
      [BLOCK_A, child],
    ]);
    expect(
      destinationUnderDeletedObservedAncestor(
        "new",
        BLOCK_A,
        nested,
        after,
        new Set([BLOCK_A]),
      ),
    ).toBe(true);
    expect(
      destinationUnderDeletedObservedAncestor(
        "new",
        SECTION,
        new Map(),
        after,
        new Set([SECTION]),
      ),
    ).toBe(false);
    expect(() =>
      destinationUnderDeletedObservedAncestor(
        "new",
        "missing",
        new Map(),
        after,
        new Set(),
      ),
    ).toThrow("replay:missing_parent:new:missing");
    expect(() =>
      destinationUnderDeletedObservedAncestor(
        "new",
        BLOCK_A,
        new Map(),
        new Map([[BLOCK_A, baseNode(BLOCK_A, { parentId: "new" })]]),
        new Set(),
      ),
    ).toThrow("replay:parent_cycle:new");
  });

  it("inserts typed rich-text and Page nodes while filtering unrequested nested children", () => {
    const richAfterDocument = richDocument([BLOCK_A, BLOCK_B, BLOCK_C]);
    const richAfterRoom = hydrated("post", richAfterDocument);
    const richAfter = decodeCanonicalBlockRoom(richAfterRoom, "post");
    const richTarget = richAfter.baseNodes.find(({ id }) => id === BLOCK_C)!;
    const richCurrent = hydrated("post", richDocument([BLOCK_A, BLOCK_B]));
    insertBaseNode(
      richCurrent,
      "post",
      richAfter,
      richTarget,
      new Set([BLOCK_C]),
    );
    expect(blockRoomBaseNodes(richCurrent).has(BLOCK_C)).toBe(true);

    const targetPageDocument = pageDocument();
    const targetPageRoom = hydrated("page", targetPageDocument);
    const targetPage = decodeCanonicalBlockRoom(targetPageRoom, "page");
    const sectionTarget = targetPage.baseNodes.find(
      ({ id }) => id === SECTION,
    )!;
    const sectionOnly = emptyPageRoom();
    insertBaseNode(
      sectionOnly,
      "page",
      targetPage,
      sectionTarget,
      new Set([SECTION]),
    );
    expect(blockRoomBaseNodes(sectionOnly).has(SECTION)).toBe(true);
    expect(blockRoomBaseNodes(sectionOnly).has(BLOCK_A)).toBe(false);

    const sectionAndChild = emptyPageRoom();
    insertBaseNode(
      sectionAndChild,
      "page",
      targetPage,
      sectionTarget,
      new Set([SECTION, BLOCK_A]),
    );
    expect(blockRoomBaseNodes(sectionAndChild).has(BLOCK_A)).toBe(true);

    const missingChildIdentity = decodeCanonicalBlockRoom(
      hydrated("page", pageDocument()),
      "page",
    );
    const missingChildIdentityDocument =
      missingChildIdentity.document as LocalizedPageDocument;
    const sectionWithMissingChildIdentity =
      missingChildIdentityDocument.base?.nodes.find(
        (node) => node.section?.id === SECTION,
      )?.section?.value;
    if (sectionWithMissingChildIdentity?.case === "richText") {
      sectionWithMissingChildIdentity.value.blocks?.nodes.push(
        create(RichTextBlockNodeSchema),
      );
    }
    const filteredMissingIdentity = emptyPageRoom();
    insertBaseNode(
      filteredMissingIdentity,
      "page",
      missingChildIdentity,
      missingChildIdentity.baseNodes.find(({ id }) => id === SECTION)!,
      new Set([SECTION]),
    );
    expect(blockRoomBaseNodes(filteredMissingIdentity).has(BLOCK_A)).toBe(
      false,
    );

    const videoTarget = targetPage.baseNodes.find(
      ({ id }) => id === CHILD_SECTION,
    )!;
    insertBaseNode(
      emptyPageRoom(),
      "page",
      targetPage,
      videoTarget,
      new Set([CHILD_SECTION]),
    );

    const targetWithoutChildren = decodeCanonicalBlockRoom(
      hydrated("page", emptyRichTextSectionPage()),
      "page",
    );
    const targetWithoutChildrenDocument =
      targetWithoutChildren.document as LocalizedPageDocument;
    const targetSectionWithoutBlocks =
      targetWithoutChildrenDocument.base?.nodes[0]?.section?.value;
    if (targetSectionWithoutBlocks?.case === "richText")
      delete targetSectionWithoutBlocks.value.blocks;
    const noChildrenRoom = emptyPageRoom();
    insertBaseNode(
      noChildrenRoom,
      "page",
      targetWithoutChildren,
      targetWithoutChildren.baseNodes[0]!,
      new Set([SECTION]),
    );

    const nestedTarget = targetPage.baseNodes.find(({ id }) => id === BLOCK_A)!;
    const nestedCurrent = hydrated(
      "page",
      fromJson(LocalizedPageDocumentSchema, {
        blockCatalogFingerprint: contentBlockCatalogFingerprint,
        locale: "ko",
        base: {
          nodes: [
            {
              section: {
                id: SECTION,
                richText: { props: {}, blocks: { nodes: [] } },
              },
              placement: { index: 0 },
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
                blocks: { locale: "ko", blocks: [] },
              },
            },
          ],
        },
      }) as LocalizedPageDocument,
    );
    insertBaseNode(
      nestedCurrent,
      "page",
      targetPage,
      nestedTarget,
      new Set([BLOCK_A]),
    );
    expect(blockRoomBaseNodes(nestedCurrent).has(BLOCK_A)).toBe(true);
  });

  it("inserts locale nodes, skips deleted bases, and rejects missing typed nodes", () => {
    const pageRoom = hydrated("page", pageDocument());
    const pageSnapshot = decodeCanonicalBlockRoom(pageRoom, "page");
    const targetWithoutChildren = decodeCanonicalBlockRoom(
      hydrated("page", emptyRichTextSectionPage()),
      "page",
    );
    const targetWithoutChildrenDocument =
      targetWithoutChildren.document as LocalizedPageDocument;
    const targetLocaleWithoutBlocks =
      targetWithoutChildrenDocument.localeOverlay?.sections[0]?.value;
    if (targetLocaleWithoutBlocks?.case === "richText")
      delete targetLocaleWithoutBlocks.value.blocks;
    const empty = emptyPageRoom();
    insertBaseNode(
      empty,
      "page",
      pageSnapshot,
      pageSnapshot.baseNodes.find(({ id }) => id === SECTION)!,
      new Set([SECTION]),
    );
    insertLocaleNode(
      empty,
      pageSnapshot,
      pageSnapshot.localeOverlay.find(({ id }) => id === SECTION)!,
      new Set([SECTION]),
    );
    expect(
      decodeCanonicalBlockRoom(empty, "page").localeOverlay.some(
        ({ id }) => id === SECTION,
      ),
    ).toBe(true);

    const nestedLocale = emptyPageRoom();
    insertBaseNode(
      nestedLocale,
      "page",
      pageSnapshot,
      pageSnapshot.baseNodes.find(({ id }) => id === SECTION)!,
      new Set([SECTION, BLOCK_A]),
    );
    insertLocaleNode(
      nestedLocale,
      pageSnapshot,
      pageSnapshot.localeOverlay.find(({ id }) => id === SECTION)!,
      new Set([SECTION, BLOCK_A]),
    );
    expect(blockRoomLocaleOverlay(nestedLocale).has(BLOCK_A)).toBe(true);

    const missingLocaleChildIdentity = decodeCanonicalBlockRoom(
      hydrated("page", pageDocument()),
      "page",
    );
    const missingLocaleChildIdentityDocument =
      missingLocaleChildIdentity.document as LocalizedPageDocument;
    const localeSectionWithMissingChildIdentity =
      missingLocaleChildIdentityDocument.localeOverlay?.sections.find(
        (section) => section.sectionId === SECTION,
      )?.value;
    if (localeSectionWithMissingChildIdentity?.case === "richText") {
      localeSectionWithMissingChildIdentity.value.blocks?.blocks.push(
        create(RichTextBlockLocaleSchema, { blockId: "" }),
      );
    }
    const filteredMissingLocaleIdentity = emptyPageRoom();
    insertBaseNode(
      filteredMissingLocaleIdentity,
      "page",
      missingLocaleChildIdentity,
      missingLocaleChildIdentity.baseNodes.find(({ id }) => id === SECTION)!,
      new Set([SECTION, BLOCK_A]),
    );
    insertLocaleNode(
      filteredMissingLocaleIdentity,
      missingLocaleChildIdentity,
      missingLocaleChildIdentity.localeOverlay.find(
        ({ id }) => id === SECTION,
      )!,
      new Set([SECTION, BLOCK_A]),
    );
    expect(blockRoomLocaleOverlay(filteredMissingLocaleIdentity).has("")).toBe(
      false,
    );

    const deletedBase = emptyPageRoom();
    insertLocaleNode(
      deletedBase,
      pageSnapshot,
      pageSnapshot.localeOverlay.find(({ id }) => id === SECTION)!,
      new Set(),
    );
    expect(decodeCanonicalBlockRoom(deletedBase, "page").localeOverlay).toEqual(
      [],
    );

    const nestedBase = emptyPageRoom();
    insertBaseNode(
      nestedBase,
      "page",
      pageSnapshot,
      pageSnapshot.baseNodes.find(({ id }) => id === SECTION)!,
      new Set([SECTION]),
    );
    insertLocaleNode(
      nestedBase,
      pageSnapshot,
      pageSnapshot.localeOverlay.find(({ id }) => id === SECTION)!,
      new Set([SECTION]),
    );
    insertBaseNode(
      nestedBase,
      "page",
      pageSnapshot,
      pageSnapshot.baseNodes.find(({ id }) => id === BLOCK_A)!,
      new Set([BLOCK_A]),
    );
    insertLocaleNode(
      nestedBase,
      pageSnapshot,
      pageSnapshot.localeOverlay.find(({ id }) => id === BLOCK_A)!,
      new Set([BLOCK_A]),
    );
    insertBaseNode(
      nestedBase,
      "page",
      pageSnapshot,
      pageSnapshot.baseNodes.find(({ id }) => id === CHILD_SECTION)!,
      new Set([CHILD_SECTION]),
    );
    insertLocaleNode(
      nestedBase,
      pageSnapshot,
      pageSnapshot.localeOverlay.find(({ id }) => id === CHILD_SECTION)!,
      new Set([CHILD_SECTION]),
    );
    expect(blockRoomLocaleOverlay(nestedBase).has(BLOCK_A)).toBe(true);
    expect(blockRoomLocaleOverlay(nestedBase).has(CHILD_SECTION)).toBe(true);

    const noChildrenLocaleRoom = emptyPageRoom();
    insertBaseNode(
      noChildrenLocaleRoom,
      "page",
      targetWithoutChildren,
      targetWithoutChildren.baseNodes[0]!,
      new Set([SECTION]),
    );
    insertLocaleNode(
      noChildrenLocaleRoom,
      targetWithoutChildren,
      targetWithoutChildren.localeOverlay[0]!,
      new Set([SECTION]),
    );

    expect(() =>
      insertBaseNode(
        emptyPageRoom(),
        "page",
        pageSnapshot,
        baseNode(BLOCK_C, { family: "page_section" }),
        new Set(),
      ),
    ).toThrow(`replay:typed_node_missing:${BLOCK_C}`);
    expect(() =>
      insertLocaleNode(
        hydrated("page", pageDocument()),
        pageSnapshot,
        localeNode(BLOCK_C, "page_section"),
        new Set(),
      ),
    ).toThrow(`replay:typed_locale_missing:${BLOCK_C}`);

    const noNodesSnapshot = decodeCanonicalBlockRoom(emptyPageRoom(), "page");
    expect(() =>
      insertBaseNode(
        emptyPageRoom(),
        "page",
        noNodesSnapshot,
        baseNode(BLOCK_C, { family: "page_section" }),
        new Set(),
      ),
    ).toThrow(`replay:typed_node_missing:${BLOCK_C}`);
    expect(() =>
      insertLocaleNode(
        emptyPageRoom(),
        noNodesSnapshot,
        localeNode(BLOCK_C, "page_section"),
        new Set(),
      ),
    ).toThrow(`replay:typed_locale_missing:${BLOCK_C}`);

    expect(() =>
      insertBaseNode(
        emptyPageRoom(),
        "page",
        pageSnapshot,
        {
          ...pageSnapshot.baseNodes.find(({ id }) => id === SECTION)!,
          family: "rich_text",
        },
        new Set([SECTION]),
      ),
    ).toThrow(`replay:family:${SECTION}`);
    expect(() =>
      insertBaseNode(
        emptyPageRoom(),
        "post",
        pageSnapshot,
        pageSnapshot.baseNodes.find(({ id }) => id === SECTION)!,
        new Set([SECTION]),
      ),
    ).toThrow(`replay:family:${SECTION}`);
    expect(() =>
      insertLocaleNode(
        nestedBase,
        pageSnapshot,
        {
          ...pageSnapshot.localeOverlay.find(({ id }) => id === BLOCK_A)!,
          family: "page_section",
        },
        new Set([BLOCK_A]),
      ),
    ).toThrow(`replay:family:${BLOCK_A}`);
    expect(() =>
      insertLocaleNode(
        hydrated("page", pageDocument()),
        pageSnapshot,
        {
          ...pageSnapshot.localeOverlay.find(({ id }) => id === SECTION)!,
          family: "rich_text",
        },
        new Set(),
      ),
    ).toThrow(`replay:family:${SECTION}`);
  });

  it("uses typed default indexes for anchored page and rich-text inserts", () => {
    const pageAfter = decodeCanonicalBlockRoom(
      hydrated("page", pageDocument()),
      "page",
    );
    const pageTypedTarget = pageAfter.document.base?.nodes.find(
      (node) => "section" in node && node.section?.id === CHILD_SECTION,
    );
    expect(pageTypedTarget).toBeDefined();
    delete pageTypedTarget!.placement;
    const pageCurrent = hydrated("page", emptyRichTextSectionPage());
    insertBaseNode(
      pageCurrent,
      "page",
      pageAfter,
      pageAfter.baseNodes.find(({ id }) => id === CHILD_SECTION)!,
      new Set([CHILD_SECTION]),
    );
    expect(blockRoomBaseNodes(pageCurrent).has(CHILD_SECTION)).toBe(true);

    const richAfter = decodeCanonicalBlockRoom(
      hydrated("post", richDocument([BLOCK_A, BLOCK_B])),
      "post",
    );
    const richTypedTarget = richAfter.document.base?.nodes.find(
      (node) => "block" in node && node.block?.id === BLOCK_B,
    );
    expect(richTypedTarget).toBeDefined();
    delete richTypedTarget!.placement;
    const richCurrent = hydrated("post", richDocument([BLOCK_A]));
    insertBaseNode(
      richCurrent,
      "post",
      richAfter,
      richAfter.baseNodes.find(({ id }) => id === BLOCK_B)!,
      new Set([BLOCK_B]),
    );
    expect(blockRoomBaseNodes(richCurrent).has(BLOCK_B)).toBe(true);
  });

  it("validates canonical type, locale, uniqueness, and missing parents before insertion", () => {
    const room = hydrated("post", richDocument());
    const snapshot = decodeCanonicalBlockRoom(room, "post");
    expect(() =>
      validateSnapshotDocument(snapshot, "post", "ko"),
    ).not.toThrow();
    expect(() => validateSnapshotDocument(snapshot, "page", "ko")).toThrow(
      "replay:document_type:page",
    );
    expect(() => validateSnapshotDocument(snapshot, "post", "ja")).toThrow(
      "replay:locale_changed",
    );
    expect(() =>
      validateSnapshotDocument(
        {
          ...snapshot,
          baseNodes: [...snapshot.baseNodes, snapshot.baseNodes[0]!],
        },
        "post",
        "ko",
      ),
    ).toThrow(`replay:duplicate_id:${BLOCK_A}`);
    expect(() =>
      validateSnapshotDocument(
        {
          ...snapshot,
          localeOverlay: [
            ...snapshot.localeOverlay,
            snapshot.localeOverlay[0]!,
          ],
        },
        "post",
        "ko",
      ),
    ).toThrow(`replay:duplicate_id:${BLOCK_A}`);

    const nestedDoc = fromJson(LocalizedRichTextDocumentSchema, {
      blockCatalogFingerprint: contentBlockCatalogFingerprint,
      profile: RichTextProfile.POST,
      locale: "ko",
      base: {
        nodes: [
          {
            block: { id: BLOCK_A, paragraph: { props: {} } },
            placement: { index: 0 },
          },
          {
            block: { id: BLOCK_B, paragraph: { props: {} } },
            placement: { parentBlockId: BLOCK_A, index: 0 },
          },
        ],
      },
      localeOverlay: {
        locale: "ko",
        blocks: [
          { blockId: BLOCK_A, paragraph: { props: {}, content: [] } },
          { blockId: BLOCK_B, paragraph: { props: {}, content: [] } },
        ],
      },
    }) as LocalizedRichTextDocument;
    const after = decodeCanonicalBlockRoom(hydrated("post", nestedDoc), "post");
    const nested = after.baseNodes.find(({ id }) => id === BLOCK_B)!;
    expect(() =>
      insertBaseNode(
        emptyRichRoom(),
        "post",
        after,
        nested,
        new Set([BLOCK_B]),
      ),
    ).toThrow(`replay:missing_parent:${BLOCK_B}:${BLOCK_A}`);
  });

  it("orders deleted locales parent first and detects cycles and duplicate IDs", () => {
    const section = baseNode(SECTION, {
      family: "page_section",
      parentId: null,
    });
    const child = baseNode(BLOCK_A, { parentId: SECTION });
    expect(
      localeNodeDeleteOrder(
        [section, child],
        [localeNode(BLOCK_A), localeNode(SECTION, "page_section")],
        new Set([SECTION, BLOCK_A]),
      ),
    ).toEqual([SECTION, BLOCK_A]);
    expect(
      localeNodeDeleteOrder(
        [],
        [localeNode(BLOCK_B), localeNode(BLOCK_A)],
        new Set([BLOCK_B, BLOCK_A]),
      ),
    ).toEqual([BLOCK_A, BLOCK_B]);
    expect(
      localeNodeDeleteOrder(
        [],
        [localeNode(BLOCK_A), localeNode(SECTION, "page_section")],
        new Set([SECTION, BLOCK_A]),
      ),
    ).toEqual([SECTION, BLOCK_A]);
    expect(
      localeNodeDeleteOrder(
        [],
        [localeNode(SECTION, "page_section"), localeNode(BLOCK_A)],
        new Set([SECTION, BLOCK_A]),
      ),
    ).toEqual([SECTION, BLOCK_A]);
    expect(
      localeNodeDeleteOrder(
        [],
        [localeNode(SECTION, "page_section"), localeNode(BLOCK_A)],
        new Set([BLOCK_A, SECTION]),
      ),
    ).toEqual([SECTION, BLOCK_A]);
    expect(
      localeNodeDeleteOrder(
        [
          baseNode(BLOCK_A, { parentId: null }),
          baseNode(BLOCK_B, { parentId: BLOCK_A }),
        ],
        [localeNode(BLOCK_B), localeNode(BLOCK_A)],
        new Set([BLOCK_A, BLOCK_B]),
      ),
    ).toEqual([BLOCK_A, BLOCK_B]);
    expect(
      localeNodeDeleteOrder(
        [
          baseNode(BLOCK_A, { parentId: null }),
          baseNode(BLOCK_B, { parentId: BLOCK_A }),
        ],
        [localeNode(BLOCK_B), localeNode(BLOCK_A)],
        new Set([BLOCK_B, BLOCK_A]),
      ),
    ).toEqual([BLOCK_A, BLOCK_B]);
    expect(() =>
      localeNodeDeleteOrder(
        [section, section],
        [localeNode(SECTION, "page_section")],
        new Set([SECTION]),
      ),
    ).toThrow(`replay:duplicate_id:${SECTION}`);
    expect(() =>
      localeNodeDeleteOrder(
        [
          baseNode(BLOCK_A, { parentId: BLOCK_B }),
          baseNode(BLOCK_B, { parentId: BLOCK_A }),
          baseNode(BLOCK_C),
        ],
        [localeNode(BLOCK_A), localeNode(BLOCK_C)],
        new Set([BLOCK_A, BLOCK_C]),
      ),
    ).toThrow(`replay:parent_cycle:${BLOCK_A}`);
  });
});
