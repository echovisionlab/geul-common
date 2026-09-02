import { fromJson, type JsonValue } from "@bufbuild/protobuf";
import {
  pageSectionKindByProtoCase,
  type PageSectionKind,
} from "@echovisionlab/geul-proto/content/block_catalog.ts";
import {
  PageSectionLocaleSchema,
  PageSectionNodeSchema,
  type PageSectionLocale,
  type PageSectionNode,
} from "@echovisionlab/geul-proto/content/block_content_pb.ts";
import type { AIDocumentOperation } from "@echovisionlab/geul-proto/secure/ai_pb.ts";
import * as Y from "yjs";
import {
  arrayPath,
  fromYValue,
  jsonObject,
  setNodePayload,
  toYValue,
  yMap,
} from "./internal.ts";
import {
  blockTarget,
  operationFail,
  plainValue,
  requiredHandle,
} from "./ai-document-values.ts";
import {
  blockRoomBaseNodes,
  blockRoomBaseOrder,
  decodeBaseNodes,
  type BlockRoomBaseNodeSnapshot,
} from "./materialization.ts";
import { setBlockRoomAtomicValue } from "./payload-mutations.ts";
import {
  roomLocaleRole,
  roomNode,
  type BlockRoomPayloadRef,
} from "./room-access.ts";
import {
  deleteBlockRoomLocalePresenceForBlocks,
  markAllBlockRoomLocaleValuesPresentForBlock,
} from "./locale-presence.ts";
import {
  deleteBlockRoomBaseNode,
  insertPageSectionLocale,
  insertPageSectionNode,
  movePageSectionNode,
} from "./structure-mutations.ts";

const PAGE_COLUMN_KIND = "page-column";
const pageSectionProtoCaseByKind = new Map<string, string>(
  Object.entries(pageSectionKindByProtoCase).map(([protoCase, kind]) => [
    kind,
    protoCase,
  ]),
);

interface PageColumnLocation {
  sectionId: string;
  index: number;
  id: string;
}

function pageBaseNodes(yDocument: Y.Doc): BlockRoomBaseNodeSnapshot[] {
  return [
    ...decodeBaseNodes(
      blockRoomBaseNodes(yDocument),
      blockRoomBaseOrder(yDocument),
    ).values(),
  ];
}

function pageColumns(node: BlockRoomBaseNodeSnapshot): JsonValue[] {
  if (node.family !== "page_section" || node.kind !== "columns") return [];
  const payload = jsonObject(node.payload, `page_columns:${node.id}:payload`);
  const props = payload.props;
  if (props === undefined) return [];
  const columns = jsonObject(props, `page_columns:${node.id}:props`).columns;
  if (columns === undefined) return [];
  return Array.isArray(columns)
    ? columns
    : operationFail(`page_columns:${node.id}:shape`);
}

function findPageColumn(
  yDocument: Y.Doc,
  columnId: string,
): PageColumnLocation | undefined {
  for (const node of pageBaseNodes(yDocument)) {
    const columns = pageColumns(node);
    const index = columns.findIndex(
      (value) =>
        jsonObject(value, `page_column:${node.id}:entry`).id === columnId,
    );
    if (index >= 0) return { sectionId: node.id, index, id: columnId };
  }
  return undefined;
}

function pageColumnsArray(
  yDocument: Y.Doc,
  sectionId: string,
  create: boolean,
): Y.Array<unknown> {
  const node = roomNode(yDocument, {
    id: sectionId,
    family: "page_section",
  });
  if (node.get("kind") !== "columns")
    return operationFail(`page_column:parent:${sectionId}`);
  const payload = yMap(node.get("payload"), `page_column:${sectionId}:payload`);
  let props = payload.get("props");
  if (props === undefined && create) {
    props = new Y.Map<unknown>();
    payload.set("props", props);
  }
  const propsMap = yMap(props, `page_column:${sectionId}:props`);
  let columns = propsMap.get("columns");
  if (columns === undefined && create) {
    columns = new Y.Array<unknown>();
    propsMap.set("columns", columns);
  }
  return columns as Y.Array<unknown>;
}

function insertionIndex(
  ids: readonly string[],
  afterId: string | undefined,
): number {
  if (afterId === undefined) return 0;
  const after = ids.indexOf(afterId);
  return after < 0
    ? operationFail(`after_block:${afterId}:not_sibling`)
    : after + 1;
}

