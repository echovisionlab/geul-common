import { create, fromJson, toJson, type JsonValue } from "@bufbuild/protobuf";
import { contentBlockCatalogFingerprint } from "@echovisionlab/geul-proto/content/block_catalog.ts";
import {
  LocalizedRichTextDocumentSchema,
  RichTextProfile,
  type LocalizedRichTextDocument,
} from "@echovisionlab/geul-proto/content/block_content_pb.ts";
import {
  AIDocumentFieldTargetSchema,
  AIDocumentInlineContentSchema,
  AIDocumentInlineItemSchema,
  AIDocumentInlineMarkSchema,
  AIDocumentListItemSchema,
  AIDocumentListValueSchema,
  AIDocumentValueSchema,
  type AIDocumentInlineItem,
} from "@echovisionlab/geul-proto/secure/ai_pb.ts";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  getBlockRoomCollaborativeText,
  hydrateCanonicalBlockRoom,
  materializeCanonicalBlockRoom,
  reconcileBlockRoomInlineContent,
  replaceBlockRoomCollaborativeText,
  type BlockRoomPayloadRef,
} from "../block-room-codec.ts";
import { setAIDocumentField } from "./ai-document-field-mutations.ts";
import { fromYInlineContent } from "./inline-content-projection.ts";
import { isBlockRoomInlineContentRef } from "./inline-content-mutations.ts";
import {
  blockRoomLocaleValue,
  blockRoomLocaleValueIsEncoded,
} from "./locale-presence.ts";

const BLOCK_ID = "019cce25-dbc0-7d12-9f1f-735b1a6c6b13";
const TABLE_ROW_ID = "019cce25-dbc0-7d12-9f1f-735b1a6c6b14";
const TABLE_CELL_ID = "019cce25-dbc0-7d12-9f1f-735b1a6c6b15";
const inlineRef = {
  id: BLOCK_ID,
  family: "rich_text" as const,
  locale: true as const,
  path: "content",
};

function textRun(text: string, styles?: Record<string, boolean | string>) {
  return { text: styles ? { text, styles } : { text } } as JsonValue;
}

function tableDocument() {
  return fromJson(LocalizedRichTextDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    profile: RichTextProfile.POST,
    locale: "ko",
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
    localeOverlay: {
      locale: "ko",
      blocks: [
        {
          blockId: BLOCK_ID,
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
  });
}

function inlineDocument(content: readonly JsonValue[]) {
  return fromJson(LocalizedRichTextDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    profile: RichTextProfile.POST,
    locale: "ko",
    base: {
      nodes: [
        {
          block: { id: BLOCK_ID, paragraph: { props: {} } },
          placement: { index: 0 },
        },
      ],
    },
    localeOverlay: {
      locale: "ko",
      blocks: [
        {
          blockId: BLOCK_ID,
          paragraph: { props: {}, content: [...content] },
        },
      ],
    },
  });
}

function p5Document() {
  return fromJson(LocalizedRichTextDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    profile: RichTextProfile.POST,
    locale: "ko",
    base: {
      nodes: [
        {
          block: {
            id: BLOCK_ID,
            p5Sketch: { props: { capabilities: [] } },
          },
          placement: { index: 0 },
        },
      ],
    },
    localeOverlay: {
      locale: "ko",
      blocks: [{ blockId: BLOCK_ID, p5Sketch: { props: {} } }],
    },
  });
}

function aiList(values: readonly string[]) {
  return create(AIDocumentValueSchema, {
    value: {
      case: "list",
      value: create(AIDocumentListValueSchema, {
        items: values.map((value) =>
          create(AIDocumentListItemSchema, {
            itemHandle: value,
            value: create(AIDocumentValueSchema, {
              value: { case: "text", value },
            }),
          }),
        ),
      }),
    },
  });
}

function roomWithInline(content: readonly JsonValue[]): Y.Doc {
  const room = new Y.Doc();
  hydrateCanonicalBlockRoom(room, "post", "ko", inlineDocument(content), []);
  return room;
}

function rawInlineContent(room: Y.Doc, path = "content"): Y.Array<unknown> {
  const root = room.getMap<unknown>("block-document");
  const overlays = root.get("localeOverlay") as Y.Map<unknown>;
  const node = overlays.get(BLOCK_ID) as Y.Map<unknown>;
  let value: unknown = node.get("payload");
  for (const part of path.split(".")) {
    const match = /^([A-Za-z][A-Za-z0-9]*)(?:\[(\d+)\])?$/.exec(part)!;
    value = (value as Y.Map<unknown>).get(match[1]!);
    if (match[2] !== undefined) {
      value = (value as Y.Array<unknown>).get(Number(match[2]));
    }
  }
  return value as unknown as Y.Array<unknown>;
}

