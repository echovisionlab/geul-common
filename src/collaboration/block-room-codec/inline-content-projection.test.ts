import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  fromYInlineContent,
  fromYRichTextBlockPayload,
  projectedStyledTextRuns,
} from "./inline-content-projection.ts";

const documents: Y.Doc[] = [];
afterEach(() => documents.splice(0).forEach((document) => document.destroy()));
function attached<T extends Y.Map<unknown> | Y.Array<unknown>>(value: T): T {
  const document = new Y.Doc();
  documents.push(document);
  document.getMap("fixture").set("value", value);
  return value;
}
function map(entries: Record<string, unknown>): Y.Map<unknown> {
  return new Y.Map(Object.entries(entries));
}
function array(values: unknown[]): Y.Array<unknown> {
  const value = new Y.Array<unknown>();
  value.insert(0, values);
  return value;
}
function inline(item: unknown) {
  return fromYInlineContent(attached(array([item])));
}
function table(rows: unknown) {
  return fromYRichTextBlockPayload(
    "rich_text",
    "table",
    attached(map({ content: map({ rows }) })),
  );
}

describe("inline storage projection validation", () => {
  it.each([null, 1, "content", {}])(
    "rejects noncollaborative inline arrays: %s",
    (value) => {
      expect(() => fromYInlineContent(value)).toThrow("inline_content:array");
    },
  );
  it.each([
    null,
    7,
    map({}),
    map({ text: map({ text: "a" }), hardBreak: map({}) }),
  ])("rejects invalid inline oneof storage", (value) => {
    expect(() => inline(value)).toThrow("inline_content:0");
  });
  it.each([null, 7, [], map({ text: 3 }), map({ text: new Y.Array() })])(
    "rejects malformed styled text",
    (value) => {
      expect(() =>
        projectedStyledTextRuns(attached(map({ text: value }))),
      ).toThrow();
    },
  );
  it("rejects malformed nested text and embedded objects", () => {
    expect(() =>
      projectedStyledTextRuns(attached(map({ styles: null }))),
    ).toThrow("styles");
    expect(() =>
      projectedStyledTextRuns(attached(map({ text: map({ text: 4 }) }))),
    ).toThrow("text");
    const text = new Y.Text();
    const styled = attached(map({ text }));
    text.insertEmbed(0, { image: "not-a-text-run" });
    expect(() => projectedStyledTextRuns(styled)).toThrow("embed");
  });
  it("projects missing and empty text with legacy styles", () => {
    expect(
      projectedStyledTextRuns(attached(map({ text: new Y.Text() }))),
    ).toEqual([{ text: "" }]);
    expect(
      projectedStyledTextRuns(
        attached(map({ styles: { bold: true, unknown: 2 } })),
      ),
    ).toEqual([{ text: "", styles: { bold: true } }]);
    expect(
      projectedStyledTextRuns(
        attached(map({ text: new Y.Text(), styles: map({ italic: true }) })),
      ),
    ).toEqual([{ text: "", styles: { italic: true } }]);
    expect(
      projectedStyledTextRuns(
        attached(map({ text: "old", styles: map({ bold: true }) })),
      ),
    ).toEqual([{ text: "old", styles: { bold: true } }]);
  });
  it("decodes nested legacy text and masks fallback with explicit default attributes", () => {
    const text = new Y.Text("legacy");
    const styled = attached(
      map({
        text: map({ text, styles: map({ bold: true, textColor: "red" }) }),
      }),
    );
    text.format(0, text.length, { bold: false, textColor: "", italic: true });
    expect(projectedStyledTextRuns(styled)).toEqual([
      { text: "legacy", styles: { italic: true } },
    ]);
    expect(
      projectedStyledTextRuns(
        attached(
          map({ text: map({ text: "fallback" }), styles: { underline: true } }),
        ),
      ),
    ).toEqual([{ text: "fallback", styles: { underline: true } }]);
  });
  it.each([
    map({ link: null }),
    map({ link: map({ href: "/", content: "bad" }) }),
    map({ link: map({ href: 1 }) }),
    map({ link: map({ href: "/", content: array([1]) }) }),
  ])("rejects malformed link storage", (value) => {
    expect(() => inline(value)).toThrow("inline_content:0");
  });
  it("projects an empty link and coalesces adjacent equal-style link runs", () => {
    expect(inline(map({ link: map({ href: "/" }) }))).toEqual([
      { link: { href: "/", content: [] } },
    ]);
    expect(inline(map({ link: { href: "/", content: undefined } }))).toEqual([
      { link: { href: "/", content: [] } },
    ]);
    expect(
      inline(
        map({
          link: map({
            href: "/",
            content: array([
              map({ text: "" }),
              map({ text: "a" }),
              map({ text: "b" }),
              map({ text: "c", styles: { bold: true } }),
            ]),
          }),
        }),
      ),
    ).toEqual([
      {
        link: {
          href: "/",
          content: [{ text: "ab" }, { text: "c", styles: { bold: true } }],
        },
      },
    ]);
  });
  it.each([
    undefined,
    1,
    array([1]),
    array([map({ cells: 3 })]),
    array([map({ cells: array([1]) })]),
  ])("rejects malformed table structure", (rows) => {
    expect(() => table(rows)).toThrow();
  });
  it("projects a table cell without inline content", () => {
    expect(
      table(array([map({ cells: array([map({ cellId: "cell" })]) })])),
    ).toEqual({
      content: { rows: [{ cells: [{ cellId: "cell" }] }] },
    });
  });
  it("rejects primitive rich text payload and table content", () => {
    expect(() =>
      fromYRichTextBlockPayload(
        "rich_text",
        "table",
        attached(map({ content: { rows: [] } })),
      ),
    ).toThrow("table_json");
    expect(() =>
      fromYRichTextBlockPayload("rich_text", "paragraph", { content: [] }),
    ).toThrow("non_json_value");
    expect(() =>
      fromYRichTextBlockPayload("rich_text", "paragraph", 4),
    ).toThrow("payload");
    expect(() =>
      fromYRichTextBlockPayload(
        "rich_text",
        "table",
        attached(map({ content: 4 })),
      ),
    ).toThrow("table_content");
  });
  it("retains unknown and non-rich-text payload decoding", () => {
    expect(
      fromYRichTextBlockPayload(
        "rich_text",
        "divider",
        attached(map({ props: map({}) })),
      ),
    ).toEqual({ props: {} });
    expect(
      fromYRichTextBlockPayload(
        "rich_text",
        "futureBlock",
        attached(map({ props: map({}) })),
      ),
    ).toEqual({ props: {} });
    expect(
      fromYRichTextBlockPayload(
        "page_section",
        "richText",
        attached(map({ value: "caption" })),
      ),
    ).toEqual({ value: "caption" });
  });
});
