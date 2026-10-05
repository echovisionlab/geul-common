import type { JsonValue } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import {
  changedStyleAttributes,
  desiredGroups,
  minimalDiff,
  normalizeInlineContent,
  styleSpans,
} from "./inline-content-model.ts";

describe("inline content model", () => {
  it("coalesces equivalent adjacent text while retaining semantic group boundaries", () => {
    const input: JsonValue[] = [
      { text: { text: "A", styles: { bold: false } } },
      { text: "B" },
      { link: { href: "/target", content: ["C", "D"] } },
      { hardBreak: {} },
      { mathInline: { source: "x+y" } },
      { text: { text: "E", styles: { italic: true } } },
    ];

    expect(desiredGroups(input).map(({ kind }) => kind)).toEqual([
      "text",
      "link",
      "hardBreak",
      "mathInline",
      "text",
    ]);
    expect(normalizeInlineContent(input)).toBe(
      JSON.stringify([
        { text: [{ text: "AB", styles: {} }] },
        { link: { href: "/target", content: [{ text: "CD", styles: {} }] } },
        { hardBreak: {} },
        { mathInline: { source: "x+y" } },
        { text: [{ text: "E", styles: { italic: true } }] },
      ]),
    );
  });

  it("plans diffs on UTF-16 boundaries without splitting surrogate pairs", () => {
    expect(minimalDiff("a😀b", "a😃b")).toEqual({
      from: 1,
      oldTo: 3,
      newTo: 3,
    });
    expect(minimalDiff("ab", "a😀b")).toEqual({
      from: 1,
      oldTo: 1,
      newTo: 3,
    });
    expect(minimalDiff("a😀b", "ab")).toEqual({
      from: 1,
      oldTo: 3,
      newTo: 1,
    });
    expect(minimalDiff("same", "same")).toEqual({
      from: 4,
      oldTo: 4,
      newTo: 4,
    });
  });

  it("projects style spans and removal attributes from the normalized model", () => {
    const spans = styleSpans(
      [
        { text: "A", styles: { bold: true, textColor: "red" } },
        { text: "BC", styles: { bold: false } },
      ],
      4,
    );
    expect(spans).toEqual([
      { from: 4, to: 5, styles: { bold: true, textColor: "red" } },
      { from: 5, to: 7, styles: {} },
    ]);
    expect(
      changedStyleAttributes(
        { bold: true, textColor: "red" },
        { italic: true },
      ),
    ).toEqual({
      bold: false,
      italic: true,
      textColor: "",
    });
  });
});