function pageSectionPlacement(
  yDocument: Y.Doc,
  parentHandle: string | undefined,
  afterHandle: string | undefined,
  movingId?: string,
): {
  parentSectionId?: string;
  columnId?: string;
  index: number;
} {
  const nodes = pageBaseNodes(yDocument);
  let parentSectionId: string | undefined;
  let columnId: string | undefined;
  if (parentHandle) {
    const column = findPageColumn(yDocument, parentHandle);
    if (!column) return operationFail(`page_parent:${parentHandle}:not_column`);
    parentSectionId = column.sectionId;
    columnId = column.id;
  }
  const siblings = nodes
    .filter(
      (node) =>
        node.family === "page_section" &&
        node.id !== movingId &&
        node.parentId === (parentSectionId ?? null) &&
        node.columnId === columnId,
    )
    .sort((left, right) => left.position - right.position);
  return {
    ...(parentSectionId ? { parentSectionId } : {}),
    ...(columnId ? { columnId } : {}),
    index: insertionIndex(
      siblings.map(({ id }) => id),
      afterHandle,
    ),
  };
}

function insertPageSection(
  yDocument: Y.Doc,
  blockId: string,
  kind: string,
  parentHandle: string | undefined,
  afterHandle: string | undefined,
): void {
  if (findPageColumn(yDocument, blockId))
    return operationFail(`page_section:${blockId}:column_exists`);
  const protoCase = pageSectionProtoCaseByKind.get(kind)!;
  const placement = pageSectionPlacement(yDocument, parentHandle, afterHandle);
  const node = fromJson(PageSectionNodeSchema, {
    section: { id: blockId, settings: {}, [protoCase]: {} },
    placement,
  }) as PageSectionNode;
  const locale = fromJson(PageSectionLocaleSchema, {
    sectionId: blockId,
    [protoCase]: {},
  }) as PageSectionLocale;
  insertPageSectionNode(yDocument, node);
  insertPageSectionLocale(yDocument, locale);
}

function insertPageColumn(
  yDocument: Y.Doc,
  blockId: string,
  parentHandle: string | undefined,
  afterHandle: string | undefined,
): void {
  const parent = requiredHandle(parentHandle ?? "", "page_column:parent");
  const nodes = pageBaseNodes(yDocument);
  if (
    nodes.some(({ id }) => id === blockId) ||
    findPageColumn(yDocument, blockId)
  ) {
    return operationFail(`page_column:${blockId}:exists`);
  }
  const columns = pageColumnsArray(yDocument, parent, true);
  const ids = columns.toArray().map((value) => {
    const object = jsonObject(fromYValue(value), `page_column:${parent}:entry`);
    return String(object.id ?? "");
  });
  const index = insertionIndex(ids, afterHandle);
  columns.insert(index, [
    toYValue(
      { id: blockId, ratio: 1 },
      arrayPath("props.columns", index),
      () => false,
    ),
  ]);
}

function setPageColumnField(
  yDocument: Y.Doc,
  column: PageColumnLocation,
  operation: Extract<
    AIDocumentOperation["operation"],
    { case: "setField" }
  >["value"],
): void {
  const target = blockTarget(operation.target);
  if (
    target.field !== "ratio" ||
    target.path.length !== 0 ||
    operation.value?.value.case !== "number"
  ) {
    return operationFail("page_column:ratio");
  }
  const value = plainValue(operation.value, { type: "number" }, "ratio");
  const ref: BlockRoomPayloadRef = {
    id: column.sectionId,
    family: "page_section",
    path: `props.columns[${column.index}].ratio`,
  };
  setBlockRoomAtomicValue(yDocument, ref, value as number);
}

function deletePageColumn(yDocument: Y.Doc, column: PageColumnLocation): void {
  if (pageBaseNodes(yDocument).some(({ columnId }) => columnId === column.id))
    return operationFail(`page_column:${column.id}:not_empty`);
  pageColumnsArray(yDocument, column.sectionId, false).delete(column.index, 1);
}

function movePageColumn(
  yDocument: Y.Doc,
  column: PageColumnLocation,
  parentHandle: string | undefined,
  afterHandle: string | undefined,
): void {
  if (parentHandle !== column.sectionId)
    return operationFail(`page_column:${column.id}:parent`);
  const columns = pageColumnsArray(yDocument, column.sectionId, false);
  const remaining = columns
    .toArray()
    .map((value) =>
      String(
        jsonObject(fromYValue(value), `page_column:${column.sectionId}:entry`)
          .id ?? "",
      ),
    )
    .filter((id) => id !== column.id);
  const index = insertionIndex(remaining, afterHandle);
  const value = fromYValue(columns.get(column.index));
  columns.delete(column.index, 1);
  columns.insert(index, [
    toYValue(value, arrayPath("props.columns", index), () => false),
  ]);
}

