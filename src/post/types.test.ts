import { describe, expect, expectTypeOf, it } from "vitest";
import {
  postContentSchema as rootPostContentSchema,
  type PostContent as RootPostContent,
} from "../index.js";
import type { Block } from "../page/types.js";
import { postContentSchema, type PostContent } from "./index.js";

const layout = {
  contentHeight: "viewport",
  pageChrome: "pinned",
  footer: "flow",
};

const blocks: Block[] = [
  {
    id: "block-1",
    type: "paragraph",
    props: { textAlignment: "left" },
    content: [{ type: "text", text: "Post body" }],
    children: [],
  },
];

describe("post content", () => {
  it("parses the locale block array", () => {
    const content = postContentSchema.parse(blocks);

    expect(content).toEqual(blocks);
    expectTypeOf(content).toEqualTypeOf<PostContent>();
    expectTypeOf<PostContent>().toEqualTypeOf<Block[]>();
  });

  it("rejects layout, envelopes, and malformed block arrays", () => {
    expect(postContentSchema.safeParse(layout).success).toBe(false);
    expect(postContentSchema.safeParse({ layout, blocks }).success).toBe(false);
    expect(postContentSchema.safeParse({ blocks }).success).toBe(false);
    expect(postContentSchema.safeParse([null]).success).toBe(false);
  });

  it("exports the same contract from the package root", () => {
    expect(rootPostContentSchema).toBe(postContentSchema);
    expectTypeOf<RootPostContent>().toEqualTypeOf<PostContent>();
  });
});
