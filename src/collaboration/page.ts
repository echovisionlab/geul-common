import { z } from "zod";

export * from "./document-layout.ts";

// Shared Page Yjs owns only section/column/block structure. Page settings are
// changed through their owning DB mutations and must not be persisted here.
export const pageCollabFieldsSchema = z.object({}).strict();

export const PAGE_SOURCE_OWNED_FIELD_KEYS = ["title", "summary"] as const;
export const PAGE_SHARED_FIELD_KEYS = [] as const;
export const PAGE_LOCALE_SECTION_PROP_KEYS = [
  "title",
  "label",
  "description",
  "caption",
  "copyJson",
] as const;
export const PAGE_RICH_TEXT_BLOCK_LOCALE_PROP_KEYS = {
  codeBlock: ["title"],
  file: ["alt", "caption"],
  map: ["caption"],
  p5Sketch: ["title"],
  threeScene: ["title"],
  shader: ["title"],
} as const;

export const PAGE_RICH_TEXT_BLOCK_SOURCE_OWNED_CONTENT_TYPES = [
  "p5Sketch",
  "threeScene",
  "shader",
] as const;

export function isPageRichTextBlockContentSourceOwned(
  blockType: string,
): boolean {
  return PAGE_RICH_TEXT_BLOCK_SOURCE_OWNED_CONTENT_TYPES.includes(
    blockType as (typeof PAGE_RICH_TEXT_BLOCK_SOURCE_OWNED_CONTENT_TYPES)[number],
  );
}

const PAGE_VISUAL_UNIT_DURABLE_PROP_KEYS = new Set([
  "id",
  "name",
  "attribution",
  "mesh",
  "meshSource",
  "meshFileId",
  "meshObjectName",
  "meshOptimizationCandidateId",
  "meshOptimizationSourceFileId",
  "meshOptimizationFileId",
  "scale",
  "meshOffsetY",
  "particleSize",
  "holdSeconds",
  "rotationX",
  "rotationY",
  "rotationZ",
  "rotationSpeedX",
  "rotationSpeedY",
  "rotationSpeedZ",
  "scrollRotationTurnsX",
  "scrollRotationTurnsY",
  "scrollRotationTurnsZ",
  "color",
  "textureSource",
  "textureFileId",
  "darkColor",
  "darkTextureSource",
  "darkTextureFileId",
]);

const PAGE_VISUAL_COPY_DURABLE_PROP_KEYS = new Set(["id", "title", "text"]);

export function sanitizePageVisualUnitsJson(value: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Failed to parse page visual units JSON");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Page visual units JSON must be an array");
  }

  return JSON.stringify(
    parsed.map((unit) => {
      if (!unit || typeof unit !== "object" || Array.isArray(unit)) {
        return unit;
      }

      const durableUnit: Record<string, unknown> = {};
      for (const [key, fieldValue] of Object.entries(unit)) {
        if (PAGE_VISUAL_UNIT_DURABLE_PROP_KEYS.has(key)) {
          durableUnit[key] = fieldValue;
        }
      }
      return durableUnit;
    }),
  );
}

export function sanitizePageVisualCopyJson(value: string): string {
  if (!value.trim()) {
    return value;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Failed to parse page visual copy JSON");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Page visual copy JSON must be an array");
  }

  return JSON.stringify(
    parsed.map((unit) => {
      if (!unit || typeof unit !== "object" || Array.isArray(unit)) {
        return unit;
      }

      const durableCopy: Record<string, string> = {};
      for (const [key, fieldValue] of Object.entries(unit)) {
        if (
          PAGE_VISUAL_COPY_DURABLE_PROP_KEYS.has(key) &&
          typeof fieldValue === "string"
        ) {
          durableCopy[key] = fieldValue;
        }
      }
      return durableCopy;
    }),
  );
}

const PAGE_RICH_TEXT_BLOCK_SHARED_PROP_KEYS = {
  file: ["fileId", "name", "width", "height", "previewWidth", "textAlignment"],
} as const;

function sanitizeSharedRichTextBlockPropValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  return value.trim();
}