function replacePageSectionKind(
  yDocument: Y.Doc,
  sectionId: string,
  kind: string,
): void {
  const protoCase = pageSectionProtoCaseByKind.get(kind);
  if (!protoCase) return operationFail(`page_section:kind:${kind}`);
  const nodes = pageBaseNodes(yDocument);
  const section = nodes.find(
    ({ id, family }) => id === sectionId && family === "page_section",
  )!;
  const hasChildren = nodes.some(
    ({ id, parentId }) => id !== sectionId && parentId === sectionId,
  );
  if (hasChildren || pageColumns(section).length > 0)
    return operationFail(`page_section:${sectionId}:not_empty`);
  const payload = jsonObject(
    section.payload,
    `page_section:${sectionId}:payload`,
  );
  let nextPayload: JsonValue = {};
  if (payload.settings !== undefined)
    nextPayload = { settings: payload.settings };
  const baseNode = roomNode(yDocument, {
    id: sectionId,
    family: "page_section",
  });
  const localeNode = roomNode(yDocument, {
    id: sectionId,
    family: "page_section",
    locale: true,
  });
  deleteBlockRoomLocalePresenceForBlocks(yDocument, new Set([sectionId]));
  setNodePayload(baseNode, "page_section", protoCase, nextPayload);
  setNodePayload(localeNode, "page_section", protoCase, {});
  if (roomLocaleRole(yDocument) === "source")
    markAllBlockRoomLocaleValuesPresentForBlock(yDocument, sectionId);
}

type PageTargetOperation = Extract<
  AIDocumentOperation["operation"],
  {
    case:
      | "setField"
      | "unsetField"
      | "attachFile"
      | "detachFile"
      | "deleteBlock"
      | "moveBlock"
      | "replaceBlockKind";
  }
>;

function targetedPageOperation(
  operation: AIDocumentOperation,
): { target: string; operation: PageTargetOperation } | undefined {
  switch (operation.operation.case) {
    case "setField":
    case "unsetField":
    case "attachFile":
    case "detachFile":
      return {
        target: blockTarget(operation.operation.value.target).blockId,
        operation: operation.operation,
      };
    case "deleteBlock":
    case "moveBlock":
    case "replaceBlockKind":
      return {
        target: operation.operation.value.blockHandle,
        operation: operation.operation,
      };
    default:
      return undefined;
  }
}

/** Applies only Page section and Page-column operations; nested Rich Text falls through. */
export function applyPageStructureAIDocumentOperation(
  yDocument: Y.Doc,
  operation: AIDocumentOperation,
): boolean {
  if (operation.operation.case === "insertBlock") {
    const value = operation.operation.value;
    const id = requiredHandle(value.blockHandle, "insert:block");
    const kind = requiredHandle(value.kind, "insert:kind");
    if (kind === PAGE_COLUMN_KIND) {
      insertPageColumn(
        yDocument,
        id,
        value.parentBlockHandle,
        value.afterBlockHandle,
      );
      return true;
    }
    if (pageSectionProtoCaseByKind.has(kind)) {
      insertPageSection(
        yDocument,
        id,
        kind as PageSectionKind,
        value.parentBlockHandle,
        value.afterBlockHandle,
      );
      return true;
    }
    return false;
  }
  const targeted = targetedPageOperation(operation);
  if (!targeted) return false;
  const { target } = targeted;
  const column = findPageColumn(yDocument, target);
  if (column) {
    switch (targeted.operation.case) {
      case "setField":
        setPageColumnField(yDocument, column, targeted.operation.value);
        return true;
      case "deleteBlock":
        deletePageColumn(yDocument, column);
        return true;
      case "moveBlock":
        movePageColumn(
          yDocument,
          column,
          targeted.operation.value.parentBlockHandle,
          targeted.operation.value.afterBlockHandle,
        );
        return true;
      case "unsetField":
        operationFail("page_column:ratio_required");
      case "replaceBlockKind":
        operationFail("page_column:replace_kind");
      case "attachFile":
      case "detachFile":
        operationFail("page_column:file");
    }
  }
  const node = pageBaseNodes(yDocument).find(({ id }) => id === target);
  if (!node || node.family !== "page_section") return false;
  switch (targeted.operation.case) {
    case "deleteBlock":
      deleteBlockRoomBaseNode(yDocument, target);
      return true;
    case "moveBlock":
      movePageSectionNode(
        yDocument,
        target,
        pageSectionPlacement(
          yDocument,
          targeted.operation.value.parentBlockHandle,
          targeted.operation.value.afterBlockHandle,
          target,
        ),
      );
      return true;
    case "replaceBlockKind":
      replacePageSectionKind(
        yDocument,
        target,
        requiredHandle(targeted.operation.value.kind, "replace:kind"),
      );
      return true;
    default:
      return false;
  }
}
