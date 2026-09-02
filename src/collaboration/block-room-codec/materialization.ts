import { fromJson, toJson, type JsonValue } from "@bufbuild/protobuf";
import {
  LocalizedPageDocumentSchema,
  LocalizedRichTextDocumentSchema,
  PageSectionNodeSchema,
  RichTextBlockNodeSchema,
  type LocalizedPageDocument,
  type LocalizedRichTextDocument,
  type PageSectionNode,
  type RichTextBlockNode,
} from "@echovisionlab/geul-proto/content/block_content_pb.ts";
import * as Y from "yjs";
import {
  BASE_NODE_KEYS,
  BLOCK_ROOM_BASE_NODES,
  BLOCK_ROOM_BASE_ORDER,
  BLOCK_ROOM_LOCALE_OVERLAY,
  BLOCK_ROOM_ROOT,
  LOCALE_NODE_KEYS,
  ROOT_KEYS,
  assertBlockRoomLocaleProjectionParity,
  assertExactKeys,
  canonicalBlockRoomDocumentBytes,
  fail,
  integerValue,
  jsonObject,
  materializePageSectionPayload,
  normalizeBlockDocument,
  orderContainerKey,
  pageSectionSlot,
  richTextSlot,
  stringValue,
  yMap,
  fromYValue,
  type BlockRoomDocumentType,
  type BlockRoomNodeFamily,
  type BlockRoomTypedDocument,
} from "./internal.ts";

export function nodePayload(
  node: Y.Map<unknown>,
  allowed: ReadonlySet<string>,
  reason: string,
): { family: BlockRoomNodeFamily; kind: string; payload: JsonValue } {
  assertExactKeys(node, allowed, reason);
  const family = stringValue(node.get("family"), `${reason}:family`);
  if (family !== "page_section" && family !== "rich_text")
    fail(`${reason}:family`);
  return {
    family,
    kind: stringValue(node.get("kind"), `${reason}:kind`),
    payload: fromYValue(node.get("payload")),
  };
}

export interface BlockRoomBaseNodeSnapshot {
  id: string;
  family: BlockRoomNodeFamily;
  kind: string;
  payload: JsonValue;
  parentId: string | null;
  containerSlot: string;
  position: number;
  columnId?: string;
}

export interface BlockRoomLocaleNodeSnapshot {
  id: string;
  family: BlockRoomNodeFamily;
  kind: string;
  payload: JsonValue;
}

export function blockRoomBaseNodes(yDocument: Y.Doc): Y.Map<unknown> {
  return yMap(
    yDocument.getMap<unknown>(BLOCK_ROOM_ROOT).get(BLOCK_ROOM_BASE_NODES),
    "base_nodes",
  );
}

export function blockRoomBaseOrder(yDocument: Y.Doc): Y.Map<unknown> {
  return yMap(
    yDocument.getMap<unknown>(BLOCK_ROOM_ROOT).get(BLOCK_ROOM_BASE_ORDER),
    "base_order",
  );
}

export function blockRoomLocaleOverlay(yDocument: Y.Doc): Y.Map<unknown> {
  return yMap(
    yDocument.getMap<unknown>(BLOCK_ROOM_ROOT).get(BLOCK_ROOM_LOCALE_OVERLAY),
    "locale_overlay",
  );
}

export function decodeBaseNodes(
  nodes: Y.Map<unknown>,
  orders: Y.Map<unknown>,
): Map<string, BlockRoomBaseNodeSnapshot> {
  const decoded = new Map(
    [...nodes.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, rawNode]) => {
        const reason = `base_node:${id}`;
        const node = yMap(rawNode, reason);
        const { family, kind, payload } = nodePayload(
          node,
          BASE_NODE_KEYS,
          reason,
        );
        const rawParentId = node.get("parentId");
        const rawColumnId = node.get("columnId");
        const parentId =
          rawParentId === null
            ? null
            : stringValue(rawParentId, `${reason}:parent`);
        const columnId =
          rawColumnId === undefined
            ? undefined
            : stringValue(rawColumnId, `${reason}:column`);
        return [
          id,
          {
            id,
            family,
            kind,
            payload,
            parentId,
            containerSlot: stringValue(
              node.get("containerSlot"),
              `${reason}:slot`,
            ),
            position: -1,
            ...(columnId ? { columnId } : {}),
          },
        ];
      }),
  );
  const orderedIds = new Set<string>();
  for (const [key, rawOrder] of [...orders.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const order =
      rawOrder instanceof Y.Array
        ? rawOrder
        : fail(`base_order:${key}:not_array`);
    const ids = order.toArray();
    ids.forEach((rawId, position) => {
      const id = stringValue(rawId, `base_order:${key}:id`);
      if (orderedIds.has(id)) fail(`base_order:${key}:duplicate:${id}`);
      const node = decoded.get(id);
      if (!node) fail(`base_order:${key}:missing_node:${id}`);
      if (key !== orderContainerKey(node.parentId, node.containerSlot)) {
        fail(`base_order:${key}:wrong_container:${id}`);
      }
      node.position = position;
      orderedIds.add(id);
    });
  }
  for (const id of decoded.keys()) {
    if (!orderedIds.has(id)) fail(`base_order:missing:${id}`);
  }
  return decoded;
}

