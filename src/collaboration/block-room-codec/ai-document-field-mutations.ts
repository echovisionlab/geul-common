import type { JsonValue } from "@bufbuild/protobuf";
import {
  pageImmersiveUnitCatalog,
  pageSectionCatalog,
  pageSectionKindByProtoCase,
  pageSectionSettingsCatalog,
  richTextBlockCatalog,
  richTextBlockKindByProtoCase,
  type PageSectionKind,
} from "@echovisionlab/geul-proto/content/block_catalog.ts";
import type {
  AIDocumentFieldTarget,
  AIDocumentValue,
} from "@echovisionlab/geul-proto/secure/ai_pb.ts";
import * as Y from "yjs";
import { fromYValue, isCollaborativeTextPath, toYValue } from "./internal.ts";
import { blockRoomBaseNodes } from "./materialization.ts";
import {
  blockRoomLocaleValueRef,
  deleteBlockRoomLocalePresenceForBlocks,
  markAllBlockRoomLocaleValuesPresentForBlock,
  markBlockRoomLocaleValuePresent,
} from "./locale-presence.ts";
import {
  nodeKind,
  payloadParent,
  roomLocaleRole,
  roomNode,
  type BlockRoomPayloadRef,
} from "./room-access.ts";
import {
  blockTarget,
  operationFail,
  plainValue,
  requiredHandle,
  resolvedCatalogField,
  resolvedPath,
  yPath,
  type CatalogField,
  type JsonPathPart,
} from "./ai-document-values.ts";

type RichTextCatalogEntry = {
  readonly content: string;
  readonly fields: Readonly<Record<string, CatalogField>>;
};

const richTextCatalog = richTextBlockCatalog as Readonly<
  Record<string, RichTextCatalogEntry>
>;

type PageSectionCatalogEntry = {
  readonly fields: Readonly<Record<string, CatalogField>>;
};

const pageCatalog = pageSectionCatalog as Readonly<
  Record<PageSectionKind, PageSectionCatalogEntry>
>;

function ownedFields(
  fields: Readonly<Record<string, CatalogField>>,
  ownerships: ReadonlySet<string>,
): Readonly<Record<string, CatalogField>> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, descriptor]) =>
      ownerships.has(descriptor.ownership as string),
    ),
  );
}

function pageField(
  kind: string,
  field: string,
): { locale: boolean; prefix: JsonPathPart[]; descriptor: CatalogField } {
  const catalogKind =
    pageSectionKindByProtoCase[kind as keyof typeof pageSectionKindByProtoCase];
  if (!catalogKind) return operationFail(`page_kind:${kind}`);
  const fields = pageCatalog[catalogKind].fields;
  if (field === "settings") {
    return {
      locale: false,
      prefix: ["settings"],
      descriptor: {
        type: "object",
        fields: pageSectionSettingsCatalog as Readonly<
          Record<string, CatalogField>
        >,
      },
    };
  }
  const locale = field === "locale-data";
  if (!locale && field !== "data") return operationFail(`field:${field}`);
  const sectionFields =
    catalogKind === "columns"
      ? Object.fromEntries(
          Object.entries(fields).filter(
            ([fieldName]) => fieldName !== "columns",
          ),
        )
      : fields;
  const descriptorFields: Record<string, CatalogField> = {
    props: {
      type: "object",
      fields: ownedFields(
        sectionFields,
        new Set(locale ? ["locale"] : ["shared", "source"]),
      ),
    },
  };
  if (catalogKind === "immersive-scene") {
    const identityField = locale ? "unitId" : "id";
    descriptorFields.units = {
      type: "array",
      item_identity: { strategy: "field", field: identityField },
      items: {
        type: "object",
        fields: {
          [identityField]: { type: "uuid" },
          props: {
            type: "object",
            fields: ownedFields(
              pageImmersiveUnitCatalog as Readonly<
                Record<string, CatalogField>
              >,
              new Set(locale ? ["locale"] : ["shared", "source"]),
            ),
          },
        },
      },
    };
  }
  return {
    locale,
    prefix: [],
    descriptor: { type: "object", fields: descriptorFields },
  };
}

