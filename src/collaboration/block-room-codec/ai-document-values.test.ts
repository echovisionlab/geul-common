import { create } from "@bufbuild/protobuf";
import {
  AIDocumentFieldPathSegmentSchema,
  AIDocumentRelationItemReferenceSchema,
  AIDocumentFieldTargetSchema,
  AIDocumentHardBreakSchema,
  AIDocumentInlineContentSchema,
  AIDocumentInlineItemSchema,
  AIDocumentInlineLinkSchema,
  AIDocumentInlineMarkSchema,
  AIDocumentListItemSchema,
  AIDocumentListValueSchema,
  AIDocumentFieldValueSchema,
  AIDocumentObjectValueSchema,
  AIDocumentValueSchema,
  type AIDocumentFieldPathSegment,
  type AIDocumentInlineItem,
  type AIDocumentValue,
} from "@echovisionlab/geul-proto/secure/ai_pb.ts";
import { describe, expect, it } from "vitest";
import {
  blockTarget,
  plainValue,
  requiredHandle,
  resolvedCatalogField,
  resolvedPath,
  yPath,
  type CatalogField,
} from "./ai-document-values.ts";

function value(typed: AIDocumentValue["value"]): AIDocumentValue {
  return create(AIDocumentValueSchema, { value: typed });
}

function item(typed: AIDocumentInlineItem["item"]): AIDocumentInlineItem {
  return create(AIDocumentInlineItemSchema, { item: typed });
}

function field(name: string): AIDocumentFieldPathSegment {
  return create(AIDocumentFieldPathSegmentSchema, {
    selector: { case: "fieldHandle", value: name },
  });
}

function listItem(name: string): AIDocumentFieldPathSegment {
  return create(AIDocumentFieldPathSegmentSchema, {
    selector: { case: "itemHandle", value: name },
  });
}

