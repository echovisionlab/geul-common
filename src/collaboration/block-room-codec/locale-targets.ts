import { create } from "@bufbuild/protobuf";
import {
  pageImmersiveUnitCatalog,
  pageSectionCatalog,
  pageSectionKindByProtoCase,
  richTextBlockCatalog,
  richTextBlockKindByProtoCase,
} from "@echovisionlab/geul-proto/content/block_catalog.ts";
import {
  AIDocumentFieldPathSegmentSchema,
  AIDocumentFieldTargetSchema,
  type AIDocumentFieldPathSegment,
  type AIDocumentFieldTarget,
} from "@echovisionlab/geul-proto/secure/ai_pb.ts";
import * as Y from "yjs";
import { fail, fromYValue, type JsonObject } from "./internal.ts";
import {
  blockRoomBaseNodes,
  blockRoomLocaleOverlay,
} from "./materialization.ts";
import { roomDocumentType, type BlockRoomPayloadRef } from "./room-access.ts";
import {
  resolvedPath,
  yPath,
  type CatalogField,
  type JsonPathPart,
} from "./ai-document-values.ts";

const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type CatalogEntry = {
  readonly content?: string;
  readonly fields: Readonly<Record<string, CatalogField>>;
};

export type CanonicalPathSegment = readonly ["field" | "item", string];

export interface CanonicalLocaleValueTarget {
  target: AIDocumentFieldTarget;
  key: string;
  blockId: string;
  field: string;
  path: readonly CanonicalPathSegment[];
}

export function presenceFail(reason: string): never {
  return fail(`locale_presence:${reason}`);
}

function requiredHandle(value: string, reason: string): string {
  return value ? value : presenceFail(reason);
}

function canonicalPath(
  path: readonly AIDocumentFieldPathSegment[],
): CanonicalPathSegment[] {
  return path.map(({ selector }) => {
    if (selector.case === "fieldHandle")
      return ["field", requiredHandle(selector.value, "path:field")] as const;
    if (selector.case === "itemHandle")
      return ["item", requiredHandle(selector.value, "path:item")] as const;
    return presenceFail("path:selector");
  });
}

export function targetFromParts(
  blockId: string,
  field: string,
  path: readonly CanonicalPathSegment[],
): AIDocumentFieldTarget {
  return create(AIDocumentFieldTargetSchema, {
    owner: { case: "blockHandle", value: blockId },
    fieldHandle: field,
    path: path.map(([kind, value]) =>
      create(AIDocumentFieldPathSegmentSchema, {
        selector:
          kind === "field"
            ? { case: "fieldHandle", value }
            : { case: "itemHandle", value },
      }),
    ),
  });
}

export function canonicalTarget(
  value: AIDocumentFieldTarget | undefined,
): CanonicalLocaleValueTarget {
  if (!value) return presenceFail("target:missing");
  if (value.owner.case !== "blockHandle")
    return presenceFail("target:relation_item");
  const blockId = requiredHandle(value.owner.value, "target:block");
  if (!CANONICAL_UUID_PATTERN.test(blockId))
    return presenceFail("target:block_uuid");
  const field = requiredHandle(value.fieldHandle, "target:field");
  const path = canonicalPath(value.path);
  const target = targetFromParts(blockId, field, path);
  return {
    target,
    key: JSON.stringify([blockId, field, path]),
    blockId,
    field,
    path,
  };
}

function pathField(
  path: readonly CanonicalPathSegment[],
  index: number,
  expected: string,
): boolean {
  return path[index]?.[0] === "field" && path[index]?.[1] === expected;
}

export function localeScalar(
  descriptor: CatalogField | undefined,
): CatalogField {
  if (!descriptor) return presenceFail("catalog:field");
  if (descriptor.type === "object" || descriptor.type === "array")
    return presenceFail("catalog:composite_terminal");
  if (descriptor.type === "file_attachment")
    return presenceFail("catalog:file_terminal");
  if (descriptor.ownership !== "locale")
    return presenceFail("catalog:ownership");
  return descriptor;
}

function jsonRecord(value: unknown, reason: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return presenceFail(reason);
  return value as JsonObject;
}

function jsonArray(value: unknown, reason: string): unknown[] {
  return Array.isArray(value) ? value : presenceFail(reason);
}