function parsedYPath(path: string): JsonPathPart[] {
  const result: JsonPathPart[] = [];
  for (const segment of path.split(".")) {
    const match = /^([A-Za-z][A-Za-z0-9]*)(?:\[(\d+)\])?$/.exec(segment)!;
    result.push(match[1]!);
    if (match[2] !== undefined) result.push(Number(match[2]));
  }
  return result;
}

function ensureYParent(node: Y.Map<unknown>, path: string): void {
  const parts = parsedYPath(path);
  parts.pop();
  let current: unknown = node.get("payload");
  for (const part of parts) {
    if (typeof part === "string") {
      const parent = current as Y.Map<unknown>;
      let child = parent.get(part);
      if (child === undefined) {
        child = new Y.Map<unknown>();
        parent.set(part, child);
      }
      current = child;
      continue;
    }
    current = (current as Y.Array<unknown>).get(part);
  }
}

function replaceYValue(
  node: Y.Map<unknown>,
  ref: BlockRoomPayloadRef,
  value: JsonValue,
): void {
  const reason = `node:${ref.id}:path:${ref.path}`;
  ensureYParent(node, ref.path);
  const { parent, key } = payloadParent(node, ref.path, reason);
  const current =
    parent instanceof Y.Map
      ? parent.get(key as string)
      : parent.get(key as number);
  const predicate = (path: string): boolean =>
    isCollaborativeTextPath(ref.family, nodeKind(node, ref), path);
  if (current instanceof Y.Text && typeof value === "string") {
    if (current.length > 0) current.delete(0, current.length);
    if (value) current.insert(0, value);
    return;
  }
  if (current instanceof Y.Array && Array.isArray(value)) {
    if (current.length > 0) current.delete(0, current.length);
    if (value.length > 0) {
      current.insert(
        0,
        value.map((child, index) =>
          toYValue(child, `${ref.path}[${index}]`, predicate),
        ),
      );
    }
    return;
  }
  if (
    current instanceof Y.Map &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    for (const child of [...current.keys()]) current.delete(child);
    for (const [child, childValue] of Object.entries(value).sort(
      ([left], [right]) => left.localeCompare(right),
    )) {
      current.set(
        child,
        toYValue(childValue, `${ref.path}.${child}`, predicate),
      );
    }
    return;
  }
  const converted = toYValue(value, ref.path, predicate);
  if (parent instanceof Y.Map) {
    parent.set(key as string, converted);
    return;
  }
  const index = key as number;
  parent.delete(index, 1);
  parent.insert(index, [converted]);
}

function deleteYValue(node: Y.Map<unknown>, ref: BlockRoomPayloadRef): void {
  const { parent, key } = payloadParent(
    node,
    ref.path,
    `node:${ref.id}:path:${ref.path}`,
  );
  if (parent instanceof Y.Map) {
    if (!parent.has(key as string)) operationFail("field_path:missing");
    parent.delete(key as string);
    return;
  }
  const index = key as number;
  parent.delete(index, 1);
}

type TableRecord = Record<string, unknown>;

function tableRecord(value: unknown, reason: string): TableRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return operationFail(reason);
  return value as TableRecord;
}

function tableArray(value: unknown, reason: string): unknown[] {
  if (!Array.isArray(value)) return operationFail(reason);
  return value;
}

function reconcileSourceTableLocale(yDocument: Y.Doc, blockId: string): void {
  const baseNode = roomNode(yDocument, { id: blockId, family: "rich_text" });
  const localeNode = roomNode(yDocument, {
    id: blockId,
    family: "rich_text",
    locale: true,
  });
  const basePayload = tableRecord(
    fromYValue(baseNode.get("payload")),
    "table:base",
  );
  const baseContent = tableRecord(basePayload.content, "table:base_content");
  const localePayload = tableRecord(
    fromYValue(localeNode.get("payload")),
    "table:locale",
  );
  const localeContent = tableRecord(
    localePayload.content,
    "table:locale_content",
  );
  const localeRows = new Map(
    tableArray(localeContent.rows, "table:locale_rows").map((value) => {
      const row = tableRecord(value, "table:locale_row");
      return [String(row.rowId), row] as const;
    }),
  );
  const rows = tableArray(baseContent.rows, "table:base_rows").map((value) => {
    const baseRow = tableRecord(value, "table:base_row");
    const rowId = String(baseRow.id);
    const localeRow = localeRows.get(rowId);
    const localeCells = new Map(
      tableArray(localeRow?.cells ?? [], "table:locale_cells").map(
        (cellValue) => {
          const cell = tableRecord(cellValue, "table:locale_cell");
          return [String(cell.cellId), cell] as const;
        },
      ),
    );
    return {
      rowId,
      cells: tableArray(baseRow.cells, "table:base_cells").map((cellValue) => {
        const cellId = String(tableRecord(cellValue, "table:base_cell").id);
        return {
          cellId,
          content: (localeCells.get(cellId)?.content ?? []) as JsonValue,
        };
      }),
    };
  });
  replaceYValue(
    localeNode,
    { id: blockId, family: "rich_text", locale: true, path: "content" },
    { rows } as JsonValue,
  );
  deleteBlockRoomLocalePresenceForBlocks(yDocument, new Set([blockId]));
  markAllBlockRoomLocaleValuesPresentForBlock(yDocument, blockId);
}