function cloneRoom(room: Y.Doc): Y.Doc {
  const clone = new Y.Doc();
  Y.applyUpdate(clone, Y.encodeStateAsUpdate(room));
  return clone;
}

function aiText(text: string): AIDocumentInlineItem {
  return create(AIDocumentInlineItemSchema, {
    item: { case: "text", value: text },
  });
}

function aiBold(text: string): AIDocumentInlineItem {
  return create(AIDocumentInlineItemSchema, {
    item: {
      case: "mark",
      value: create(AIDocumentInlineMarkSchema, {
        mark: "bold",
        children: [aiText(text)],
      }),
    },
  });
}

describe("Block Room inline content reconciliation", () => {
  it("sets and removes partial marks while keeping the same Y.Text", () => {
    const room = roomWithInline([textRun("abcdef")]);
    const text = getBlockRoomCollaborativeText(room, {
      ...inlineRef,
      path: "content[0].text.text",
    });

    reconcileBlockRoomInlineContent(
      room,
      inlineRef,
      [textRun("abcdef")],
      [textRun("ab"), textRun("cd", { bold: true }), textRun("ef")],
    );

    expect(
      getBlockRoomCollaborativeText(room, {
        ...inlineRef,
        path: "content[0].text.text",
      }),
    ).toBe(text);
    expect(text.toDelta()).toEqual([
      { insert: "ab" },
      { insert: "cd", attributes: { bold: true } },
      { insert: "ef" },
    ]);

    reconcileBlockRoomInlineContent(
      room,
      inlineRef,
      [textRun("ab"), textRun("cd", { bold: true }), textRun("ef")],
      [textRun("abcdef")],
    );

    expect(
      getBlockRoomCollaborativeText(room, {
        ...inlineRef,
        path: "content[0].text.text",
      }),
    ).toBe(text);
    expect(text.toDelta()).toEqual([
      { insert: "ab" },
      { insert: "cd", attributes: { bold: false } },
      { insert: "ef" },
    ]);
    expect(fromYInlineContent(rawInlineContent(room))).toEqual([
      { text: { text: "abcdef" } },
    ]);
    const materialized = materializeCanonicalBlockRoom(room, "post");
    const json = toJson(
      LocalizedRichTextDocumentSchema,
      materialized as LocalizedRichTextDocument,
    ) as {
      localeOverlay?: {
        blocks: Array<{ paragraph?: { content: unknown[] } }>;
      };
    };
    expect(json.localeOverlay?.blocks[0]?.paragraph?.content).toEqual([
      { text: { text: "abcdef" } },
    ]);
  });

  it("creates a missing empty inline array only for a nonempty edit", () => {
    const room = roomWithInline([]);
    const before = Y.encodeStateAsUpdate(room);
    reconcileBlockRoomInlineContent(room, inlineRef, [], []);
    expect(Y.encodeStateAsUpdate(room)).toEqual(before);

    expect(() =>
      reconcileBlockRoomInlineContent(
        room,
        inlineRef,
        [textRun("stale")],
        [textRun("new")],
      ),
    ).toThrow("block_room_invalid:stale_inline_content");
    expect(Y.encodeStateAsUpdate(room)).toEqual(before);

    reconcileBlockRoomInlineContent(room, inlineRef, [], [textRun("first")]);

    expect(
      getBlockRoomCollaborativeText(room, {
        ...inlineRef,
        path: "content[0].text.text",
      }).toString(),
    ).toBe("first");
    const materialized = materializeCanonicalBlockRoom(room, "post");
    expect(materialized.$typeName).toBe(
      "api.content.v1.LocalizedRichTextDocument",
    );
  });

  it("canonicalizes equivalent adjacent runs without replacing their text nodes", () => {
    const previous = [
      textRun("ab", { bold: true }),
      textRun("cd", { bold: true }),
    ];
    const room = roomWithInline(previous);
    const first = getBlockRoomCollaborativeText(room, {
      ...inlineRef,
      path: "content[0].text.text",
    });
    const second = getBlockRoomCollaborativeText(room, {
      ...inlineRef,
      path: "content[1].text.text",
    });

    reconcileBlockRoomInlineContent(room, inlineRef, previous, [
      textRun("abcd", { bold: true }),
    ]);

    expect(
      getBlockRoomCollaborativeText(room, {
        ...inlineRef,
        path: "content[0].text.text",
      }),
    ).toBe(first);
    expect(
      getBlockRoomCollaborativeText(room, {
        ...inlineRef,
        path: "content[1].text.text",
      }),
    ).toBe(second);
    expect(first.toString()).toBe("ab");
    expect(second.toString()).toBe("cd");
  });

  it("rejects invalid scope, path, catalog kind, and malformed inline input", () => {
    const room = roomWithInline([textRun("x")]);
    const validPrevious = [textRun("x")];
    const failWith = (ref: BlockRoomPayloadRef, expected: string) => {
      expect(() =>
        reconcileBlockRoomInlineContent(
          room,
          ref,
          validPrevious,
          validPrevious,
        ),
      ).toThrow(expected);
    };

    expect(isBlockRoomInlineContentRef(inlineRef)).toBe(true);
    expect(
      isBlockRoomInlineContentRef({ ...inlineRef, family: "page_section" }),
    ).toBe(false);
    expect(
      isBlockRoomInlineContentRef({ ...inlineRef, locale: undefined }),
    ).toBe(false);
    expect(isBlockRoomInlineContentRef({ ...inlineRef, path: "props" })).toBe(
      false,
    );
    failWith({ ...inlineRef, family: "page_section" }, "inline_content_scope");
    failWith({ ...inlineRef, locale: undefined }, "inline_content_scope");
    failWith({ ...inlineRef, id: "missing" }, "node:missing:missing");
    failWith({ ...inlineRef, path: "props" }, "not_inline_content:props");

    const node = (
      room
        .getMap<unknown>("block-document")
        .get("localeOverlay") as Y.Map<unknown>
    ).get(BLOCK_ID) as Y.Map<unknown>;
    node.set("kind", "unknown-kind");
    failWith(inlineRef, "not_inline_content:content");

    const malformed: Array<[unknown, string]> = [
      [null, "inline_content:input:0"],
      [{}, "inline_content:input:0:oneof"],
      [{ text: { text: 1 } }, "inline_content:input:0:text:text"],
      [{ text: {} }, "inline_content:input:0:text:text"],
      [
        { text: { text: "x", styles: [] } },
        "inline_content:input:0:text:styles",
      ],
      [
        { text: { text: "x", styles: { bold: "yes" } } },
        "inline_content:input:0:text:styles:bold",
      ],
      [
        { text: { text: "x", styles: { textColor: true } } },
        "inline_content:input:0:text:styles:textColor",
      ],
      [
        { text: { text: "x", styles: { backgroundColor: 3 } } },
        "inline_content:input:0:text:styles:backgroundColor",
      ],
      [{ link: { href: 1, content: [] } }, "inline_content:input:0:link_shape"],
      [
        { link: { href: "https://example.com", content: "bad" } },
        "inline_content:input:0:link_shape",
      ],
      [
        { link: { href: "https://example.com", content: [null] } },
        "inline_content:input:0:link_content:0",
      ],
      [{ mathInline: 1 }, "inline_content:input:0:math"],
      [{ mathInline: { source: 1 } }, "inline_content:input:0:math_source"],
    ];
    for (const [value, expected] of malformed) {
      const current = roomWithInline([textRun("x")]);
      expect(() =>
        reconcileBlockRoomInlineContent(current, inlineRef, validPrevious, [
          value as JsonValue,
        ]),
      ).toThrow(expected);
    }
  });

  it("accepts empty defaults and updates math text in place", () => {
    const room = roomWithInline([{ mathInline: { source: "x+y" } }]);
    const math = getBlockRoomCollaborativeText(room, {
      ...inlineRef,
      path: "content[0].mathInline.source",
    });

    reconcileBlockRoomInlineContent(
      room,
      inlineRef,
      [{ mathInline: { source: "x+y" } }],
      [{ mathInline: {} } as JsonValue],
    );

    expect(math.toString()).toBe("");
    reconcileBlockRoomInlineContent(
      room,
      inlineRef,
      [{ mathInline: {} } as JsonValue],
      [{ mathInline: { source: "a+b" } }],
    );
    expect(math.toString()).toBe("a+b");

    const linkRoom = roomWithInline([
      { link: { href: "https://example.com", content: [] } },
    ]);
    reconcileBlockRoomInlineContent(
      linkRoom,
      inlineRef,
      [{ link: { href: "https://example.com", content: [] } }],
      [{ link: { href: "https://example.com", content: ["text"] } }],
    );
    expect(fromYInlineContent(rawInlineContent(linkRoom))).toEqual([
      {
        link: {
          href: "https://example.com",
          content: [{ text: "text" }],
        },
      },
    ]);
  });

  it("inserts links, math, and hard breaks while retaining a matched text suffix", () => {
    const room = roomWithInline([textRun("tail")]);
    const next = [
      {
        link: {
          href: "https://example.com",
          content: [{ text: "linked", styles: { bold: true } }],
        },
      },
      { mathInline: { source: "x + 1" } },
      { hardBreak: {} },
      textRun("tail"),
    ] as JsonValue[];

    reconcileBlockRoomInlineContent(room, inlineRef, [textRun("tail")], next);

    expect(fromYInlineContent(rawInlineContent(room))).toEqual(next);
    const editedTail = [...next.slice(0, 3), textRun("tail!")];
    reconcileBlockRoomInlineContent(room, inlineRef, next, editedTail);
    expect(fromYInlineContent(rawInlineContent(room))).toEqual(editedTail);

    const emptyLinkRoom = roomWithInline([textRun("tail")]);
    const emptyLink = [
      { link: { href: "https://empty.example", content: [] } },
      textRun("tail"),
    ] as JsonValue[];
    reconcileBlockRoomInlineContent(
      emptyLinkRoom,
      inlineRef,
      [textRun("tail")],
      emptyLink,
    );
    expect(fromYInlineContent(rawInlineContent(emptyLinkRoom))).toEqual(
      emptyLink,
    );
    const emptyChild = [
      { link: { href: "https://empty.example", content: [""] } },
      textRun("tail"),
    ] as JsonValue[];
    reconcileBlockRoomInlineContent(
      emptyLinkRoom,
      inlineRef,
      emptyLink,
      emptyChild,
    );
    expect(fromYInlineContent(rawInlineContent(emptyLinkRoom))).toEqual(
      emptyLink,
    );
  });

  it("falls back across adjacent physical text segments without replacing them", () => {
    const initial = [textRun("abc"), textRun("def")];
    const room = roomWithInline(initial);
    const first = getBlockRoomCollaborativeText(room, {
      ...inlineRef,
      path: "content[0].text.text",
    });
    const second = getBlockRoomCollaborativeText(room, {
      ...inlineRef,
      path: "content[1].text.text",
    });

    reconcileBlockRoomInlineContent(room, inlineRef, initial, [
      textRun("abcdeXf"),
    ]);
    expect(first.toString()).toBe("abc");
    expect(second.toString()).toBe("deXf");

    reconcileBlockRoomInlineContent(
      room,
      inlineRef,
      [textRun("abcdeXf")],
      [textRun("abXf")],
    );

    expect(first.toString()).toBe("ab");
    expect(second.toString()).toBe("Xf");
    expect(
      getBlockRoomCollaborativeText(room, {
        ...inlineRef,
        path: "content[0].text.text",
      }),
    ).toBe(first);
    expect(
      getBlockRoomCollaborativeText(room, {
        ...inlineRef,
        path: "content[1].text.text",
      }),
    ).toBe(second);
  });

  it("creates a missing raw Y.Text leaf and rejects non-collaborative text shapes", () => {
    const missingTextRoom = roomWithInline([textRun("")]);
    const textItem = rawInlineContent(missingTextRoom).get(0) as Y.Map<unknown>;
    (textItem.get("text") as Y.Map<unknown>).delete("text");

    const createdRuns = [textRun("create"), textRun("d", { bold: true })];
    reconcileBlockRoomInlineContent(
      missingTextRoom,
      inlineRef,
      [],
      createdRuns,
    );

    expect(
      getBlockRoomCollaborativeText(missingTextRoom, {
        ...inlineRef,
        path: "content[0].text.text",
      }).toString(),
    ).toBe("created");
    expect(fromYInlineContent(rawInlineContent(missingTextRoom))).toEqual([
      { text: { text: "create" } },
      { text: { text: "d", styles: { bold: true } } },
    ]);

    const rawStringRoom = roomWithInline([textRun("legacy")]);
    const rawStringItem = rawInlineContent(rawStringRoom).get(
      0,
    ) as Y.Map<unknown>;
    (rawStringItem.get("text") as Y.Map<unknown>).set("text", "legacy");
    expect(() =>
      reconcileBlockRoomInlineContent(
        rawStringRoom,
        inlineRef,
        [textRun("legacy")],
        [textRun("changed")],
      ),
    ).toThrow("block_room_invalid:inline_content:raw:0:text:text");

    const plainLinkRoom = roomWithInline([
      { link: { href: "https://example.com", content: [] } },
    ]);
    const plainLinkItem = rawInlineContent(plainLinkRoom).get(
      0,
    ) as Y.Map<unknown>;
    plainLinkItem.set("link", { href: "https://example.com" });
    expect(() =>
      reconcileBlockRoomInlineContent(
        plainLinkRoom,
        inlineRef,
        [{ link: { href: "https://example.com", content: [] } }],
        [{ link: { href: "https://changed.example", content: [] } }],
      ),
    ).toThrow("block_room_invalid:inline_content:raw:0:link");

    const rawMathRoom = roomWithInline([{ mathInline: { source: "x" } }]);
    const mathItem = rawInlineContent(rawMathRoom).get(0) as Y.Map<unknown>;
    (mathItem.get("mathInline") as Y.Map<unknown>).set("source", "x");
    expect(() =>
      reconcileBlockRoomInlineContent(
        rawMathRoom,
        inlineRef,
        [{ mathInline: { source: "x" } }],
        [{ mathInline: { source: "y" } }],
      ),
    ).toThrow("block_room_invalid:inline_content:raw:0:math_source");
  });

  it("masks legacy color styles when a partial mark is removed", () => {
    const initial = [textRun("colored", { textColor: "red" })];
    const room = roomWithInline(initial);
    const text = getBlockRoomCollaborativeText(room, {
      ...inlineRef,
      path: "content[0].text.text",
    });

    reconcileBlockRoomInlineContent(room, inlineRef, initial, [
      textRun("colored"),
    ]);

    expect(text.toDelta()).toEqual([
      { insert: "colored", attributes: { textColor: "" } },
    ]);
    expect(fromYInlineContent(rawInlineContent(room))).toEqual([
      { text: { text: "colored" } },
    ]);
  });

  it("routes AI inline writes through Y.Text and projects locale presence", () => {
    const room = roomWithInline([textRun("abcdef", { bold: true })]);
    const text = getBlockRoomCollaborativeText(room, {
      ...inlineRef,
      path: "content[0].text.text",
    });
    const target = create(AIDocumentFieldTargetSchema, {
      owner: { case: "blockHandle", value: BLOCK_ID },
      fieldHandle: "content",
    });
    const value = create(AIDocumentValueSchema, {
      value: {
        case: "inline",
        value: create(AIDocumentInlineContentSchema, {
          items: [aiText("ab"), aiBold("cd"), aiText("ef")],
        }),
      },
    });

    setAIDocumentField(room, target, value);

    expect(
      getBlockRoomCollaborativeText(room, {
        ...inlineRef,
        path: "content[0].text.text",
      }),
    ).toBe(text);
    expect(blockRoomLocaleValue(room, target)).toEqual([
      { text: { text: "ab" } },
      { text: { text: "cd", styles: { bold: true } } },
      { text: { text: "ef" } },
    ]);
    expect(blockRoomLocaleValueIsEncoded(room, target)).toBe(true);
    expect(text.toDelta()).toEqual([
      { insert: "ab", attributes: { bold: false } },
      { insert: "cd" },
      { insert: "ef", attributes: { bold: false } },
    ]);
  });

  it("keeps non-inline AI array replacement on its physical payload path", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "post", "ko", p5Document(), []);
    const target = create(AIDocumentFieldTargetSchema, {
      owner: { case: "blockHandle", value: BLOCK_ID },
      fieldHandle: "capabilities",
    });
    const root = room.getMap<unknown>("block-document");
    const baseNodes = root.get("baseNodes") as Y.Map<unknown>;
    const node = baseNodes.get(BLOCK_ID) as Y.Map<unknown>;
    const payload = node.get("payload") as Y.Map<unknown>;
    const props = payload.get("props") as Y.Map<unknown>;
    const capabilities = new Y.Array<unknown>();
    props.set("capabilities", capabilities);

    setAIDocumentField(room, target, aiList(["microphone", "camera"]));

    expect(capabilities.toArray()).toEqual([
      "CAPABILITIES_ITEM_MICROPHONE",
      "CAPABILITIES_ITEM_CAMERA",
    ]);

    setAIDocumentField(room, target, aiList([]));
    expect(capabilities.toArray()).toEqual([]);
  });

  it("keeps whole-leaf text replacement separate from inline mark editing", () => {
    const room = roomWithInline([textRun("plain")]);
    const text = getBlockRoomCollaborativeText(room, {
      ...inlineRef,
      path: "content[0].text.text",
    });
    reconcileBlockRoomInlineContent(
      room,
      inlineRef,
      [textRun("plain")],
      [textRun("plain", { italic: true })],
    );
    expect(text.toDelta()).toEqual([
      { insert: "plain", attributes: { italic: true } },
    ]);

    replaceBlockRoomCollaborativeText(
      room,
      { ...inlineRef, path: "content[0].text.text" },
      "replacement",
    );

    expect(text.toDelta()).toEqual([{ insert: "replacement" }]);
    expect(fromYInlineContent(rawInlineContent(room))).toEqual([
      { text: { text: "replacement" } },
    ]);
  });

  it("retains legacy styles and scopes mark writes over only changed ranges", () => {
    const initial = [textRun("abcdef", { bold: true })];
    const room = roomWithInline(initial);
    const local = cloneRoom(room);
    const remote = cloneRoom(room);
    const localText = getBlockRoomCollaborativeText(local, {
      ...inlineRef,
      path: "content[0].text.text",
    });
    const remoteText = getBlockRoomCollaborativeText(remote, {
      ...inlineRef,
      path: "content[0].text.text",
    });
    const localVector = Y.encodeStateVector(local);
    const remoteVector = Y.encodeStateVector(remote);
    reconcileBlockRoomInlineContent(local, inlineRef, initial, [
      textRun("ab", { bold: true }),
      textRun("cd"),
      textRun("ef", { bold: true }),
    ]);
    remoteText.insert(0, "X");
    Y.applyUpdate(local, Y.encodeStateAsUpdate(remote, localVector));
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(local, remoteVector));

    expect(localText.toString()).toBe("Xabcdef");
    expect(remoteText.toString()).toBe("Xabcdef");
    const localItem = rawInlineContent(local).get(0) as Y.Map<unknown>;
    const localStyled = localItem.get("text") as Y.Map<unknown>;
    expect((localStyled.get("styles") as Y.Map<unknown>).get("bold")).toBe(
      true,
    );
    expect(localText.toDelta()).toEqual([
      { insert: "Xab" },
      { insert: "cd", attributes: { bold: false } },
      { insert: "ef" },
    ]);
    expect(fromYInlineContent(rawInlineContent(local))).toEqual([
      { text: { text: "Xab", styles: { bold: true } } },
      { text: { text: "cd" } },
      { text: { text: "ef", styles: { bold: true } } },
    ]);
    expect(fromYInlineContent(rawInlineContent(remote))).toEqual(
      fromYInlineContent(rawInlineContent(local)),
    );
  });

  it("reconciles nested links and empty link content without replacing Y.Text", () => {
    const initial = [
      {
        link: {
          href: "https://before.example",
          content: [{ text: "linktext" }],
        },
      },
    ] as JsonValue[];
    const room = roomWithInline(initial);
    const text = getBlockRoomCollaborativeText(room, {
      ...inlineRef,
      path: "content[0].link.content[0].text",
    });
    const next = [
      {
        link: {
          href: "https://after.example",
          content: [
            { text: "link" },
            { text: "text", styles: { italic: true } },
          ],
        },
      },
    ] as JsonValue[];

    reconcileBlockRoomInlineContent(room, inlineRef, initial, next);

    expect(
      getBlockRoomCollaborativeText(room, {
        ...inlineRef,
        path: "content[0].link.content[0].text",
      }),
    ).toBe(text);
    expect(fromYInlineContent(rawInlineContent(room))).toEqual([
      {
        link: {
          href: "https://after.example",
          content: [
            { text: "link" },
            { text: "text", styles: { italic: true } },
          ],
        },
      },
    ]);

    const emptyLink = [
      { link: { href: "https://empty.example", content: [] } },
    ] as JsonValue[];
    const emptyRoom = roomWithInline(emptyLink);
    const filledLink = [
      {
        link: {
          href: "https://empty.example",
          content: [{ text: "new", styles: { bold: true } }],
        },
      },
    ] as JsonValue[];
    reconcileBlockRoomInlineContent(
      emptyRoom,
      inlineRef,
      emptyLink,
      filledLink,
    );
    const rawLink = rawInlineContent(emptyRoom).get(0) as Y.Map<unknown>;
    const link = rawLink.get("link") as Y.Map<unknown>;
    const children = link.get("content") as Y.Array<unknown>;
    const child = children.get(0) as Y.Map<unknown>;
    expect(child.get("text")).toBeInstanceOf(Y.Text);
    expect(fromYInlineContent(rawInlineContent(emptyRoom))).toEqual([
      {
        link: {
          href: "https://empty.example",
          content: [{ text: "new", styles: { bold: true } }],
        },
      },
    ]);
  });

  it("keeps concurrent edits in separate nested link text nodes independent", () => {
    const initial = [
      {
        link: {
          href: "https://example.com",
          content: [
            { text: "left" },
            { text: "right", styles: { bold: true } },
          ],
        },
      },
    ] as JsonValue[];
    const first = roomWithInline(initial);
    const second = cloneRoom(first);
    const previous = initial;

    reconcileBlockRoomInlineContent(first, inlineRef, previous, [
      {
        link: {
          href: "https://example.com",
          content: [
            { text: "first left" },
            { text: "right", styles: { bold: true } },
          ],
        },
      },
    ]);
    reconcileBlockRoomInlineContent(second, inlineRef, previous, [
      {
        link: {
          href: "https://example.com",
          content: [
            { text: "left" },
            { text: "second right", styles: { bold: true } },
          ],
        },
      },
    ]);

    Y.applyUpdate(
      second,
      Y.encodeStateAsUpdate(first, Y.encodeStateVector(second)),
    );
    Y.applyUpdate(
      first,
      Y.encodeStateAsUpdate(second, Y.encodeStateVector(first)),
    );

    for (const room of [first, second]) {
      expect(
        getBlockRoomCollaborativeText(room, {
          ...inlineRef,
          path: "content[0].link.content[0].text",
        }).toString(),
      ).toBe("first left");
      expect(
        getBlockRoomCollaborativeText(room, {
          ...inlineRef,
          path: "content[0].link.content[1].text",
        }).toString(),
      ).toBe("second right");
    }
  });

  it("preserves table-cell text identity, matched suffixes, and rejects stale input", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "post", "ko", tableDocument(), []);
    const tableRef = {
      ...inlineRef,
      path: "content.rows[0].cells[0].content",
    };
    const cellText = getBlockRoomCollaborativeText(room, {
      ...inlineRef,
      path: `${tableRef.path}[0].text.text`,
    });
    const oldTableContent = [textRun("cell")];
    const nextTableContent = [
      textRun("ce"),
      textRun("ll", { underline: true }),
    ];

    reconcileBlockRoomInlineContent(
      room,
      tableRef,
      oldTableContent,
      nextTableContent,
    );

    expect(
      getBlockRoomCollaborativeText(room, {
        ...inlineRef,
        path: `${tableRef.path}[0].text.text`,
      }),
    ).toBe(cellText);
    expect(cellText.toDelta()).toEqual([
      { insert: "ce" },
      { insert: "ll", attributes: { underline: true } },
    ]);

    const suffixRoom = roomWithInline([
      textRun("left"),
      { mathInline: { source: "x" } },
      textRun("right"),
    ]);
    const suffixText = getBlockRoomCollaborativeText(suffixRoom, {
      ...inlineRef,
      path: "content[2].text.text",
    });
    const beforeStale = Y.encodeStateAsUpdate(suffixRoom);
    expect(() =>
      reconcileBlockRoomInlineContent(
        suffixRoom,
        inlineRef,
        [textRun("different")],
        [textRun("replacement")],
      ),
    ).toThrow("block_room_invalid:stale_inline_content");
    expect(Y.encodeStateAsUpdate(suffixRoom)).toEqual(beforeStale);

    reconcileBlockRoomInlineContent(
      suffixRoom,
      inlineRef,
      [textRun("left"), { mathInline: { source: "x" } }, textRun("right")],
      [textRun("left"), { hardBreak: {} }, textRun("right")],
    );
    expect(
      getBlockRoomCollaborativeText(suffixRoom, {
        ...inlineRef,
        path: "content[2].text.text",
      }),
    ).toBe(suffixText);
  });
});
