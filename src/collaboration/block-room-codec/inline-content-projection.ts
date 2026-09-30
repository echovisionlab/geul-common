import type { JsonValue } from "@bufbuild/protobuf";
import {
  richTextBlockCatalog,
  richTextBlockKindByProtoCase,
  type RichTextBlockKind,
} from "@echovisionlab/geul-proto/content/block_catalog.ts";
import * as Y from "yjs";
import {
  fail,
  fromYValue,
  type BlockRoomNodeFamily,
  type JsonObject,
} from "./internal.ts";

const RICH_TEXT_STYLE_KEYS = [
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
  "textColor",
  "backgroundColor",
] as const;

type RichTextStyleKey = (typeof RICH_TEXT_STYLE_KEYS)[number];
type RichTextStyleValue = boolean | string;
type RichTextStyle = Partial<Record<RichTextStyleKey, RichTextStyleValue>>;
type ProjectedTextRun = JsonObject & { text: string };

type RichTextCatalogEntry = {
  readonly content: string;
};

const richTextCatalog = richTextBlockCatalog as Readonly<
  Record<string, RichTextCatalogEntry>
>;

function record(value: unknown, reason: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail(reason);
  }
  return value as Record<string, unknown>;
}

function yRecord(value: unknown, reason: string): Record<string, unknown> {
  if (value instanceof Y.Map) {
    return Object.fromEntries(value.entries());
  }
  return record(value, reason);
}

function textStyle(value: unknown, reason: string): RichTextStyle {
  if (value === undefined) {
    return {};
  }
  let raw: Record<string, unknown>;
  if (value instanceof Y.Map) {
    raw = Object.fromEntries(value.entries());
  } else {
    raw = record(value, reason);
  }
  const result: RichTextStyle = {};
  for (const key of RICH_TEXT_STYLE_KEYS) {
    const style = raw[key];
    if (typeof style === "boolean" || typeof style === "string") {
      result[key] = style;
    }
  }
  return result;
}

function mergedTextStyle(
  legacy: RichTextStyle,
  attributes: Readonly<Record<string, unknown>> | undefined,
): RichTextStyle {
  const result: RichTextStyle = { ...legacy };
  if (attributes === undefined) {
    return result;
  }
  const raw = attributes;
  for (const key of RICH_TEXT_STYLE_KEYS) {
    const value = raw[key];
    if (typeof value === "boolean" || typeof value === "string") {
      result[key] = value;
    }
  }
  return result;
}

