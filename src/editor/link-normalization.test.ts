import { describe, expect, it } from "vitest";
import {
  normalizeRichTextHref,
  normalizeRichTextHtmlLinks,
  normalizeRichTextHtmlLinksFromBlocks,
} from "./link-normalization.js";

type TestInlineNode = {
  type?: string;
  href?: string;
  props?: {
    href?: string;
  };
  content?: TestInlineNode[];
};

type TestBlockNode = {
  content?: TestInlineNode[];
  children?: TestBlockNode[];
};

describe("normalizeRichTextHref", () => {
  it("preserves already safe hrefs without changing intentional whitespace", () => {
    expect(normalizeRichTextHref("")).toBe("");
    expect(normalizeRichTextHref("https://studio.example.com/path?q=1")).toBe(
      "https://studio.example.com/path?q=1",
    );
    expect(normalizeRichTextHref("mailto:johndoe@example.com")).toBe(
      "mailto:johndoe@example.com",
    );
    expect(normalizeRichTextHref("tel:+821012345678")).toBe(
      "tel:+821012345678",
    );
  });

  it("normalizes editor-added protocol wrappers around placeholders and duplicate schemes", () => {
    expect(normalizeRichTextHref(" https://{{profile.url}} ")).toBe(
      "{{profile.url}}",
    );
    expect(normalizeRichTextHref("https://https://example.com/post")).toBe(
      "https://example.com/post",
    );
    expect(normalizeRichTextHref("http://http://example.com/post")).toBe(
      "http://example.com/post",
    );
  });

  it("rejects unsafe schemes even when obfuscated with entities or whitespace", () => {
    expect(normalizeRichTextHref("javascript:alert(1)")).toBe("");
    expect(normalizeRichTextHref("java&#x73;cript&colon;alert(1)")).toBe("");
    expect(normalizeRichTextHref("java\nscript:alert(1)")).toBe("");
    expect(normalizeRichTextHref("java&tab;script:alert(1)")).toBe("");
    expect(normalizeRichTextHref("java&newline;script:alert(1)")).toBe("");
    expect(normalizeRichTextHref("ftp://example.com/file")).toBe("");
    expect(normalizeRichTextHref("java&#9999999999;script:alert(1)")).toBe(
      "java&#9999999999;script:alert(1)",
    );
  });

  it("keeps relative and schemeless hrefs because materialized content may resolve them later", () => {
    expect(normalizeRichTextHref("/pages/about")).toBe("/pages/about");
    expect(normalizeRichTextHref("studio.example.com/about")).toBe(
      "studio.example.com/about",
    );
    expect(normalizeRichTextHref("#section")).toBe("#section");
  });
});

describe("normalizeRichTextHtmlLinks", () => {
  it("normalizes href attributes across quote styles", () => {
    const html =
      "<a href=\" https://https://example.com \">A</a><a href='https://{{cta.url}}'>B</a><a href=https://example.org>C</a>";

    expect(normalizeRichTextHtmlLinks(html)).toBe(
      "<a href=\"https://example.com\">A</a><a href='{{cta.url}}'>B</a><a href=https://example.org>C</a>",
    );
  });

  it("removes unsafe href attributes without disturbing the rest of the element", () => {
    expect(
      normalizeRichTextHtmlLinks(
        '<a class="x" href="javascript:alert(1)">bad</a>',
      ),
    ).toBe('<a class="x" >bad</a>');
    expect(
      normalizeRichTextHtmlLinks(
        "<a href='java&#115;cript&colon;alert(1)'>bad</a>",
      ),
    ).toBe("<a >bad</a>");
  });

  it("returns input unchanged when no href attribute is present", () => {
    expect(normalizeRichTextHtmlLinks("<p>No links</p>")).toBe(
      "<p>No links</p>",
    );
    expect(normalizeRichTextHtmlLinks("")).toBe("");
  });
});

describe("normalizeRichTextHtmlLinksFromBlocks", () => {
  it("restores schemeless links that a renderer exported with an https prefix", () => {
    const blocks: TestBlockNode[] = [
      {
        content: [
          {
            type: "link",
            props: { href: "studio.example.com/releases" },
            content: [
              { type: "text", href: "nested.example" },
              { type: "link", href: "https://safe.example" },
              { type: "text" },
            ],
          },
        ],
        children: [
          {
            content: [{ type: "link", href: "artist.example/profile" }],
            children: [],
          },
        ],
      },
      {
        children: [
          {
            content: [
              { type: "link", props: { href: 42 as unknown as string } },
            ],
          },
        ],
      },
    ];

    expect(
      normalizeRichTextHtmlLinksFromBlocks(
        blocks,
        '<a href="https://studio.example.com/releases">Release</a><a href=\'https://artist.example/profile\'>Artist</a><a href=https://nested.example>Nested</a><a href="https://safe.example">Safe</a>',
      ),
    ).toBe(
      '<a href="studio.example.com/releases">Release</a><a href=\'artist.example/profile\'>Artist</a><a href=nested.example>Nested</a><a href="https://safe.example">Safe</a>',
    );
  });

  it("falls back to regular html normalization for empty block input", () => {
    expect(
      normalizeRichTextHtmlLinksFromBlocks(
        [],
        '<a href="javascript:alert(1)">bad</a>',
      ),
    ).toBe("<a >bad</a>");
    expect(
      normalizeRichTextHtmlLinksFromBlocks([{ children: [] }], "<p>plain</p>"),
    ).toBe("<p>plain</p>");
  });
});
