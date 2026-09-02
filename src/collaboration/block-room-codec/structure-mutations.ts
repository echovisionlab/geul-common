import { toJson } from "@bufbuild/protobuf";
import {
  PageSectionLocaleSchema,
  PageSectionNodeSchema,
  RichTextBlockLocaleSchema,
  RichTextBlockNodeSchema,
  type PageSectionLocale,
  type PageSectionNode,
  type RichTextBlockLocale,
  type RichTextBlockNode,
} from "@echovisionlab/geul-proto/content/block_content_pb.ts";
import * as Y from "yjs";
import {
  fail,
  integerValue,
  jsonObject,
  oneofPayload,
  orderContainerKey,
  pageSectionPayload,
  pageSectionSlot,
  richTextSlot,
  setNodePayload,
  stringValue,
  withoutField,
  type BlockRoomNodeFamily,
} from "./internal.ts";
import {
  blockRoomBaseNodes,
  blockRoomBaseOrder,
  blockRoomLocaleOverlay,
  decodeBaseNodes,
  type BlockRoomBaseNodeSnapshot,
} from "./materialization.ts";
import {
  roomDocumentType,
  roomLocaleRole,
  roomNode,
  type BlockRoomAnchoredMutationOptions,
  type BlockRoomMutationOptions,
} from "./room-access.ts";
import {
  deleteBlockRoomLocalePresenceForBlocks,
  markAllBlockRoomLocaleValuesPresentForBlock,
} from "./locale-presence.ts";

export interface BlockRoomContainerRef {
  parentId: string | null;
  containerSlot: string;
}

function orderArray(
  yDocument: Y.Doc,
  container: BlockRoomContainerRef,
  create: boolean,
): Y.Array<string> {
  const orders = blockRoomBaseOrder(yDocument);
  const key = orderContainerKey(container.parentId, container.containerSlot);
  const existing = orders.get(key);
  if (existing !== undefined)
    return existing instanceof Y.Array
      ? existing
      : fail(`base_order:${key}:not_array`);
  if (!create) return fail(`base_order:${key}:missing`);
  const order = new Y.Array<string>();
  orders.set(key, order);
  return order;
}

export function createBlockRoomInsertionAnchor(
  yDocument: Y.Doc,
  container: BlockRoomContainerRef,
  index: number,
): Y.RelativePosition {
  const order = orderArray(yDocument, container, false);
  if (!Number.isSafeInteger(index) || index < 0 || index > order.length) {
    return fail("base_order:anchor_index");
  }
  return Y.createRelativePositionFromTypeIndex(order, index);
}

function insertionIndex(
  yDocument: Y.Doc,
  order: Y.Array<string>,
  fallbackIndex: number,
  anchor?: Y.RelativePosition,
): number {
  if (anchor) {
    const absolute = Y.createAbsolutePositionFromRelativePosition(
      anchor,
      yDocument,
    );
    if (!absolute || absolute.type !== order)
      return fail("base_order:stale_anchor");
    return absolute.index;
  }
  if (
    !Number.isSafeInteger(fallbackIndex) ||
    fallbackIndex < 0 ||
    fallbackIndex > order.length
  ) {
    return fail("base_order:index");
  }
  return fallbackIndex;
}

function insertBaseNode(
  yDocument: Y.Doc,
  node: Omit<BlockRoomBaseNodeSnapshot, "position">,
  position: number,
  anchor?: Y.RelativePosition,
): void {
  const nodes = blockRoomBaseNodes(yDocument);
  if (nodes.has(node.id)) fail(`base_node:${node.id}:exists`);
  const value = new Y.Map<unknown>();
  setNodePayload(value, node.family, node.kind, node.payload);
  value.set("parentId", node.parentId);
  value.set("containerSlot", node.containerSlot);
  if (node.columnId) value.set("columnId", node.columnId);
  const order = orderArray(yDocument, node, true);
  const index = insertionIndex(yDocument, order, position, anchor);
  nodes.set(node.id, value);
  order.insert(index, [node.id]);
}

function insertRichTextNode(
  yDocument: Y.Doc,
  typedNode: RichTextBlockNode,
  pageSectionId: string | undefined,
  anchor?: Y.RelativePosition,
): void {
  const json = jsonObject(
    toJson(RichTextBlockNodeSchema, typedNode),
    "rich_node",
  );
  const block = oneofPayload(
    jsonObject(json.block, "rich_node:block"),
    "id",
    "rich_node:block",
  );
  if (!typedNode.placement) fail("rich_node:placement");
  const documentType = roomDocumentType(yDocument);
  const parentBlockId = typedNode.placement.parentBlockId;
  if (documentType === "page" && !parentBlockId && !pageSectionId)
    fail("rich_node:missing_section_parent");
  if (documentType !== "page" && pageSectionId)
    fail("rich_node:unexpected_section_parent");
  insertBaseNode(
    yDocument,
    {
      id: block.id,
      family: "rich_text",
      kind: block.kind,
      payload: block.payload,
      parentId: parentBlockId ?? pageSectionId ?? null,
      containerSlot: richTextSlot(),
    },
    integerValue(typedNode.placement.index, "rich_node:index"),
    anchor,
  );
}

