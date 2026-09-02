import * as Y from "yjs";
import type { AIDocumentFieldTarget } from "@echovisionlab/geul-proto/secure/ai_pb.ts";
import {
  BASE_NODE_KEYS,
  LOCALE_NODE_KEYS,
  fail,
  orderContainerKey,
  stringValue,
  yMap,
  type BlockRoomDocumentType,
  type BlockRoomTypedDocument,
} from "./internal.ts";
import {
  blockRoomBaseNodes,
  blockRoomBaseOrder,
  blockRoomLocaleOverlay,
  decodeCanonicalBlockRoom,
  nodePayload,
  type BlockRoomBaseNodeSnapshot,
  type BlockRoomLocaleNodeSnapshot,
  type CanonicalBlockRoomSnapshot,
} from "./materialization.ts";
import { roomDocumentType } from "./room-access.ts";
import {
  blockRoomLocaleValue,
  blockRoomLocalePresence,
  blockRoomPresentLocaleValues,
  blockRoomLocaleValueTargetIdentity,
  blockRoomLocaleValueTargetBlockId,
  canonicalBlockRoomLocaleValueTargetKey,
  localePresenceTargetsForBlock,
  sparseBlockRoomLocalePayload,
} from "./locale-presence.ts";

export interface CanonicalBlockRoomTransaction {
  document: BlockRoomTypedDocument;
  snapshot: CanonicalBlockRoomSnapshot;
  origin: unknown;
  local: boolean;
}

export interface BlockRoomChangeSet {
  affectedBaseBlockIds: string[];
  affectedLocaleBlockIds: string[];
  affectedLocaleValueTargets: AIDocumentFieldTarget[];
  changedContainerOrderKeys: string[];
  documentMetadataChanged: boolean;
  documentLayoutChanged: boolean;
  requiresFullDecode: boolean;
}

export type BlockRoomTransactionOriginKind = "local" | "remote";

/** Transaction metadata retained without exposing Y.Transaction to consumers. */
export interface ObservedBlockRoomChange {
  changeSet: BlockRoomChangeSet;
  origin: unknown;
  originKind: BlockRoomTransactionOriginKind;
}

export interface BlockRoomAffectedBaseNodeSnapshot extends BlockRoomBaseNodeSnapshot {
  pageSectionId?: string;
}

export interface CanonicalBlockRoomAffectedSnapshot {
  baseNodes: BlockRoomAffectedBaseNodeSnapshot[];
  deletedBaseBlockIds: string[];
  localeNodes: BlockRoomLocaleNodeSnapshot[];
  deletedLocaleBlockIds: string[];
  localeValueTargets: AIDocumentFieldTarget[];
  deletedLocaleValueTargets: AIDocumentFieldTarget[];
}

type TrackedRoomType =
  | { scope: "root" }
  | { scope: "base_nodes" }
  | { scope: "base_node"; blockId: string }
  | { scope: "base_order" }
  | { scope: "order"; key: string }
  | { scope: "locale_nodes" }
  | { scope: "locale_node"; blockId: string }
  | { scope: "locale_presence" };

interface BlockRoomTypeIndex {
  descriptors: WeakMap<object, TrackedRoomType>;
  orderIdsByKey: Map<string, string[]>;
  localeValuesByKey: Map<
    string,
    { target: AIDocumentFieldTarget; value: string }
  >;
}

function indexTrackedValue(
  value: unknown,
  descriptor: TrackedRoomType,
  descriptors: WeakMap<object, TrackedRoomType>,
): void {
  if (!(
    value instanceof Y.Map ||
    value instanceof Y.Array ||
    value instanceof Y.Text
  ))
    return;
  descriptors.set(value, descriptor);
  if (value instanceof Y.Map) {
    for (const child of value.values())
      indexTrackedValue(child, descriptor, descriptors);
  } else if (value instanceof Y.Array) {
    for (const child of value.toArray())
      indexTrackedValue(child, descriptor, descriptors);
  }
}

