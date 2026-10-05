import { create } from "@bufbuild/protobuf";
import {
  ContentBlockPlacementSchema,
  PageSectionPlacementSchema,
  type PageSectionLocale,
  type PageSectionNode,
  type RichTextBlockLocale,
  type RichTextBlockNode,
} from "@echovisionlab/geul-proto/content/block_content_pb.ts";
import * as Y from "yjs";
import {
  blockRoomBaseNodes,
  blockRoomBaseOrder,
  decodeCanonicalBlockRoom,
  type BlockRoomBaseNodeSnapshot,
  type BlockRoomLocaleNodeSnapshot,
  type CanonicalBlockRoomSnapshot,
} from "./materialization.ts";
import {
  createBlockRoomInsertionAnchor,
  insertPageSectionLocale,
  insertPageSectionNode,
  insertRichTextBlockLocale,
  insertRichTextBlockNode,
} from "./structure-mutations.ts";
import {
  fail,
  orderContainerKey,
  type BlockRoomDocumentType,
  type BlockRoomTypedDocument,
} from "./internal.ts";

export function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function nodeMap<T extends { id: string }>(
  nodes: readonly T[],
): Map<string, T> {
  const result = new Map<string, T>();
  for (const node of nodes) {
    if (result.has(node.id)) fail(`replay:duplicate_id:${node.id}`);
    result.set(node.id, node);
  }
  return result;
}

export function sameContainer(
  left: BlockRoomBaseNodeSnapshot,
  right: BlockRoomBaseNodeSnapshot,
): boolean {
  return (
    left.parentId === right.parentId &&
    left.containerSlot === right.containerSlot &&
    left.columnId === right.columnId
  );
}

export function sameNodeType(
  left: { family: string; kind: string },
  right: { family: string; kind: string },
): boolean {
  return left.family === right.family && left.kind === right.kind;
}

export function compareBaseState(
  left: readonly BlockRoomBaseNodeSnapshot[],
  right: readonly BlockRoomBaseNodeSnapshot[],
): boolean {
  const leftById = nodeMap(left);
  const rightById = nodeMap(right);
  if (leftById.size !== rightById.size) return false;
  for (const [id, node] of leftById) {
    const other = rightById.get(id);
    if (
      !other ||
      !sameNodeType(node, other) ||
      !sameContainer(node, other) ||
      node.position !== other.position ||
      !sameValue(node.payload, other.payload)
    )
      return false;
  }
  return true;
}

export function longestCommonSubsequence<T>(
  left: readonly T[],
  right: readonly T[],
): Set<T> {
  const lengths = Array.from(
    { length: left.length + 1 },
    () => new Uint32Array(right.length + 1),
  );
  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      lengths[leftIndex]![rightIndex] = Object.is(
        left[leftIndex],
        right[rightIndex],
      )
        ? lengths[leftIndex + 1]![rightIndex + 1]! + 1
        : Math.max(
            lengths[leftIndex + 1]![rightIndex]!,
            lengths[leftIndex]![rightIndex + 1]!,
          );
    }
  }
  const retained = new Set<T>();
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (Object.is(left[leftIndex], right[rightIndex])) {
      retained.add(left[leftIndex]!);
      leftIndex += 1;
      rightIndex += 1;
    } else if (
      lengths[leftIndex + 1]![rightIndex]! >=
      lengths[leftIndex]![rightIndex + 1]!
    ) {
      leftIndex += 1;
    } else {
      rightIndex += 1;
    }
  }
  return retained;
}

function sameMembershipOrder(
  before: readonly BlockRoomBaseNodeSnapshot[],
  after: readonly BlockRoomBaseNodeSnapshot[],
  ids: ReadonlySet<string>,
): Set<string> {
  const previous = before
    .filter((node) => ids.has(node.id))
    .sort((left, right) => left.position - right.position)
    .map((node) => node.id);
  const next = after
    .filter((node) => ids.has(node.id))
    .sort((left, right) => left.position - right.position)
    .map((node) => node.id);
  return longestCommonSubsequence(previous, next);
}