export interface InsertRichTextBlockNodeOptions extends BlockRoomAnchoredMutationOptions {
  pageSectionId?: string;
}

export function insertRichTextBlockNode(
  yDocument: Y.Doc,
  node: RichTextBlockNode,
  options: InsertRichTextBlockNodeOptions = {},
): void {
  yDocument.transact(() => {
    insertRichTextNode(yDocument, node, options.pageSectionId, options.anchor);
  }, options.origin);
}

export function insertPageSectionNode(
  yDocument: Y.Doc,
  typedNode: PageSectionNode,
  options: BlockRoomAnchoredMutationOptions = {},
): void {
  yDocument.transact(() => {
    if (roomDocumentType(yDocument) !== "page") fail("document_type");
    const json = jsonObject(
      toJson(PageSectionNodeSchema, typedNode),
      "page_node",
    );
    const section = pageSectionPayload(
      jsonObject(json.section, "page_node:section"),
      "page_node:section",
    );
    if (!typedNode.placement) fail("page_node:placement");
    const parentId = typedNode.placement.parentSectionId ?? null;
    const columnId = typedNode.placement.columnId;
    insertBaseNode(
      yDocument,
      {
        id: section.id,
        family: "page_section",
        kind: section.kind,
        payload:
          section.kind === "richText"
            ? withoutField(section.payload, "blocks", "page_node:rich_text")
            : section.payload,
        parentId,
        containerSlot: pageSectionSlot(parentId ?? undefined, columnId),
        ...(columnId ? { columnId } : {}),
      },
      integerValue(typedNode.placement.index, "page_node:index"),
      options.anchor,
    );
    if (typedNode.section?.value.case === "richText") {
      for (const block of typedNode.section.value.value.blocks?.nodes ?? []) {
        insertRichTextNode(yDocument, block, section.id);
      }
    }
  }, options.origin);
}

function insertLocaleNode(
  yDocument: Y.Doc,
  node: {
    id: string;
    family: BlockRoomNodeFamily;
    kind: string;
    payload: BlockRoomBaseNodeSnapshot["payload"];
  },
): void {
  const nodes = blockRoomLocaleOverlay(yDocument);
  if (nodes.has(node.id)) fail(`locale:${node.id}:exists`);
  const value = new Y.Map<unknown>();
  setNodePayload(value, node.family, node.kind, node.payload);
  nodes.set(node.id, value);
}

function insertRichTextLocaleNode(
  yDocument: Y.Doc,
  block: RichTextBlockLocale,
): void {
  const parsed = oneofPayload(
    jsonObject(toJson(RichTextBlockLocaleSchema, block), "rich_locale"),
    "blockId",
    "rich_locale",
  );
  insertLocaleNode(yDocument, {
    id: parsed.id,
    family: "rich_text",
    kind: parsed.kind,
    payload: parsed.payload,
  });
}

export function insertRichTextBlockLocale(
  yDocument: Y.Doc,
  block: RichTextBlockLocale,
  options: BlockRoomMutationOptions = {},
): void {
  yDocument.transact(() => {
    insertRichTextLocaleNode(yDocument, block);
    if (roomLocaleRole(yDocument) === "source")
      markAllBlockRoomLocaleValuesPresentForBlock(yDocument, block.blockId);
  }, options.origin);
}

export function insertPageSectionLocale(
  yDocument: Y.Doc,
  section: PageSectionLocale,
  options: BlockRoomMutationOptions = {},
): void {
  yDocument.transact(() => {
    if (roomDocumentType(yDocument) !== "page") fail("document_type");
    const parsed = oneofPayload(
      jsonObject(toJson(PageSectionLocaleSchema, section), "page_locale"),
      "sectionId",
      "page_locale",
    );
    const payload =
      parsed.kind === "richText"
        ? withoutField(parsed.payload, "blocks", "page_locale:rich_text")
        : parsed.payload;
    const insertedIds = new Set<string>();
    jsonObject(payload, "page_locale:payload");
    insertLocaleNode(yDocument, {
      id: parsed.id,
      family: "page_section",
      kind: parsed.kind,
      payload,
    });
    insertedIds.add(parsed.id);
    if (section.value.case === "richText") {
      for (const block of section.value.value.blocks?.blocks ?? []) {
        insertRichTextLocaleNode(yDocument, block);
        insertedIds.add(block.blockId);
      }
    }
    if (roomLocaleRole(yDocument) === "source")
      for (const id of insertedIds)
        markAllBlockRoomLocaleValuesPresentForBlock(yDocument, id);
  }, options.origin);
}