export function pickSharedRichTextBlockProps(
  sharedProps: Record<string, unknown>,
  blockType: string,
): Record<string, unknown> {
  const sharedKeys =
    PAGE_RICH_TEXT_BLOCK_SHARED_PROP_KEYS[
      blockType as keyof typeof PAGE_RICH_TEXT_BLOCK_SHARED_PROP_KEYS
    ];

  if (!sharedKeys) {
    const localizedKeys = new Set<string>(
      PAGE_RICH_TEXT_BLOCK_LOCALE_PROP_KEYS[
        blockType as keyof typeof PAGE_RICH_TEXT_BLOCK_LOCALE_PROP_KEYS
      ] ?? [],
    );
    return Object.fromEntries(
      Object.entries(sharedProps).filter(([key]) => !localizedKeys.has(key)),
    );
  }

  const nextProps: Record<string, unknown> = {};
  for (const key of sharedKeys) {
    const value = sanitizeSharedRichTextBlockPropValue(sharedProps[key]);
    if (value !== undefined) {
      nextProps[key] = value;
    }
  }

  return nextProps;
}

export type PageCollabFields = z.infer<typeof pageCollabFieldsSchema>;
export type PageFieldValue = string | boolean | null;
export type PageSourceOwnedFieldKey =
  (typeof PAGE_SOURCE_OWNED_FIELD_KEYS)[number];
export type PageSharedFieldKey = (typeof PAGE_SHARED_FIELD_KEYS)[number];
export type PageLocaleSectionPropKey =
  (typeof PAGE_LOCALE_SECTION_PROP_KEYS)[number];

export function getRichTextBlockLocalePropKeys(
  blockType: string,
): readonly string[] {
  return (
    PAGE_RICH_TEXT_BLOCK_LOCALE_PROP_KEYS[
      blockType as keyof typeof PAGE_RICH_TEXT_BLOCK_LOCALE_PROP_KEYS
    ] ?? []
  );
}

export function hasRichTextBlockLocaleProps(blockType: string): boolean {
  return getRichTextBlockLocalePropKeys(blockType).length > 0;
}

function pageTranslationRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pageTranslationArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function pageTranslationString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function appendPageTranslationText(parts: string[], value: unknown): void {
  const text = pageTranslationString(value).trim();
  if (text) {
    parts.push(text);
  }
}

function pageInlineText(content: unknown): string {
  const parts: string[] = [];
  for (const rawNode of pageTranslationArray(content)) {
    const node = pageTranslationRecord(rawNode);
    if (!node) {
      continue;
    }
    if (node.type === "text") {
      const text = pageTranslationString(node.text);
      if (text.trim()) {
        parts.push(text);
      }
    } else if (node.type === "link") {
      const text = pageInlineText(node.content);
      if (text) {
        parts.push(text);
      }
    }
  }
  return parts.join("");
}

function pageTableText(content: unknown): string {
  const table = pageTranslationRecord(content);
  if (table?.type !== "tableContent") {
    return "";
  }

  const parts: string[] = [];
  for (const rawRow of pageTranslationArray(table.rows)) {
    const row = pageTranslationRecord(rawRow);
    for (const rawCell of pageTranslationArray(row?.cells)) {
      const cell = pageTranslationRecord(rawCell);
      const text = pageInlineText(cell?.content);
      if (text) {
        parts.push(text);
      }
    }
  }
  return parts.join("");
}

function pageBlockText(block: Record<string, unknown>): string {
  return block.type === "table"
    ? pageTableText(block.content)
    : pageInlineText(block.content);
}

function extractPageBlockTranslationText(blocks: unknown): string {
  const parts: string[] = [];
  for (const rawBlock of pageTranslationArray(blocks)) {
    const block = pageTranslationRecord(rawBlock);
    if (!block) {
      continue;
    }

    const text = pageBlockText(block);
    if (text) {
      parts.push(text);
    }

    const props = pageTranslationRecord(block.props) ?? {};
    for (const key of getRichTextBlockLocalePropKeys(
      pageTranslationString(block.type),
    )) {
      appendPageTranslationText(parts, props[key]);
    }

    const childText = extractPageBlockTranslationText(block.children);
    if (childText) {
      parts.push(childText);
    }
  }
  return parts.join("\n");
}

function appendImmersiveSceneCopyText(parts: string[], value: unknown): void {
  const copyJson = pageTranslationString(value).trim();
  if (!copyJson) {
    return;
  }

  let units: unknown;
  try {
    units = JSON.parse(copyJson) as unknown;
  } catch {
    return;
  }

  for (const rawUnit of pageTranslationArray(units)) {
    const unit = pageTranslationRecord(rawUnit);
    if (!unit) {
      continue;
    }
    appendPageTranslationText(parts, unit.title);
    appendPageTranslationText(parts, unit.text);
  }
}

