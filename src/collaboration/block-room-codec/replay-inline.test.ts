import { fromJson, type JsonValue } from "@bufbuild/protobuf";
import { contentBlockCatalogFingerprint } from "@echovisionlab/geul-proto/content/block_catalog.ts";
import {
  LocalizedRichTextDocumentSchema,
  RichTextProfile,
} from "@echovisionlab/geul-proto/content/block_content_pb.ts";
import * as Y from "yjs";
import { afterEach, describe, expect, it } from "vitest";
import {
  decodeCanonicalBlockRoom,
  hydrateCanonicalBlockRoom,
  reconcileBlockRoomInlineContent,
  replayBlockRoomChanges,
  replaceBlockRoomCollaborativeText,
} from "../block-room-codec.ts";
import { fromYInlineContent } from "./inline-content-projection.ts";
import { roomNode, payloadValue } from "./room-access.ts";
import { mergeInlineIntent, mergeTextIntent } from "./replay-inline-merge.ts";
import { applyPayloadRootDiff } from "./replay-payload.ts";

const documents = new Set<Y.Doc>();
afterEach(() => {
  for (const document of documents) document.destroy();
  documents.clear();
});

const BLOCK = "d5e4c5d2-c628-47a9-8bc0-6b69dd725101";
const ROW = "8f93ce52-439a-4843-a694-f60595360101";
const CELL = "8f93ce52-439a-4843-a694-f60595360201";
const ref = {
  id: BLOCK,
  family: "rich_text" as const,
  locale: true as const,
  path: "content",
};
const text = (value: string, styles = {}): JsonValue => ({
  text: { text: value, styles },
});

function room(content: JsonValue[] | string, kind = "paragraph"): Y.Doc {
  const isTable = kind === "table";
  const document = fromJson(LocalizedRichTextDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    profile: RichTextProfile.POST,
    locale: "en",
    base: {
      nodes: [
        {
          block: {
            id: BLOCK,
            [kind]: {
              props: {},
              ...(isTable
                ? {
                    content: {
                      columnWidths: [100],
                      rows: [{ id: ROW, cells: [{ id: CELL, props: {} }] }],
                    },
                  }
                : {}),
            },
          },
          placement: { index: 0 },
        },
      ],
    },
    localeOverlay: {
      locale: "en",
      blocks: [
        {
          blockId: BLOCK,
          [kind]: {
            props: {},
            content: isTable
              ? { rows: [{ rowId: ROW, cells: [{ cellId: CELL, content }] }] }
              : content,
          },
        },
      ],
    },
  });
  const result = new Y.Doc();
  documents.add(result);
  hydrateCanonicalBlockRoom(result, "post", "en", document, []);
  return result;
}

function replayInline(
  before: JsonValue[],
  local: JsonValue[],
  peer: JsonValue[],
  kind = "paragraph",
): { content: JsonValue[]; replayAgain: () => JsonValue[] } {
  const base = room(before, kind);
  const beforeSnapshot = decodeCanonicalBlockRoom(base, "post");
  const target = {
    ...ref,
    path: kind === "table" ? "content.rows[0].cells[0].content" : "content",
  };
  reconcileBlockRoomInlineContent(base, target, before, local);
  const afterSnapshot = decodeCanonicalBlockRoom(base, "post");
  const current = room(peer, kind);
  const read = () =>
    fromYInlineContent(
      payloadValue(
        roomNode(current, target),
        target.path,
        "test",
      ) as Y.Array<unknown>,
    );
  const replay = () => {
    replayBlockRoomChanges(current, [
      { before: beforeSnapshot, after: afterSnapshot },
    ]);
    return read();
  };
  return { content: replay(), replayAgain: replay };
}

