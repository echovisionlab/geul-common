import { fromJson, toJson } from "@bufbuild/protobuf";
import {
  contentBlockCatalogFingerprint,
  materializeLocalizedPageDocument,
  materializeLocalizedRichTextDocument,
} from "@echovisionlab/geul-proto/content/block_catalog.ts";
import {
  LocalizedPageDocumentSchema,
  LocalizedRichTextDocumentSchema,
  PageDocumentSchema,
  PageLocaleOverlaySchema,
  PageSectionLocaleSchema,
  PageSectionNodeSchema,
  RichTextBlockLocaleSchema,
  RichTextBlockDataSchema,
  RichTextBlockLocaleDataSchema,
  RichTextBlockNodeSchema,
  RichTextDocumentSchema,
  RichTextLocaleOverlaySchema,
  RichTextProfile,
  type LocalizedPageDocument,
  type LocalizedRichTextDocument,
  type PageDocument,
  type PageSectionLocale,
  type PageSectionNode,
  type RichTextBlockLocale,
  type RichTextBlockData,
  type RichTextBlockLocaleData,
  type RichTextBlockNode,
  type RichTextDocument,
} from "@echovisionlab/geul-proto/content/block_content_pb.ts";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  assertCanonicalBlockRoomParity as assertExactBlockRoomParity,
  canonicalBlockRoomDocumentBytes as canonicalExactBlockRoomDocumentBytes,
  createBlockRoomInsertionAnchor,
  decodeCanonicalBlockRoom,
  decodeCanonicalBlockRoomAffectedNodes,
  deleteBlockRoomAtomicValue,
  deleteBlockRoomBaseNode,
  deleteBlockRoomLocaleNode,
  deleteBlockRoomPayloadArrayItem,
  getBlockRoomAtomicValue,
  getBlockRoomCollaborativeText,
  hydrateCanonicalBlockRoom as hydrateExactBlockRoom,
  insertRichTextBlockLocale,
  insertRichTextBlockNode,
  insertPageSectionLocale,
  insertPageSectionNode,
  insertBlockRoomPayloadArrayItem,
  materializeCanonicalBlockRoom,
  mergeBlockRoomChangeSets,
  moveRichTextBlockNode,
  movePageSectionNode,
  moveBlockRoomPayloadArrayItem,
  observeBlockRoomChanges,
  observeCanonicalBlockRoom,
  replaceBlockRoomCollaborativeText,
  replaceBlockRoomPayloadArray,
  setBlockRoomAtomicValue,
  transactBlockRoom,
  replaceRichTextBlockData,
  roomLocale,
  roomLocaleRole,
  roomSourceLocale,
} from "./block-room-codec.js";
import {
  allBlockRoomLocaleValueTargets,
  markBlockRoomLocaleValuePresent,
} from "./block-room-codec/locale-presence.ts";

type AggregateDocument = RichTextDocument | PageDocument;
type ExactRoomDocument = LocalizedRichTextDocument | LocalizedPageDocument;

function exactRoomDocument(document: AggregateDocument): ExactRoomDocument {
  const locale = document.localeOverlays[0]?.locale;
  if (!locale) throw new Error("test fixture locale missing");
  return document.$typeName === "api.content.v1.PageDocument"
    ? materializeLocalizedPageDocument(document, locale)
    : materializeLocalizedRichTextDocument(document, locale);
}

function hydrateCanonicalBlockRoom(
  room: Y.Doc,
  documentType: Parameters<typeof hydrateExactBlockRoom>[1],
  document: AggregateDocument,
): void {
  hydrateExactBlockRoom(
    room,
    documentType,
    document.sourceLocale,
    exactRoomDocument(document),
    [],
  );
  if (document.localeOverlays[0]?.locale === document.sourceLocale) {
    for (const target of allBlockRoomLocaleValueTargets(room))
      markBlockRoomLocaleValuePresent(room, target);
  }
}

function canonicalBlockRoomDocumentBytes(
  documentType: Parameters<typeof canonicalExactBlockRoomDocumentBytes>[0],
  document: AggregateDocument | ExactRoomDocument,
): Uint8Array {
  return canonicalExactBlockRoomDocumentBytes(
    documentType,
    document.$typeName === "api.content.v1.PageDocument" ||
      document.$typeName === "api.content.v1.RichTextDocument"
      ? exactRoomDocument(document)
      : document,
  );
}

function assertCanonicalBlockRoomParity(
  room: Y.Doc,
  documentType: Parameters<typeof assertExactBlockRoomParity>[1],
  document: AggregateDocument,
): void {
  assertExactBlockRoomParity(room, documentType, exactRoomDocument(document));
}

const BLOCK_ID = "019cce25-dbc0-7d12-9f1f-735b1a6c6b13";
const BLOCK_ID_2 = "019cce25-dbc0-7d12-9f1f-735b1a6c6b14";
const BLOCK_ID_3 = "019cce25-dbc0-7d12-9f1f-735b1a6c6b15";
const SECTION_ID = "019cce25-f076-741b-aee6-bc0a81a7c506";
const RICH_SECTION_ID = "019cce26-19a4-78fd-bd6d-4f2e4fd93f4f";

function roomRoot(room: Y.Doc): Y.Map<unknown> {
  return room.getMap("block-document");
}

function roomBaseNodes(room: Y.Doc): Y.Map<unknown> {
  return roomRoot(room).get("baseNodes") as Y.Map<unknown>;
}

function roomBaseOrder(room: Y.Doc): Y.Map<unknown> {
  return roomRoot(room).get("baseOrder") as Y.Map<unknown>;
}

function roomLocaleNodes(room: Y.Doc): Y.Map<unknown> {
  return roomRoot(room).get("localeOverlay") as Y.Map<unknown>;
}

function clonedRoom(source: Y.Doc): Y.Doc {
  const clone = new Y.Doc();
  Y.applyUpdate(clone, Y.encodeStateAsUpdate(source));
  return clone;
}

function baseNode(room: Y.Doc, id: string): Y.Map<unknown> {
  return roomBaseNodes(room).get(id) as Y.Map<unknown>;
}

function localeNode(room: Y.Doc, id: string): Y.Map<unknown> {
  return roomLocaleNodes(room).get(id) as Y.Map<unknown>;
}

function richTextDocument(
  profile: RichTextProfile = RichTextProfile.POST,
): RichTextDocument {
  return fromJson(RichTextDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    profile,
    sourceLocale: "ko",
    base: {
      nodes: [
        {
          block: {
            id: BLOCK_ID,
            paragraph: { props: { backgroundColor: "#ffffff" } },
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
            paragraph: {
              props: {},
              content: [{ text: { text: "안녕하세요" } }],
            },
          },
        ],
      },
    ],
  }) as RichTextDocument;
}

function paragraphNode(id: string, index: number): RichTextBlockNode {
  return fromJson(RichTextBlockNodeSchema, {
    block: { id, paragraph: { props: {} } },
    placement: { index },
  }) as RichTextBlockNode;
}

function paragraphLocale(id: string, text: string): RichTextBlockLocale {
  return fromJson(RichTextBlockLocaleSchema, {
    blockId: id,
    paragraph: {
      props: {},
      content: [{ text: { text } }],
    },
  }) as RichTextBlockLocale;
}

function pageDocument(): PageDocument {
  return fromJson(PageDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    sourceLocale: "ko",
    base: {
      nodes: [
        {
          section: {
            id: SECTION_ID,
            settings: {
              backgroundColor: "#101010",
              paddingTop: 24,
              maxWidth: "MAX_WIDTH_NARROW",
            },
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
            sectionId: SECTION_ID,
            externalVideo: { props: { caption: "설명" } },
          },
        ],
      },
    ],
  }) as PageDocument;
}

