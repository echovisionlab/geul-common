import { toJson } from "@bufbuild/protobuf";
import {
  PageSectionLocaleSchema,
  PageSectionNodeSchema,
  RichTextBlockLocaleSchema,
  RichTextBlockNodeSchema,
  type LocalizedPageDocument,
  type LocalizedRichTextDocument,
  type PageSectionNode,
  type RichTextBlockNode,
} from "@echovisionlab/geul-proto/content/block_content_pb.ts";
import * as Y from "yjs";
import type { AIDocumentFieldTarget } from "@echovisionlab/geul-proto/secure/ai_pb.ts";
import {
  BLOCK_ROOM_BASE_NODES,
  BLOCK_ROOM_BASE_ORDER,
  BLOCK_ROOM_LOCALE_OVERLAY,
  BLOCK_ROOM_LOCALE_PRESENCE,
  BLOCK_ROOM_ROOT,
  assertBlockRoomLocaleProjectionParity,
  fail,
  integerValue,
  jsonObject,
  normalizeBlockDocument,
  oneofPayload,
  orderContainerKey,
  pageSectionPayload,
  pageSectionSlot,
  richTextSlot,
  setNodePayload,
  stringValue,
  withoutField,
  type BlockRoomDocumentType,
  type BlockRoomNodeFamily,
  type BlockRoomTypedDocument,
} from "./internal.ts";
import { hydrateBlockRoomLocalePresence } from "./locale-presence.ts";

interface BaseOrderEntry {
  id: string;
  parentId: string | null;
  containerSlot: string;
  position: number;
}