export function movedBaseIds(
  before: readonly BlockRoomBaseNodeSnapshot[],
  after: readonly BlockRoomBaseNodeSnapshot[],
): Set<string> {
  const previous = nodeMap(before);
  const next = nodeMap(after);
  const moved = new Set<string>();
  const commonByContainer = new Map<string, Set<string>>();
  for (const [id, oldNode] of previous) {
    const newNode = next.get(id);
    if (!newNode) continue;
    if (!sameNodeType(oldNode, newNode)) fail(`replay:kind_changed:${id}`);
    if (!sameContainer(oldNode, newNode)) {
      moved.add(id);
      continue;
    }
    const key = orderContainerKey(oldNode.parentId, oldNode.containerSlot);
    const ids = commonByContainer.get(key) ?? new Set<string>();
    ids.add(id);
    commonByContainer.set(key, ids);
  }
  for (const ids of commonByContainer.values()) {
    const retained = sameMembershipOrder(before, after, ids);
    for (const id of ids) if (!retained.has(id)) moved.add(id);
  }
  return moved;
}

export function currentBaseNodes(
  document: Y.Doc,
  type: BlockRoomDocumentType,
): Map<string, BlockRoomBaseNodeSnapshot> {
  return nodeMap(decodeCanonicalBlockRoom(document, type).baseNodes);
}

export function currentNodeType(
  nodes: Y.Map<unknown>,
  id: string,
): { family: string; kind: string } | undefined {
  const raw = nodes.get(id);
  if (raw === undefined) return undefined;
  if (!(raw instanceof Y.Map)) fail(`replay:node_shape:${id}`);
  const family = raw.get("family");
  const kind = raw.get("kind");
  if (
    (family !== "page_section" && family !== "rich_text") ||
    typeof kind !== "string" ||
    kind.length === 0
  )
    fail(`replay:node_type:${id}`);
  return { family, kind };
}

function containerOrder(
  document: Y.Doc,
  node: BlockRoomBaseNodeSnapshot,
): Y.Array<string> | undefined {
  const value = blockRoomBaseOrder(document).get(
    orderContainerKey(node.parentId, node.containerSlot),
  );
  if (value === undefined) return undefined;
  if (!(value instanceof Y.Array)) fail(`replay:order_shape:${node.id}`);
  return value as Y.Array<string>;
}

export function stableTreeAnchor(
  document: Y.Doc,
  afterNodes: readonly BlockRoomBaseNodeSnapshot[],
  node: BlockRoomBaseNodeSnapshot,
): Y.RelativePosition | undefined {
  const order = containerOrder(document, node);
  if (!order) return undefined;
  const afterSiblings = afterNodes
    .filter(
      (candidate) => candidate.id !== node.id && sameContainer(candidate, node),
    )
    .sort((left, right) => left.position - right.position);
  const currentIds = new Set(order.toArray());
  const following = afterSiblings.find(
    (candidate) =>
      candidate.position > node.position && currentIds.has(candidate.id),
  );
  const anchorIndex = following
    ? order.toArray().indexOf(following.id)
    : order.length;
  return createBlockRoomInsertionAnchor(
    document,
    { parentId: node.parentId, containerSlot: node.containerSlot },
    anchorIndex,
  );
}

export function safeIndex(
  document: Y.Doc,
  node: BlockRoomBaseNodeSnapshot,
): number {
  return containerOrder(document, node)?.length ?? 0;
}

export function baseDepth(
  nodes: ReadonlyMap<string, BlockRoomBaseNodeSnapshot>,
  id: string,
): number {
  const visited = new Set<string>();
  let depth = 0;
  let node = nodes.get(id);
  while (node?.parentId !== null && node?.parentId !== undefined) {
    if (visited.has(node.id)) fail(`replay:parent_cycle:${id}`);
    visited.add(node.id);
    const parent = nodes.get(node.parentId);
    if (!parent) fail(`replay:missing_parent:${id}:${node.parentId}`);
    depth += 1;
    node = parent;
  }
  return depth;
}