function richTextPageDocument(): PageDocument {
  return fromJson(PageDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    sourceLocale: "ko",
    base: {
      nodes: [
        {
          section: {
            id: RICH_SECTION_ID,
            richText: {
              props: {},
              blocks: {
                nodes: [
                  {
                    block: { id: BLOCK_ID, paragraph: { props: {} } },
                    placement: { index: 0 },
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
        sections: [
          {
            sectionId: RICH_SECTION_ID,
            richText: {
              props: {},
              blocks: {
                locale: "ko",
                blocks: [
                  {
                    blockId: BLOCK_ID,
                    paragraph: {
                      props: {},
                      content: [{ text: { text: "페이지 본문" } }],
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    ],
  }) as PageDocument;
}

function expectSameDocument(
  actual: ExactRoomDocument,
  expected: RichTextDocument | PageDocument,
): void {
  const exactExpected = exactRoomDocument(expected);
  const schema =
    exactExpected.$typeName === "api.content.v1.LocalizedPageDocument"
      ? LocalizedPageDocumentSchema
      : LocalizedRichTextDocumentSchema;
  expect(toJson(schema, actual as never)).toEqual(
    toJson(schema, exactExpected as never),
  );
}

describe("block room codec", () => {
  it("round-trips one exact rich-text locale overlay", () => {
    const canonical = richTextDocument();
    const room = new Y.Doc();

    hydrateCanonicalBlockRoom(room, "post", canonical);

    expectSameDocument(materializeCanonicalBlockRoom(room, "post"), canonical);
    const snapshot = decodeCanonicalBlockRoom(room, "post");
    expect(snapshot.baseNodes).toHaveLength(1);
    expect(snapshot.localeOverlay).toHaveLength(1);
  });

  it("hydrates and materializes one exact target locale while retaining the source-owned graph", () => {
    const aggregate = richTextDocument();
    aggregate.localeOverlays.push(
      fromJson(RichTextLocaleOverlaySchema, {
        locale: "en",
        blocks: [
          {
            blockId: BLOCK_ID,
            paragraph: {
              props: {},
              content: [{ text: { text: "Hello" } }],
            },
          },
        ],
      }),
    );
    const target = materializeLocalizedRichTextDocument(aggregate, "en");
    const room = new Y.Doc();

    hydrateExactBlockRoom(room, "post", "ko", target, []);

    expect(roomSourceLocale(room)).toBe("ko");
    expect(roomLocale(room)).toBe("en");
    expect(roomLocaleRole(room)).toBe("target");
    expect(
      toJson(
        LocalizedRichTextDocumentSchema,
        materializeCanonicalBlockRoom(room, "post") as never,
      ),
    ).toEqual(toJson(LocalizedRichTextDocumentSchema, target));
    expect(() =>
      assertExactBlockRoomParity(room, "post", target),
    ).not.toThrow();
  });

  it.each([
    ["program-event", RichTextProfile.PROGRAM_EVENT],
    ["artist", RichTextProfile.COMPACT],
    ["label", RichTextProfile.COMPACT],
    ["release", RichTextProfile.COMPACT],
    ["campaign", RichTextProfile.EMAIL],
    ["email-template", RichTextProfile.EMAIL],
    ["terms-history", RichTextProfile.POLICY],
    ["privacy-history", RichTextProfile.POLICY],
  ] as const)(
    "round-trips the %s resident rich-text profile",
    (documentType, profile) => {
      const canonical = richTextDocument(profile);
      const room = new Y.Doc();

      hydrateCanonicalBlockRoom(room, documentType, canonical);

      expectSameDocument(
        materializeCanonicalBlockRoom(room, documentType),
        canonical,
      );
    },
  );

  it("round-trips a typed Page aggregate", () => {
    const canonical = pageDocument();
    const room = new Y.Doc();

    hydrateCanonicalBlockRoom(room, "page", canonical);

    expectSameDocument(materializeCanonicalBlockRoom(room, "page"), canonical);
  });

  it("flattens Page rich-text descendants as independently editable room nodes", () => {
    const canonical = richTextPageDocument();
    const room = new Y.Doc();

    hydrateCanonicalBlockRoom(room, "page", canonical);

    const snapshot = decodeCanonicalBlockRoom(room, "page");
    expect(snapshot.baseNodes).toHaveLength(2);
    const section = snapshot.baseNodes.find(
      (node) => node.id === RICH_SECTION_ID,
    )!;
    const block = snapshot.baseNodes.find((node) => node.id === BLOCK_ID)!;
    expect(section.family).toBe("page_section");
    expect(section.containerSlot).toBe("sections");
    expect(section.payload).not.toHaveProperty("blocks");
    expect(block.family).toBe("rich_text");
    expect(block.parentId).toBe(RICH_SECTION_ID);
    expect(block.containerSlot).toBe("content");

    expectSameDocument(materializeCanonicalBlockRoom(room, "page"), canonical);
  });

  it("reconstructs the same typed aggregate from the bootstrap update", () => {
    const canonical = richTextDocument(RichTextProfile.WORK);
    const resident = new Y.Doc();
    hydrateCanonicalBlockRoom(resident, "work", canonical);

    const client = new Y.Doc();
    Y.applyUpdate(client, Y.encodeStateAsUpdate(resident));

    expectSameDocument(
      materializeCanonicalBlockRoom(client, "work"),
      canonical,
    );
    expect(() =>
      assertCanonicalBlockRoomParity(client, "work", canonical),
    ).not.toThrow();
    expect(Y.encodeStateVector(client)).toEqual(Y.encodeStateVector(resident));
  });

  it("rejects unknown runtime hydration properties", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "post", richTextDocument());
    room.getMap("block-document").set("runtimeOnly", true);

    expect(() => materializeCanonicalBlockRoom(room, "post")).toThrow(
      "block_room_invalid:root:unknown_key:runtimeOnly",
    );
  });

  it("preserves local undo semantics inside the one resident room", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "post", richTextDocument());
    const text = getBlockRoomCollaborativeText(room, {
      family: "rich_text",
      id: BLOCK_ID,
      locale: true as const,
      path: "content[0].text.text",
    });
    const undo = new Y.UndoManager(text, { trackedOrigins: new Set([null]) });

    text.insert(text.length, "!");
    expect(text.toString()).toBe("안녕하세요!");

    undo.undo();
    expect(text.toString()).toBe("안녕하세요");
  });

  it("uses Y.Text only for catalog-owned authored text fields", () => {
    const richRoom = new Y.Doc();
    hydrateCanonicalBlockRoom(richRoom, "post", richTextDocument());
    expect(
      getBlockRoomCollaborativeText(richRoom, {
        family: "rich_text",
        id: BLOCK_ID,
        locale: true as const,
        path: "content[0].text.text",
      }),
    ).toBeInstanceOf(Y.Text);
    expect(
      getBlockRoomAtomicValue(richRoom, {
        family: "rich_text",
        id: BLOCK_ID,
        path: "props.backgroundColor",
      }),
    ).toBe("#ffffff");

    const pageRoom = new Y.Doc();
    hydrateCanonicalBlockRoom(pageRoom, "page", pageDocument());
    expect(
      getBlockRoomAtomicValue(pageRoom, {
        family: "page_section",
        id: SECTION_ID,
        path: "props.uri",
      }),
    ).toBe("https://example.com/video");
    expect(
      getBlockRoomAtomicValue(pageRoom, {
        family: "page_section",
        id: SECTION_ID,
        path: "settings.paddingTop",
      }),
    ).toBe(24);
    expect(
      getBlockRoomCollaborativeText(pageRoom, {
        family: "page_section",
        id: SECTION_ID,
        locale: true as const,
        path: "props.caption",
      }),
    ).toBeInstanceOf(Y.Text);
    replaceBlockRoomCollaborativeText(
      pageRoom,
      {
        family: "page_section",
        id: SECTION_ID,
        locale: true as const,
        path: "props.caption",
      },
      "새 설명",
    );
    expect(
      getBlockRoomCollaborativeText(pageRoom, {
        family: "page_section",
        id: SECTION_ID,
        locale: true as const,
        path: "props.caption",
      }).toString(),
    ).toBe("새 설명");
  });

  it("preserves Page section settings through typed insertion", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "page", pageDocument());
    insertPageSectionNode(
      room,
      fromJson(PageSectionNodeSchema, {
        section: {
          id: RICH_SECTION_ID,
          settings: {
            backgroundColor: "#202020",
            paddingBottom: 16,
            maxWidth: "MAX_WIDTH_CONTAINER",
          },
          externalVideo: { props: { uri: "https://example.com/second" } },
        },
        placement: { index: 1 },
      }) as PageSectionNode,
    );
    insertPageSectionLocale(
      room,
      fromJson(PageSectionLocaleSchema, {
        sectionId: RICH_SECTION_ID,
        externalVideo: { props: {} },
      }) as PageSectionLocale,
    );

    expect(
      getBlockRoomAtomicValue(room, {
        family: "page_section",
        id: RICH_SECTION_ID,
        path: "settings.paddingBottom",
      }),
    ).toBe(16);
    const document = materializeCanonicalBlockRoom(room, "page");
    expect(document.$typeName).toBe("api.content.v1.LocalizedPageDocument");
    if (document.$typeName !== "api.content.v1.LocalizedPageDocument") {
      throw new Error("expected Page document");
    }
    expect(document.base?.nodes[1]?.section?.settings).toMatchObject({
      backgroundColor: "#202020",
      paddingBottom: 16,
    });
  });

  it("accepts a source immersive scene before it has locale units", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "page", pageDocument());
    insertPageSectionNode(
      room,
      fromJson(PageSectionNodeSchema, {
        section: {
          id: BLOCK_ID_3,
          immersiveScene: { props: {} },
        },
        placement: { index: 1 },
      }) as PageSectionNode,
    );
    expect(() =>
      insertPageSectionLocale(
        room,
        fromJson(PageSectionLocaleSchema, {
          sectionId: BLOCK_ID_3,
          immersiveScene: { props: {} },
        }) as PageSectionLocale,
      ),
    ).not.toThrow();
    expect(materializeCanonicalBlockRoom(room, "page").$typeName).toBe(
      "api.content.v1.LocalizedPageDocument",
    );
  });

  it("replaces typed payload collections in one validated transaction", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "post", richTextDocument());
    replaceBlockRoomPayloadArray(
      room,
      {
        family: "rich_text",
        id: BLOCK_ID,
        locale: true as const,
        path: "content",
      },
      [{ text: { text: "교체됨" } }],
    );

    const document = materializeCanonicalBlockRoom(room, "post");
    if (document.$typeName !== "api.content.v1.LocalizedRichTextDocument") {
      throw new Error("expected Rich Text document");
    }
    expect(document.localeOverlay?.blocks[0]).toMatchObject({
      value: {
        case: "paragraph",
        value: {
          content: [{ value: { case: "text", value: { text: "교체됨" } } }],
        },
      },
    });
  });

  it("creates a missing array leaf only for full typed collection replacement", () => {
    const room = new Y.Doc();
    const sparseDocument = fromJson(RichTextDocumentSchema, {
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
          blocks: [{ blockId: BLOCK_ID, paragraph: { props: {} } }],
        },
      ],
    }) as RichTextDocument;
    hydrateCanonicalBlockRoom(room, "post", sparseDocument);
    const content = {
      family: "rich_text" as const,
      id: BLOCK_ID,
      locale: true as const,
      path: "content",
    };

    expect(() =>
      insertBlockRoomPayloadArrayItem(room, content, 0, {
        text: { text: "첫 편집" },
      }),
    ).toThrow(`node:${BLOCK_ID}:path:content`);
    const origin = Symbol("first-full-replacement");
    const observedOrigins: unknown[] = [];
    room.on("afterTransaction", (transaction) => {
      observedOrigins.push(transaction.origin);
    });
    replaceBlockRoomPayloadArray(
      room,
      content,
      [{ text: { text: "첫 편집" } }],
      { origin },
    );
    expect(
      getBlockRoomCollaborativeText(room, {
        ...content,
        path: "content[0].text.text",
      }).toString(),
    ).toBe("첫 편집");
    expect(observedOrigins).toEqual([origin]);
    expect(materializeCanonicalBlockRoom(room, "post")).toMatchObject({
      localeOverlay: {
        locale: "ko",
        blocks: [
          {
            value: {
              case: "paragraph",
              value: {
                content: [
                  { value: { case: "text", value: { text: "첫 편집" } } },
                ],
              },
            },
          },
        ],
      },
    });

    const wrongShape = new Y.Doc();
    hydrateCanonicalBlockRoom(wrongShape, "post", sparseDocument);
    (localeNode(wrongShape, BLOCK_ID).get("payload") as Y.Map<unknown>).set(
      "content",
      "invalid",
    );
    expect(() => replaceBlockRoomPayloadArray(wrongShape, content, [])).toThrow(
      `node:${BLOCK_ID}:path:content`,
    );
  });

  it("inserts, moves, updates, and deletes through typed room operations", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "post", richTextDocument());
    insertRichTextBlockNode(room, paragraphNode(BLOCK_ID_2, 1));
    insertRichTextBlockLocale(room, paragraphLocale(BLOCK_ID_2, "두 번째"));

    moveRichTextBlockNode(room, BLOCK_ID_2, { index: 0 });
    setBlockRoomAtomicValue(
      room,
      {
        family: "rich_text",
        id: BLOCK_ID,
        path: "props.backgroundColor",
      },
      "#000000",
    );
    let snapshot = decodeCanonicalBlockRoom(room, "post");
    expect(
      snapshot.baseNodes.find((node) => node.id === BLOCK_ID_2)?.position,
    ).toBe(0);
    expect(
      getBlockRoomAtomicValue(room, {
        family: "rich_text",
        id: BLOCK_ID,
        path: "props.backgroundColor",
      }),
    ).toBe("#000000");
    expect(() => materializeCanonicalBlockRoom(room, "post")).not.toThrow();

    deleteBlockRoomAtomicValue(room, {
      family: "rich_text",
      id: BLOCK_ID,
      path: "props.backgroundColor",
    });
    deleteBlockRoomBaseNode(room, BLOCK_ID_2);
    snapshot = decodeCanonicalBlockRoom(room, "post");
    expect(snapshot.baseNodes.map((node) => node.id)).toEqual([BLOCK_ID]);
    expect(snapshot.localeOverlay.map((node) => node.id)).toEqual([BLOCK_ID]);
    expect(() => materializeCanonicalBlockRoom(room, "post")).not.toThrow();
  });

  it("keeps concurrent insertions at the same relative anchor", () => {
    const resident = new Y.Doc();
    hydrateCanonicalBlockRoom(resident, "post", richTextDocument());
    const baseline = Y.encodeStateAsUpdate(resident);
    const clientA = new Y.Doc();
    const clientB = new Y.Doc();
    Y.applyUpdate(clientA, baseline);
    Y.applyUpdate(clientB, baseline);
    const baselineVector = Y.encodeStateVector(resident);
    const anchorA = createBlockRoomInsertionAnchor(
      clientA,
      {
        parentId: null,
        containerSlot: "content",
      },
      1,
    );
    const anchorB = createBlockRoomInsertionAnchor(
      clientB,
      {
        parentId: null,
        containerSlot: "content",
      },
      1,
    );

    insertRichTextBlockNode(clientA, paragraphNode(BLOCK_ID_2, 1), {
      anchor: anchorA,
    });
    insertRichTextBlockLocale(clientA, paragraphLocale(BLOCK_ID_2, "둘"));
    insertRichTextBlockNode(clientB, paragraphNode(BLOCK_ID_3, 1), {
      anchor: anchorB,
    });
    insertRichTextBlockLocale(clientB, paragraphLocale(BLOCK_ID_3, "셋"));

    const updateA = Y.encodeStateAsUpdate(clientA, baselineVector);
    const updateB = Y.encodeStateAsUpdate(clientB, baselineVector);
    Y.applyUpdate(clientA, updateB);
    Y.applyUpdate(clientB, updateA);

    const idsA = decodeCanonicalBlockRoom(clientA, "post")
      .baseNodes.sort((left, right) => left.position - right.position)
      .map((node) => node.id);
    const idsB = decodeCanonicalBlockRoom(clientB, "post")
      .baseNodes.sort((left, right) => left.position - right.position)
      .map((node) => node.id);
    expect(idsA).toEqual(idsB);
    expect(new Set(idsA)).toEqual(new Set([BLOCK_ID, BLOCK_ID_2, BLOCK_ID_3]));
    expect(() => materializeCanonicalBlockRoom(clientA, "post")).not.toThrow();
  });

  it("observes a validated typed document after each codec-owned transaction", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "post", richTextDocument());
    const changes: Array<{
      origin: unknown;
      document: ExactRoomDocument;
    }> = [];
    const stop = observeCanonicalBlockRoom(room, "post", (change) => {
      changes.push({ origin: change.origin, document: change.document });
    });
    const origin = Symbol("editor");

    setBlockRoomAtomicValue(
      room,
      {
        family: "rich_text",
        id: BLOCK_ID,
        path: "props.backgroundColor",
      },
      "#000000",
      { origin },
    );
    stop();

    expect(changes).toHaveLength(1);
    expect(changes[0]?.origin).toBe(origin);
    expect(changes[0]?.document.$typeName).toBe(
      "api.content.v1.LocalizedRichTextDocument",
    );
  });

  it("preserves local and remote transaction origins without mutating their payloads", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "post", richTextDocument());
    const observed: Array<{
      origin: unknown;
      originKind: "local" | "remote";
      affectedBaseBlockIds: string[];
    }> = [];
    const stop = observeBlockRoomChanges(
      room,
      ({ changeSet, origin, originKind }) => {
        observed.push({
          origin,
          originKind,
          affectedBaseBlockIds: changeSet.affectedBaseBlockIds,
        });
      },
    );
    const localOrigin = {
      kind: "editor",
      payload: { interactionId: "interaction-1", memberId: "member-1" },
    };
    const localOriginBefore = structuredClone(localOrigin);

    setBlockRoomAtomicValue(
      room,
      {
        family: "rich_text",
        id: BLOCK_ID,
        path: "props.backgroundColor",
      },
      "#000000",
      { origin: localOrigin },
    );

    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(room));
    const remoteVector = Y.encodeStateVector(remote);
    setBlockRoomAtomicValue(
      remote,
      {
        family: "rich_text",
        id: BLOCK_ID,
        path: "props.textColor",
      },
      "#ffffff",
    );
    const remoteOrigin = {
      kind: "accepted-relay",
      payload: { mutationId: "mutation-1", channel: "mcp" },
    };
    const remoteOriginBefore = structuredClone(remoteOrigin);
    Y.applyUpdate(
      room,
      Y.encodeStateAsUpdate(remote, remoteVector),
      remoteOrigin,
    );
    stop();

    expect(observed).toEqual([
      {
        origin: localOrigin,
        originKind: "local",
        affectedBaseBlockIds: [BLOCK_ID],
      },
      {
        origin: remoteOrigin,
        originKind: "remote",
        affectedBaseBlockIds: [BLOCK_ID],
      },
    ]);
    expect(observed[0]?.origin).toBe(localOrigin);
    expect(observed[1]?.origin).toBe(remoteOrigin);
    expect(localOrigin).toEqual(localOriginBefore);
    expect(remoteOrigin).toEqual(remoteOriginBefore);
    remote.destroy();
  });

  it("reports and decodes only affected base and locale nodes", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "post", richTextDocument());
    const changes: Parameters<
      typeof decodeCanonicalBlockRoomAffectedNodes
    >[2][] = [];
    const stop = observeBlockRoomChanges(room, ({ changeSet }) =>
      changes.push(changeSet),
    );

    setBlockRoomAtomicValue(
      room,
      {
        family: "rich_text",
        id: BLOCK_ID,
        path: "props.backgroundColor",
      },
      "#000000",
    );
    replaceBlockRoomCollaborativeText(
      room,
      {
        family: "rich_text",
        id: BLOCK_ID,
        locale: true as const,
        path: "content[0].text.text",
      },
      "변경",
    );
    stop();

    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({
      affectedBaseBlockIds: [BLOCK_ID],
      affectedLocaleBlockIds: [],
      requiresFullDecode: false,
    });
    expect(changes[1]).toMatchObject({
      affectedBaseBlockIds: [],
      affectedLocaleBlockIds: [BLOCK_ID],
      requiresFullDecode: false,
    });
    const affected = decodeCanonicalBlockRoomAffectedNodes(
      room,
      "post",
      changes[1]!,
    );
    expect(affected.baseNodes.map(({ id }) => id)).toEqual([BLOCK_ID]);
    expect(affected.localeNodes).toEqual([
      expect.objectContaining({
        id: BLOCK_ID,
        kind: "paragraph",
      }),
    ]);
  });

  it("tracks order shifts and requires a cold full decode for unknown root changes", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "post", richTextDocument());
    insertRichTextBlockNode(room, paragraphNode(BLOCK_ID_2, 1));
    const changes: Parameters<
      typeof decodeCanonicalBlockRoomAffectedNodes
    >[2][] = [];
    const stop = observeBlockRoomChanges(room, ({ changeSet }) =>
      changes.push(changeSet),
    );

    moveRichTextBlockNode(room, BLOCK_ID_2, { index: 0 });
    room.getMap("block-document").set("unknown", true);
    stop();

    expect(changes[0]).toMatchObject({
      affectedBaseBlockIds: [BLOCK_ID, BLOCK_ID_2],
      requiresFullDecode: false,
    });
    expect(changes[0]?.changedContainerOrderKeys).toHaveLength(1);
    expect(changes[1]?.requiresFullDecode).toBe(true);
    expect(() =>
      decodeCanonicalBlockRoomAffectedNodes(room, "post", changes[1]!),
    ).toThrow("full_decode_required");
  });

  it("edits typed payload collections without exposing the Y.Map layout", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "post", richTextDocument());
    const contentRef = {
      family: "rich_text" as const,
      id: BLOCK_ID,
      locale: true as const,
      path: "content",
    };

    insertBlockRoomPayloadArrayItem(room, contentRef, 1, {
      link: {
        href: "https://example.com",
        content: [{ text: "링크" }],
      },
    });
    expect(
      getBlockRoomAtomicValue(room, {
        ...contentRef,
        path: "content[1].link.href",
      }),
    ).toBe("https://example.com");
    expect(
      getBlockRoomCollaborativeText(room, {
        ...contentRef,
        path: "content[1].link.content[0].text",
      }).toString(),
    ).toBe("링크");

    moveBlockRoomPayloadArrayItem(room, contentRef, 1, 0);
    expect(
      getBlockRoomAtomicValue(room, {
        ...contentRef,
        path: "content[0].link.href",
      }),
    ).toBe("https://example.com");
    deleteBlockRoomPayloadArrayItem(room, contentRef, 0);
    expect(() => materializeCanonicalBlockRoom(room, "post")).not.toThrow();
  });

  it("replaces a rich Block kind atomically across the locale overlay", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "post", richTextDocument());
    const base = fromJson(RichTextBlockDataSchema, {
      heading: { props: { level: 2 } },
    }) as RichTextBlockData;
    const ko = fromJson(RichTextBlockLocaleDataSchema, {
      heading: {
        props: {},
        content: [{ text: { text: "제목" } }],
      },
    }) as RichTextBlockLocaleData;
    replaceRichTextBlockData(room, BLOCK_ID, base, {
      expectedKind: "paragraph",
      localeData: ko,
    });

    const snapshot = decodeCanonicalBlockRoom(room, "post");
    expect(snapshot.baseNodes[0]?.kind).toBe("heading");
    expect(snapshot.localeOverlay[0]?.kind).toBe("heading");
    expect(
      getBlockRoomCollaborativeText(room, {
        family: "rich_text",
        id: BLOCK_ID,
        locale: true as const,
        path: "content[0].text.text",
      }).toString(),
    ).toBe("제목");
    expect(() => materializeCanonicalBlockRoom(room, "post")).not.toThrow();

    const aggregate = richTextDocument();
    aggregate.localeOverlays.push(
      fromJson(RichTextLocaleOverlaySchema, {
        locale: "en",
        blocks: [
          {
            blockId: BLOCK_ID,
            paragraph: {
              props: {},
              content: [{ text: { text: "Existing" } }],
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
    replaceRichTextBlockData(targetRoom, BLOCK_ID, base, {
      expectedKind: "paragraph",
      localeData: fromJson(RichTextBlockLocaleDataSchema, {
        heading: {
          props: {},
          content: [{ text: { text: "Title" } }],
        },
      }) as RichTextBlockLocaleData,
    });
    expect(
      decodeCanonicalBlockRoom(targetRoom, "post").baseNodes[0]?.kind,
    ).toBe("heading");
  });

  it("compares catalog kinds against their proto oneof case", () => {
    const room = new Y.Doc();
    const document = fromJson(RichTextDocumentSchema, {
      blockCatalogFingerprint: contentBlockCatalogFingerprint,
      profile: RichTextProfile.POST,
      sourceLocale: "ko",
      base: {
        nodes: [
          {
            block: { id: BLOCK_ID, codeBlock: { props: {} } },
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
              codeBlock: { props: {}, content: "const ok = true;" },
            },
          ],
        },
      ],
    }) as RichTextDocument;
    hydrateCanonicalBlockRoom(room, "post", document);

    replaceRichTextBlockData(
      room,
      BLOCK_ID,
      fromJson(RichTextBlockDataSchema, {
        quote: { props: {} },
      }) as RichTextBlockData,
      {
        expectedKind: "code-block",
        localeData: fromJson(RichTextBlockLocaleDataSchema, {
          quote: { props: {}, content: [{ text: { text: "인용" } }] },
        }) as RichTextBlockLocaleData,
      },
    );

    expect(decodeCanonicalBlockRoom(room, "post").baseNodes[0]?.kind).toBe(
      "quote",
    );
    expect(() => materializeCanonicalBlockRoom(room, "post")).not.toThrow();
  });

  it("deletes a Page section with its flat rich descendants and locale rows", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "page", richTextPageDocument());

    deleteBlockRoomBaseNode(room, RICH_SECTION_ID);

    const snapshot = decodeCanonicalBlockRoom(room, "page");
    expect(snapshot.baseNodes).toEqual([]);
    expect(snapshot.localeOverlay).toEqual([]);
    expect(() => materializeCanonicalBlockRoom(room, "page")).not.toThrow();
  });

  it("supports every atomic value and array mutation boundary", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "post", richTextDocument());
    const props = {
      family: "rich_text" as const,
      id: BLOCK_ID,
      path: "props.backgroundColor",
    };
    const content = {
      family: "rich_text" as const,
      id: BLOCK_ID,
      locale: true as const,
      path: "content",
    };

    setBlockRoomAtomicValue(room, props, null);
    expect(getBlockRoomAtomicValue(room, props)).toBeNull();
    setBlockRoomAtomicValue(room, props, true);
    expect(getBlockRoomAtomicValue(room, props)).toBe(true);
    setBlockRoomAtomicValue(room, props, 7);
    expect(getBlockRoomAtomicValue(room, props)).toBe(7);
    replaceBlockRoomPayloadArray(room, content, []);
    replaceBlockRoomPayloadArray(room, content, [
      { text: { text: "하나" } },
      { text: { text: "둘" } },
    ]);
    setBlockRoomAtomicValue(
      room,
      { ...content, path: "content[0].text.marks" },
      1,
    );
    expect(
      getBlockRoomAtomicValue(room, {
        ...content,
        path: "content[0].text.marks",
      }),
    ).toBe(1);
    deleteBlockRoomAtomicValue(room, {
      ...content,
      path: "content[0].text.marks",
    });
    moveBlockRoomPayloadArrayItem(room, content, 0, 0);

    expect(() =>
      insertBlockRoomPayloadArrayItem(room, content, -1, null),
    ).toThrow("array_index");
    expect(() =>
      insertBlockRoomPayloadArrayItem(room, content, 4, null),
    ).toThrow("array_index");
    expect(() => deleteBlockRoomPayloadArrayItem(room, content, 3)).toThrow(
      "array_index",
    );
    expect(() => moveBlockRoomPayloadArrayItem(room, content, 0, 3)).toThrow(
      "array_index",
    );
    expect(() => replaceBlockRoomPayloadArray(room, props, [])).toThrow(
      "node:" + BLOCK_ID + ":path:props.backgroundColor",
    );
    expect(() =>
      replaceBlockRoomPayloadArray(
        room,
        { ...content, path: "content[0]" },
        [],
      ),
    ).toThrow("node:" + BLOCK_ID + ":path:content[0]");
  });

  it("rejects invalid payload refs without mutating the canonical room", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "post", richTextDocument());
    const collaborative = {
      family: "rich_text" as const,
      id: BLOCK_ID,
      path: "content[0].text.text",
    };
    const atomic = {
      family: "rich_text" as const,
      id: BLOCK_ID,
      path: "props.backgroundColor",
    };

    expect(() => getBlockRoomAtomicValue(room, collaborative)).toThrow(
      "collaborative_text",
    );
    expect(() => setBlockRoomAtomicValue(room, collaborative, "x")).toThrow(
      "collaborative_text",
    );
    expect(() => deleteBlockRoomAtomicValue(room, collaborative)).toThrow(
      "collaborative_text",
    );
    expect(() => getBlockRoomCollaborativeText(room, atomic)).toThrow(
      "not_collaborative_text",
    );
    expect(() => replaceBlockRoomCollaborativeText(room, atomic, "x")).toThrow(
      "not_collaborative_text",
    );
    expect(() =>
      getBlockRoomAtomicValue(room, { ...atomic, path: "" }),
    ).toThrow("payload_path:empty");
    expect(() =>
      getBlockRoomAtomicValue(room, { ...atomic, path: "props[nope]" }),
    ).toThrow("payload_path:invalid");
    expect(() =>
      getBlockRoomAtomicValue(room, { ...atomic, path: "props[0]" }),
    ).toThrow("node:" + BLOCK_ID + ":path:props[0]");
    expect(() =>
      getBlockRoomAtomicValue(room, { ...atomic, path: "props.missing" }),
    ).toThrow("not_atomic");
    expect(() =>
      deleteBlockRoomAtomicValue(room, { ...atomic, path: "props.missing" }),
    ).toThrow("node:" + BLOCK_ID + ":path:props.missing");
    expect(() =>
      getBlockRoomAtomicValue(room, { ...atomic, id: "missing" }),
    ).toThrow("node:missing:missing");
    expect(() =>
      getBlockRoomAtomicValue(room, {
        ...atomic,
        family: "page_section",
      }),
    ).toThrow("node:" + BLOCK_ID + ":family");
  });

  it("creates and deletes locale nodes through the typed mutation API", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "post", richTextDocument());
    deleteBlockRoomLocaleNode(room, BLOCK_ID);
    expect(() => decodeCanonicalBlockRoom(room, "post")).toThrow(
      `locale:${BLOCK_ID}:missing`,
    );
    insertRichTextBlockLocale(room, paragraphLocale(BLOCK_ID, "다시 작성"));
    expect(decodeCanonicalBlockRoom(room, "post").localeOverlay).toHaveLength(
      1,
    );

    expect(() =>
      insertRichTextBlockLocale(room, paragraphLocale(BLOCK_ID, "x")),
    ).toThrow("exists");
    deleteBlockRoomLocaleNode(room, BLOCK_ID);
    expect(() => deleteBlockRoomLocaleNode(room, BLOCK_ID)).toThrow(
      `locale:${BLOCK_ID}:missing`,
    );
    expect(() => deleteBlockRoomLocaleNode(room, "missing")).toThrow(
      "locale:missing:missing",
    );
  });

  it("inserts and moves nested Page sections and their rich text", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "page", richTextPageDocument());
    const childId = "019cce26-19a4-78fd-bd6d-4f2e4fd93f50";
    const columnId = "019cce26-19a4-78fd-bd6d-4f2e4fd93f51";
    insertPageSectionNode(
      room,
      fromJson(PageSectionNodeSchema, {
        section: {
          id: childId,
          externalVideo: { props: { uri: "https://example.com/child" } },
        },
        placement: {
          parentSectionId: RICH_SECTION_ID,
          columnId,
          index: 0,
        },
      }) as PageSectionNode,
    );
    movePageSectionNode(room, childId, { index: 1 });
    movePageSectionNode(room, childId, {
      parentSectionId: RICH_SECTION_ID,
      columnId,
      index: 0,
    });
    moveRichTextBlockNode(
      room,
      BLOCK_ID,
      { index: 0 },
      { pageSectionId: RICH_SECTION_ID },
    );
    deleteBlockRoomBaseNode(room, childId);

    const locale = fromJson(PageSectionLocaleSchema, {
      sectionId: RICH_SECTION_ID,
      richText: {
        props: {},
        blocks: {
          locale: "ko",
          blocks: [
            {
              blockId: BLOCK_ID,
              paragraph: {
                props: {},
                content: [{ text: { text: "Bonjour" } }],
              },
            },
          ],
        },
      },
    }) as PageSectionLocale;
    deleteBlockRoomLocaleNode(room, RICH_SECTION_ID);
    deleteBlockRoomLocaleNode(room, BLOCK_ID);
    insertPageSectionLocale(room, locale);
    expect(materializeCanonicalBlockRoom(room, "page")).toBeDefined();

    const simplePage = new Y.Doc();
    hydrateCanonicalBlockRoom(simplePage, "page", pageDocument());
    const simpleLocale = fromJson(PageSectionLocaleSchema, {
      sectionId: SECTION_ID,
      externalVideo: { props: {} },
    }) as PageSectionLocale;
    deleteBlockRoomLocaleNode(simplePage, SECTION_ID);
    insertPageSectionLocale(simplePage, simpleLocale);
    expect(
      decodeCanonicalBlockRoom(simplePage, "page").localeOverlay,
    ).toHaveLength(1);

    const targetAggregate = pageDocument();
    targetAggregate.localeOverlays.push(
      fromJson(PageLocaleOverlaySchema, {
        locale: "en",
        sections: [
          {
            sectionId: SECTION_ID,
            externalVideo: { props: { caption: "English" } },
          },
        ],
      }),
    );
    const targetPage = new Y.Doc();
    hydrateExactBlockRoom(
      targetPage,
      "page",
      "ko",
      materializeLocalizedPageDocument(targetAggregate, "en"),
      [],
    );
    deleteBlockRoomLocaleNode(targetPage, SECTION_ID);
    insertPageSectionLocale(
      targetPage,
      fromJson(PageSectionLocaleSchema, {
        sectionId: SECTION_ID,
        externalVideo: { props: { caption: "Reinserted" } },
      }) as PageSectionLocale,
    );
    expect(materializeCanonicalBlockRoom(targetPage, "page")).toBeDefined();

    expect(() =>
      movePageSectionNode(room, childId, {
        parentSectionId: RICH_SECTION_ID,
        index: 0,
      }),
    ).toThrow("page_node:missing_column");
  });

  it("merges sparse change sets without aliasing caller arrays", () => {
    const presenceRoom = new Y.Doc();
    const presenceDocument = richTextDocument();
    presenceDocument.base!.nodes.push(paragraphNode(BLOCK_ID_2, 1));
    presenceDocument.localeOverlays[0]!.blocks.push(
      paragraphLocale(BLOCK_ID_2, "두 번째"),
    );
    hydrateCanonicalBlockRoom(presenceRoom, "post", presenceDocument);
    const presenceTargets = allBlockRoomLocaleValueTargets(presenceRoom);
    expect(presenceTargets.length).toBeGreaterThan(1);
    const right = {
      affectedBaseBlockIds: ["b"],
      affectedLocaleBlockIds: ["b"],
      affectedLocaleValueTargets: [presenceTargets[1]!, presenceTargets[0]!],
      changedContainerOrderKeys: ["order-b"],
      documentMetadataChanged: false,
      documentLayoutChanged: true,
      requiresFullDecode: false,
    };
    const copied = mergeBlockRoomChangeSets(undefined, right);
    expect(copied).toEqual(right);
    expect(copied.affectedBaseBlockIds).not.toBe(right.affectedBaseBlockIds);
    expect(copied.affectedLocaleBlockIds).not.toBe(
      right.affectedLocaleBlockIds,
    );

    expect(
      mergeBlockRoomChangeSets(
        {
          affectedBaseBlockIds: ["a", "b"],
          affectedLocaleBlockIds: ["a"],
          affectedLocaleValueTargets: [presenceTargets[0]!],
          changedContainerOrderKeys: ["order-a"],
          documentMetadataChanged: true,
          documentLayoutChanged: false,
          requiresFullDecode: true,
        },
        right,
      ),
    ).toEqual({
      affectedBaseBlockIds: ["a", "b"],
      affectedLocaleBlockIds: ["a", "b"],
      affectedLocaleValueTargets: [presenceTargets[0]!, presenceTargets[1]!],
      changedContainerOrderKeys: ["order-a", "order-b"],
      documentMetadataChanged: true,
      documentLayoutChanged: true,
      requiresFullDecode: true,
    });

    expect(
      decodeCanonicalBlockRoomAffectedNodes(presenceRoom, "post", {
        affectedBaseBlockIds: [BLOCK_ID],
        affectedLocaleBlockIds: [BLOCK_ID],
        affectedLocaleValueTargets: [],
        changedContainerOrderKeys: [],
        documentMetadataChanged: false,
        documentLayoutChanged: false,
        requiresFullDecode: false,
      }).localeNodes[0]?.payload,
    ).toEqual({});
    expect(() =>
      decodeCanonicalBlockRoomAffectedNodes(presenceRoom, "post", {
        affectedBaseBlockIds: [],
        affectedLocaleBlockIds: [BLOCK_ID],
        affectedLocaleValueTargets: [],
        changedContainerOrderKeys: [],
        documentMetadataChanged: false,
        documentLayoutChanged: false,
        requiresFullDecode: false,
      }),
    ).toThrow("affected_nodes:unmarked_locale_change");
  });

  it("preserves transaction origin and stops observation cleanly", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "post", richTextDocument());
    const origins: unknown[] = [];
    const stop = observeCanonicalBlockRoom(room, "post", (change) =>
      origins.push(change.origin),
    );
    const origin = Symbol("batch");
    transactBlockRoom(room, origin, () => {
      setBlockRoomAtomicValue(
        room,
        {
          family: "rich_text",
          id: BLOCK_ID,
          path: "props.backgroundColor",
        },
        "#121212",
      );
    });
    stop();
    transactBlockRoom(room, Symbol("ignored"), () => {});
    expect(origins).toEqual([origin]);
  });

  it("rejects canonical parity drift and malformed room metadata", () => {
    const canonical = richTextDocument();
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "post", canonical);
    setBlockRoomAtomicValue(
      room,
      {
        family: "rich_text",
        id: BLOCK_ID,
        path: "props.backgroundColor",
      },
      "#111111",
    );
    expect(() =>
      assertCanonicalBlockRoomParity(room, "post", canonical),
    ).toThrow("canonical_parity");

    const invalidType = clonedRoom(room);
    roomRoot(invalidType).set("documentType", "unknown");
    expect(() =>
      insertRichTextBlockNode(invalidType, paragraphNode(BLOCK_ID_2, 1)),
    ).toThrow("document_type");

    const page = new Y.Doc();
    hydrateCanonicalBlockRoom(page, "page", pageDocument());
    roomRoot(page).set("profile", RichTextProfile.POST);
    expect(() => materializeCanonicalBlockRoom(page, "page")).toThrow(
      "page_profile",
    );
  });

  it("rejects malformed node payloads and placements at the decode boundary", () => {
    const source = new Y.Doc();
    hydrateCanonicalBlockRoom(source, "post", richTextDocument());

    const invalidPayload = clonedRoom(source);
    baseNode(invalidPayload, BLOCK_ID).set("payload", Number.POSITIVE_INFINITY);
    expect(() => materializeCanonicalBlockRoom(invalidPayload, "post")).toThrow(
      "non_json_value",
    );

    const invalidFamily = clonedRoom(source);
    baseNode(invalidFamily, BLOCK_ID).set("family", "invalid");
    expect(() => materializeCanonicalBlockRoom(invalidFamily, "post")).toThrow(
      "family",
    );

    const invalidPlacement = clonedRoom(source);
    baseNode(invalidPlacement, BLOCK_ID).set("containerSlot", "wrong");
    const oldOrder = roomBaseOrder(invalidPlacement).get(
      JSON.stringify([null, "content"]),
    ) as Y.Array<string>;
    oldOrder.delete(0, 1);
    roomBaseOrder(invalidPlacement).delete(JSON.stringify([null, "content"]));
    const wrongOrder = new Y.Array<string>();
    wrongOrder.insert(0, [BLOCK_ID]);
    roomBaseOrder(invalidPlacement).set(
      JSON.stringify([null, "wrong"]),
      wrongOrder,
    );
    expect(() =>
      materializeCanonicalBlockRoom(invalidPlacement, "post"),
    ).toThrow("placement");

    const nested = clonedRoom(source);
    insertRichTextBlockNode(nested, paragraphNode(BLOCK_ID_2, 1));
    insertRichTextBlockLocale(nested, paragraphLocale(BLOCK_ID_2, ""));
    moveRichTextBlockNode(nested, BLOCK_ID_2, {
      parentBlockId: BLOCK_ID,
      index: 0,
    });
    const nestedDocument = materializeCanonicalBlockRoom(
      nested,
      "post",
    ) as LocalizedRichTextDocument;
    expect(
      nestedDocument.base?.nodes.find((node) => node.block?.id === BLOCK_ID_2)
        ?.placement,
    ).toMatchObject({ parentBlockId: BLOCK_ID });

    const page = new Y.Doc();
    hydrateCanonicalBlockRoom(page, "page", richTextPageDocument());
    baseNode(page, BLOCK_ID).set("parentId", null);
    const sectionOrderKey = JSON.stringify([RICH_SECTION_ID, "content"]);
    const sectionOrder = roomBaseOrder(page).get(
      sectionOrderKey,
    ) as Y.Array<string>;
    sectionOrder.delete(0, 1);
    roomBaseOrder(page).delete(sectionOrderKey);
    const orphanOrder = new Y.Array<string>();
    orphanOrder.insert(0, [BLOCK_ID]);
    roomBaseOrder(page).set(JSON.stringify([null, "content"]), orphanOrder);
    expect(() => materializeCanonicalBlockRoom(page, "page")).toThrow(
      "missing_section_parent",
    );
  });

  it("rejects malformed Page locale relationships", () => {
    const source = new Y.Doc();
    hydrateCanonicalBlockRoom(source, "page", richTextPageDocument());

    const missingBase = clonedRoom(source);
    roomBaseNodes(missingBase).delete(BLOCK_ID);
    const order = roomBaseOrder(missingBase).get(
      JSON.stringify([RICH_SECTION_ID, "content"]),
    ) as Y.Array<string>;
    order.delete(0, 1);
    roomBaseOrder(missingBase).delete(
      JSON.stringify([RICH_SECTION_ID, "content"]),
    );
    expect(() => materializeCanonicalBlockRoom(missingBase, "page")).toThrow(
      "missing_base",
    );

    const missingSection = clonedRoom(source);
    roomBaseNodes(missingSection).delete(RICH_SECTION_ID);
    const rootOrder = roomBaseOrder(missingSection).get(
      JSON.stringify([null, "sections"]),
    ) as Y.Array<string>;
    rootOrder.delete(0, 1);
    roomBaseOrder(missingSection).delete(JSON.stringify([null, "sections"]));
    expect(() => materializeCanonicalBlockRoom(missingSection, "page")).toThrow(
      `locale:${RICH_SECTION_ID}:missing_base`,
    );

    const wrongLocaleFamily = clonedRoom(source);
    localeNode(wrongLocaleFamily, RICH_SECTION_ID).set("family", "rich_text");
    expect(() =>
      materializeCanonicalBlockRoom(wrongLocaleFamily, "page"),
    ).toThrow(`locale:${RICH_SECTION_ID}:identity_mismatch`);
  });

  it("validates replace-kind compare-and-set inputs before mutation", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "post", richTextDocument());
    const heading = fromJson(RichTextBlockDataSchema, {
      heading: { props: { level: 2 } },
    }) as RichTextBlockData;
    const headingLocale = fromJson(RichTextBlockLocaleDataSchema, {
      heading: { props: {}, content: [{ text: { text: "Title" } }] },
    }) as RichTextBlockLocaleData;
    const quoteLocale = fromJson(RichTextBlockLocaleDataSchema, {
      quote: { props: {}, content: [{ text: { text: "Quote" } }] },
    }) as RichTextBlockLocaleData;

    expect(() =>
      replaceRichTextBlockData(room, BLOCK_ID, heading, {
        expectedKind: "heading",
        localeData: headingLocale,
      }),
    ).toThrow("kind_changed");
    expect(() =>
      replaceRichTextBlockData(room, BLOCK_ID, heading, {
        expectedKind: "paragraph",
        localeData: quoteLocale,
      }),
    ).toThrow("locale_kind");

    replaceRichTextBlockData(room, BLOCK_ID, heading, {
      expectedKind: "paragraph",
      localeData: null,
    });
    expect(() => decodeCanonicalBlockRoom(room, "post")).toThrow(
      `locale:${BLOCK_ID}:missing`,
    );
  });

  it("validates insertion anchors, indices, duplicate ids, and document families", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "post", richTextDocument());
    expect(() =>
      createBlockRoomInsertionAnchor(
        room,
        {
          parentId: null,
          containerSlot: "content",
        },
        2,
      ),
    ).toThrow("anchor_index");
    expect(() =>
      insertRichTextBlockNode(room, paragraphNode(BLOCK_ID_2, 2)),
    ).toThrow("base_order:index");
    expect(() =>
      insertRichTextBlockNode(room, paragraphNode(BLOCK_ID, 1)),
    ).toThrow("exists");
    expect(() =>
      insertPageSectionNode(room, pageDocument().base!.nodes[0]!),
    ).toThrow("document_type");
    expect(() =>
      insertRichTextBlockNode(room, paragraphNode(BLOCK_ID_2, 1), {
        pageSectionId: RICH_SECTION_ID,
      }),
    ).toThrow("unexpected_section_parent");

    insertRichTextBlockNode(room, paragraphNode(BLOCK_ID_2, 1));
    insertRichTextBlockLocale(room, paragraphLocale(BLOCK_ID_2, ""));
    const anchor = createBlockRoomInsertionAnchor(
      room,
      {
        parentId: null,
        containerSlot: "content",
      },
      2,
    );
    moveRichTextBlockNode(room, BLOCK_ID, { index: 0 }, { anchor });
    expect(
      decodeCanonicalBlockRoom(room, "post")
        .baseNodes.sort((left, right) => left.position - right.position)
        .map(({ id }) => id),
    ).toEqual([BLOCK_ID_2, BLOCK_ID]);
    expect(() => moveRichTextBlockNode(room, BLOCK_ID, { index: 4 })).toThrow(
      "base_order:index",
    );

    const foreign = new Y.Doc();
    hydrateCanonicalBlockRoom(foreign, "post", richTextDocument());
    const stale = createBlockRoomInsertionAnchor(
      foreign,
      {
        parentId: null,
        containerSlot: "content",
      },
      0,
    );
    expect(() =>
      moveRichTextBlockNode(room, BLOCK_ID, { index: 0 }, { anchor: stale }),
    ).toThrow("stale_anchor");

    const page = new Y.Doc();
    hydrateCanonicalBlockRoom(page, "page", richTextPageDocument());
    expect(() =>
      insertRichTextBlockNode(page, paragraphNode(BLOCK_ID_2, 1)),
    ).toThrow("missing_section_parent");
    expect(() => moveRichTextBlockNode(page, BLOCK_ID, { index: 0 })).toThrow(
      "missing_section_parent",
    );
  });

  it("inserts a rich Page section with its resident descendants", () => {
    const target = new Y.Doc();
    hydrateCanonicalBlockRoom(target, "page", pageDocument());
    const rich = richTextPageDocument().base!.nodes[0]!;
    rich.placement!.index = 1;
    insertPageSectionNode(target, rich);
    insertPageSectionLocale(
      target,
      richTextPageDocument().localeOverlays[0]!.sections[0]!,
    );
    const snapshot = decodeCanonicalBlockRoom(target, "page");
    expect(snapshot.baseNodes.map(({ id }) => id)).toEqual([
      BLOCK_ID,
      SECTION_ID,
      RICH_SECTION_ID,
    ]);
  });

  it("classifies direct room mutations into precise incremental change sets", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "post", richTextDocument());
    const changes: Parameters<
      typeof decodeCanonicalBlockRoomAffectedNodes
    >[2][] = [];
    const stop = observeBlockRoomChanges(room, ({ changeSet }) =>
      changes.push(changeSet),
    );

    roomRoot(room).set("sourceLocale", "en");
    roomRoot(room).set("documentLayout", "wide");
    deleteBlockRoomLocaleNode(room, BLOCK_ID);
    insertRichTextBlockLocale(room, paragraphLocale(BLOCK_ID, "Bonjour"));
    room.getMap("untracked").set("value", true);
    stop();

    expect(changes[0]).toMatchObject({ documentMetadataChanged: true });
    expect(changes[1]).toMatchObject({ documentLayoutChanged: true });
    expect(changes[2]?.affectedLocaleBlockIds).toEqual([BLOCK_ID]);
    expect(changes[3]?.affectedLocaleBlockIds).toEqual([BLOCK_ID]);
    expect(changes[4]).toMatchObject({ requiresFullDecode: true });
  });

  it("decodes deletions and implicit locale effects without a full scan", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "post", richTextDocument());
    const affected = decodeCanonicalBlockRoomAffectedNodes(room, "post", {
      affectedBaseBlockIds: [BLOCK_ID, "deleted-base"],
      affectedLocaleBlockIds: [BLOCK_ID, "deleted-source"],
      affectedLocaleValueTargets: [],
      changedContainerOrderKeys: [],
      documentMetadataChanged: false,
      documentLayoutChanged: false,
      requiresFullDecode: false,
    });
    expect(affected.deletedBaseBlockIds).toEqual(["deleted-base"]);
    expect(affected.localeNodes.map(({ id }) => id)).toEqual([BLOCK_ID]);
    expect(affected.deletedLocaleBlockIds).toEqual(["deleted-source"]);

    expect(() =>
      decodeCanonicalBlockRoomAffectedNodes(room, "page", {
        affectedBaseBlockIds: [],
        affectedLocaleBlockIds: [],
        affectedLocaleValueTargets: [],
        changedContainerOrderKeys: [],
        documentMetadataChanged: false,
        documentLayoutChanged: false,
        requiresFullDecode: false,
      }),
    ).toThrow("document_type");
  });

  it("rejects non-object Page payloads and supports atomic array slots", () => {
    const page = new Y.Doc();
    hydrateCanonicalBlockRoom(page, "page", pageDocument());
    baseNode(page, SECTION_ID).set("payload", null);
    expect(() => materializeCanonicalBlockRoom(page, "page")).toThrow(
      "payload",
    );

    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "post", richTextDocument());
    const arraySlot = {
      family: "rich_text" as const,
      id: BLOCK_ID,
      locale: true as const,
      path: "content[0]",
    };
    setBlockRoomAtomicValue(room, arraySlot, null);
    expect(getBlockRoomAtomicValue(room, arraySlot)).toBeNull();

    const deletion = new Y.Doc();
    hydrateCanonicalBlockRoom(deletion, "post", richTextDocument());
    deleteBlockRoomAtomicValue(deletion, arraySlot);
    expect(() => getBlockRoomAtomicValue(deletion, arraySlot)).toThrow();
  });

  it("tracks nested rich Page ancestry and rejects an unexpected move section", () => {
    const page = new Y.Doc();
    hydrateCanonicalBlockRoom(page, "page", richTextPageDocument());
    const child = fromJson(RichTextBlockNodeSchema, {
      block: { id: BLOCK_ID_2, paragraph: { props: {} } },
      placement: { parentBlockId: BLOCK_ID, index: 0 },
    }) as RichTextBlockNode;
    insertRichTextBlockNode(page, child, { pageSectionId: RICH_SECTION_ID });
    expect(
      decodeCanonicalBlockRoomAffectedNodes(page, "page", {
        affectedBaseBlockIds: [BLOCK_ID_2],
        affectedLocaleBlockIds: [],
        affectedLocaleValueTargets: [],
        changedContainerOrderKeys: [],
        documentMetadataChanged: false,
        documentLayoutChanged: false,
        requiresFullDecode: false,
      }).baseNodes[0],
    ).toMatchObject({ pageSectionId: RICH_SECTION_ID });

    const post = new Y.Doc();
    hydrateCanonicalBlockRoom(post, "post", richTextDocument());
    expect(() =>
      moveRichTextBlockNode(
        post,
        BLOCK_ID,
        { index: 0 },
        {
          pageSectionId: RICH_SECTION_ID,
        },
      ),
    ).toThrow("unexpected_section_parent");
  });

  it("sorts multiple locale changes deterministically and rejects duplicate order ids", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "post", richTextDocument());
    insertRichTextBlockNode(room, paragraphNode(BLOCK_ID_2, 1));
    insertRichTextBlockLocale(room, paragraphLocale(BLOCK_ID_2, "둘"));
    const changes: Parameters<
      typeof decodeCanonicalBlockRoomAffectedNodes
    >[2][] = [];
    const stop = observeBlockRoomChanges(room, ({ changeSet }) =>
      changes.push(changeSet),
    );
    transactBlockRoom(room, "locale-batch", () => {
      replaceBlockRoomCollaborativeText(
        room,
        {
          family: "rich_text",
          id: BLOCK_ID_2,
          locale: true as const,
          path: "content[0].text.text",
        },
        "둘 변경",
      );
      replaceBlockRoomCollaborativeText(
        room,
        {
          family: "rich_text",
          id: BLOCK_ID,
          locale: true as const,
          path: "content[0].text.text",
        },
        "하나 변경",
      );
    });
    stop();
    expect(changes[0]?.affectedLocaleBlockIds).toEqual([BLOCK_ID, BLOCK_ID_2]);

    const order = roomBaseOrder(room).get(
      JSON.stringify([null, "content"]),
    ) as Y.Array<string>;
    order.insert(order.length, [BLOCK_ID]);
    expect(() =>
      decodeCanonicalBlockRoomAffectedNodes(room, "post", {
        affectedBaseBlockIds: [BLOCK_ID],
        affectedLocaleBlockIds: [],
        affectedLocaleValueTargets: [],
        changedContainerOrderKeys: [],
        documentMetadataChanged: false,
        documentLayoutChanged: false,
        requiresFullDecode: false,
      }),
    ).toThrow("invalid:" + BLOCK_ID);
  });

  it("rejects corrupt ancestry during affected-node decoding", () => {
    const change = (blockId: string) => ({
      affectedBaseBlockIds: [blockId],
      affectedLocaleBlockIds: [],
      affectedLocaleValueTargets: [],
      changedContainerOrderKeys: [],
      documentMetadataChanged: false,
      documentLayoutChanged: false,
      requiresFullDecode: false,
    });
    const reparent = (
      room: Y.Doc,
      id: string,
      parentId: string | null,
    ): void => {
      const node = baseNode(room, id);
      const oldParent = node.get("parentId") as string | null;
      const oldKey = JSON.stringify([oldParent, "content"]);
      const oldOrder = roomBaseOrder(room).get(oldKey) as Y.Array<string>;
      const index = oldOrder.toArray().indexOf(id);
      oldOrder.delete(index, 1);
      if (oldOrder.length === 0) roomBaseOrder(room).delete(oldKey);
      node.set("parentId", parentId);
      const newKey = JSON.stringify([parentId, "content"]);
      let newOrder = roomBaseOrder(room).get(newKey) as
        Y.Array<string> | undefined;
      if (!newOrder) {
        newOrder = new Y.Array<string>();
        roomBaseOrder(room).set(newKey, newOrder);
      }
      newOrder.insert(newOrder.length, [id]);
    };

    const cycle = new Y.Doc();
    hydrateCanonicalBlockRoom(cycle, "page", richTextPageDocument());
    reparent(cycle, BLOCK_ID, BLOCK_ID);
    expect(() =>
      decodeCanonicalBlockRoomAffectedNodes(cycle, "page", change(BLOCK_ID)),
    ).toThrow("parent_cycle");

    const missing = new Y.Doc();
    hydrateCanonicalBlockRoom(missing, "page", richTextPageDocument());
    reparent(missing, BLOCK_ID, "missing");
    expect(() =>
      decodeCanonicalBlockRoomAffectedNodes(missing, "page", change(BLOCK_ID)),
    ).toThrow("missing_parent");

    const wrongDocument = new Y.Doc();
    hydrateCanonicalBlockRoom(wrongDocument, "page", richTextPageDocument());
    roomRoot(wrongDocument).set("documentType", "post");
    expect(() =>
      decodeCanonicalBlockRoomAffectedNodes(
        wrongDocument,
        "post",
        change(BLOCK_ID),
      ),
    ).toThrow("parent_family");

    const wrongSectionKind = new Y.Doc();
    hydrateCanonicalBlockRoom(wrongSectionKind, "page", richTextPageDocument());
    baseNode(wrongSectionKind, RICH_SECTION_ID).set("kind", "externalVideo");
    expect(() =>
      decodeCanonicalBlockRoomAffectedNodes(
        wrongSectionKind,
        "page",
        change(BLOCK_ID),
      ),
    ).toThrow("section_kind");

    const pageUnderRich = new Y.Doc();
    hydrateCanonicalBlockRoom(pageUnderRich, "page", richTextPageDocument());
    const section = baseNode(pageUnderRich, RICH_SECTION_ID);
    const sectionsKey = JSON.stringify([null, "sections"]);
    const sections = roomBaseOrder(pageUnderRich).get(
      sectionsKey,
    ) as Y.Array<string>;
    sections.delete(0, 1);
    roomBaseOrder(pageUnderRich).delete(sectionsKey);
    section.set("parentId", BLOCK_ID);
    section.set("containerSlot", "content");
    const contentKey = JSON.stringify([BLOCK_ID, "content"]);
    const contentOrder = new Y.Array<string>();
    contentOrder.insert(0, [RICH_SECTION_ID]);
    roomBaseOrder(pageUnderRich).set(contentKey, contentOrder);
    expect(() =>
      decodeCanonicalBlockRoomAffectedNodes(
        pageUnderRich,
        "page",
        change(RICH_SECTION_ID),
      ),
    ).toThrow("parent_family");

    const orphan = new Y.Doc();
    hydrateCanonicalBlockRoom(orphan, "page", richTextPageDocument());
    reparent(orphan, BLOCK_ID, null);
    expect(() =>
      decodeCanonicalBlockRoomAffectedNodes(orphan, "page", change(BLOCK_ID)),
    ).toThrow("missing_section_parent");
  });

  it("covers empty aggregates and validates root identity exactly", () => {
    const emptyRich = fromJson(RichTextDocumentSchema, {
      blockCatalogFingerprint: contentBlockCatalogFingerprint,
      profile: RichTextProfile.POST,
      sourceLocale: "ko",
      base: { nodes: [] },
      localeOverlays: [{ locale: "ko", blocks: [] }],
    }) as RichTextDocument;
    const rich = new Y.Doc();
    hydrateCanonicalBlockRoom(rich, "post", emptyRich);
    expect(materializeCanonicalBlockRoom(rich, "post")).toBeDefined();

    const emptyPage = fromJson(PageDocumentSchema, {
      blockCatalogFingerprint: contentBlockCatalogFingerprint,
      sourceLocale: "ko",
      base: { nodes: [] },
      localeOverlays: [{ locale: "ko", sections: [] }],
    }) as PageDocument;
    const page = new Y.Doc();
    hydrateCanonicalBlockRoom(page, "page", emptyPage);
    expect(
      canonicalBlockRoomDocumentBytes("page", emptyPage).length,
    ).toBeGreaterThan(0);

    expect(() => hydrateCanonicalBlockRoom(page, "page", emptyPage)).toThrow(
      "room_not_empty",
    );
    expect(() =>
      hydrateCanonicalBlockRoom(new Y.Doc(), "page", richTextDocument()),
    ).toThrow("document_type");
    expect(() =>
      hydrateCanonicalBlockRoom(new Y.Doc(), "post", pageDocument()),
    ).toThrow("document_type");
    expect(() =>
      hydrateCanonicalBlockRoom(
        new Y.Doc(),
        "work",
        richTextDocument(RichTextProfile.POST),
      ),
    ).toThrow("document_profile");

    const invalidString = clonedRoom(rich);
    roomRoot(invalidString).set("sourceLocale", "");
    expect(() => materializeCanonicalBlockRoom(invalidString, "post")).toThrow(
      "source_locale",
    );
    const invalidInteger = clonedRoom(rich);
    roomRoot(invalidInteger).set("profile", -1);
    expect(() => materializeCanonicalBlockRoom(invalidInteger, "post")).toThrow(
      "profile",
    );
  });

  it("rejects malformed base-order representations exhaustively", () => {
    const source = new Y.Doc();
    hydrateCanonicalBlockRoom(source, "post", richTextDocument());
    const key = JSON.stringify([null, "content"]);

    const notArray = clonedRoom(source);
    roomBaseOrder(notArray).set(key, "invalid");
    expect(() => materializeCanonicalBlockRoom(notArray, "post")).toThrow(
      "not_array",
    );

    const duplicate = clonedRoom(source);
    const duplicateOrder = roomBaseOrder(duplicate).get(key) as Y.Array<string>;
    duplicateOrder.insert(1, [BLOCK_ID]);
    expect(() => materializeCanonicalBlockRoom(duplicate, "post")).toThrow(
      "duplicate",
    );

    const missingNode = clonedRoom(source);
    const missingOrder = roomBaseOrder(missingNode).get(key) as Y.Array<string>;
    missingOrder.insert(1, ["missing"]);
    expect(() => materializeCanonicalBlockRoom(missingNode, "post")).toThrow(
      "missing_node",
    );

    const wrongContainer = clonedRoom(source);
    baseNode(wrongContainer, BLOCK_ID).set("containerSlot", "wrong");
    expect(() => materializeCanonicalBlockRoom(wrongContainer, "post")).toThrow(
      "wrong_container",
    );

    const unordered = clonedRoom(source);
    roomBaseOrder(unordered).delete(key);
    expect(() => materializeCanonicalBlockRoom(unordered, "post")).toThrow(
      "base_order:missing",
    );
  });

  it("rejects malformed room families and payload shapes", () => {
    const rich = new Y.Doc();
    hydrateCanonicalBlockRoom(rich, "post", richTextDocument());
    const pageFamily = clonedRoom(rich);
    baseNode(pageFamily, BLOCK_ID).set("family", "page_section");
    expect(() => materializeCanonicalBlockRoom(pageFamily, "post")).toThrow(
      `locale:${BLOCK_ID}:identity_mismatch`,
    );

    const sourceFamily = clonedRoom(rich);
    localeNode(sourceFamily, BLOCK_ID).set("family", "page_section");
    expect(() => materializeCanonicalBlockRoom(sourceFamily, "post")).toThrow(
      `locale:${BLOCK_ID}:identity_mismatch`,
    );

    const invalidParent = clonedRoom(rich);
    const payload = baseNode(invalidParent, BLOCK_ID).get(
      "payload",
    ) as Y.Map<unknown>;
    const props = payload.get("props") as Y.Map<unknown>;
    props.set("backgroundColor", new Y.Map());
    expect(() =>
      getBlockRoomAtomicValue(invalidParent, {
        family: "rich_text",
        id: BLOCK_ID,
        path: "props.backgroundColor",
      }),
    ).toThrow("not_atomic");
    expect(() =>
      getBlockRoomAtomicValue(invalidParent, {
        family: "rich_text",
        id: BLOCK_ID,
        path: "props.backgroundColor.value",
      }),
    ).toThrow("not_atomic");
    expect(() =>
      setBlockRoomAtomicValue(
        invalidParent,
        {
          family: "rich_text",
          id: BLOCK_ID,
          locale: true as const,
          path: "content.value",
        },
        "x",
      ),
    ).toThrow();
  });

  it("validates collaborative text shape and empty replacement behavior", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "post", richTextDocument());
    const ref = {
      family: "rich_text" as const,
      id: BLOCK_ID,
      locale: true as const,
      path: "content[0].text.text",
    };
    replaceBlockRoomCollaborativeText(room, ref, "");
    expect(getBlockRoomCollaborativeText(room, ref).toString()).toBe("");
    replaceBlockRoomCollaborativeText(room, ref, "again");

    const missing = clonedRoom(room);
    const item = (
      (localeNode(missing, BLOCK_ID).get("payload") as Y.Map<unknown>).get(
        "content",
      ) as Y.Array<unknown>
    ).get(0) as Y.Map<unknown>;
    (item.get("text") as Y.Map<unknown>).delete("text");
    replaceBlockRoomCollaborativeText(missing, ref, "created");
    expect(getBlockRoomCollaborativeText(missing, ref).toString()).toBe(
      "created",
    );

    const wrong = clonedRoom(room);
    const wrongItem = (
      (localeNode(wrong, BLOCK_ID).get("payload") as Y.Map<unknown>).get(
        "content",
      ) as Y.Array<unknown>
    ).get(0) as Y.Map<unknown>;
    (wrongItem.get("text") as Y.Map<unknown>).set("text", "atomic");
    expect(() => getBlockRoomCollaborativeText(wrong, ref)).toThrow(
      "text_shape",
    );
    expect(() => replaceBlockRoomCollaborativeText(wrong, ref, "x")).toThrow(
      "text_shape",
    );
  });

  it("rejects missing placements and wrong document mutation APIs", () => {
    const post = new Y.Doc();
    hydrateCanonicalBlockRoom(post, "post", richTextDocument());
    expect(() =>
      insertRichTextBlockNode(
        post,
        fromJson(RichTextBlockNodeSchema, {
          block: { id: BLOCK_ID_2, paragraph: { props: {} } },
        }) as RichTextBlockNode,
      ),
    ).toThrow("placement");
    expect(() =>
      insertPageSectionLocale(
        post,
        fromJson(PageSectionLocaleSchema, {
          sectionId: SECTION_ID,
          externalVideo: { props: {} },
        }) as PageSectionLocale,
      ),
    ).toThrow("document_type");
    expect(() => movePageSectionNode(post, SECTION_ID, { index: 0 })).toThrow(
      "document_type",
    );

    const page = new Y.Doc();
    hydrateCanonicalBlockRoom(page, "page", pageDocument());
    expect(() =>
      insertPageSectionNode(
        page,
        fromJson(PageSectionNodeSchema, {
          section: { id: RICH_SECTION_ID, externalVideo: { props: {} } },
        }) as PageSectionNode,
      ),
    ).toThrow("placement");
    expect(() =>
      insertPageSectionNode(
        page,
        fromJson(PageSectionNodeSchema, {
          section: { id: RICH_SECTION_ID, externalVideo: { props: {} } },
          placement: { columnId: "orphan", index: 1 },
        }) as PageSectionNode,
      ),
    ).toThrow("orphan_column");
  });

  it("rejects missing mutation targets and preserves non-empty locale state", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "post", richTextDocument());
    expect(() => deleteBlockRoomBaseNode(room, "missing")).toThrow(
      "base_node:missing",
    );
    insertRichTextBlockNode(room, paragraphNode(BLOCK_ID_2, 1));
    insertRichTextBlockLocale(room, paragraphLocale(BLOCK_ID_2, "둘"));
    deleteBlockRoomLocaleNode(room, BLOCK_ID_2);
    expect(() => decodeCanonicalBlockRoom(room, "post")).toThrow(
      `locale:${BLOCK_ID_2}:missing`,
    );
    insertRichTextBlockLocale(room, paragraphLocale(BLOCK_ID_2, "둘"));

    const brokenMove = clonedRoom(room);
    const order = roomBaseOrder(brokenMove).get(
      JSON.stringify([null, "content"]),
    ) as Y.Array<string>;
    order.delete(0, 1);
    expect(() =>
      moveRichTextBlockNode(brokenMove, BLOCK_ID, { index: 0 }),
    ).toThrow("base_order:missing:" + BLOCK_ID);

    const brokenDelete = clonedRoom(room);
    const deleteOrder = roomBaseOrder(brokenDelete).get(
      JSON.stringify([null, "content"]),
    ) as Y.Array<string>;
    deleteOrder.delete(0, 1);
    expect(() => deleteBlockRoomBaseNode(brokenDelete, BLOCK_ID)).toThrow(
      "base_order:missing:" + BLOCK_ID,
    );
  });

  it("hydrates dense multi-node order and empty authored text", () => {
    const document = fromJson(RichTextDocumentSchema, {
      blockCatalogFingerprint: contentBlockCatalogFingerprint,
      profile: RichTextProfile.POST,
      sourceLocale: "ko",
      base: {
        nodes: [paragraphNode(BLOCK_ID_2, 1), paragraphNode(BLOCK_ID, 0)].map(
          (node) => toJson(RichTextBlockNodeSchema, node),
        ),
      },
      localeOverlays: [
        {
          locale: "ko",
          blocks: [
            toJson(RichTextBlockLocaleSchema, paragraphLocale(BLOCK_ID, "")),
            toJson(
              RichTextBlockLocaleSchema,
              paragraphLocale(BLOCK_ID_2, "둘"),
            ),
          ],
        },
      ],
    }) as RichTextDocument;
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "post", document);
    insertBlockRoomPayloadArrayItem(
      room,
      {
        family: "rich_text",
        id: BLOCK_ID,
        locale: true as const,
        path: "content",
      },
      0,
      { text: { text: "" } },
    );
    expect(
      getBlockRoomCollaborativeText(room, {
        family: "rich_text",
        id: BLOCK_ID,
        locale: true as const,
        path: "content[0].text.text",
      }).toString(),
    ).toBe("");
    expect(
      decodeCanonicalBlockRoom(room, "post")
        .baseNodes.sort((left, right) => left.position - right.position)
        .map(({ id }) => id),
    ).toEqual([BLOCK_ID, BLOCK_ID_2]);
  });

  it("materializes nested Page placement and reports malformed Page graphs", () => {
    const page = new Y.Doc();
    hydrateCanonicalBlockRoom(page, "page", richTextPageDocument());
    insertRichTextBlockNode(
      page,
      fromJson(RichTextBlockNodeSchema, {
        block: { id: BLOCK_ID_2, paragraph: { props: {} } },
        placement: { parentBlockId: BLOCK_ID, index: 0 },
      }) as RichTextBlockNode,
      { pageSectionId: RICH_SECTION_ID },
    );
    insertRichTextBlockLocale(page, paragraphLocale(BLOCK_ID_2, ""));
    expect(materializeCanonicalBlockRoom(page, "page")).toBeDefined();

    const invalidSection = clonedRoom(page);
    baseNode(invalidSection, RICH_SECTION_ID).set("kind", "externalVideo");
    expect(() => materializeCanonicalBlockRoom(invalidSection, "page")).toThrow(
      `locale:${RICH_SECTION_ID}:identity_mismatch`,
    );

    const missingLocaleSection = clonedRoom(page);
    const ko = roomLocaleNodes(missingLocaleSection);
    const ghost = new Y.Map<unknown>();
    ghost.set("family", "page_section");
    ghost.set("kind", "externalVideo");
    ghost.set("payload", new Y.Map());
    ko.set("ghost", ghost);
    expect(() =>
      materializeCanonicalBlockRoom(missingLocaleSection, "page"),
    ).toThrow("locale:ghost:missing_base");

    const wrongSlot = new Y.Doc();
    hydrateCanonicalBlockRoom(wrongSlot, "page", pageDocument());
    baseNode(wrongSlot, SECTION_ID).set("containerSlot", "wrong");
    const sections = roomBaseOrder(wrongSlot).get(
      JSON.stringify([null, "sections"]),
    ) as Y.Array<string>;
    sections.delete(0, 1);
    roomBaseOrder(wrongSlot).delete(JSON.stringify([null, "sections"]));
    const wrong = new Y.Array<string>();
    wrong.insert(0, [SECTION_ID]);
    roomBaseOrder(wrongSlot).set(JSON.stringify([null, "wrong"]), wrong);
    expect(() => materializeCanonicalBlockRoom(wrongSlot, "page")).toThrow(
      "slot",
    );
  });

  it("materializes a nested Page section placement with its column id", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "page", pageDocument());
    const childId = "019cce26-19a4-78fd-bd6d-4f2e4fd93f60";
    insertPageSectionNode(
      room,
      fromJson(PageSectionNodeSchema, {
        section: {
          id: childId,
          externalVideo: { props: { uri: "https://example.com/nested" } },
        },
        placement: {
          parentSectionId: SECTION_ID,
          columnId: "column-a",
          index: 0,
        },
      }) as PageSectionNode,
    );
    const affected = decodeCanonicalBlockRoomAffectedNodes(room, "page", {
      affectedBaseBlockIds: [childId],
      affectedLocaleBlockIds: [],
      affectedLocaleValueTargets: [],
      changedContainerOrderKeys: [],
      documentMetadataChanged: false,
      documentLayoutChanged: false,
      requiresFullDecode: false,
    });
    expect(affected.baseNodes[0]).toMatchObject({
      columnId: "column-a",
    });
    expect(() => materializeCanonicalBlockRoom(room, "page")).toThrow();
  });

  it("rejects invalid oneof replacement data and order storage", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "post", richTextDocument());
    expect(() =>
      replaceRichTextBlockData(
        room,
        BLOCK_ID,
        fromJson(RichTextBlockDataSchema, {}) as RichTextBlockData,
        {
          expectedKind: "paragraph",
          localeData: fromJson(
            RichTextBlockLocaleDataSchema,
            {},
          ) as RichTextBlockLocaleData,
        },
      ),
    ).toThrow("invalid_oneof");

    const badOrder = clonedRoom(room);
    roomBaseOrder(badOrder).set(JSON.stringify([null, "content"]), "not-array");
    expect(() =>
      createBlockRoomInsertionAnchor(
        badOrder,
        {
          parentId: null,
          containerSlot: "content",
        },
        0,
      ),
    ).toThrow("not_array");
    expect(() =>
      createBlockRoomInsertionAnchor(
        room,
        {
          parentId: null,
          containerSlot: "missing",
        },
        0,
      ),
    ).toThrow("base_order");
  });

  it("tracks direct container mutations and new or removed order groups", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "post", richTextDocument());
    const changes: Parameters<
      typeof decodeCanonicalBlockRoomAffectedNodes
    >[2][] = [];
    const stop = observeBlockRoomChanges(room, ({ changeSet }) =>
      changes.push(changeSet),
    );

    const extra = new Y.Map<unknown>();
    extra.set("family", "rich_text");
    extra.set("kind", "paragraph");
    extra.set("payload", new Y.Map());
    extra.set("parentId", null);
    extra.set("containerSlot", "other");
    roomBaseNodes(room).set("extra", extra);
    roomBaseNodes(room).delete("extra");

    const otherOrder = new Y.Array<string>();
    roomBaseOrder(room).set(JSON.stringify([null, "other"]), otherOrder);
    roomBaseOrder(room).delete(JSON.stringify([null, "other"]));

    const localeNodes = roomLocaleNodes(room);
    const extraLocale = new Y.Map<unknown>();
    extraLocale.set("family", "rich_text");
    extraLocale.set("kind", "paragraph");
    extraLocale.set("payload", new Y.Map());
    localeNodes.set("extra", extraLocale);
    localeNodes.delete("extra");
    stop();

    expect(changes).toHaveLength(6);
    expect(changes[0]?.affectedBaseBlockIds).toEqual(["extra"]);
    expect(changes[1]?.affectedBaseBlockIds).toEqual(["extra"]);
    expect(changes[2]?.changedContainerOrderKeys).toEqual([
      JSON.stringify([null, "other"]),
    ]);
    expect(changes[3]?.changedContainerOrderKeys).toEqual([
      JSON.stringify([null, "other"]),
    ]);
    expect(changes[4]?.affectedLocaleBlockIds).toEqual(["extra"]);
    expect(changes[5]?.affectedLocaleBlockIds).toEqual(["extra"]);
  });

  it("rejects malformed indexed order types during observation and affected decode", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "post", richTextDocument());
    roomBaseOrder(room).set(JSON.stringify([null, "content"]), "invalid");
    expect(() => observeBlockRoomChanges(room, () => {})).toThrow("not_array");
    expect(() =>
      decodeCanonicalBlockRoomAffectedNodes(room, "post", {
        affectedBaseBlockIds: [BLOCK_ID],
        affectedLocaleBlockIds: [],
        affectedLocaleValueTargets: [],
        changedContainerOrderKeys: [],
        documentMetadataChanged: false,
        documentLayoutChanged: false,
        requiresFullDecode: false,
      }),
    ).toThrow("not_array");
  });

  it("covers optional payloads and rejects incomplete exact locale projections", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "post", richTextDocument());
    insertBlockRoomPayloadArrayItem(
      room,
      {
        family: "rich_text",
        id: BLOCK_ID,
        locale: true as const,
        path: "content",
      },
      1,
      [],
    );
    expect(() =>
      setBlockRoomAtomicValue(
        room,
        {
          family: "rich_text",
          id: BLOCK_ID,
          locale: true as const,
          path: "content[9]",
        },
        null,
      ),
    ).toThrow();
    expect(() =>
      deleteBlockRoomAtomicValue(room, {
        family: "rich_text",
        id: BLOCK_ID,
        locale: true as const,
        path: "content[9]",
      }),
    ).toThrow();

    const merged = mergeBlockRoomChangeSets(
      {
        affectedBaseBlockIds: [],
        affectedLocaleBlockIds: [BLOCK_ID_2],
        affectedLocaleValueTargets: [],
        changedContainerOrderKeys: [],
        documentMetadataChanged: false,
        documentLayoutChanged: false,
        requiresFullDecode: false,
      },
      {
        affectedBaseBlockIds: [],
        affectedLocaleBlockIds: [BLOCK_ID],
        affectedLocaleValueTargets: [],
        changedContainerOrderKeys: [],
        documentMetadataChanged: false,
        documentLayoutChanged: false,
        requiresFullDecode: false,
      },
    );
    expect(merged.affectedLocaleBlockIds).toEqual([BLOCK_ID, BLOCK_ID_2]);
    expect(merged).toMatchObject({
      documentMetadataChanged: false,
      documentLayoutChanged: false,
      requiresFullDecode: false,
    });

    const page = new Y.Doc();
    hydrateCanonicalBlockRoom(page, "page", richTextPageDocument());
    const ko = roomLocaleNodes(page);
    ko.delete(RICH_SECTION_ID);
    ko.delete(BLOCK_ID);
    expect(() => materializeCanonicalBlockRoom(page, "page")).toThrow(
      `locale:${RICH_SECTION_ID}:missing`,
    );

    const target = new Y.Doc();
    hydrateCanonicalBlockRoom(target, "page", pageDocument());
    insertPageSectionNode(
      target,
      fromJson(PageSectionNodeSchema, {
        section: { id: RICH_SECTION_ID, richText: { props: {} } },
        placement: { index: 1 },
      }) as PageSectionNode,
    );
    expect(() => materializeCanonicalBlockRoom(target, "page")).toThrow(
      `locale:${RICH_SECTION_ID}:missing`,
    );
  });

  it("detects a Page ancestry cycle during canonical materialization", () => {
    const page = new Y.Doc();
    hydrateCanonicalBlockRoom(page, "page", richTextPageDocument());
    const node = baseNode(page, BLOCK_ID);
    const oldKey = JSON.stringify([RICH_SECTION_ID, "content"]);
    const oldOrder = roomBaseOrder(page).get(oldKey) as Y.Array<string>;
    oldOrder.delete(0, 1);
    roomBaseOrder(page).delete(oldKey);
    node.set("parentId", BLOCK_ID);
    const cycle = new Y.Array<string>();
    cycle.insert(0, [BLOCK_ID]);
    roomBaseOrder(page).set(JSON.stringify([BLOCK_ID, "content"]), cycle);
    expect(() => materializeCanonicalBlockRoom(page, "page")).toThrow(
      "parent_cycle",
    );
  });

  it("rejects expected document mismatch and impossible payload parents", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "post", richTextDocument());
    expect(() => materializeCanonicalBlockRoom(room, "work")).toThrow(
      "document_type",
    );

    const primitive = clonedRoom(room);
    baseNode(primitive, BLOCK_ID).set("payload", 1);
    expect(() =>
      setBlockRoomAtomicValue(
        primitive,
        {
          family: "rich_text",
          id: BLOCK_ID,
          path: "value",
        },
        2,
      ),
    ).toThrow("node:" + BLOCK_ID + ":path:value");

    expect(() =>
      setBlockRoomAtomicValue(
        room,
        {
          family: "rich_text",
          id: BLOCK_ID,
          path: "props[0]",
        },
        2,
      ),
    ).toThrow("node:" + BLOCK_ID + ":path:props[0]");
  });

  it("rejects absent Page and nested Rich Text locale wrappers", () => {
    const blockOnly = new Y.Doc();
    hydrateCanonicalBlockRoom(blockOnly, "page", richTextPageDocument());
    roomLocaleNodes(blockOnly).delete(RICH_SECTION_ID);
    expect(() => materializeCanonicalBlockRoom(blockOnly, "page")).toThrow(
      `locale:${RICH_SECTION_ID}:missing`,
    );

    const sectionOnly = new Y.Doc();
    hydrateCanonicalBlockRoom(sectionOnly, "page", richTextPageDocument());
    roomLocaleNodes(sectionOnly).delete(BLOCK_ID);
    expect(() => materializeCanonicalBlockRoom(sectionOnly, "page")).toThrow(
      `locale:${BLOCK_ID}:missing`,
    );

    const target = new Y.Doc();
    hydrateCanonicalBlockRoom(target, "page", richTextPageDocument());
    deleteBlockRoomLocaleNode(target, RICH_SECTION_ID);
    insertPageSectionLocale(
      target,
      fromJson(PageSectionLocaleSchema, {
        sectionId: RICH_SECTION_ID,
        richText: { props: {} },
      }) as PageSectionLocale,
    );
    expect(materializeCanonicalBlockRoom(target, "page")).toBeDefined();
  });

  it("fails closed while materializing malformed ancestry and document families", () => {
    const reparent = (room: Y.Doc, parentId: string) => {
      const node = baseNode(room, BLOCK_ID);
      const oldKey = JSON.stringify([RICH_SECTION_ID, "content"]);
      const oldOrder = roomBaseOrder(room).get(oldKey) as Y.Array<string>;
      oldOrder.delete(0, 1);
      roomBaseOrder(room).delete(oldKey);
      node.set("parentId", parentId);
      const order = new Y.Array<string>();
      order.insert(0, [BLOCK_ID]);
      roomBaseOrder(room).set(JSON.stringify([parentId, "content"]), order);
    };

    const missingParent = new Y.Doc();
    hydrateCanonicalBlockRoom(missingParent, "page", richTextPageDocument());
    reparent(missingParent, BLOCK_ID_2);
    expect(() => materializeCanonicalBlockRoom(missingParent, "page")).toThrow(
      "missing_parent",
    );

    const wrongSectionKind = new Y.Doc();
    hydrateCanonicalBlockRoom(wrongSectionKind, "page", richTextPageDocument());
    baseNode(wrongSectionKind, RICH_SECTION_ID).set("kind", "externalVideo");
    localeNode(wrongSectionKind, RICH_SECTION_ID).set("kind", "externalVideo");
    expect(() =>
      materializeCanonicalBlockRoom(wrongSectionKind, "page"),
    ).toThrow("section_kind");

    const wrongPostFamily = new Y.Doc();
    hydrateCanonicalBlockRoom(wrongPostFamily, "post", richTextDocument());
    baseNode(wrongPostFamily, BLOCK_ID).set("family", "page_section");
    localeNode(wrongPostFamily, BLOCK_ID).set("family", "page_section");
    expect(() =>
      materializeCanonicalBlockRoom(wrongPostFamily, "post"),
    ).toThrow("base_node:" + BLOCK_ID + ":family");

    const emptyRichSection = new Y.Doc();
    hydrateCanonicalBlockRoom(emptyRichSection, "page", richTextPageDocument());
    deleteBlockRoomBaseNode(emptyRichSection, BLOCK_ID);
    expect(
      materializeCanonicalBlockRoom(emptyRichSection, "page"),
    ).toBeDefined();
  });
});