function jsonStyle(style: RichTextStyle): JsonObject | undefined {
  const result: JsonObject = {};
  for (const key of RICH_TEXT_STYLE_KEYS) {
    const value = style[key];
    if (value !== undefined && value !== false && value !== "") {
      result[key] = value;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function appendProjectedText(
  target: ProjectedTextRun[],
  value: ProjectedTextRun,
): void {
  const text = value.text;
  if (text.length === 0) {
    target.push(value);
    return;
  }
  const previous = target[target.length - 1];
  if (previous) {
    const previousText = previous.text;
    if (
      JSON.stringify(previous.styles ?? {}) ===
      JSON.stringify(value.styles ?? {})
    ) {
      previous.text = previousText + text;
      return;
    }
  }
  target.push(value);
}

function styledTextMap(value: unknown, reason: string): Y.Map<unknown> {
  if (!(value instanceof Y.Map)) {
    return fail(reason);
  }
  return value;
}

function projectedTextField(
  value: unknown,
  styleValue: unknown,
  reason: string,
): ProjectedTextRun[] {
  const text = value;
  if (
    text !== undefined &&
    typeof text !== "string" &&
    !(text instanceof Y.Text)
  ) {
    return fail(`${reason}:text`);
  }
  const legacyStyle = textStyle(styleValue, `${reason}:styles`);
  if (typeof text === "string" || text === undefined) {
    const emptyOrLegacy: ProjectedTextRun = {
      text: typeof text === "string" ? text : "",
    };
    const style = jsonStyle(legacyStyle);
    if (style) {
      emptyOrLegacy.styles = style;
    }
    return [emptyOrLegacy];
  }
  const result: ProjectedTextRun[] = [];
  const delta = text.toDelta();
  if (delta.length === 0) {
    const empty: ProjectedTextRun = { text: "" };
    const style = jsonStyle(legacyStyle);
    if (style) {
      empty.styles = style;
    }
    return [empty];
  }
  for (const operation of delta) {
    if (typeof operation.insert !== "string") {
      return fail(`${reason}:embed`);
    }
    const item: ProjectedTextRun = { text: operation.insert };
    if (operation.attributes !== undefined || styleValue !== undefined) {
      const style = jsonStyle(
        mergedTextStyle(legacyStyle, operation.attributes),
      );
      if (style) {
        item.styles = style;
      }
    }
    appendProjectedText(result, item);
  }
  return result;
}

function projectedStyledText(
  value: unknown,
  reason: string,
): ProjectedTextRun[] {
  const styled = styledTextMap(value, reason);
  const text = styled.get("text");
  if (text === undefined) {
    return projectedTextField(undefined, styled.get("styles"), reason);
  }
  if (text instanceof Y.Text || typeof text === "string") {
    return projectedTextField(text, styled.get("styles"), reason);
  }
  if (!(text instanceof Y.Map)) {
    return fail(`${reason}:text`);
  }
  const nestedText = text.get("text");
  const legacyStyle = text.get("styles") ?? styled.get("styles");
  return projectedTextField(nestedText, legacyStyle, reason);
}

function projectedLinkStyledText(
  value: unknown,
  reason: string,
): ProjectedTextRun[] {
  const styled = styledTextMap(value, reason);
  return projectedTextField(styled.get("text"), styled.get("styles"), reason);
}

function projectedInlineItem(value: unknown, reason: string): JsonValue[] {
  if (!(value instanceof Y.Map)) {
    return fail(reason);
  }
  const cases = ["text", "link", "mathInline", "hardBreak"].filter((key) =>
    value.has(key),
  );
  if (cases.length !== 1) {
    return fail(`${reason}:oneof`);
  }
  const selected = cases[0]!;
  if (selected === "text") {
    return projectedStyledText(value.get("text"), `${reason}:text`).map(
      (styledText) => ({ text: styledText }),
    );
  }
  if (selected === "link") {
    const link = yRecord(value.get("link"), `${reason}:link`);
    const content = link.content;
    if (content !== undefined && !(content instanceof Y.Array)) {
      return fail(`${reason}:link_content`);
    }
    const projectedContent: ProjectedTextRun[] = [];
    if (content instanceof Y.Array) {
      content.toArray().forEach((child, index) => {
        for (const run of projectedLinkStyledText(
          child,
          `${reason}:link_content:${index}`,
        )) {
          appendProjectedText(projectedContent, run);
        }
      });
    }
    const projectedLink: JsonObject = {
      href: typeof link.href === "string" ? link.href : fail(`${reason}:href`),
      content: projectedContent,
    };
    return [{ link: projectedLink }];
  }
  return [fromYValue(value)];
}

export function fromYInlineContent(value: unknown): JsonValue[] {
  if (!(value instanceof Y.Array)) {
    return fail("inline_content:array");
  }
  return value
    .toArray()
    .flatMap((item, index) =>
      projectedInlineItem(item, `inline_content:${index}`),
    );
}

function decodeOtherFields(
  value: unknown,
  excluded: string,
  reason: string,
): JsonObject {
  if (!(value instanceof Y.Map)) {
    return fail(reason);
  }
  return Object.fromEntries(
    [...value.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .filter(([key]) => key !== excluded)
      .map(([key, child]) => [key, fromYValue(child)]),
  );
}

function projectedTableContent(value: unknown): JsonValue {
  const rawContent = yRecord(value, "inline_content:table_content");
  const projected = decodeOtherFields(
    value,
    "rows",
    "inline_content:table_json",
  );
  const rows = rawContent.rows;
  if (!(rows instanceof Y.Array)) {
    return fail("inline_content:table_rows");
  }
  projected.rows = rows.toArray().map((rawRow, rowIndex) => {
    if (!(rawRow instanceof Y.Map)) {
      return fail(`inline_content:table_row:${rowIndex}`);
    }
    const row = decodeOtherFields(
      rawRow,
      "cells",
      `inline_content:table_row_json:${rowIndex}`,
    );
    const rawCells = rawRow.get("cells");
    if (!(rawCells instanceof Y.Array)) {
      return fail(`inline_content:table_cells:${rowIndex}`);
    }
    row.cells = rawCells.toArray().map((rawCell, cellIndex) => {
      if (!(rawCell instanceof Y.Map)) {
        return fail(`inline_content:table_cell:${rowIndex}:${cellIndex}`);
      }
      const cell = decodeOtherFields(
        rawCell,
        "content",
        `inline_content:table_cell_json:${rowIndex}:${cellIndex}`,
      );
      const cellContent = rawCell.get("content");
      if (cellContent !== undefined) {
        cell.content = fromYInlineContent(cellContent);
      }
      return cell;
    });
    return row;
  });
  return projected as JsonValue;
}

/**
 * Projects formatted inline Y.Text runs into the existing protobuf JSON shape.
 * The raw storage decoder intentionally stays one-to-one with physical Y.Array
 * items so all existing payload paths continue to use physical indexes.
 */
export function fromYRichTextBlockPayload(
  family: BlockRoomNodeFamily,
  kind: string,
  value: unknown,
): JsonValue {
  if (family !== "rich_text") {
    return fromYValue(value);
  }
  const catalogKind =
    richTextBlockKindByProtoCase[
      kind as keyof typeof richTextBlockKindByProtoCase
    ];
  if (!catalogKind) {
    return fromYValue(value);
  }
  const entry = richTextCatalog[catalogKind as RichTextBlockKind];
  if (entry.content !== "inline" && entry.content !== "table") {
    return fromYValue(value);
  }
  if (!(value instanceof Y.Map)) {
    return record(
      fromYValue(value),
      "inline_content:payload_json",
    ) as JsonValue;
  }
  const projected = decodeOtherFields(
    value,
    "content",
    "inline_content:payload_json",
  );
  const rawContent = value.get("content");
  if (rawContent === undefined) {
    return projected as JsonValue;
  }
  if (entry.content === "inline") {
    projected.content = fromYInlineContent(rawContent);
    return projected as JsonValue;
  }
  const content = projectedTableContent(rawContent);
  projected.content = content;
  return projected as JsonValue;
}

export function richTextStyleKeys(): readonly RichTextStyleKey[] {
  return RICH_TEXT_STYLE_KEYS;
}

export function projectedStyledTextRuns(
  value: unknown,
  reason = "inline_content:styled_text",
): JsonValue[] {
  return projectedStyledText(value, reason);
}
