import { fromJson, type JsonValue } from "@bufbuild/protobuf";
import { contentBlockCatalogFingerprint } from "@echovisionlab/geul-proto/content/block_catalog.ts";
import {
  LocalizedRichTextDocumentSchema,
  RichTextProfile,
  type LocalizedRichTextDocument,
} from "@echovisionlab/geul-proto/content/block_content_pb.ts";
import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import {
  hydrateCanonicalBlockRoom,
  replaceBlockRoomPayloadArray,
  setBlockRoomAtomicValue,
} from "../block-room-codec.ts";
import { BLOCK_ROOM_BASE_NODES, fromYValue } from "./internal.ts";
import { applyPayloadRootDiff } from "./replay-payload.ts";

const BLOCK = "4c438135-2381-47d3-b31c-cb56853a2801";
const CODE_BLOCK = "4c438135-2381-47d3-b31c-cb56853a2802";
const ref = { id: BLOCK, family: "rich_text" as const };

function room(): Y.Doc {
  const document = fromJson(LocalizedRichTextDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    profile: RichTextProfile.POST,
    locale: "ko",
    base: {
      nodes: [
        {
          block: {
            id: BLOCK,
            paragraph: {
              props: { backgroundColor: "#ffffff", textColor: "#111111" },
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
          blockId: BLOCK,
          paragraph: { props: {}, content: [{ text: { text: "기본 문장" } }] },
        },
      ],
    },
  }) as LocalizedRichTextDocument;
  const yDocument = new Y.Doc();
  hydrateCanonicalBlockRoom(yDocument, "post", "ko", document, []);
  return yDocument;
}

function payload(document: Y.Doc): Record<string, unknown> {
  const nodes = document
    .getMap<unknown>("block-document")
    .get(BLOCK_ROOM_BASE_NODES) as Y.Map<unknown>;
  const node = nodes.get(BLOCK) as Y.Map<unknown>;
  return fromYValue(node.get("payload")) as Record<string, unknown>;
}

function codeRoom(): Y.Doc {
  const document = fromJson(LocalizedRichTextDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    profile: RichTextProfile.POST,
    locale: "ko",
    base: {
      nodes: [
        {
          block: { id: CODE_BLOCK, codeBlock: { props: {} } },
          placement: { index: 0 },
        },
      ],
    },
    localeOverlay: {
      locale: "ko",
      blocks: [
        {
          blockId: CODE_BLOCK,
          codeBlock: { props: {}, content: "old code" },
        },
      ],
    },
  }) as LocalizedRichTextDocument;
  const yDocument = new Y.Doc();
  hydrateCanonicalBlockRoom(yDocument, "post", "ko", document, []);
  return yDocument;
}

function apply(document: Y.Doc, before: JsonValue, after: JsonValue): void {
  applyPayloadRootDiff(document, ref, before, after);
}

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length < 2) return [[...values]];
  return values.flatMap((value, index) =>
    permutations(values.filter((_, candidate) => candidate !== index)).map(
      (rest) => [value, ...rest],
    ),
  );
}