function assertTableLeaf(
  basePayload: unknown,
  path: readonly CanonicalPathSegment[],
): void {
  if (
    path.length !== 5 ||
    !pathField(path, 0, "rows") ||
    path[1]?.[0] !== "item" ||
    !pathField(path, 2, "cells") ||
    path[3]?.[0] !== "item" ||
    !pathField(path, 4, "content")
  )
    return presenceFail("table:path");
  const rows = jsonArray(
    jsonRecord(
      jsonRecord(basePayload, "table:payload").content,
      "table:content",
    ).rows,
    "table:rows",
  );
  const row = rows.find(
    (candidate) => jsonRecord(candidate, "table:row").id === path[1]![1],
  );
  if (!row) return presenceFail("table:row_handle");
  const cells = jsonArray(jsonRecord(row, "table:row").cells, "table:cells");
  if (
    !cells.some(
      (candidate) => jsonRecord(candidate, "table:cell").id === path[3]![1],
    )
  )
    return presenceFail("table:cell_handle");
}

function resolvedTablePath(
  basePayload: unknown,
  path: readonly CanonicalPathSegment[],
): JsonPathPart[] {
  assertTableLeaf(basePayload, path);
  const rows = jsonArray(
    jsonRecord(
      jsonRecord(basePayload, "table:payload").content,
      "table:content",
    ).rows,
    "table:rows",
  );
  const rowIndex = rows.findIndex(
    (candidate) => jsonRecord(candidate, "table:row").id === path[1]![1],
  );
  const row = rows[rowIndex]!;
  const cells = jsonArray(jsonRecord(row, "table:row").cells, "table:cells");
  const cellIndex = cells.findIndex(
    (candidate) => jsonRecord(candidate, "table:cell").id === path[3]![1],
  );
  return ["content", "rows", rowIndex, "cells", cellIndex, "content"];
}

function assertRichTextLeaf(
  kind: string,
  basePayload: unknown,
  field: string,
  path: readonly CanonicalPathSegment[],
): void {
  const catalogKind =
    richTextBlockKindByProtoCase[
      kind as keyof typeof richTextBlockKindByProtoCase
    ];
  const catalog = (
    richTextBlockCatalog as Readonly<Record<string, CatalogEntry>>
  )[catalogKind!];
  if (!catalog) return presenceFail("catalog:block_kind");
  if (field === "content") {
    if (
      path.length !== 0 ||
      (catalog.content !== "inline" && catalog.content !== "locale_text")
    )
      return presenceFail("catalog:content");
    return;
  }
  if (field === "tableContent") {
    if (catalog.content !== "table") return presenceFail("catalog:table");
    assertTableLeaf(basePayload, path);
    return;
  }
  if (field === "table") return presenceFail("catalog:shared_table");
  if (path.length !== 0) return presenceFail("catalog:path");
  localeScalar(catalog.fields[field]);
}

function assertPageLeaf(
  kind: string,
  basePayload: unknown,
  field: string,
  path: readonly CanonicalPathSegment[],
): void {
  if (field !== "locale-data") return presenceFail("page:field");
  const catalogKind =
    pageSectionKindByProtoCase[kind as keyof typeof pageSectionKindByProtoCase];
  const catalog = (
    pageSectionCatalog as Readonly<Record<string, CatalogEntry>>
  )[catalogKind!];
  if (!catalog) return presenceFail("page:kind");
  if (
    path.length === 2 &&
    pathField(path, 0, "props") &&
    path[1]?.[0] === "field"
  ) {
    localeScalar(catalog.fields[path[1][1]]);
    return;
  }
  if (
    catalogKind === "immersive-scene" &&
    path.length === 4 &&
    pathField(path, 0, "units") &&
    path[1]?.[0] === "item" &&
    pathField(path, 2, "props") &&
    path[3]?.[0] === "field"
  ) {
    const units = jsonArray(
      jsonRecord(basePayload, "page:payload").units,
      "page:units",
    );
    if (!units.some((unit) => jsonRecord(unit, "page:unit").id === path[1]![1]))
      return presenceFail("page:unit_handle");
    localeScalar(
      (pageImmersiveUnitCatalog as Readonly<Record<string, CatalogField>>)[
        path[3][1]
      ],
    );
    return;
  }
  return presenceFail("page:path");
}