/**
 * Returns true when the intended container is below an ancestor observed in
 * the local baseline that is absent from the current resident. A valid local
 * after-snapshot is required so an unknown parent remains a hard error.
 */
export function destinationUnderDeletedObservedAncestor(
  nodeId: string,
  parentId: string | null,
  before: ReadonlyMap<string, BlockRoomBaseNodeSnapshot>,
  after: ReadonlyMap<string, BlockRoomBaseNodeSnapshot>,
  currentIds: ReadonlySet<string>,
): boolean {
  const visited = new Set<string>([nodeId]);
  let blocked = false;
  while (parentId !== null) {
    if (visited.has(parentId)) fail(`replay:parent_cycle:${nodeId}`);
    visited.add(parentId);
    const parent = after.get(parentId);
    if (!parent) fail(`replay:missing_parent:${nodeId}:${parentId}`);
    if (before.has(parentId) && !currentIds.has(parentId)) blocked = true;
    parentId = parent.parentId;
  }
  return blocked;
}

function typedBaseNode(
  document: BlockRoomTypedDocument,
  id: string,
): PageSectionNode | RichTextBlockNode | undefined {
  if (document.$typeName === "api.content.v1.LocalizedPageDocument") {
    // replayBlockRoomChanges validates the canonical base graph before helpers run.
    for (const section of document.base!.nodes) {
      if (section.section?.id === id) return section;
      if (section.section?.value.case !== "richText") continue;
      const block = section.section.value.value.blocks?.nodes.find(
        (candidate) => candidate.block?.id === id,
      );
      if (block) return block;
    }
    return undefined;
  }
  return document.base?.nodes.find((node) => node.block?.id === id);
}

function filterPageBaseChildren(
  node: PageSectionNode,
  include: ReadonlySet<string>,
): PageSectionNode {
  if (node.section?.value.case !== "richText") return node;
  const section = node.section.value.value;
  const blocks = section.blocks;
  return {
    ...node,
    section: {
      ...node.section,
      value: {
        case: "richText",
        value: {
          ...section,
          blocks: blocks
            ? {
                ...blocks,
                nodes: blocks.nodes.filter((block) =>
                  include.has(block.block?.id ?? ""),
                ),
              }
            : undefined,
        },
      },
    },
  } as PageSectionNode;
}

function typedLocaleNode(
  document: BlockRoomTypedDocument,
  id: string,
): PageSectionLocale | RichTextBlockLocale | undefined {
  if (document.$typeName === "api.content.v1.LocalizedPageDocument") {
    // replayBlockRoomChanges validates the canonical locale graph before helpers run.
    for (const section of document.localeOverlay!.sections) {
      if (section.sectionId === id) return section;
      if (section.value.case !== "richText") continue;
      const block = section.value.value.blocks?.blocks.find(
        (candidate) => candidate.blockId === id,
      );
      if (block) return block;
    }
    return undefined;
  }
  return document.localeOverlay?.blocks.find((block) => block.blockId === id);
}

function filterPageLocaleChildren(
  node: PageSectionLocale,
  include: ReadonlySet<string>,
): PageSectionLocale {
  if (node.value.case !== "richText") return node;
  const section = node.value.value;
  const blocks = section.blocks;
  return {
    ...node,
    value: {
      case: "richText",
      value: {
        ...section,
        blocks: blocks
          ? {
              ...blocks,
              blocks: blocks.blocks.filter((block) =>
                include.has(block.blockId),
              ),
            }
          : undefined,
      },
    },
  } as PageSectionLocale;
}