function appendPageSectionTranslationText(
  parts: string[],
  sections: unknown,
): void {
  for (const rawSection of pageTranslationArray(sections)) {
    const section = pageTranslationRecord(rawSection);
    if (!section) {
      continue;
    }

    const type = pageTranslationString(section.type);
    if (type === "rich-text") {
      const text = extractPageBlockTranslationText(section.content);
      if (text) {
        parts.push(text);
      }
    }

    const props = pageTranslationRecord(section.props) ?? {};
    for (const key of PAGE_LOCALE_SECTION_PROP_KEYS) {
      if (key === "copyJson") {
        if (type === "immersive-scene") {
          appendImmersiveSceneCopyText(parts, props[key]);
        }
      } else {
        appendPageTranslationText(parts, props[key]);
      }
    }

    if (type === "columns") {
      for (const rawColumn of pageTranslationArray(section.columns)) {
        const column = pageTranslationRecord(rawColumn);
        appendPageSectionTranslationText(parts, column?.sections);
      }
    }
  }
}

export function extractPageTranslationContentText(sections: unknown): string {
  const parts: string[] = [];
  appendPageSectionTranslationText(parts, sections);
  return parts.join("\n").trim();
}

export function pickPageLocaleSectionProps(
  props: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!props) {
    return undefined;
  }

  const localizedProps: Record<string, unknown> = {};
  for (const key of PAGE_LOCALE_SECTION_PROP_KEYS) {
    const value = props[key];
    if (typeof value === "string") {
      localizedProps[key] =
        key === "copyJson" ? sanitizePageVisualCopyJson(value) : value;
    }
  }

  return Object.keys(localizedProps).length > 0 ? localizedProps : undefined;
}

export function stripPageLocaleSectionProps(
  props: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!props) {
    return {};
  }

  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (
      !PAGE_LOCALE_SECTION_PROP_KEYS.includes(
        key as (typeof PAGE_LOCALE_SECTION_PROP_KEYS)[number],
      )
    ) {
      next[key] =
        key === "unitsJson" && typeof value === "string"
          ? sanitizePageVisualUnitsJson(value)
          : value;
    }
  }
  return next;
}

export function mergePageLocaleSectionProps(
  sharedPropsValue: unknown,
  localizedPropsValue: unknown,
): Record<string, unknown> | undefined {
  const sharedProps =
    sharedPropsValue &&
    typeof sharedPropsValue === "object" &&
    !Array.isArray(sharedPropsValue)
      ? (sharedPropsValue as Record<string, unknown>)
      : {};
  const nextProps = stripPageLocaleSectionProps(sharedProps);
  const localizedProps =
    localizedPropsValue &&
    typeof localizedPropsValue === "object" &&
    !Array.isArray(localizedPropsValue)
      ? (localizedPropsValue as Record<string, unknown>)
      : {};

  for (const key of PAGE_LOCALE_SECTION_PROP_KEYS) {
    const value = localizedProps[key];
    if (typeof value === "string") {
      nextProps[key] =
        key === "copyJson" ? sanitizePageVisualCopyJson(value) : value;
      continue;
    }
    delete nextProps[key];
  }

  return Object.keys(nextProps).length > 0 ? nextProps : undefined;
}

export function mergeLocalizedBlockProps(
  sharedPropsValue: unknown,
  localizedPropsValue: unknown,
  blockType: string,
): Record<string, unknown> | undefined {
  if (
    !sharedPropsValue ||
    typeof sharedPropsValue !== "object" ||
    Array.isArray(sharedPropsValue)
  ) {
    return undefined;
  }

  const nextProps = pickSharedRichTextBlockProps(
    sharedPropsValue as Record<string, unknown>,
    blockType,
  );
  const localizedProps =
    localizedPropsValue &&
    typeof localizedPropsValue === "object" &&
    !Array.isArray(localizedPropsValue)
      ? (localizedPropsValue as Record<string, unknown>)
      : {};

  for (const key of getRichTextBlockLocalePropKeys(blockType)) {
    const value = localizedProps[key];
    if (typeof value === "string") {
      nextProps[key] = value.trim();
      continue;
    }
    delete nextProps[key];
  }

  return Object.keys(nextProps).length > 0 ? nextProps : undefined;
}

export function extractPageFields(fieldsMap: {
  get(key: string): PageFieldValue | undefined;
}): PageCollabFields {
  void fieldsMap;
  return pageCollabFieldsSchema.parse({});
}