describe("applyPayloadRootDiff edge cases", () => {
  it("applies changed nested leaves and deletion while preserving a disjoint peer leaf", () => {
    const document = room();
    setBlockRoomAtomicValue(
      document,
      { ...ref, path: "props.textColor" },
      "#222222",
    );

    apply(
      document,
      {
        props: {
          backgroundColor: "#ffffff",
          textColor: "#111111",
          obsolete: "remove me",
        },
      },
      { props: { backgroundColor: "#000000", textColor: "#111111" } },
    );

    expect(payload(document)).toMatchObject({
      props: { backgroundColor: "#000000", textColor: "#222222" },
    });
    expect((payload(document).props as Record<string, unknown>).obsolete).toBe(
      undefined,
    );
  });

  it("deletes an existing payload key and treats a missing deleted key as a no-op", () => {
    const document = room();
    const nodes = document
      .getMap<unknown>("block-document")
      .get(BLOCK_ROOM_BASE_NODES) as Y.Map<unknown>;
    const node = nodes.get(BLOCK) as Y.Map<unknown>;
    const basePayload = node.get("payload") as Y.Map<unknown>;
    const props = basePayload.get("props") as Y.Map<unknown>;
    props.set("obsolete", "remove me");

    apply(
      document,
      { props: { backgroundColor: "#ffffff", obsolete: "remove me" } },
      { props: { backgroundColor: "#ffffff" } },
    );
    expect(props.has("obsolete")).toBe(false);

    apply(document, { props: { absent: "already gone" } }, { props: {} });
    expect(props.has("absent")).toBe(false);
  });

  it("creates a missing object path and treats arrays without stable IDs as atomic values", () => {
    const document = room();
    const rowsRef = { ...ref, path: "props.rows" };
    replaceBlockRoomPayloadArray(document, rowsRef, [{ label: "peer" }]);

    apply(
      document,
      { props: { rows: [{ label: "before" }] } },
      { props: { created: { enabled: true }, rows: [{ label: "local" }] } },
    );

    expect(payload(document)).toMatchObject({
      props: { created: { enabled: true }, rows: [{ label: "local" }] },
    });
  });

  it("rejects a null current payload when the local snapshot expects an object", () => {
    const document = room();
    setBlockRoomAtomicValue(document, { ...ref, path: "props.details" }, null);

    expect(() =>
      apply(
        document,
        { props: { details: { enabled: false } } },
        { props: { details: { enabled: true } } },
      ),
    ).toThrow(`replay:payload_shape:${BLOCK}:props.details`);
  });

  it("rejects a current scalar where the local snapshot changes that path as an object", () => {
    const document = room();
    setBlockRoomAtomicValue(
      document,
      { ...ref, path: "props.nested" },
      "peer scalar",
    );
    expect(() =>
      apply(
        document,
        { props: { nested: { value: "before" } } },
        { props: { nested: { value: "after" } } },
      ),
    ).toThrow(`replay:payload_shape:${BLOCK}:props.nested`);
  });

  it("keeps stable-array peer additions and does not resurrect a peer-deleted item", () => {
    const document = room();
    const rowsRef = { ...ref, path: "props.rows" };
    replaceBlockRoomPayloadArray(document, rowsRef, [
      { id: "b", value: "peer b" },
      { id: "peer", value: "peer addition" },
    ]);

    apply(
      document,
      {
        props: {
          rows: [
            { id: "a", value: "old a" },
            { id: "b", value: "old b" },
          ],
        },
      },
      {
        props: {
          rows: [
            { id: "a", value: "local a" },
            { id: "b", value: "local b" },
            { id: "local", value: "local addition" },
          ],
        },
      },
    );

    expect((payload(document).props as { rows: unknown[] }).rows).toEqual([
      { id: "b", value: "local b" },
      { id: "peer", value: "peer addition" },
      { id: "local", value: "local addition" },
    ]);
  });

  it("does not duplicate an already-present local addition or resurrect an explicitly removed peer deletion", () => {
    const alreadyAdded = room();
    replaceBlockRoomPayloadArray(alreadyAdded, { ...ref, path: "props.rows" }, [
      { id: "same", value: "peer value" },
    ]);
    apply(
      alreadyAdded,
      { props: { rows: [] } },
      { props: { rows: [{ id: "same", value: "local value" }] } },
    );
    expect((payload(alreadyAdded).props as { rows: unknown[] }).rows).toEqual([
      { id: "same", value: "peer value" },
    ]);

    const alreadyDeleted = room();
    replaceBlockRoomPayloadArray(
      alreadyDeleted,
      { ...ref, path: "props.rows" },
      [],
    );
    apply(
      alreadyDeleted,
      { props: { rows: [{ id: "deleted", value: "before" }] } },
      { props: { rows: [] } },
    );
    expect((payload(alreadyDeleted).props as { rows: unknown[] }).rows).toEqual(
      [],
    );
  });

  it("does not restore an item deleted by a peer during a local reorder", () => {
    const document = room();
    const rowsRef = { ...ref, path: "props.rows" };
    const beforeRows = [
      { id: "a", value: "a" },
      { id: "b", value: "b" },
      { id: "c", value: "c" },
    ];
    replaceBlockRoomPayloadArray(document, rowsRef, [
      beforeRows[0]!,
      beforeRows[2]!,
    ]);
    apply(
      document,
      { props: { rows: beforeRows } },
      { props: { rows: [beforeRows[1]!, beforeRows[0]!, beforeRows[2]!] } },
    );
    expect((payload(document).props as { rows: unknown[] }).rows).toEqual([
      beforeRows[0],
      beforeRows[2],
    ]);
  });

  it("inserts before an existing identity and reorders common items around peer-preserved rows", () => {
    const insertion = room();
    const rowsRef = { ...ref, path: "props.rows" };
    replaceBlockRoomPayloadArray(insertion, rowsRef, [
      { id: "a", value: "a" },
      { id: "b", value: "b" },
      { id: "c", value: "c" },
    ]);
    apply(
      insertion,
      {
        props: {
          rows: [
            { id: "a", value: "a" },
            { id: "b", value: "b" },
            { id: "c", value: "c" },
          ],
        },
      },
      {
        props: {
          rows: [
            { id: "local", value: "local" },
            { id: "a", value: "a" },
            { id: "b", value: "b" },
            { id: "c", value: "c" },
          ],
        },
      },
    );
    expect((payload(insertion).props as { rows: unknown[] }).rows).toEqual([
      { id: "local", value: "local" },
      { id: "a", value: "a" },
      { id: "b", value: "b" },
      { id: "c", value: "c" },
    ]);

    const reorderLater = room();
    replaceBlockRoomPayloadArray(reorderLater, rowsRef, [
      { id: "a", value: "a" },
      { id: "b", value: "b" },
      { id: "c", value: "c" },
    ]);
    apply(
      reorderLater,
      {
        props: {
          rows: [
            { id: "a", value: "a" },
            { id: "b", value: "b" },
            { id: "c", value: "c" },
          ],
        },
      },
      {
        props: {
          rows: [
            { id: "b", value: "b" },
            { id: "c", value: "c" },
            { id: "a", value: "a" },
          ],
        },
      },
    );
    expect((payload(reorderLater).props as { rows: unknown[] }).rows).toEqual([
      { id: "b", value: "b" },
      { id: "c", value: "c" },
      { id: "a", value: "a" },
    ]);

    const reorderEarlier = room();
    replaceBlockRoomPayloadArray(reorderEarlier, rowsRef, [
      { id: "a", value: "a" },
      { id: "b", value: "b" },
      { id: "c", value: "c" },
    ]);
    apply(
      reorderEarlier,
      {
        props: {
          rows: [
            { id: "a", value: "a" },
            { id: "b", value: "b" },
            { id: "c", value: "c" },
          ],
        },
      },
      {
        props: {
          rows: [
            { id: "b", value: "b" },
            { id: "a", value: "a" },
            { id: "c", value: "c" },
          ],
        },
      },
    );
    expect((payload(reorderEarlier).props as { rows: unknown[] }).rows).toEqual(
      [
        { id: "b", value: "b" },
        { id: "a", value: "a" },
        { id: "c", value: "c" },
      ],
    );
  });

  it("replays a multi-item array reorder in the intended final order", () => {
    const document = room();
    const rowsRef = { ...ref, path: "props.rows" };
    const rows = ["a", "b", "c", "d"].map((id) => ({ id, value: id }));
    replaceBlockRoomPayloadArray(document, rowsRef, rows);
    apply(
      document,
      { props: { rows } },
      { props: { rows: [...rows].reverse() } },
    );

    expect(
      (payload(document).props as { rows: Array<{ id: string }> }).rows.map(
        ({ id }) => id,
      ),
    ).toEqual(["d", "c", "b", "a"]);
  });

  it("replays every four-item reorder without changing its final identity order", () => {
    const rows = ["a", "b", "c", "d"].map((id) => ({ id, value: id }));
    const rowsRef = { ...ref, path: "props.rows" };

    for (const desiredIds of permutations(rows.map(({ id }) => id))) {
      const document = room();
      replaceBlockRoomPayloadArray(document, rowsRef, rows);
      apply(
        document,
        { props: { rows } },
        {
          props: {
            rows: desiredIds.map((id) => rows.find((row) => row.id === id)!),
          },
        },
      );
      expect(
        (payload(document).props as { rows: Array<{ id: string }> }).rows.map(
          ({ id }) => id,
        ),
      ).toEqual(desiredIds);
    }
  });

  it.each([
    {
      label: "preserves a peer addition",
      current: ["a", "b", "peer", "c", "d"],
      expected: ["d", "c", "b", "a"],
    },
    {
      label: "does not resurrect a peer deletion",
      current: ["a", "c", "d"],
      expected: ["d", "c", "a"],
    },
  ])("keeps stable-array order correct and $label", ({ current, expected }) => {
    const document = room();
    const rowsRef = { ...ref, path: "props.rows" };
    const rows = ["a", "b", "c", "d"].map((id) => ({ id, value: id }));
    replaceBlockRoomPayloadArray(
      document,
      rowsRef,
      current.map((id) => ({ id, value: id === "peer" ? "peer value" : id })),
    );

    apply(
      document,
      { props: { rows } },
      { props: { rows: [...rows].reverse() } },
    );

    const actual = (
      payload(document).props as { rows: Array<{ id: string }> }
    ).rows.map(({ id }) => id);
    expect(actual.filter((id) => id !== "peer")).toEqual(expected);
    if (current.includes("peer")) expect(actual).toContain("peer");
  });

  it.each(["id", "rowId", "cellId", "unitId"] as const)(
    "uses stable %s identity for an explicit array edit",
    (identityField) => {
      const document = room();
      const rowsRef = { ...ref, path: "props.rows" };
      const item = (id: string, value: string) => ({
        [identityField]: id,
        value,
      });
      replaceBlockRoomPayloadArray(document, rowsRef, [item("a", "old")]);

      apply(
        document,
        { props: { rows: [item("a", "old")] } },
        { props: { rows: [item("a", "new"), item("b", "added")] } },
      );

      expect((payload(document).props as { rows: unknown[] }).rows).toEqual([
        item("a", "new"),
        item("b", "added"),
      ]);
    },
  );

  it("initializes a missing stable array and deletes explicitly removed items", () => {
    const document = room();
    apply(
      document,
      { props: { rows: [] } },
      { props: { rows: [{ id: "new", value: "added" }] } },
    );
    expect((payload(document).props as { rows: unknown[] }).rows).toEqual([
      { id: "new", value: "added" },
    ]);

    apply(
      document,
      { props: { rows: [{ id: "new", value: "added" }] } },
      { props: { rows: [] } },
    );
    expect((payload(document).props as { rows: unknown[] }).rows).toEqual([]);
  });

  it("falls back to an explicit replacement when snapshot identities are malformed or inconsistent", () => {
    const duplicateDocument = room();
    apply(
      duplicateDocument,
      { props: { rows: [{ id: "same" }, { id: "same" }] } },
      { props: { rows: [{ id: "next" }] } },
    );
    expect(
      (payload(duplicateDocument).props as { rows: unknown[] }).rows,
    ).toEqual([{ id: "next" }]);

    const inconsistentDocument = room();
    apply(
      inconsistentDocument,
      { props: { rows: [{ id: "a" }] } },
      { props: { rows: [{ rowId: "a" }] } },
    );
    expect(
      (payload(inconsistentDocument).props as { rows: unknown[] }).rows,
    ).toEqual([{ rowId: "a" }]);
  });

  it("rejects malformed or duplicate current identities and a current array shape mismatch", () => {
    const invalidItems = [
      [{ value: "missing identity" }],
      [{ id: "duplicate" }, { id: "duplicate" }],
    ];
    for (const items of invalidItems) {
      const document = room();
      replaceBlockRoomPayloadArray(
        document,
        { ...ref, path: "props.rows" },
        items,
      );
      expect(() =>
        apply(
          document,
          { props: { rows: [{ id: "a" }] } },
          { props: { rows: [{ id: "a", value: "local" }] } },
        ),
      ).toThrow("replay:stable_array_");
    }

    const wrongShape = room();
    setBlockRoomAtomicValue(
      wrongShape,
      { ...ref, path: "props.rows" },
      "not an array",
    );
    expect(() =>
      apply(
        wrongShape,
        { props: { rows: [{ id: "a" }] } },
        { props: { rows: [{ id: "a", value: "local" }] } },
      ),
    ).toThrow("replay:stable_array_shape");
  });

  it("applies rich text through the collaborative-text replacement path", () => {
    const document = codeRoom();
    const ref = {
      id: CODE_BLOCK,
      family: "rich_text" as const,
      locale: true as const,
    };
    applyPayloadRootDiff(
      document,
      ref,
      { content: "old code" },
      { content: "new code" },
    );
    const locale = document
      .getMap<unknown>("block-document")
      .get("localeOverlay") as Y.Map<unknown>;
    const localeNode = locale.get(CODE_BLOCK) as Y.Map<unknown>;
    expect(fromYValue(localeNode.get("payload"))).toMatchObject({
      content: "new code",
    });
  });

  it("rejects a changed object whose path cannot be represented by the room path grammar", () => {
    const document = room();
    expect(() =>
      apply(
        document,
        { props: {} },
        { props: { "invalid-key": { nested: true } } },
      ),
    ).toThrow("payload_path:invalid");
  });

  it("rejects non-object payload roots before mutating the room", () => {
    const document = room();
    expect(() =>
      applyPayloadRootDiff(document, ref, [], { props: { textColor: "#000" } }),
    ).toThrow(`replay:payload_root:${BLOCK}`);
  });
});