function hydrateBaseOrder(
  orders: Y.Map<unknown>,
  entries: readonly BaseOrderEntry[],
): void {
  const grouped = new Map<string, BaseOrderEntry[]>();
  for (const entry of entries) {
    const key = orderContainerKey(entry.parentId, entry.containerSlot);
    const group = grouped.get(key) ?? [];
    group.push(entry);
    grouped.set(key, group);
  }
  for (const [key, group] of [...grouped.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    group.sort((left, right) => left.position - right.position);
    group.forEach((entry, index) => {
      if (entry.position !== index) fail(`base_order:${key}:not_dense`);
    });
    const order = new Y.Array<string>();
    order.insert(
      0,
      group.map((entry) => entry.id),
    );
    orders.set(key, order);
  }
}

function hydrateRichTextBase(
  nodes: Y.Map<unknown>,
  orderEntries: BaseOrderEntry[],
  typedNodes: readonly RichTextBlockNode[],
  topLevelParentId?: string,
): void {
  for (const typedNode of typedNodes) {
    const node = jsonObject(
      toJson(RichTextBlockNodeSchema, typedNode),
      "rich_node",
    );
    const block = oneofPayload(
      jsonObject(node.block, "rich_node:block"),
      "id",
      "rich_node:block",
    );
    if (!typedNode.placement) fail("rich_node:placement");
    const parentId = typedNode.placement.parentBlockId ?? topLevelParentId;
    const value = new Y.Map<unknown>();
    setNodePayload(value, "rich_text", block.kind, block.payload);
    value.set("parentId", parentId ?? null);
    value.set("containerSlot", richTextSlot());
    orderEntries.push({
      id: block.id,
      parentId: parentId ?? null,
      containerSlot: richTextSlot(),
      position: integerValue(typedNode.placement.index, "rich_node:index"),
    });
    nodes.set(block.id, value);
  }
}

function hydratePageBase(
  nodes: Y.Map<unknown>,
  orderEntries: BaseOrderEntry[],
  typedNodes: readonly PageSectionNode[],
): void {
  for (const typedNode of typedNodes) {
    const node = jsonObject(
      toJson(PageSectionNodeSchema, typedNode),
      "page_node",
    );
    const section = pageSectionPayload(
      jsonObject(node.section, "page_node:section"),
      "page_node:section",
    );
    if (!typedNode.placement) fail("page_node:placement");
    const parentId = typedNode.placement.parentSectionId;
    const columnId = typedNode.placement.columnId;
    const value = new Y.Map<unknown>();
    const sectionPayload =
      section.kind === "richText"
        ? withoutField(section.payload, "blocks", "page_node:rich_text")
        : section.payload;
    setNodePayload(value, "page_section", section.kind, sectionPayload);
    value.set("parentId", parentId ?? null);
    const containerSlot = pageSectionSlot(parentId, columnId);
    value.set("containerSlot", containerSlot);
    orderEntries.push({
      id: section.id,
      parentId: parentId ?? null,
      containerSlot,
      position: integerValue(typedNode.placement.index, "page_node:index"),
    });
    if (columnId) value.set("columnId", columnId);
    nodes.set(section.id, value);
    if (typedNode.section?.value.case === "richText") {
      hydrateRichTextBase(
        nodes,
        orderEntries,
        typedNode.section.value.value.blocks?.nodes ?? [],
        section.id,
      );
    }
  }
}

function hydrateLocaleNode(
  target: Y.Map<unknown>,
  json: ReturnType<typeof jsonObject>,
  idField: string,
  family: BlockRoomNodeFamily,
  reason: string,
): void {
  const { id, kind, payload } = oneofPayload(json, idField, reason);
  if (target.has(id)) fail(`${reason}:duplicate_id:${id}`);
  const value = new Y.Map<unknown>();
  setNodePayload(value, family, kind, payload);
  target.set(id, value);
}

function hydratePageLocale(
  localeNodes: Y.Map<unknown>,
  document: LocalizedPageDocument,
): void {
  const overlay = document.localeOverlay!;
  for (const section of overlay.sections) {
    const json = jsonObject(
      toJson(PageSectionLocaleSchema, section),
      "page_locale",
    );
    const parsed = oneofPayload(json, "sectionId", "page_locale");
    const value = new Y.Map<unknown>();
    const payload =
      parsed.kind === "richText"
        ? withoutField(parsed.payload, "blocks", "page_locale:rich_text")
        : parsed.payload;
    setNodePayload(value, "page_section", parsed.kind, payload);
    if (localeNodes.has(parsed.id))
      fail(`page_locale:duplicate_id:${parsed.id}`);
    localeNodes.set(parsed.id, value);
    if (section.value.case === "richText") {
      for (const block of section.value.value.blocks?.blocks ?? []) {
        hydrateLocaleNode(
          localeNodes,
          jsonObject(
            toJson(RichTextBlockLocaleSchema, block),
            "page_rich_locale",
          ),
          "blockId",
          "rich_text",
          "page_rich_locale",
        );
      }
    }
  }
}

function hydrateRichTextLocale(
  localeNodes: Y.Map<unknown>,
  document: LocalizedRichTextDocument,
): void {
  for (const block of document.localeOverlay!.blocks) {
    hydrateLocaleNode(
      localeNodes,
      jsonObject(toJson(RichTextBlockLocaleSchema, block), "rich_locale"),
      "blockId",
      "rich_text",
      "rich_locale",
    );
  }
}

export function hydrateCanonicalBlockRoom(
  yDocument: Y.Doc,
  documentType: BlockRoomDocumentType,
  sourceLocale: string,
  document: BlockRoomTypedDocument,
  presentLocaleValues: readonly AIDocumentFieldTarget[],
): void {
  const normalized = normalizeBlockDocument(documentType, document);
  const canonicalSourceLocale = stringValue(sourceLocale, "source_locale");
  const root = yDocument.getMap<unknown>(BLOCK_ROOM_ROOT);
  if (root.size !== 0) fail("room_not_empty");
  const baseNodes = new Y.Map<unknown>();
  const baseOrder = new Y.Map<unknown>();
  const localeOverlay = new Y.Map<unknown>();
  const localePresence = new Y.Map<unknown>();
  const orderEntries: BaseOrderEntry[] = [];
  yDocument.transact(() => {
    root.set("documentType", documentType);
    root.set("blockCatalogFingerprint", normalized.blockCatalogFingerprint);
    root.set("sourceLocale", canonicalSourceLocale);
    root.set("roomLocale", normalized.locale);
    root.set(BLOCK_ROOM_BASE_NODES, baseNodes);
    root.set(BLOCK_ROOM_BASE_ORDER, baseOrder);
    root.set(BLOCK_ROOM_LOCALE_OVERLAY, localeOverlay);
    root.set(BLOCK_ROOM_LOCALE_PRESENCE, localePresence);
    if (normalized.$typeName === "api.content.v1.LocalizedRichTextDocument") {
      root.set("profile", normalized.profile);
      hydrateRichTextBase(
        baseNodes,
        orderEntries,
        normalized.base?.nodes ?? [],
      );
      hydrateRichTextLocale(localeOverlay, normalized);
    } else {
      hydratePageBase(baseNodes, orderEntries, normalized.base?.nodes ?? []);
      hydratePageLocale(localeOverlay, normalized);
    }
    hydrateBaseOrder(baseOrder, orderEntries);
    assertBlockRoomLocaleProjectionParity(yDocument);
    hydrateBlockRoomLocalePresence(yDocument, presentLocaleValues);
  }, "canonical-bootstrap");
}
