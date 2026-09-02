import { describe, expect, expectTypeOf, it } from "vitest";
import type { ExternalVideoAspectRatio } from "../media/block-schemas.ts";
import {
  pageContentSchema as rootPageContentSchema,
  type PageContent as RootPageContent,
} from "../index.js";
import { pageContentSchema, type PageContent, type Section } from "./index.js";
import type { ExternalVideoProps } from "./block-fixtures.ts";

const layout = {
  contentHeight: "viewport",
  pageChrome: "pinned",
  footer: "flow",
};

const sections: Section[] = [
  {
    id: "section-1",
    type: "rich-text",
    settings: {},
    props: { title: "Section" },
    content: [],
  },
];

describe("page content", () => {
  it("parses the locale sections envelope", () => {
    const content = pageContentSchema.parse({ sections });

    expect(content).toEqual({ sections });
    expectTypeOf(content).toEqualTypeOf<PageContent>();
    expectTypeOf<PageContent>().toEqualTypeOf<{ sections: Section[] }>();
    expectTypeOf<PageContent["sections"]>().toEqualTypeOf<Section[]>();
  });

  it("rejects layout, unknown, and malformed envelope values", () => {
    expect(pageContentSchema.safeParse(sections).success).toBe(false);
    expect(pageContentSchema.safeParse({}).success).toBe(false);
    expect(pageContentSchema.safeParse({ layout, sections }).success).toBe(
      false,
    );
    expect(pageContentSchema.safeParse({ sections: null }).success).toBe(false);
    expect(pageContentSchema.safeParse({ sections: [null] }).success).toBe(
      false,
    );
    expect(pageContentSchema.safeParse({ sections: [[]] }).success).toBe(false);
    expect(pageContentSchema.safeParse({ sections: ["section"] }).success).toBe(
      false,
    );
    expect(
      pageContentSchema.safeParse({ sections, localized: true }).success,
    ).toBe(false);
  });

  it("exports the same contract from page and package root entry points", () => {
    expect(rootPageContentSchema).toBe(pageContentSchema);
    expectTypeOf<RootPageContent>().toEqualTypeOf<PageContent>();
  });

  it("shares the external-video aspect-ratio contract with rich-text link layout", () => {
    expectTypeOf<
      ExternalVideoProps["aspectRatio"]
    >().toEqualTypeOf<ExternalVideoAspectRatio>();
  });
});