function reconcileSourceImmersiveLocale(
  yDocument: Y.Doc,
  blockId: string,
): void {
  const baseNode = roomNode(yDocument, {
    id: blockId,
    family: "page_section",
  });
  const localeNode = roomNode(yDocument, {
    id: blockId,
    family: "page_section",
    locale: true,
  });
  const basePayload = tableRecord(
    fromYValue(baseNode.get("payload")),
    "immersive:base",
  );
  const localePayload = tableRecord(
    fromYValue(localeNode.get("payload")),
    "immersive:locale",
  );
  const localizedByID = new Map(
    tableArray(localePayload.units, "immersive:locale_units").map((value) => {
      const unit = tableRecord(value, "immersive:locale_unit");
      return [String(unit.unitId), unit] as const;
    }),
  );
  const units = tableArray(basePayload.units, "immersive:base_units").map(
    (value) => {
      const id = String(tableRecord(value, "immersive:base_unit").id);
      return {
        unitId: id,
        props: (localizedByID.get(id)?.props ?? {}) as JsonValue,
      };
    },
  );
  replaceYValue(
    localeNode,
    {
      id: blockId,
      family: "page_section",
      locale: true,
      path: "units",
    },
    units,
  );
  deleteBlockRoomLocalePresenceForBlocks(yDocument, new Set([blockId]));
  markAllBlockRoomLocaleValuesPresentForBlock(yDocument, blockId);
}

function isWholeImmersiveUnitList(
  target: ReturnType<typeof blockTarget>,
): boolean {
  return (
    target.field === "data" &&
    target.path.length === 1 &&
    target.path[0]?.selector.case === "fieldHandle" &&
    target.path[0].selector.value === "units"
  );
}

function sourceTableValue(value: JsonValue): JsonValue {
  const table = tableRecord(value, "table:value");
  return {
    ...table,
    rows: tableArray(table.rows, "table:rows").map((rowValue) => {
      const row = tableRecord(rowValue, "table:row");
      const { rowId, cells, ...rowFields } = row;
      return {
        ...rowFields,
        id: String(rowId),
        cells: tableArray(cells, "table:cells").map((cellValue) => {
          const cell = tableRecord(cellValue, "table:cell");
          const { cellId, ...cellFields } = cell;
          return { ...cellFields, id: String(cellId) };
        }),
      };
    }),
  } as JsonValue;
}

function richField(
  kind: string,
  field: string,
): { locale: boolean; prefix: JsonPathPart[]; descriptor?: CatalogField } {
  const catalogKind =
    richTextBlockKindByProtoCase[
      kind as keyof typeof richTextBlockKindByProtoCase
    ];
  const catalog = richTextCatalog[catalogKind!]!;
  if (field === "content") {
    if (catalog.content !== "inline" && catalog.content !== "locale_text")
      return operationFail(`field:${field}`);
    return { locale: true, prefix: ["content"] };
  }
  if (field === "table" && catalog.content === "table")
    return { locale: false, prefix: ["content"] };
  if (field === "tableContent" && catalog.content === "table")
    return { locale: true, prefix: ["content"] };
  const descriptor = catalog.fields[field];
  if (!descriptor) return operationFail(`field:${field}`);
  return {
    locale: descriptor.ownership === "locale",
    prefix: ["props", field],
    descriptor,
  };
}