function materializeRichTextNode(
  node: BlockRoomBaseNodeSnapshot,
  topLevelParentId?: string,
): RichTextBlockNode {
  if (node.containerSlot !== richTextSlot() || node.columnId !== undefined) {
    fail(`base_node:${node.id}:placement`);
  }
  const placement: { index: number; parentBlockId?: string } = {
    index: node.position,
  };
  if (node.parentId !== null && node.parentId !== topLevelParentId)
    placement.parentBlockId = node.parentId;
  return fromJson(RichTextBlockNodeSchema, {
    block: { id: node.id, [node.kind]: node.payload },
    placement,
  }) as RichTextBlockNode;
}

function richTextSectionId(
  node: BlockRoomBaseNodeSnapshot,
  nodes: ReadonlyMap<string, BlockRoomBaseNodeSnapshot>,
): string {
  const visited = new Set([node.id]);
  let parentId = node.parentId;
  while (parentId !== null) {
    if (visited.has(parentId)) fail(`base_node:${node.id}:parent_cycle`);
    visited.add(parentId);
    const parent = nodes.get(parentId);
    if (!parent) fail(`base_node:${node.id}:missing_parent`);
    if (parent.family === "page_section") {
      if (parent.kind !== "richText") fail(`base_node:${node.id}:section_kind`);
      return parent.id;
    }
    parentId = parent.parentId;
  }
  return fail(`base_node:${node.id}:missing_section_parent`);
}

function materializeStandaloneRichTextBase(
  nodes: ReadonlyMap<string, BlockRoomBaseNodeSnapshot>,
): RichTextBlockNode[] {
  return [...nodes.values()].map((node) => {
    if (node.family !== "rich_text") fail(`base_node:${node.id}:family`);
    return materializeRichTextNode(node);
  });
}

function materializePageBase(
  nodes: ReadonlyMap<string, BlockRoomBaseNodeSnapshot>,
): PageSectionNode[] {
  const richTextBySection = new Map<string, BlockRoomBaseNodeSnapshot[]>();
  for (const node of nodes.values()) {
    if (node.family !== "rich_text") continue;
    const sectionId = richTextSectionId(node, nodes);
    const entries = richTextBySection.get(sectionId) ?? [];
    entries.push(node);
    richTextBySection.set(sectionId, entries);
  }
  return [...nodes.values()]
    .filter((node) => node.family === "page_section")
    .map((node) => {
      const expectedSlot = pageSectionSlot(
        node.parentId ?? undefined,
        node.columnId,
      );
      if (node.containerSlot !== expectedSlot)
        fail(`base_node:${node.id}:slot`);
      const placement: {
        index: number;
        parentSectionId?: string;
        columnId?: string;
      } = { index: node.position };
      if (node.parentId !== null) placement.parentSectionId = node.parentId;
      if (node.columnId) placement.columnId = node.columnId;
      const materialized = materializePageSectionPayload(
        node.payload,
        `base_node:${node.id}:payload`,
      );
      const payload =
        node.kind === "richText"
          ? {
              ...materialized.value,
              blocks: {
                nodes: (richTextBySection.get(node.id) ?? []).map((block) =>
                  toJson(
                    RichTextBlockNodeSchema,
                    materializeRichTextNode(block, node.id),
                  ),
                ),
              },
            }
          : materialized.value;
      return fromJson(PageSectionNodeSchema, {
        section: {
          id: node.id,
          ...(materialized.settings === undefined
            ? {}
            : { settings: materialized.settings }),
          [node.kind]: payload,
        },
        placement,
      }) as PageSectionNode;
    });
}

function decodeLocaleNodes(
  rawNodes: unknown,
): Map<string, BlockRoomLocaleNodeSnapshot> {
  const nodes = yMap(rawNodes, "locale");
  return new Map(
    [...nodes.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, rawNode]) => {
        const reason = `locale:${id}`;
        const { family, kind, payload } = nodePayload(
          yMap(rawNode, reason),
          LOCALE_NODE_KEYS,
          reason,
        );
        return [id, { id, family, kind, payload }];
      }),
  );
}

function richTextLocaleJson(node: BlockRoomLocaleNodeSnapshot): {
  blockId: string;
  [key: string]: JsonValue;
} {
  return { blockId: node.id, [node.kind]: node.payload };
}

function materializeRichTextLocaleOverlay(
  roomLocale: string,
  localeNodes: Y.Map<unknown>,
): JsonValue[] {
  return [
    {
      locale: roomLocale,
      blocks: [...decodeLocaleNodes(localeNodes).values()].map(
        richTextLocaleJson,
      ),
    },
  ];
}

