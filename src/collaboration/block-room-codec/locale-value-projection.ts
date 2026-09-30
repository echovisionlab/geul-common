import type { JsonValue } from "@bufbuild/protobuf";
import {
  pageImmersiveUnitCatalog,
  pageSectionCatalog,
  pageSectionKindByProtoCase,
  richTextBlockCatalog,
  richTextBlockKindByProtoCase,
} from "@echovisionlab/geul-proto/content/block_catalog.ts";
import type { AIDocumentFieldTarget } from "@echovisionlab/geul-proto/secure/ai_pb.ts";
import * as Y from "yjs";
import { fromYValue, type JsonObject } from "./internal.ts";
import { fromYInlineContent } from "./inline-content-projection.ts";
import { blockRoomBaseNodes } from "./materialization.ts";
import { payloadValue, roomNode } from "./room-access.ts";
import type { CatalogField } from "./ai-document-values.ts";
import {
  blockRoomLocaleValueRef,
  canonicalBlockRoomLocaleValueTarget,
  canonicalTarget,
  localeScalar,
  presenceFail,
  type CatalogEntry,
} from "./locale-targets.ts";

function catalogDefault(descriptor: CatalogField | undefined): JsonValue {
  return localeScalar(descriptor).default as string;
}

function localeValueDefault(
  yDocument: Y.Doc,
  value: AIDocumentFieldTarget,
): JsonValue {
  const target = canonicalTarget(value);
  const rawNode = blockRoomBaseNodes(yDocument).get(
    target.blockId,
  ) as Y.Map<unknown>;
  const family = rawNode.get("family");
  const kind = rawNode.get("kind") as string;
  if (family === "rich_text") {
    const catalogKind =
      richTextBlockKindByProtoCase[
        kind as keyof typeof richTextBlockKindByProtoCase
      ];
    const catalog = (
      richTextBlockCatalog as unknown as Readonly<Record<string, CatalogEntry>>
    )[catalogKind!]!;
    if (target.field === "content")
      return catalog.content === "inline" ? [] : "";
    if (target.field === "tableContent") return [];
    return catalogDefault(catalog.fields[target.field]);
  }
  const catalogKind =
    pageSectionKindByProtoCase[kind as keyof typeof pageSectionKindByProtoCase];
  if (target.path[0]?.[1] === "props") {
    const field = target.path[1]![1];
    const catalog = (
      pageSectionCatalog as unknown as Readonly<Record<string, CatalogEntry>>
    )[catalogKind!]!;
    return catalogDefault(catalog.fields[field]);
  }
  const field = target.path[3]![1];
  return catalogDefault(
    (pageImmersiveUnitCatalog as Readonly<Record<string, CatalogField>>)[field],
  );
}

export function blockRoomLocaleValue(
  yDocument: Y.Doc,
  target: AIDocumentFieldTarget,
): unknown {
  const ref = blockRoomLocaleValueRef(yDocument, target);
  try {
    const value = payloadValue(
      roomNode(yDocument, ref),
      ref.path,
      "locale_presence:value",
    );
    if (
      ref.family === "rich_text" &&
      (target.fieldHandle === "content" ||
        target.fieldHandle === "tableContent") &&
      value instanceof Y.Array
    ) {
      return fromYInlineContent(value);
    }
    return fromYValue(value);
  } catch {
    return localeValueDefault(yDocument, target);
  }
}

export function blockRoomLocaleValueIsEncoded(
  yDocument: Y.Doc,
  target: AIDocumentFieldTarget,
): boolean {
  try {
    const ref = blockRoomLocaleValueRef(yDocument, target);
    return (
      payloadValue(
        roomNode(yDocument, ref),
        ref.path,
        "locale_presence:encoded",
      ) !== undefined
    );
  } catch {
    return false;
  }
}

function mutableObject(value: JsonValue | undefined): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function upsertIdentityItem(
  values: JsonValue[],
  identityField: string,
  identity: string,
): JsonObject {
  const existing = values.find(
    (value) => mutableObject(value)[identityField] === identity,
  );
  if (existing) return mutableObject(existing);
  const created: JsonObject = { [identityField]: identity };
  values.push(created);
  return created;
}

/**
 * Reconstructs only the affected persisted locale leaves. Source-fallback
 * values that are visible in the complete resident projection are never
 * copied into this sparse payload.
 */
export function sparseBlockRoomLocalePayload(
  yDocument: Y.Doc,
  blockId: string,
  values: readonly AIDocumentFieldTarget[],
): JsonValue {
  const rawBase = blockRoomBaseNodes(yDocument).get(blockId);
  if (!(rawBase instanceof Y.Map)) return presenceFail("sparse:block_missing");
  const family = rawBase.get("family");
  const result: JsonObject = {};
  for (const value of values) {
    const target = canonicalTarget(
      canonicalBlockRoomLocaleValueTarget(yDocument, value),
    );
    if (target.blockId !== blockId) return presenceFail("sparse:block_owner");
    const leaf = blockRoomLocaleValue(yDocument, target.target) as JsonValue;
    if (family === "rich_text") {
      if (target.field === "content") {
        result.content = leaf;
        continue;
      }
      if (target.field === "tableContent") {
        const content = mutableObject(result.content);
        result.content = content;
        const rows = (content.rows ??= []) as JsonValue[];
        const row = upsertIdentityItem(rows, "rowId", target.path[1]![1]);
        const cells = (row.cells ??= []) as JsonValue[];
        const cell = upsertIdentityItem(cells, "cellId", target.path[3]![1]);
        cell.content = leaf;
        continue;
      }
      const props = mutableObject(result.props);
      result.props = props;
      props[target.field] = leaf;
      continue;
    }
    if (target.path[0]?.[1] === "props") {
      const props = mutableObject(result.props);
      result.props = props;
      props[target.path[1]![1]] = leaf;
      continue;
    }
    const units = (result.units ??= []) as JsonValue[];
    const unit = upsertIdentityItem(units, "unitId", target.path[1]![1]);
    const props = mutableObject(unit.props);
    unit.props = props;
    props[target.path[3]![1]] = leaf;
  }
  return result;
}