function fieldRef(
  yDocument: Y.Doc,
  target: ReturnType<typeof blockTarget>,
  targetValue: AIDocumentFieldTarget | undefined,
  createMissing: boolean,
): {
  ref: BlockRoomPayloadRef;
  descriptor?: CatalogField;
  fieldName: string;
  locale: boolean;
} {
  const base = blockRoomBaseNodes(yDocument).get(target.blockId);
  if (!(base instanceof Y.Map))
    return operationFail(`block:${target.blockId}:missing`);
  const family = base.get("family") as "page_section" | "rich_text";
  const kind = base.get("kind") as string;
  const { locale, prefix, descriptor } =
    family === "page_section"
      ? pageField(kind, target.field)
      : richField(kind, target.field);
  if (target.field === "tableContent") {
    return {
      ref: blockRoomLocaleValueRef(yDocument, targetValue),
      fieldName: "content",
      locale: true,
    };
  }
  const node = roomNode(yDocument, {
    id: target.blockId,
    family,
    ...(locale ? { locale: true as const } : {}),
  });
  const payload = fromYValue(node.get("payload"));
  const path = resolvedPath(
    payload,
    prefix,
    target.path,
    createMissing,
    descriptor,
    target.field,
  );
  const fieldName = target.path.reduce(
    (name, segment) =>
      segment.selector.case === "fieldHandle"
        ? requiredHandle(segment.selector.value, "field_path:field_handle")
        : name,
    target.field,
  );
  return {
    ref: {
      id: target.blockId,
      family,
      ...(locale ? { locale: true as const } : {}),
      path: yPath(path),
    },
    descriptor: resolvedCatalogField(descriptor, target.path),
    fieldName,
    locale,
  };
}

export function setAIDocumentField(
  yDocument: Y.Doc,
  targetValue: AIDocumentFieldTarget | undefined,
  value: AIDocumentValue | undefined,
): void {
  const target = blockTarget(targetValue);
  const { ref, descriptor, fieldName, locale } = fieldRef(
    yDocument,
    target,
    targetValue,
    true,
  );
  const node = roomNode(yDocument, ref);
  const next = plainValue(value, descriptor, fieldName);
  if (
    locale &&
    roomLocaleRole(yDocument) === "target" &&
    (descriptor?.type === "object" || descriptor?.type === "array")
  ) {
    operationFail("target_locale_scalar_required");
  }
  replaceYValue(
    node,
    ref,
    target.field === "table" ? sourceTableValue(next) : next,
  );
  if (target.field === "table" && roomLocaleRole(yDocument) === "source") {
    reconcileSourceTableLocale(yDocument, target.blockId);
    return;
  }
  if (
    isWholeImmersiveUnitList(target) &&
    roomLocaleRole(yDocument) === "source"
  ) {
    reconcileSourceImmersiveLocale(yDocument, target.blockId);
    return;
  }
  if (locale) {
    if (descriptor?.type === "object" || descriptor?.type === "array") {
      markAllBlockRoomLocaleValuesPresentForBlock(yDocument, target.blockId);
      return;
    }
    markBlockRoomLocaleValuePresent(yDocument, targetValue);
  }
}

export function unsetAIDocumentField(
  yDocument: Y.Doc,
  targetValue: AIDocumentFieldTarget | undefined,
): void {
  const target = blockTarget(targetValue);
  const { ref } = fieldRef(yDocument, target, targetValue, false);
  deleteYValue(roomNode(yDocument, ref), ref);
}

export function attachAIDocumentFile(
  yDocument: Y.Doc,
  targetValue: AIDocumentFieldTarget | undefined,
  file: string,
): void {
  const target = blockTarget(targetValue);
  const { ref, descriptor } = fieldRef(yDocument, target, targetValue, true);
  if (descriptor?.type !== "file_attachment") operationFail("file:field");
  replaceYValue(roomNode(yDocument, ref), ref, {
    activeFileId: requiredHandle(file, "file:handle"),
  });
}

export function detachAIDocumentFile(
  yDocument: Y.Doc,
  targetValue: AIDocumentFieldTarget | undefined,
): void {
  const target = blockTarget(targetValue);
  const { ref, descriptor } = fieldRef(yDocument, target, targetValue, false);
  if (descriptor?.type !== "file_attachment") operationFail("file:field");
  deleteYValue(roomNode(yDocument, ref), ref);
}