function materializePageLocaleOverlay(
  roomLocale: string,
  localeNodes: Y.Map<unknown>,
  baseNodes: ReadonlyMap<string, BlockRoomBaseNodeSnapshot>,
): JsonValue[] {
  const nodes = decodeLocaleNodes(localeNodes);
  const richTextBySection = new Map<string, BlockRoomLocaleNodeSnapshot[]>();
  for (const node of nodes.values()) {
    if (node.family !== "rich_text") continue;
    const base = baseNodes.get(node.id)!;
    const sectionId = richTextSectionId(base, baseNodes);
    const entries = richTextBySection.get(sectionId) ?? [];
    entries.push(node);
    richTextBySection.set(sectionId, entries);
  }
  const sectionIds = new Set([
    ...[...nodes.values()]
      .filter((node) => node.family === "page_section")
      .map((node) => node.id),
    ...richTextBySection.keys(),
  ]);
  const sections = [...sectionIds].sort().map((sectionId) => {
    const localeSection = nodes.get(sectionId)!;
    const kind = localeSection.kind;
    const payload = localeSection.payload;
    const value =
      kind === "richText"
        ? {
            ...jsonObject(payload, `locale:${sectionId}:payload`),
            blocks: {
              locale: roomLocale,
              blocks: (richTextBySection.get(sectionId) ?? []).map(
                richTextLocaleJson,
              ),
            },
          }
        : payload;
    return { sectionId, [kind]: value };
  });
  return [{ locale: roomLocale, sections }];
}

export function materializeCanonicalBlockRoom(
  yDocument: Y.Doc,
  expectedDocumentType: BlockRoomDocumentType,
): BlockRoomTypedDocument {
  const root = yDocument.getMap<unknown>(BLOCK_ROOM_ROOT);
  assertExactKeys(root, ROOT_KEYS, "root");
  const documentType = stringValue(root.get("documentType"), "document_type");
  if (documentType !== expectedDocumentType) fail("document_type");
  const fingerprint = stringValue(
    root.get("blockCatalogFingerprint"),
    "catalog_fingerprint",
  );
  stringValue(root.get("sourceLocale"), "source_locale");
  const roomLocale = stringValue(root.get("roomLocale"), "room_locale");
  const nodes = decodeBaseNodes(
    blockRoomBaseNodes(yDocument),
    blockRoomBaseOrder(yDocument),
  );
  assertBlockRoomLocaleProjectionParity(yDocument);
  const localeNodes = blockRoomLocaleOverlay(yDocument);
  if (expectedDocumentType === "page") {
    if (root.has("profile")) fail("page_profile");
    const document = fromJson(LocalizedPageDocumentSchema, {
      blockCatalogFingerprint: fingerprint,
      locale: roomLocale,
      base: {
        nodes: materializePageBase(nodes).map((node) =>
          toJson(PageSectionNodeSchema, node),
        ),
      },
      localeOverlay: materializePageLocaleOverlay(
        roomLocale,
        localeNodes,
        nodes,
      )[0],
    }) as LocalizedPageDocument;
    return normalizeBlockDocument(
      expectedDocumentType,
      document,
    ) as LocalizedPageDocument;
  }
  const profile = integerValue(root.get("profile"), "profile");
  const document = fromJson(LocalizedRichTextDocumentSchema, {
    blockCatalogFingerprint: fingerprint,
    profile,
    locale: roomLocale,
    base: {
      nodes: materializeStandaloneRichTextBase(nodes).map((node) =>
        toJson(RichTextBlockNodeSchema, node),
      ),
    },
    localeOverlay: materializeRichTextLocaleOverlay(roomLocale, localeNodes)[0],
  }) as LocalizedRichTextDocument;
  return normalizeBlockDocument(
    expectedDocumentType,
    document,
  ) as LocalizedRichTextDocument;
}

export function assertCanonicalBlockRoomParity(
  yDocument: Y.Doc,
  documentType: BlockRoomDocumentType,
  expected: BlockRoomTypedDocument,
): void {
  const actualBytes = canonicalBlockRoomDocumentBytes(
    documentType,
    materializeCanonicalBlockRoom(yDocument, documentType),
  );
  const expectedBytes = canonicalBlockRoomDocumentBytes(documentType, expected);
  if (
    actualBytes.length !== expectedBytes.length ||
    !actualBytes.every((value, index) => value === expectedBytes[index])
  )
    fail("canonical_parity");
}

export interface CanonicalBlockRoomSnapshot {
  document: BlockRoomTypedDocument;
  baseNodes: BlockRoomBaseNodeSnapshot[];
  localeOverlay: BlockRoomLocaleNodeSnapshot[];
}

export function decodeCanonicalBlockRoom(
  yDocument: Y.Doc,
  expectedDocumentType: BlockRoomDocumentType,
): CanonicalBlockRoomSnapshot {
  const document = materializeCanonicalBlockRoom(
    yDocument,
    expectedDocumentType,
  );
  const baseNodes = decodeBaseNodes(
    blockRoomBaseNodes(yDocument),
    blockRoomBaseOrder(yDocument),
  );
  const localeOverlay = [
    ...decodeLocaleNodes(blockRoomLocaleOverlay(yDocument)).values(),
  ];
  return { document, baseNodes: [...baseNodes.values()], localeOverlay };
}
