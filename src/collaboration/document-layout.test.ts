import { describe, expect, expectTypeOf, it } from "vitest";
import * as Y from "yjs";
import {
  DEFAULT_DOCUMENT_LAYOUT,
  DOCUMENT_LAYOUT_FIELD_KEYS,
  documentLayoutSchema,
  hasExplicitDocumentLayout,
  readDocumentLayout,
  writeDocumentLayout,
  type DocumentLayout,
} from "./document-layout.js";
import {
  PAGE_SHARED_FIELD_KEYS,
  documentLayoutSchema as pageDocumentLayoutSchema,
  pageCollabFieldsSchema,
} from "./page.js";
import { POST_SHARED_FIELD_KEYS, postCollabFieldsSchema } from "./post.js";
import { documentLayoutSchema as pageIndexDocumentLayoutSchema } from "../page/index.js";

describe("document layout", () => {
  it("defines the reusable field keys and default layout", () => {
    const document = new Y.Doc();
    const settingsMap = document.getMap("settings");

    expect(DOCUMENT_LAYOUT_FIELD_KEYS).toEqual([
      "contentHeight",
      "pageChrome",
      "footer",
    ]);
    expect(hasExplicitDocumentLayout(settingsMap)).toBe(false);
    expect(readDocumentLayout(settingsMap)).toEqual(DEFAULT_DOCUMENT_LAYOUT);
    expect(DEFAULT_DOCUMENT_LAYOUT).toEqual({
      contentHeight: "content",
      pageChrome: "flow",
      footer: "flow",
    });
  });

  it("fills only missing map values from the defaults", () => {
    const document = new Y.Doc();
    const settingsMap = document.getMap("page-fields");
    settingsMap.set("contentHeight", "viewport");
    settingsMap.set("footer", "pinned");

    expect(hasExplicitDocumentLayout(settingsMap)).toBe(false);
    expect(readDocumentLayout(settingsMap)).toEqual({
      contentHeight: "viewport",
      pageChrome: "flow",
      footer: "pinned",
    });
    expect(document.share.has("page-fields")).toBe(true);
    expect(document.share.has("document-layout")).toBe(false);
  });

  it("writes the layout in one transaction without deleting other shared settings", () => {
    const document = new Y.Doc();
    const settingsMap = document.getMap("post-meta");
    settingsMap.set("commentsEnabled", true);
    settingsMap.set("contentHeight", "legacy");
    expect(hasExplicitDocumentLayout(settingsMap)).toBe(false);

    let observerCalls = 0;
    settingsMap.observe(() => {
      observerCalls += 1;
    });

    writeDocumentLayout(settingsMap, {
      contentHeight: "viewport",
      pageChrome: "pinned",
      footer: "pinned",
    });

    expect(observerCalls).toBe(1);
    expect(settingsMap.get("commentsEnabled")).toBe(true);
    expect(hasExplicitDocumentLayout(settingsMap)).toBe(true);
    expect(readDocumentLayout(settingsMap)).toEqual({
      contentHeight: "viewport",
      pageChrome: "pinned",
      footer: "pinned",
    });
    expect(document.share.has("post-meta")).toBe(true);
    expect(document.share.has("document-layout")).toBe(false);
  });

  it("rejects malformed layouts without partially writing them", () => {
    const document = new Y.Doc();
    const settingsMap = document.getMap("page-fields");
    settingsMap.set("showTitle", true);
    writeDocumentLayout(settingsMap, DEFAULT_DOCUMENT_LAYOUT);

    expect(() =>
      writeDocumentLayout(settingsMap, {
        contentHeight: "viewport",
        pageChrome: "sticky",
        footer: "pinned",
      } as unknown as DocumentLayout),
    ).toThrow();
    expect(readDocumentLayout(settingsMap)).toEqual(DEFAULT_DOCUMENT_LAYOUT);
    expect(settingsMap.get("showTitle")).toBe(true);
    expect(hasExplicitDocumentLayout(settingsMap)).toBe(true);

    settingsMap.set("footer", null);
    expect(hasExplicitDocumentLayout(settingsMap)).toBe(false);
    expect(() => readDocumentLayout(settingsMap)).toThrow();
    expect(
      documentLayoutSchema.safeParse({
        ...DEFAULT_DOCUMENT_LAYOUT,
        localized: true,
      }).success,
    ).toBe(false);
  });

  it("requires all three explicit valid keys while allowing other shared settings", () => {
    const document = new Y.Doc();
    const settingsMap = document.getMap("page-fields");
    settingsMap.set("slug", "about");
    settingsMap.set("contentHeight", "content");
    settingsMap.set("pageChrome", "flow");

    expect(hasExplicitDocumentLayout(settingsMap)).toBe(false);

    settingsMap.set("footer", "flow");
    expect(hasExplicitDocumentLayout(settingsMap)).toBe(true);
  });

  it("rejects writes to a detached Y.Map", () => {
    expect(() =>
      writeDocumentLayout(new Y.Map(), DEFAULT_DOCUMENT_LAYOUT),
    ).toThrow("Document settings map must be attached to a Y.Doc");
  });

  it("keeps Page and Post domain settings outside shared document metadata", () => {
    expect(pageDocumentLayoutSchema).toBe(documentLayoutSchema);
    expect(pageIndexDocumentLayoutSchema).toBe(documentLayoutSchema);
    expect(Object.keys(pageCollabFieldsSchema.shape)).toEqual([]);
    expect(PAGE_SHARED_FIELD_KEYS).toEqual([]);
    expect(Object.keys(postCollabFieldsSchema.shape)).toEqual([
      "title",
      "summary",
      "categoryIds",
      "tagIds",
    ]);
    expect(POST_SHARED_FIELD_KEYS).toEqual(["categoryIds", "tagIds"]);
    expectTypeOf<
      typeof DEFAULT_DOCUMENT_LAYOUT
    >().toEqualTypeOf<DocumentLayout>();
  });
});