export function canonicalBlockRoomLocaleValueTarget(
  yDocument: Y.Doc,
  value: AIDocumentFieldTarget | undefined,
): AIDocumentFieldTarget {
  const canonical = canonicalTarget(value);
  const rawNode = blockRoomBaseNodes(yDocument).get(canonical.blockId);
  if (!(rawNode instanceof Y.Map)) return presenceFail("target:block_missing");
  const family = rawNode.get("family");
  const kind = rawNode.get("kind");
  if (typeof kind !== "string") return presenceFail("target:block_kind");
  const payload = fromYValue(rawNode.get("payload"));
  if (family === "rich_text") {
    assertRichTextLeaf(kind, payload, canonical.field, canonical.path);
  } else if (family === "page_section") {
    if (roomDocumentType(yDocument) !== "page")
      return presenceFail("target:block_family");
    assertPageLeaf(kind, payload, canonical.field, canonical.path);
  } else {
    return presenceFail("target:block_family");
  }
  return canonical.target;
}

export function blockRoomLocaleValueRef(
  yDocument: Y.Doc,
  value: AIDocumentFieldTarget | undefined,
): BlockRoomPayloadRef {
  const target = canonicalTarget(
    canonicalBlockRoomLocaleValueTarget(yDocument, value),
  );
  const rawNode = blockRoomBaseNodes(yDocument).get(
    target.blockId,
  ) as Y.Map<unknown>;
  const family = rawNode.get("family") as "rich_text" | "page_section";
  const kind = rawNode.get("kind") as string;
  const basePayload = fromYValue(rawNode.get("payload"));
  const localeNode = blockRoomLocaleOverlay(yDocument).get(target.blockId);
  if (!(localeNode instanceof Y.Map))
    return presenceFail("target:locale_missing");
  const localePayload = fromYValue(localeNode.get("payload"));
  let path: JsonPathPart[];
  if (family === "rich_text") {
    const catalogKind =
      richTextBlockKindByProtoCase[
        kind as keyof typeof richTextBlockKindByProtoCase
      ];
    const catalog = (
      richTextBlockCatalog as Readonly<Record<string, CatalogEntry>>
    )[catalogKind!]!;
    if (target.field === "content") path = ["content"];
    else if (target.field === "tableContent")
      path = resolvedTablePath(basePayload, target.path);
    else {
      path = resolvedPath(
        localePayload,
        ["props", target.field],
        target.target.path,
        false,
        catalog.fields[target.field],
        target.field,
      );
    }
  } else if (pathField(target.path, 0, "props")) {
    const field = target.path[1]![1];
    const catalogKind =
      pageSectionKindByProtoCase[
        kind as keyof typeof pageSectionKindByProtoCase
      ];
    const catalog = (
      pageSectionCatalog as Readonly<Record<string, CatalogEntry>>
    )[catalogKind!]!;
    path = resolvedPath(
      localePayload,
      ["props", field],
      target.target.path.slice(2),
      false,
      catalog.fields[field],
      field,
    );
  } else {
    const units = jsonArray(
      jsonRecord(basePayload, "page:payload").units,
      "page:units",
    );
    const unitIndex = units.findIndex(
      (unit) => jsonRecord(unit, "page:unit").id === target.path[1]![1],
    );
    const field = target.path[3]![1];
    path = resolvedPath(
      localePayload,
      ["units", unitIndex, "props", field],
      target.target.path.slice(4),
      false,
      (pageImmersiveUnitCatalog as Readonly<Record<string, CatalogField>>)[
        field
      ],
      field,
    );
  }
  return { id: target.blockId, family, locale: true, path: yPath(path) };
}

export function canonicalBlockRoomLocaleValueTargetKey(
  yDocument: Y.Doc,
  value: AIDocumentFieldTarget | undefined,
): string {
  return canonicalTarget(canonicalBlockRoomLocaleValueTarget(yDocument, value))
    .key;
}