function blockRoomTypeIndex(yDocument: Y.Doc): BlockRoomTypeIndex {
  const descriptors = new WeakMap<object, TrackedRoomType>();
  const orderIdsByKey = new Map<string, string[]>();
  const localeValuesByKey = new Map<
    string,
    { target: AIDocumentFieldTarget; value: string }
  >();
  const root = yDocument.getMap<unknown>("block-document");
  descriptors.set(root, { scope: "root" });
  const baseNodes = blockRoomBaseNodes(yDocument);
  descriptors.set(baseNodes, { scope: "base_nodes" });
  for (const [blockId, node] of baseNodes.entries()) {
    indexTrackedValue(node, { scope: "base_node", blockId }, descriptors);
  }
  const baseOrder = blockRoomBaseOrder(yDocument);
  descriptors.set(baseOrder, { scope: "base_order" });
  for (const [key, rawOrder] of baseOrder.entries()) {
    const order =
      rawOrder instanceof Y.Array
        ? rawOrder
        : fail(`base_order:${key}:not_array`);
    const ids = order
      .toArray()
      .map((id) => stringValue(id, `base_order:${key}:id`));
    orderIdsByKey.set(key, ids);
    descriptors.set(order, { scope: "order", key });
  }
  const localeNodes = blockRoomLocaleOverlay(yDocument);
  descriptors.set(localeNodes, { scope: "locale_nodes" });
  for (const [blockId, node] of localeNodes.entries()) {
    indexTrackedValue(node, { scope: "locale_node", blockId }, descriptors);
  }
  descriptors.set(blockRoomLocalePresence(yDocument), {
    scope: "locale_presence",
  });
  for (const target of blockRoomPresentLocaleValues(yDocument)) {
    const key = canonicalBlockRoomLocaleValueTargetKey(yDocument, target);
    localeValuesByKey.set(key, {
      target,
      value: JSON.stringify(blockRoomLocaleValue(yDocument, target)),
    });
  }
  return { descriptors, orderIdsByKey, localeValuesByKey };
}

function changedIds(
  previous: readonly string[],
  current: readonly string[],
): string[] {
  const previousPositions = new Map(previous.map((id, index) => [id, index]));
  const currentPositions = new Map(current.map((id, index) => [id, index]));
  return [...new Set([...previous, ...current])].filter(
    (id) => previousPositions.get(id) !== currentPositions.get(id),
  );
}

function collectRoomChangeSet(
  transaction: Y.Transaction,
  previous: BlockRoomTypeIndex,
  current: BlockRoomTypeIndex,
): BlockRoomChangeSet {
  const baseIds = new Set<string>();
  const localeIds = new Set<string>();
  const orderKeys = new Set<string>();
  const localeValueTargets = new Map<string, AIDocumentFieldTarget>();
  let documentMetadataChanged = false;
  let documentLayoutChanged = false;
  let requiresFullDecode = false;
  const addOrder = (key: string) => {
    orderKeys.add(key);
    for (const id of changedIds(
      previous.orderIdsByKey.get(key) ?? [],
      current.orderIdsByKey.get(key) ?? [],
    )) {
      baseIds.add(id);
    }
  };
  const mark = (
    descriptor: TrackedRoomType,
    keys: ReadonlySet<string | null> | undefined,
  ) => {
    switch (descriptor.scope) {
      case "base_node":
        baseIds.add(descriptor.blockId);
        return;
      case "locale_node":
        localeIds.add(descriptor.blockId);
        return;
      case "order":
        addOrder(descriptor.key);
        return;
      case "base_nodes":
        for (const key of keys ?? []) baseIds.add(key as string);
        return;
      case "base_order":
        for (const key of keys ?? []) addOrder(key as string);
        return;
      case "locale_nodes":
        for (const key of keys ?? []) localeIds.add(key as string);
        return;
      case "locale_presence":
        return;
      case "root":
        for (const key of keys ?? []) {
          if (key === "documentLayout") documentLayoutChanged = true;
          else if (
            key === "sourceLocale" ||
            key === "roomLocale" ||
            key === "profile" ||
            key === "blockCatalogFingerprint"
          ) {
            documentMetadataChanged = true;
          } else requiresFullDecode = true;
        }
    }
  };
  for (const [type, keys] of transaction.changed) {
    const descriptor =
      previous.descriptors.get(type) ?? current.descriptors.get(type);
    if (descriptor) mark(descriptor, keys);
    else requiresFullDecode = true;
  }
  for (const type of transaction.changedParentTypes.keys()) {
    const descriptor =
      previous.descriptors.get(type) ?? current.descriptors.get(type);
    if (descriptor) mark(descriptor, undefined);
  }
  for (const key of new Set([
    ...previous.localeValuesByKey.keys(),
    ...current.localeValuesByKey.keys(),
  ])) {
    const before = previous.localeValuesByKey.get(key);
    const after = current.localeValuesByKey.get(key);
    if (before?.value === after?.value) continue;
    const target = after?.target ?? before!.target;
    localeValueTargets.set(key, target);
    if (target.owner.case === "blockHandle") localeIds.add(target.owner.value);
  }
  return {
    affectedBaseBlockIds: [...baseIds].sort(),
    affectedLocaleBlockIds: [...localeIds].sort(),
    affectedLocaleValueTargets: [...localeValueTargets.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, target]) => target),
    changedContainerOrderKeys: [...orderKeys].sort(),
    documentMetadataChanged,
    documentLayoutChanged,
    requiresFullDecode,
  };
}