function moveBaseNode(
  yDocument: Y.Doc,
  id: string,
  family: BlockRoomNodeFamily,
  container: BlockRoomContainerRef & { columnId?: string },
  fallbackIndex: number,
  anchor?: Y.RelativePosition,
): void {
  const node = roomNode(yDocument, { id, family });
  const oldContainer: BlockRoomContainerRef = {
    parentId:
      node.get("parentId") === null
        ? null
        : stringValue(node.get("parentId"), `base_node:${id}:parent`),
    containerSlot: stringValue(
      node.get("containerSlot"),
      `base_node:${id}:slot`,
    ),
  };
  const oldOrder = orderArray(yDocument, oldContainer, false);
  const oldIndex = oldOrder.toArray().indexOf(id);
  if (oldIndex < 0) fail(`base_order:missing:${id}`);
  const newOrder = orderArray(yDocument, container, true);
  let index: number;
  if (anchor) {
    index = insertionIndex(yDocument, newOrder, fallbackIndex, anchor);
    if (oldOrder === newOrder && oldIndex < index) index -= 1;
  } else {
    const maximum = newOrder.length - (oldOrder === newOrder ? 1 : 0);
    if (
      !Number.isSafeInteger(fallbackIndex) ||
      fallbackIndex < 0 ||
      fallbackIndex > maximum
    ) {
      return fail("base_order:index");
    }
    index = fallbackIndex;
  }
  oldOrder.delete(oldIndex, 1);
  node.set("parentId", container.parentId);
  node.set("containerSlot", container.containerSlot);
  if (container.columnId) node.set("columnId", container.columnId);
  else node.delete("columnId");
  newOrder.insert(index, [id]);
  if (oldOrder.length === 0) {
    blockRoomBaseOrder(yDocument).delete(
      orderContainerKey(oldContainer.parentId, oldContainer.containerSlot),
    );
  }
}

export function moveRichTextBlockNode(
  yDocument: Y.Doc,
  id: string,
  placement: { parentBlockId?: string; index: number },
  options: InsertRichTextBlockNodeOptions = {},
): void {
  yDocument.transact(() => {
    const documentType = roomDocumentType(yDocument);
    const parentId = placement.parentBlockId ?? options.pageSectionId ?? null;
    if (documentType === "page" && parentId === null)
      fail("rich_node:missing_section_parent");
    if (documentType !== "page" && options.pageSectionId)
      fail("rich_node:unexpected_section_parent");
    moveBaseNode(
      yDocument,
      id,
      "rich_text",
      { parentId, containerSlot: richTextSlot() },
      placement.index,
      options.anchor,
    );
  }, options.origin);
}

export function movePageSectionNode(
  yDocument: Y.Doc,
  id: string,
  placement: { parentSectionId?: string; columnId?: string; index: number },
  options: BlockRoomAnchoredMutationOptions = {},
): void {
  yDocument.transact(() => {
    if (roomDocumentType(yDocument) !== "page") fail("document_type");
    const parentId = placement.parentSectionId ?? null;
    moveBaseNode(
      yDocument,
      id,
      "page_section",
      {
        parentId,
        containerSlot: pageSectionSlot(
          parentId ?? undefined,
          placement.columnId,
        ),
        ...(placement.columnId ? { columnId: placement.columnId } : {}),
      },
      placement.index,
      options.anchor,
    );
  }, options.origin);
}

export function deleteBlockRoomBaseNode(
  yDocument: Y.Doc,
  id: string,
  options: BlockRoomMutationOptions = {},
): void {
  yDocument.transact(() => {
    const decoded = decodeBaseNodes(
      blockRoomBaseNodes(yDocument),
      blockRoomBaseOrder(yDocument),
    );
    if (!decoded.has(id)) fail(`base_node:${id}:missing`);
    const deleted = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of decoded.values()) {
        if (
          node.parentId !== null &&
          deleted.has(node.parentId) &&
          !deleted.has(node.id)
        ) {
          deleted.add(node.id);
          changed = true;
        }
      }
    }
    const nodes = blockRoomBaseNodes(yDocument);
    const orders = blockRoomBaseOrder(yDocument);
    for (const deletedId of deleted) {
      const node = decoded.get(deletedId)!;
      const key = orderContainerKey(node.parentId, node.containerSlot);
      const order = orderArray(yDocument, node, false);
      const index = order.toArray().indexOf(deletedId);
      order.delete(index, 1);
      if (order.length === 0) orders.delete(key);
      nodes.delete(deletedId);
      blockRoomLocaleOverlay(yDocument).delete(deletedId);
    }
    deleteBlockRoomLocalePresenceForBlocks(yDocument, deleted);
  }, options.origin);
}

export function deleteBlockRoomLocaleNode(
  yDocument: Y.Doc,
  id: string,
  options: BlockRoomMutationOptions = {},
): void {
  yDocument.transact(() => {
    const nodes = blockRoomLocaleOverlay(yDocument);
    if (!nodes.has(id)) fail(`locale:${id}:missing`);
    nodes.delete(id);
    deleteBlockRoomLocalePresenceForBlocks(yDocument, new Set([id]));
  }, options.origin);
}