describe("AI document canonical values", () => {
  it("validates handles and block-owned field targets", () => {
    expect(requiredHandle("block", "missing")).toBe("block");
    expect(() => requiredHandle("", "missing")).toThrow(
      "block_room_invalid:ai_operation:missing",
    );
    expect(() => blockTarget(undefined)).toThrow("field_target:missing");
    expect(() =>
      blockTarget(
        create(AIDocumentFieldTargetSchema, {
          owner: {
            case: "relationItem",
            value: create(AIDocumentRelationItemReferenceSchema, {
              blockHandle: "block",
              relationHandle: "relation",
              itemHandle: "item",
            }),
          },
          fieldHandle: "title",
        }),
      ),
    ).toThrow("field_target:relation_item");
    expect(() =>
      blockTarget(
        create(AIDocumentFieldTargetSchema, {
          owner: { case: "blockHandle", value: "" },
          fieldHandle: "title",
        }),
      ),
    ).toThrow("field_target:block");
    expect(() =>
      blockTarget(
        create(AIDocumentFieldTargetSchema, {
          owner: { case: "blockHandle", value: "block" },
        }),
      ),
    ).toThrow("field_target:field");
    expect(
      blockTarget(
        create(AIDocumentFieldTargetSchema, {
          owner: { case: "blockHandle", value: "block" },
          fieldHandle: "title",
          path: [field("child")],
        }),
      ),
    ).toMatchObject({ blockId: "block", field: "title" });
  });

  it("converts every scalar, recursive, enum, and inline value without lossy JSON guessing", () => {
    expect(plainValue(value({ case: "text", value: "text" }))).toBe("text");
    expect(plainValue(value({ case: "boolean", value: true }))).toBe(true);
    expect(plainValue(value({ case: "number", value: "2.5" }))).toBe(2.5);
    expect(
      plainValue(
        value({ case: "text", value: "16:9" }),
        {
          type: "enum",
          values: ["16:9"],
        },
        "aspectRatio",
      ),
    ).toBe("ASPECT_RATIO_X_16_9");
    expect(
      plainValue(
        value({ case: "text", value: "2" }),
        {
          type: "enum_int",
          values: [2],
        },
        "level",
        true,
      ),
    ).toBe("LEVEL_ITEM_2");
    expect(() =>
      plainValue(
        value({ case: "text", value: "bad" }),
        {
          type: "enum",
          values: ["good"],
        },
        "mode",
      ),
    ).toThrow("value:enum:mode");

    const inline = create(AIDocumentInlineContentSchema, {
      items: [
        item({ case: "text", value: "plain" }),
        item({
          case: "mark",
          value: create(AIDocumentInlineMarkSchema, {
            mark: "bold",
            children: [item({ case: "text", value: "bold" })],
          }),
        }),
        item({
          case: "mark",
          value: create(AIDocumentInlineMarkSchema, {
            mark: "textColor",
            parameter: value({ case: "text", value: "red" }),
            children: [item({ case: "text", value: "red" })],
          }),
        }),
        item({
          case: "mark",
          value: create(AIDocumentInlineMarkSchema, {
            mark: "backgroundColor",
            parameter: value({ case: "text", value: "blue" }),
            children: [item({ case: "text", value: "blue" })],
          }),
        }),
        item({
          case: "link",
          value: create(AIDocumentInlineLinkSchema, {
            target: "https://example.com",
            children: [item({ case: "text", value: "link" })],
          }),
        }),
        item({
          case: "hardBreak",
          value: create(AIDocumentHardBreakSchema),
        }),
        item({ case: "math", value: "x+y" }),
      ],
    });
    expect(plainValue(value({ case: "inline", value: inline }))).toEqual([
      { text: { text: "plain" } },
      { text: { text: "bold", styles: { bold: true } } },
      { text: { text: "red", styles: { textColor: "red" } } },
      { text: { text: "blue", styles: { backgroundColor: "blue" } } },
      { link: { href: "https://example.com", content: [{ text: "link" }] } },
      { hardBreak: {} },
      { mathInline: { source: "x+y" } },
    ]);

    expect(
      plainValue(
        value({
          case: "list",
          value: create(AIDocumentListValueSchema, {
            items: [
              create(AIDocumentListItemSchema, {
                itemHandle: "one",
                value: value({ case: "boolean", value: false }),
              }),
            ],
          }),
        }),
      ),
    ).toEqual([false]);
    expect(
      plainValue(
        value({
          case: "object",
          value: create(AIDocumentObjectValueSchema, {
            fields: [
              create(AIDocumentFieldValueSchema, {
                fieldHandle: "count",
                value: value({ case: "number", value: "3" }),
              }),
            ],
          }),
        }),
      ),
    ).toEqual({ count: 3 });
  });

  it("rejects every malformed value arm and invalid inline nesting", () => {
    for (const number of ["", " 1", "Infinity"]) {
      expect(() =>
        plainValue(value({ case: "number", value: number })),
      ).toThrow("value:number");
    }
    expect(() => plainValue(undefined)).toThrow("value:missing");
    expect(() => plainValue(create(AIDocumentValueSchema))).toThrow(
      "value:missing",
    );
    const invalidInline = (child: AIDocumentInlineItem) =>
      plainValue(
        value({
          case: "inline",
          value: create(AIDocumentInlineContentSchema, { items: [child] }),
        }),
      );
    expect(() =>
      invalidInline(
        item({
          case: "mark",
          value: create(AIDocumentInlineMarkSchema, {
            mark: "bold",
            parameter: value({ case: "text", value: "bad" }),
          }),
        }),
      ),
    ).toThrow("inline:bold:parameter");
    expect(() =>
      invalidInline(
        item({
          case: "mark",
          value: create(AIDocumentInlineMarkSchema, { mark: "textColor" }),
        }),
      ),
    ).toThrow("inline:textColor:parameter");
    expect(() =>
      invalidInline(
        item({
          case: "mark",
          value: create(AIDocumentInlineMarkSchema, { mark: "unknown" }),
        }),
      ),
    ).toThrow("inline:mark:unknown");
    expect(() =>
      invalidInline(
        item({
          case: "mark",
          value: create(AIDocumentInlineMarkSchema),
        }),
      ),
    ).toThrow("inline:mark:missing");
    expect(() =>
      invalidInline(
        item({
          case: "link",
          value: create(AIDocumentInlineLinkSchema, {
            target: "outer",
            children: [
              item({
                case: "link",
                value: create(AIDocumentInlineLinkSchema, { target: "inner" }),
              }),
            ],
          }),
        }),
      ),
    ).toThrow("inline:nested_link");
    expect(() =>
      invalidInline(
        item({
          case: "link",
          value: create(AIDocumentInlineLinkSchema, {
            target: "outer",
            children: [
              item({
                case: "hardBreak",
                value: create(AIDocumentHardBreakSchema),
              }),
            ],
          }),
        }),
      ),
    ).toThrow("inline:marked_hard_break");
    expect(() =>
      invalidInline(
        item({
          case: "link",
          value: create(AIDocumentInlineLinkSchema, {
            children: [item({ case: "text", value: "missing target" })],
          }),
        }),
      ),
    ).toThrow("inline:link_target");
    for (const mark of ["italic", "underline", "strike", "code"]) {
      expect(() =>
        invalidInline(
          item({
            case: "mark",
            value: create(AIDocumentInlineMarkSchema, {
              mark,
              parameter: value({ case: "text", value: "bad" }),
            }),
          }),
        ),
      ).toThrow(`inline:${mark}:parameter`);
    }
    expect(() =>
      invalidInline(
        item({
          case: "mark",
          value: create(AIDocumentInlineMarkSchema, {
            mark: "bold",
            children: [
              item({
                case: "hardBreak",
                value: create(AIDocumentHardBreakSchema),
              }),
            ],
          }),
        }),
      ),
    ).toThrow("inline:marked_hard_break");
    expect(() =>
      invalidInline(
        item({
          case: "mark",
          value: create(AIDocumentInlineMarkSchema, {
            mark: "bold",
            children: [item({ case: "math", value: "x" })],
          }),
        }),
      ),
    ).toThrow("inline:marked_math");
    expect(() =>
      invalidInline(item({ case: "placeholderHandle", value: "x" })),
    ).toThrow("inline:placeholder");
    expect(() => invalidInline(create(AIDocumentInlineItemSchema))).toThrow(
      "inline:missing",
    );
    const duplicate = value({
      case: "object",
      value: create(AIDocumentObjectValueSchema, {
        fields: [
          create(AIDocumentFieldValueSchema, {
            fieldHandle: "same",
            value: value({ case: "text", value: "one" }),
          }),
          create(AIDocumentFieldValueSchema, {
            fieldHandle: "same",
            value: value({ case: "text", value: "two" }),
          }),
        ],
      }),
    });
    expect(() => plainValue(duplicate)).toThrow("value:duplicate_field:same");
    expect(() =>
      plainValue(
        value({
          case: "object",
          value: create(AIDocumentObjectValueSchema, {
            fields: [create(AIDocumentFieldValueSchema)],
          }),
        }),
      ),
    ).toThrow("value:object_field");
  });

  it("resolves fixed, value, and field list identities and typed paths", () => {
    const objectItem: CatalogField = {
      type: "object",
      fields: {
        kind: { type: "enum", values: ["bufferA"] },
        value: { type: "text" },
      },
    };
    const byField: CatalogField = {
      type: "list",
      items: objectItem,
      item_identity: { strategy: "field", field: "kind" },
    };
    const root = {
      props: { stages: [{ kind: "KIND_BUFFER_A", value: "old" }] },
    };
    expect(
      resolvedPath(
        root,
        ["props", "stages"],
        [listItem("bufferA"), field("value")],
        false,
        byField,
        "stages",
      ),
    ).toEqual(["props", "stages", 0, "value"]);
    expect(
      resolvedCatalogField(byField, [listItem("bufferA"), field("value")]),
    ).toEqual({ type: "text" });

    const fixed: CatalogField = {
      type: "list",
      items: { type: "text" },
      item_identity: { strategy: "fixed", values: ["a", "b"] },
    };
    expect(
      resolvedPath(
        { values: ["x", "y"] },
        ["values"],
        [listItem("b")],
        false,
        fixed,
      ),
    ).toEqual(["values", 1]);
    const byValue: CatalogField = {
      type: "list",
      items: { type: "number" },
      item_identity: { strategy: "value" },
    };
    expect(
      resolvedPath(
        { values: [1, 2] },
        ["values"],
        [listItem("2")],
        false,
        byValue,
      ),
    ).toEqual(["values", 1]);
    const byRawValue: CatalogField = {
      type: "list",
      items: { type: "text" },
      item_identity: { strategy: "value" },
    };
    expect(
      resolvedPath(
        { values: ["a"] },
        ["values"],
        [listItem("a")],
        false,
        byRawValue,
      ),
    ).toEqual(["values", 0]);
    expect(
      resolvedPath({ props: {} }, ["props"], [field("new")], true, {
        type: "object",
        fields: { new: { type: "text" } },
      }),
    ).toEqual(["props", "new"]);
    expect(resolvedPath([["x"]], [0, 0], [], false)).toEqual([0, 0]);
    expect(yPath(["props", "stages", 0, "kind"])).toBe("props.stages[0].kind");
  });

  it("fails closed for malformed paths and descriptor identities", () => {
    const missingIdentity = {
      type: "list",
      items: { type: "text" },
    } satisfies CatalogField;
    const invalidSelector = create(AIDocumentFieldPathSegmentSchema);
    const cases: Array<() => unknown> = [
      () => resolvedPath({}, ["missing", "child"], [], false),
      () => resolvedPath({}, [0], [], false),
      () =>
        resolvedPath(
          { value: "not-array" },
          ["value"],
          [listItem("x")],
          false,
          missingIdentity,
        ),
      () =>
        resolvedPath(
          { value: [] },
          ["value"],
          [listItem("x")],
          false,
          missingIdentity,
        ),
      () =>
        resolvedPath(
          { value: [] },
          ["value"],
          [
            create(AIDocumentFieldPathSegmentSchema, {
              selector: { case: "itemHandle", value: "" },
            }),
          ],
          false,
          missingIdentity,
        ),
      () => resolvedPath({}, [], [invalidSelector], false),
      () => resolvedCatalogField({ type: "object" }, [field("x")]),
      () => resolvedCatalogField({ type: "list" }, [listItem("x")]),
      () => resolvedCatalogField({ type: "object" }, [invalidSelector]),
      () => yPath([]),
    ];
    for (const run of cases)
      expect(run).toThrow("block_room_invalid:ai_operation:");
    expect(resolvedCatalogField(undefined, [field("x")])).toBeUndefined();

    const invalidFixed: CatalogField = {
      type: "list",
      items: { type: "text" },
      item_identity: { strategy: "fixed", values: ["a"] },
    };
    expect(() =>
      resolvedPath(
        { value: [] },
        ["value"],
        [listItem("a")],
        false,
        invalidFixed,
      ),
    ).toThrow("field_path:item:a");
    const fixedWithoutValues: CatalogField = {
      type: "list",
      items: { type: "text" },
      item_identity: { strategy: "fixed" },
    };
    expect(() =>
      resolvedPath(
        { value: ["a"] },
        ["value"],
        [listItem("a")],
        false,
        fixedWithoutValues,
      ),
    ).toThrow("field_path:item:a");
    const invalidEnum: CatalogField = {
      type: "list",
      items: { type: "enum", values: ["a"] },
      item_identity: { strategy: "value" },
    };
    expect(() =>
      resolvedPath(
        { value: [] },
        ["value"],
        [listItem("b")],
        false,
        invalidEnum,
      ),
    ).toThrow("field_path:item:b");
    const missingValue: CatalogField = {
      type: "list",
      items: { type: "text" },
      item_identity: { strategy: "value" },
    };
    expect(() =>
      resolvedPath(
        { value: ["a"] },
        ["value"],
        [listItem("b")],
        false,
        missingValue,
      ),
    ).toThrow("field_path:item:b");
    const missingFieldIdentity: CatalogField = {
      type: "list",
      items: { type: "object", fields: {} },
      item_identity: { strategy: "field" },
    };
    expect(() =>
      resolvedPath(
        { value: [] },
        ["value"],
        [listItem("x")],
        false,
        missingFieldIdentity,
      ),
    ).toThrow("item_identity_field");
    const missingFieldDescriptor: CatalogField = {
      type: "list",
      items: { type: "object", fields: {} },
      item_identity: { strategy: "field", field: "kind" },
    };
    expect(() =>
      resolvedPath(
        { value: [] },
        ["value"],
        [listItem("x")],
        false,
        missingFieldDescriptor,
      ),
    ).toThrow("item_identity_descriptor");
    const noMatch: CatalogField = {
      type: "list",
      items: { type: "object", fields: { kind: { type: "text" } } },
      item_identity: { strategy: "field", field: "kind" },
    };
    expect(() =>
      resolvedPath(
        { value: [null, [], {}] },
        ["value"],
        [listItem("x")],
        false,
        noMatch,
      ),
    ).toThrow("field_path:item:x");
  });
});