export function mergeBlockRoomChangeSets(
  left: BlockRoomChangeSet | undefined,
  right: BlockRoomChangeSet,
): BlockRoomChangeSet {
  if (!left)
    return {
      ...right,
      affectedBaseBlockIds: [...right.affectedBaseBlockIds],
      affectedLocaleBlockIds: [...right.affectedLocaleBlockIds],
      affectedLocaleValueTargets: [...right.affectedLocaleValueTargets],
      changedContainerOrderKeys: [...right.changedContainerOrderKeys],
    };
  return {
    affectedBaseBlockIds: [
      ...new Set([...left.affectedBaseBlockIds, ...right.affectedBaseBlockIds]),
    ].sort(),
    affectedLocaleBlockIds: [
      ...new Set([
        ...left.affectedLocaleBlockIds,
        ...right.affectedLocaleBlockIds,
      ]),
    ].sort(),
    affectedLocaleValueTargets: [
      ...new Map(
        [
          ...left.affectedLocaleValueTargets,
          ...right.affectedLocaleValueTargets,
        ].map(
          (target) =>
            [blockRoomLocaleValueTargetIdentity(target), target] as const,
        ),
      ).values(),
    ].sort((left, right) =>
      blockRoomLocaleValueTargetIdentity(left).localeCompare(
        blockRoomLocaleValueTargetIdentity(right),
      ),
    ),
    changedContainerOrderKeys: [
      ...new Set([
        ...left.changedContainerOrderKeys,
        ...right.changedContainerOrderKeys,
      ]),
    ].sort(),
    documentMetadataChanged:
      left.documentMetadataChanged || right.documentMetadataChanged,
    documentLayoutChanged:
      left.documentLayoutChanged || right.documentLayoutChanged,
    requiresFullDecode: left.requiresFullDecode || right.requiresFullDecode,
  };
}

export function observeBlockRoomChanges(
  yDocument: Y.Doc,
  listener: (change: ObservedBlockRoomChange) => void,
): () => void {
  let index = blockRoomTypeIndex(yDocument);
  const handler = (transaction: Y.Transaction): void => {
    const next = blockRoomTypeIndex(yDocument);
    const changeSet = collectRoomChangeSet(transaction, index, next);
    index = next;
    listener({
      changeSet,
      origin: transaction.origin,
      originKind: transaction.local ? "local" : "remote",
    });
  };
  yDocument.on("afterTransaction", handler);
  return () => yDocument.off("afterTransaction", handler);
}

function decodeBaseNodeById(
  yDocument: Y.Doc,
  blockId: string,
): BlockRoomBaseNodeSnapshot | null {
  const nodes = blockRoomBaseNodes(yDocument);
  const rawNode = nodes.get(blockId);
  if (rawNode === undefined) return null;
  const reason = `base_node:${blockId}`;
  const node = yMap(rawNode, reason);
  const { family, kind, payload } = nodePayload(node, BASE_NODE_KEYS, reason);
  const rawParentId = node.get("parentId");
  const parentId =
    rawParentId === null ? null : stringValue(rawParentId, `${reason}:parent`);
  const containerSlot = stringValue(
    node.get("containerSlot"),
    `${reason}:slot`,
  );
  const key = orderContainerKey(parentId, containerSlot);
  const rawOrder = blockRoomBaseOrder(yDocument).get(key);
  const order =
    rawOrder instanceof Y.Array
      ? rawOrder
      : fail(`base_order:${key}:not_array`);
  const ids = order
    .toArray()
    .map((id) => stringValue(id, `base_order:${key}:id`));
  const position = ids.indexOf(blockId);
  if (position < 0 || ids.lastIndexOf(blockId) !== position)
    return fail(`base_order:${key}:invalid:${blockId}`);
  const rawColumnId = node.get("columnId");
  const columnId =
    rawColumnId === undefined
      ? undefined
      : stringValue(rawColumnId, `${reason}:column`);
  return {
    id: blockId,
    family,
    kind,
    payload,
    parentId,
    containerSlot,
    position,
    ...(columnId ? { columnId } : {}),
  };
}

function affectedPageSectionId(
  yDocument: Y.Doc,
  documentType: BlockRoomDocumentType,
  node: BlockRoomBaseNodeSnapshot,
): string | undefined {
  const visited = new Set([node.id]);
  let parentId = node.parentId;
  while (parentId !== null) {
    if (visited.has(parentId)) fail(`base_node:${node.id}:parent_cycle`);
    visited.add(parentId);
    const parent = decodeBaseNodeById(yDocument, parentId);
    if (!parent) fail(`base_node:${node.id}:missing_parent`);
    if (parent.family === "page_section") {
      if (documentType !== "page")
        return fail(`base_node:${node.id}:parent_family`);
      if (node.family === "rich_text") {
        if (parent.kind !== "richText")
          fail(`base_node:${node.id}:section_kind`);
        return parent.id;
      }
      parentId = parent.parentId;
      continue;
    }
    if (parent.family !== node.family)
      return fail(`base_node:${node.id}:parent_family`);
    parentId = parent.parentId;
  }
  if (documentType === "page" && node.family === "rich_text") {
    return fail(`base_node:${node.id}:missing_section_parent`);
  }
  return undefined;
}