export function insertBaseNode(
  document: Y.Doc,
  type: BlockRoomDocumentType,
  after: CanonicalBlockRoomSnapshot,
  node: BlockRoomBaseNodeSnapshot,
  newlyAddedIds: ReadonlySet<string>,
): void {
  const typed = typedBaseNode(after.document, node.id);
  if (!typed) fail(`replay:typed_node_missing:${node.id}`);
  if (
    node.parentId !== null &&
    !blockRoomBaseNodes(document).has(node.parentId)
  )
    fail(`replay:missing_parent:${node.id}:${node.parentId}`);
  const anchor = stableTreeAnchor(document, after.baseNodes, node);
  const opts = {
    ...(anchor ? { anchor } : {}),
  };
  if (node.family === "page_section") {
    if (type !== "page" || !("section" in typed))
      fail(`replay:family:${node.id}`);
    const filtered = filterPageBaseChildren(typed, newlyAddedIds);
    const placement = create(
      PageSectionPlacementSchema,
      filtered.placement ?? {},
    );
    placement.index = anchor
      ? (filtered.placement?.index ?? 0)
      : safeIndex(document, node);
    const safe = {
      ...filtered,
      placement,
    } as PageSectionNode;
    insertPageSectionNode(document, safe, opts);
    return;
  }
  if (!("block" in typed)) fail(`replay:family:${node.id}`);
  const placement = create(ContentBlockPlacementSchema, typed.placement ?? {});
  placement.index = anchor
    ? (typed.placement?.index ?? 0)
    : safeIndex(document, node);
  const safe = {
    ...typed,
    placement,
  } as RichTextBlockNode;
  insertRichTextBlockNode(document, safe, {
    ...(node.parentId &&
    node.parentId !== null &&
    node.containerSlot === "content"
      ? { pageSectionId: node.parentId }
      : {}),
    ...opts,
  });
}

export function insertLocaleNode(
  document: Y.Doc,
  after: CanonicalBlockRoomSnapshot,
  node: BlockRoomLocaleNodeSnapshot,
  newlyAddedIds: ReadonlySet<string>,
): void {
  const typed = typedLocaleNode(after.document, node.id);
  if (!typed) fail(`replay:typed_locale_missing:${node.id}`);
  if (!blockRoomBaseNodes(document).has(node.id)) return;
  if (node.family === "page_section") {
    if (!("sectionId" in typed)) fail(`replay:family:${node.id}`);
    const filtered = filterPageLocaleChildren(typed, newlyAddedIds);
    insertPageSectionLocale(document, filtered);
    return;
  }
  if (!("blockId" in typed)) fail(`replay:family:${node.id}`);
  insertRichTextBlockLocale(document, typed);
}

export function validateSnapshotDocument(
  snapshot: CanonicalBlockRoomSnapshot,
  type: BlockRoomDocumentType,
  locale: string,
): void {
  const expectedName =
    type === "page"
      ? "api.content.v1.LocalizedPageDocument"
      : "api.content.v1.LocalizedRichTextDocument";
  if (snapshot.document.$typeName !== expectedName)
    fail(`replay:document_type:${type}`);
  if (snapshot.document.locale !== locale) fail("replay:locale_changed");
  nodeMap(snapshot.baseNodes);
  nodeMap(snapshot.localeOverlay);
}

export function localeNodeDeleteOrder(
  baseNodes: readonly BlockRoomBaseNodeSnapshot[],
  localeNodes: readonly BlockRoomLocaleNodeSnapshot[],
  deletedIds: ReadonlySet<string>,
): string[] {
  const nodes = nodeMap(localeNodes);
  const base = nodeMap(baseNodes);
  const isDescendantOf = (candidate: string, ancestor: string): boolean => {
    let node = base.get(candidate);
    const visited = new Set<string>();
    while (node?.parentId !== null && node?.parentId !== undefined) {
      if (visited.has(node.id)) fail(`replay:parent_cycle:${candidate}`);
      visited.add(node.id);
      if (node.parentId === ancestor) return true;
      node = base.get(node.parentId);
    }
    return false;
  };
  return [...deletedIds].sort((left, right) => {
    const leftNode = nodes.get(left);
    const rightNode = nodes.get(right);
    if (
      leftNode?.family === "page_section" &&
      rightNode?.family === "rich_text"
    )
      return -1;
    if (
      leftNode?.family === "rich_text" &&
      rightNode?.family === "page_section"
    )
      return 1;
    if (isDescendantOf(left, right)) return 1;
    if (isDescendantOf(right, left)) return -1;
    return left.localeCompare(right);
  });
}
