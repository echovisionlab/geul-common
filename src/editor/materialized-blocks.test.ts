import { describe, expect, it } from "vitest";
import {
  isEmptyParagraphBlock,
  stripTrailingEmptyParagraphBlocks,
} from "./materialized-blocks.ts";

type TestBlock = {
  type?: string;
  content?:
    | Array<{ text?: string; content?: Array<{ text?: string }> }>
    | string
    | object
    | null;
  children?: TestBlock[];
};

describe("materialized block helpers", () => {
  it("recognizes every empty paragraph representation", () => {
    expect(
      isEmptyParagraphBlock<TestBlock>({ type: "heading", content: "" }),
    ).toBe(false);
    expect(
      isEmptyParagraphBlock<TestBlock>({
        type: "paragraph",
        content: "",
        children: [{ type: "paragraph", content: "" }],
      }),
    ).toBe(false);
    expect(
      isEmptyParagraphBlock<TestBlock>({ type: "paragraph", content: "" }),
    ).toBe(true);
    expect(
      isEmptyParagraphBlock<TestBlock>({
        type: "paragraph",
        content: " text ",
      }),
    ).toBe(false);
    expect(
      isEmptyParagraphBlock<TestBlock>({ type: "paragraph", content: null }),
    ).toBe(true);
    expect(isEmptyParagraphBlock<TestBlock>({ type: "paragraph" })).toBe(true);
    expect(
      isEmptyParagraphBlock<TestBlock>({ type: "paragraph", content: {} }),
    ).toBe(false);
    expect(
      isEmptyParagraphBlock<TestBlock>({ type: "paragraph", content: [] }),
    ).toBe(true);
  });

  it("finds direct and nested inline text", () => {
    expect(
      isEmptyParagraphBlock<TestBlock>({
        type: "paragraph",
        content: [{ text: " direct " }],
      }),
    ).toBe(false);
    expect(
      isEmptyParagraphBlock<TestBlock>({
        type: "paragraph",
        content: [{ text: "  ", content: [{ text: " nested " }] }],
      }),
    ).toBe(false);
    expect(
      isEmptyParagraphBlock<TestBlock>({
        type: "paragraph",
        content: [{ text: " ", content: [{ text: " " }] }, {}],
      }),
    ).toBe(true);
  });

  it("strips only trailing empty paragraphs without mutating the input", () => {
    const blocks: TestBlock[] = [
      { type: "paragraph", content: "" },
      { type: "paragraph", content: "keep" },
      { type: "paragraph", content: [] },
      { type: "paragraph", content: null },
    ];

    expect(stripTrailingEmptyParagraphBlocks(blocks)).toEqual(
      blocks.slice(0, 2),
    );
    expect(
      stripTrailingEmptyParagraphBlocks([{ type: "paragraph", content: "" }]),
    ).toEqual([]);
    expect(
      stripTrailingEmptyParagraphBlocks([{ type: "heading", content: "" }]),
    ).toHaveLength(1);
    expect(blocks).toHaveLength(4);
  });
});