describe("canonical rich text recovery", () => {
  it("merges additions to a paragraph with omitted empty content", () => {
    expect(replayInline([], [text("LOCAL")], [text("PEER")]).content).toEqual([
      { text: { text: "PEERLOCAL" } },
    ]);
  });

  it("clears observed text without deleting later peer additions", () => {
    expect(
      replayInline([text("BASE")], [], [text("BASE PEER")]).content,
    ).toEqual([{ text: { text: " PEER" } }]);
  });
  it.each(["paragraph", "table"])(
    "preserves peer prefix and local suffix in the same %s content",
    (kind) => {
      const recovered = replayInline(
        [text("BASE")],
        [text("BASE LOCAL")],
        [text("PEER BASE")],
        kind,
      );
      expect(recovered.content).toEqual([
        { text: { text: "PEER BASE LOCAL" } },
      ]);
      expect(recovered.replayAgain()).toEqual(recovered.content);
    },
  );

  it("merges multiple disjoint edits within one paragraph", () => {
    expect(
      replayInline(
        [text("one two three")],
        [text("ONE two THREE")],
        [text("one TWO three")],
      ).content,
    ).toEqual([{ text: { text: "ONE TWO THREE" } }]);
  });

  it("merges independent style keys and peer link attributes", () => {
    const link = (
      styles: Record<string, boolean | string>,
      href = "https://example.com/before",
    ): JsonValue => ({ link: { href, content: [{ text: "ABC", styles }] } });
    expect(
      replayInline(
        [link({})],
        [link({ italic: true })],
        [link({ bold: true }, "https://example.com/peer")],
      ).content,
    ).toEqual([
      {
        link: {
          href: "https://example.com/peer",
          content: [{ text: "ABC", styles: { bold: true, italic: true } }],
        },
      },
    ]);
  });

  it("does not restore peer-deleted characters during local formatting", () => {
    expect(
      replayInline([text("ABC")], [text("ABC", { italic: true })], [text("BC")])
        .content,
    ).toEqual([{ text: { text: "BC", styles: { italic: true } } }]);
  });

  it("preserves peer edits around inline math and a hard break", () => {
    const before: JsonValue[] = [
      text("A"),
      { mathInline: { source: "x" } },
      { hardBreak: {} },
      text("B"),
    ];
    const local: JsonValue[] = [
      text("A"),
      { mathInline: { source: "y" } },
      { hardBreak: {} },
      text("B"),
    ];
    const peer: JsonValue[] = [
      text("PEER A"),
      { mathInline: { source: "x" } },
      { hardBreak: {} },
      text("B!"),
    ];
    expect(replayInline(before, local, peer).content).toEqual([
      { text: { text: "PEER A" } },
      { mathInline: { source: "y" } },
      { hardBreak: {} },
      { text: { text: "B!" } },
    ]);
  });

  it("preserves disjoint edits in collaborative code text", () => {
    const before = "const a = 1;\nconst b = 2;";
    const base = room(before, "codeBlock");
    const beforeSnapshot = decodeCanonicalBlockRoom(base, "post");
    replaceBlockRoomCollaborativeText(base, ref, before.replace("1", "3"));
    const afterSnapshot = decodeCanonicalBlockRoom(base, "post");
    const current = room(before.replace("2", "4"), "codeBlock");
    replayBlockRoomChanges(current, [
      { before: beforeSnapshot, after: afterSnapshot },
    ]);
    expect(
      (
        payloadValue(roomNode(current, ref), "content", "test") as Y.Text
      ).toString(),
    ).toBe("const a = 3;\nconst b = 4;");
  });

  it.each([
    { before: "", local: "LOCAL", peer: "PEER", expected: "PEERLOCAL" },
    { before: "BASE", local: "", peer: "BASE PEER", expected: " PEER" },
  ])(
    "merges code text with omitted protobuf defaults ($before → $local)",
    ({ before, local, peer, expected }) => {
      const base = room(before, "codeBlock");
      const beforeSnapshot = decodeCanonicalBlockRoom(base, "post");
      replaceBlockRoomCollaborativeText(base, ref, local);
      const afterSnapshot = decodeCanonicalBlockRoom(base, "post");
      const current = room(peer, "codeBlock");
      replayBlockRoomChanges(current, [
        { before: beforeSnapshot, after: afterSnapshot },
      ]);
      expect(
        (
          payloadValue(roomNode(current, ref), "content", "test") as Y.Text
        ).toString(),
      ).toBe(expected);
    },
  );

  it("does not restore observed code characters after the canonical text field was removed", () => {
    const current = room("", "codeBlock");
    (roomNode(current, ref).get("payload") as Y.Map<unknown>).delete("content");
    applyPayloadRootDiff(
      current,
      ref,
      { content: "BASE" },
      { content: "BASE LOCAL" },
    );
    expect(
      (
        payloadValue(roomNode(current, ref), "content", "test") as Y.Text
      ).toString(),
    ).toBe(" LOCAL");
  });

  it("initializes a missing inline array from local insertion intent", () => {
    const current = room([]);
    (roomNode(current, ref).get("payload") as Y.Map<unknown>).delete("content");
    applyPayloadRootDiff(current, ref, {}, { content: [text("LOCAL")] });
    expect(
      fromYInlineContent(
        payloadValue(
          roomNode(current, ref),
          "content",
          "test",
        ) as Y.Array<unknown>,
      ),
    ).toEqual([{ text: { text: "LOCAL" } }]);
  });

  it("clears omitted inline/text values without removing later peer insertions", () => {
    const inline = room([text("BASE PEER")]);
    applyPayloadRootDiff(inline, ref, { content: [text("BASE")] }, {});
    expect(
      fromYInlineContent(
        payloadValue(
          roomNode(inline, ref),
          "content",
          "test",
        ) as Y.Array<unknown>,
      ),
    ).toEqual([{ text: { text: " PEER" } }]);
    const code = room("BASE PEER", "codeBlock");
    applyPayloadRootDiff(code, ref, { content: "BASE" }, {});
    expect(
      (
        payloadValue(roomNode(code, ref), "content", "test") as Y.Text
      ).toString(),
    ).toBe(" PEER");
  });

  it("rejects a malformed canonical collaborative text before replacing it", () => {
    const current = room("BASE", "codeBlock");
    (roomNode(current, ref).get("payload") as Y.Map<unknown>).set(
      "content",
      123,
    );
    expect(() =>
      applyPayloadRootDiff(
        current,
        ref,
        { content: "BASE" },
        { content: "LOCAL" },
      ),
    ).toThrow(`replay:payload_shape:${BLOCK}:content`);
    expect(payloadValue(roomNode(current, ref), "content", "test")).toBe(123);
  });

  it("replays a style removal without removing an independent peer style", () => {
    expect(
      mergeInlineIntent(
        [text("A", { bold: true })],
        [text("A", { bold: false })],
        [text("A", { bold: true, italic: true })],
      ),
    ).toEqual([{ text: { text: "A", styles: { italic: true } } }]);
  });

  it("keeps both independent insertions at the same anchor", () => {
    expect(mergeTextIntent("AB", "AXB", "AYB")).toBe("AYXB");
  });

  it("does not duplicate an accepted insertion surrounded by peer additions", () => {
    expect(mergeTextIntent("AB", "AXB", "APXQB")).toBe("APXQB");
    expect(
      mergeInlineIntent(
        [text("AB")],
        [text("AXB", { italic: true })],
        [text("APXQB")],
      ),
    ).toEqual([
      { text: { text: "A", styles: { italic: true } } },
      { text: { text: "P" } },
      { text: { text: "X", styles: { italic: true } } },
      { text: { text: "Q" } },
      { text: { text: "B", styles: { italic: true } } },
    ]);
  });

  it("does not duplicate accepted insertion characters with interleaved peer edits", () => {
    expect(mergeTextIntent("AB", "AXYB", "AXQYB")).toBe("AXQYB");
    const recovered = replayInline(
      [text("AB")],
      [text("AXYB")],
      [text("AXQYB")],
    );
    expect(recovered.content).toEqual([{ text: { text: "AXQYB" } }]);
    expect(recovered.replayAgain()).toEqual(recovered.content);
    expect(mergeTextIntent("AB", "AXYB", "AXQB")).toBe("AXQYB");
  });

  it("keeps Unicode characters intact while merging edits", () => {
    expect(mergeTextIntent("가🎸나", "가🎸나!", "😀가🎸나")).toBe("😀가🎸나!");
  });

  it("does not duplicate identical inline atomic insertions", () => {
    const inserted: JsonValue[] = [
      { mathInline: { source: "x" } },
      { hardBreak: {} },
    ];
    expect(mergeInlineIntent([], inserted, inserted)).toEqual(inserted);
  });

  it("keeps empty links while replaying text beside them", () => {
    const link: JsonValue = {
      link: { href: "https://example.com/keep", content: [] },
    };
    expect(replayInline([link], [link, text("x")], [link]).content).toEqual([
      link,
      { text: { text: "x" } },
    ]);
    expect(mergeInlineIntent([], [link], [link])).toEqual([link]);
  });

  it("preserves adjacent links with identical hrefs", () => {
    const link = (
      value: string,
      styles: Record<string, boolean> = {},
    ): JsonValue => ({
      link: {
        href: "https://example.com/same",
        content: [{ text: value, styles }],
      },
    });
    const recovered = replayInline(
      [link("A"), link("B")],
      [link("A", { italic: true }), link("B")],
      [link("A"), link("B")],
    );
    expect(recovered.content).toEqual([
      {
        link: {
          href: "https://example.com/same",
          content: [{ text: "A", styles: { italic: true } }],
        },
      },
      { link: { href: "https://example.com/same", content: [{ text: "B" }] } },
    ]);
    expect(recovered.replayAgain()).toEqual(recovered.content);
  });

  it("retains independent peer edits across large local replacements", () => {
    const before = "a".repeat(1000) + "KEEP" + "z".repeat(1000);
    const local = "x".repeat(1000) + "KEEP" + "y".repeat(1000);
    expect(mergeTextIntent(before, local, before.replace("KEEP", "PEER"))).toBe(
      "x".repeat(1000) + "PEER" + "y".repeat(1000),
    );
  });

  it("replays large repetitive replacements without changing their intended order", () => {
    const before = "ab".repeat(1000);
    const local = "b".repeat(1000) + "a";
    expect(mergeTextIntent(before, local, before)).toBe(local);
    expect(mergeTextIntent(before, local, local)).toBe(local);
  });

  it("handles large insertions and whole replacements without exceeding argument limits", () => {
    const inserted = "x".repeat(150_000);
    expect(mergeTextIntent("A", inserted + "A", "A")).toBe(inserted + "A");
    expect(
      mergeTextIntent("A".repeat(1000), "B".repeat(1000), "A".repeat(1000)),
    ).toBe("B".repeat(1000));
  });

  it("preserves text/link boundaries and independent styles inside a link", () => {
    const before = [text("ABC")];
    const local: JsonValue[] = [
      text("A"),
      { link: { href: "https://example.com", content: [{ text: "B" }] } },
      text("C"),
    ];
    expect(
      mergeInlineIntent(before, local, [text("ABC", { bold: true })]),
    ).toEqual([
      { text: { text: "A", styles: { bold: true } } },
      {
        link: {
          href: "https://example.com",
          content: [{ text: "B", styles: { bold: true } }],
        },
      },
      { text: { text: "C", styles: { bold: true } } },
    ]);
  });
});
