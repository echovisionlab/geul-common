import type * as Y from "yjs";
import { z } from "zod";

export const DOCUMENT_LAYOUT_FIELD_KEYS = [
  "contentHeight",
  "pageChrome",
  "footer",
] as const;

export const documentLayoutSchema = z
  .object({
    contentHeight: z.enum(["content", "viewport"]),
    pageChrome: z.enum(["flow", "pinned"]),
    footer: z.enum(["flow", "pinned"]),
  })
  .strict();

export type DocumentLayout = z.infer<typeof documentLayoutSchema>;

export const DEFAULT_DOCUMENT_LAYOUT: DocumentLayout = {
  contentHeight: "content",
  pageChrome: "flow",
  footer: "flow",
};

function readDocumentLayoutValue(
  settingsMap: Y.Map<unknown>,
  key: keyof DocumentLayout,
): unknown {
  const value = settingsMap.get(key);
  return value === undefined ? DEFAULT_DOCUMENT_LAYOUT[key] : value;
}

export function readDocumentLayout(
  settingsMap: Y.Map<unknown>,
): DocumentLayout {
  return documentLayoutSchema.parse({
    contentHeight: readDocumentLayoutValue(settingsMap, "contentHeight"),
    pageChrome: readDocumentLayoutValue(settingsMap, "pageChrome"),
    footer: readDocumentLayoutValue(settingsMap, "footer"),
  });
}

export function hasExplicitDocumentLayout(
  settingsMap: Y.Map<unknown>,
): boolean {
  if (!DOCUMENT_LAYOUT_FIELD_KEYS.every((key) => settingsMap.has(key))) {
    return false;
  }

  return documentLayoutSchema.safeParse({
    contentHeight: settingsMap.get("contentHeight"),
    pageChrome: settingsMap.get("pageChrome"),
    footer: settingsMap.get("footer"),
  }).success;
}

export function writeDocumentLayout(
  settingsMap: Y.Map<unknown>,
  layout: DocumentLayout,
): void {
  const parsed = documentLayoutSchema.parse(layout);
  const document = settingsMap.doc;
  if (!document) {
    throw new Error("Document settings map must be attached to a Y.Doc");
  }

  const write = () => {
    settingsMap.set("contentHeight", parsed.contentHeight);
    settingsMap.set("pageChrome", parsed.pageChrome);
    settingsMap.set("footer", parsed.footer);
  };

  document.transact(write);
}