export function decodeCanonicalBlockRoomAffectedNodes(
  yDocument: Y.Doc,
  documentType: BlockRoomDocumentType,
  changeSet: BlockRoomChangeSet,
): CanonicalBlockRoomAffectedSnapshot {
  if (changeSet.requiresFullDecode) fail("affected_nodes:full_decode_required");
  if (roomDocumentType(yDocument) !== documentType) fail("document_type");
  const requestedBaseIds = new Set(changeSet.affectedBaseBlockIds);
  for (const blockId of changeSet.affectedLocaleBlockIds)
    requestedBaseIds.add(blockId);
  const baseNodes: BlockRoomAffectedBaseNodeSnapshot[] = [];
  const deletedBaseBlockIds: string[] = [];
  for (const blockId of [...requestedBaseIds].sort()) {
    const node = decodeBaseNodeById(yDocument, blockId);
    if (!node) {
      if (changeSet.affectedBaseBlockIds.includes(blockId))
        deletedBaseBlockIds.push(blockId);
      continue;
    }
    const pageSectionId = affectedPageSectionId(yDocument, documentType, node);
    baseNodes.push({ ...node, ...(pageSectionId ? { pageSectionId } : {}) });
  }
  const localeIds = new Set(changeSet.affectedLocaleBlockIds);
  const presentKeys = new Set(
    blockRoomPresentLocaleValues(yDocument).map((target) =>
      blockRoomLocaleValueTargetIdentity(target),
    ),
  );
  const localeValueTargets = changeSet.affectedLocaleValueTargets.filter(
    (target) => presentKeys.has(blockRoomLocaleValueTargetIdentity(target)),
  );
  const deletedLocaleValueTargets = changeSet.affectedLocaleValueTargets.filter(
    (target) => !presentKeys.has(blockRoomLocaleValueTargetIdentity(target)),
  );
  const targetsByBlock = new Map<string, AIDocumentFieldTarget[]>();
  for (const target of localeValueTargets) {
    const blockId = blockRoomLocaleValueTargetBlockId(target);
    targetsByBlock.set(
      blockId,
      localePresenceTargetsForBlock(yDocument, blockId),
    );
    localeIds.add(blockId);
  }
  const localeNodes: BlockRoomLocaleNodeSnapshot[] = [];
  const deletedLocaleBlockIds: string[] = [];
  for (const blockId of [...localeIds].sort()) {
    const rawNode = blockRoomLocaleOverlay(yDocument).get(blockId);
    if (rawNode === undefined) {
      deletedLocaleBlockIds.push(blockId);
      continue;
    }
    const reason = `locale:${blockId}`;
    const decoded = nodePayload(
      yMap(rawNode, reason),
      LOCALE_NODE_KEYS,
      reason,
    );
    const targets = targetsByBlock.get(blockId) ?? [];
    if (targets.length === 0) {
      if (!changeSet.affectedBaseBlockIds.includes(blockId))
        fail(`affected_nodes:unmarked_locale_change:${blockId}`);
      localeNodes.push({ id: blockId, ...decoded, payload: {} });
      continue;
    }
    localeNodes.push({
      id: blockId,
      ...decoded,
      payload: sparseBlockRoomLocalePayload(yDocument, blockId, targets),
    });
  }
  return {
    baseNodes,
    deletedBaseBlockIds,
    localeNodes,
    deletedLocaleBlockIds,
    localeValueTargets,
    deletedLocaleValueTargets,
  };
}

export function observeCanonicalBlockRoom(
  yDocument: Y.Doc,
  documentType: BlockRoomDocumentType,
  listener: (change: CanonicalBlockRoomTransaction) => void,
): () => void {
  const handler = (transaction: Y.Transaction): void => {
    const snapshot = decodeCanonicalBlockRoom(yDocument, documentType);
    listener({
      document: snapshot.document,
      snapshot,
      origin: transaction.origin,
      local: transaction.local,
    });
  };
  yDocument.on("afterTransaction", handler);
  return () => yDocument.off("afterTransaction", handler);
}

export function transactBlockRoom(
  yDocument: Y.Doc,
  origin: unknown,
  mutate: () => void,
): void {
  yDocument.transact(mutate, origin);
}