/** Validates, canonicalizes, sorts, and deduplicates locale leaf targets. */
export function canonicalBlockRoomLocaleValueTargets(
  yDocument: Y.Doc,
  values: readonly AIDocumentFieldTarget[],
): AIDocumentFieldTarget[] {
  return [
    ...new Map(
      values.map((value) => {
        const target = canonicalBlockRoomLocaleValueTarget(yDocument, value);
        return [canonicalTarget(target).key, target] as const;
      }),
    ).entries(),
  ]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, target]) => target);
}

export function blockRoomLocaleValueTargetIdentity(
  value: AIDocumentFieldTarget | undefined,
): string {
  return canonicalTarget(value).key;
}

export function blockRoomLocaleValueTargetBlockId(
  value: AIDocumentFieldTarget | undefined,
): string {
  return canonicalTarget(value).blockId;
}

function scalarLocaleCatalogFields(
  fields: Readonly<Record<string, CatalogField>>,
): string[] {
  return Object.entries(fields)
    .filter(
      ([, descriptor]) =>
        descriptor.ownership === "locale" &&
        descriptor.type !== "object" &&
        descriptor.type !== "array" &&
        descriptor.type !== "file_attachment",
    )
    .map(([field]) => field)
    .sort();
}

export function allBlockRoomLocaleValueTargets(
  yDocument: Y.Doc,
): AIDocumentFieldTarget[] {
  const targets: AIDocumentFieldTarget[] = [];
  for (const [blockId, rawNode] of [
    ...blockRoomBaseNodes(yDocument).entries(),
  ].sort(([left], [right]) => left.localeCompare(right))) {
    const node = rawNode as Y.Map<unknown>;
    const family = node.get("family");
    const kind = node.get("kind") as string;
    const payload = fromYValue(node.get("payload"));
    if (family === "rich_text") {
      const catalogKind =
        richTextBlockKindByProtoCase[
          kind as keyof typeof richTextBlockKindByProtoCase
        ];
      const catalog = (
        richTextBlockCatalog as Readonly<Record<string, CatalogEntry>>
      )[catalogKind!]!;
      if (catalog.content === "inline" || catalog.content === "locale_text")
        targets.push(targetFromParts(blockId, "content", []));
      if (catalog.content === "table") {
        const rows = jsonArray(
          jsonRecord(
            jsonRecord(payload, "table:payload").content,
            "table:content",
          ).rows,
          "table:rows",
        );
        for (const row of rows) {
          const rowRecord = jsonRecord(row, "table:row");
          const rowId = String(rowRecord.id);
          for (const cell of jsonArray(rowRecord.cells, "table:cells")) {
            const cellId = String(jsonRecord(cell, "table:cell").id);
            targets.push(
              targetFromParts(blockId, "tableContent", [
                ["field", "rows"],
                ["item", rowId],
                ["field", "cells"],
                ["item", cellId],
                ["field", "content"],
              ]),
            );
          }
        }
      }
      for (const field of scalarLocaleCatalogFields(catalog.fields))
        targets.push(targetFromParts(blockId, field, []));
      continue;
    }
    const catalogKind =
      pageSectionKindByProtoCase[
        kind as keyof typeof pageSectionKindByProtoCase
      ];
    const catalog = (
      pageSectionCatalog as Readonly<Record<string, CatalogEntry>>
    )[catalogKind!]!;
    for (const field of scalarLocaleCatalogFields(catalog.fields))
      targets.push(
        targetFromParts(blockId, "locale-data", [
          ["field", "props"],
          ["field", field],
        ]),
      );
    if (catalogKind === "immersive-scene") {
      const fields = scalarLocaleCatalogFields(
        pageImmersiveUnitCatalog as Readonly<Record<string, CatalogField>>,
      );
      const rawUnits = jsonRecord(payload, "page:payload").units;
      const units =
        rawUnits === undefined ? [] : jsonArray(rawUnits, "page:units");
      for (const unit of units) {
        const unitId = String(jsonRecord(unit, "page:unit").id);
        for (const field of fields)
          targets.push(
            targetFromParts(blockId, "locale-data", [
              ["field", "units"],
              ["item", unitId],
              ["field", "props"],
              ["field", field],
            ]),
          );
      }
    }
  }
  return targets.sort((left, right) =>
    canonicalTarget(left).key.localeCompare(canonicalTarget(right).key),
  );
}
