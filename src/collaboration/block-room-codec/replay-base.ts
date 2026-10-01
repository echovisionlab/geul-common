import * as Y from "yjs";
import {
  blockRoomBaseNodes,
  type CanonicalBlockRoomSnapshot,
} from "./materialization.ts";
import {
  deleteBlockRoomBaseNode,
  movePageSectionNode,
  moveRichTextBlockNode,
} from "./structure-mutations.ts";
import { fail, type BlockRoomDocumentType } from "./internal.ts";
import { applyPayloadRootDiff } from "./replay-payload.ts";
import {
  baseDepth,
  currentBaseNodes,
  currentNodeType,
  insertBaseNode,
  movedBaseIds,
  nodeMap,
  safeIndex,
  sameContainer,
  sameNodeType,
  sameValue,
  stableTreeAnchor,
  destinationUnderDeletedObservedAncestor,
} from "./replay-structure.ts";

export function applyBaseAdditions(
  document: Y.Doc,
  type: BlockRoomDocumentType,
  before: CanonicalBlockRoomSnapshot,
  after: CanonicalBlockRoomSnapshot,
): void {
  const beforeBase = nodeMap(before.baseNodes);
  const afterBase = nodeMap(after.baseNodes);
  const newlyAddedIds = new Set(
    [...afterBase.keys()].filter((id) => !beforeBase.has(id)),
  );
  const currentBeforeChanges = currentBaseNodes(document, type);
  for (const [id, node] of afterBase) {
    if (beforeBase.has(id)) continue;
    const current = currentBeforeChanges.get(id);
    if (current) {
      if (!sameNodeType(current, node)) fail(`replay:kind_changed:${id}`);
      // A replay may be retried after its prior insert became resident. Keep
      // that already-existing node and its later peer edits intact.
      newlyAddedIds.delete(id);
    }
  }
  const additions = [...newlyAddedIds]
    .map((id) => afterBase.get(id)!)
    .sort(
      (left, right) =>
        baseDepth(afterBase, left.id) - baseDepth(afterBase, right.id) ||
        left.position - right.position ||
        left.id.localeCompare(right.id),
    );
  for (const node of additions) {
    if (blockRoomBaseNodes(document).has(node.id)) continue;
    if (
      destinationUnderDeletedObservedAncestor(
        node.id,
        node.parentId,
        beforeBase,
        afterBase,
        new Set(blockRoomBaseNodes(document).keys()),
      )
    )
      continue;
    insertBaseNode(document, type, after, node, newlyAddedIds);
  }
}

export function applyBaseChanges(
  document: Y.Doc,
  before: CanonicalBlockRoomSnapshot,
  after: CanonicalBlockRoomSnapshot,
): void {
  const beforeBase = nodeMap(before.baseNodes);
  const afterBase = nodeMap(after.baseNodes);
  const moved = movedBaseIds(before.baseNodes, after.baseNodes);
  const escaping = [...moved]
    .filter((id) => {
      const oldNode = beforeBase.get(id)!;
      const newNode = afterBase.get(id)!;
      let ancestor = oldNode.parentId;
      while (ancestor !== null) {
        if (!afterBase.has(ancestor)) return true;
        ancestor = beforeBase.get(ancestor)?.parentId ?? null;
      }
      return (
        !sameContainer(oldNode, newNode) &&
        !afterBase.has(oldNode.parentId ?? "")
      );
    })
    .sort(
      (left, right) =>
        baseDepth(beforeBase, left) - baseDepth(beforeBase, right),
    );
  const moveNode = (id: string) => {
    const desired = afterBase.get(id)!;
    if (
      destinationUnderDeletedObservedAncestor(
        id,
        desired.parentId,
        beforeBase,
        afterBase,
        new Set(blockRoomBaseNodes(document).keys()),
      )
    )
      return;
    const existing = currentNodeType(blockRoomBaseNodes(document), id);
    if (!existing) return;
    const baseline = beforeBase.get(id)!;
    if (!sameNodeType(existing, baseline)) fail(`replay:kind_changed:${id}`);
    if (desired.family === "page_section") {
      const anchor = stableTreeAnchor(document, after.baseNodes, desired);
      movePageSectionNode(
        document,
        id,
        {
          ...(desired.parentId ? { parentSectionId: desired.parentId } : {}),
          ...(desired.columnId ? { columnId: desired.columnId } : {}),
          index: anchor ? desired.position : safeIndex(document, desired),
        },
        anchor ? { anchor } : {},
      );
    } else {
      const anchor = stableTreeAnchor(document, after.baseNodes, desired);
      moveRichTextBlockNode(
        document,
        id,
        {
          ...(desired.parentId &&
          afterBase.get(desired.parentId)?.family === "rich_text"
            ? { parentBlockId: desired.parentId }
            : {}),
          index: anchor ? desired.position : safeIndex(document, desired),
        },
        {
          ...(desired.parentId &&
          afterBase.get(desired.parentId)?.family === "page_section"
            ? { pageSectionId: desired.parentId }
            : {}),
          ...(anchor ? { anchor } : {}),
        },
      );
    }
  };
  for (const id of escaping) moveNode(id);

  const deletedIds = new Set(
    [...beforeBase.keys()].filter((id) => !afterBase.has(id)),
  );
  const topLevelDeletes = [...deletedIds]
    .filter((id) => {
      let parentId = beforeBase.get(id)!.parentId;
      while (parentId !== null) {
        if (deletedIds.has(parentId)) return false;
        parentId = beforeBase.get(parentId)?.parentId ?? null;
      }
      return true;
    })
    .sort(
      (left, right) =>
        baseDepth(beforeBase, left) - baseDepth(beforeBase, right),
    );
  for (const id of topLevelDeletes) {
    if (blockRoomBaseNodes(document).has(id))
      deleteBlockRoomBaseNode(document, id);
  }

  const movedInAfterOrder = [...moved]
    .filter((id) => !escaping.includes(id))
    .sort(
      (left, right) =>
        afterBase.get(right)!.position - afterBase.get(left)!.position,
    );
  for (const id of movedInAfterOrder) moveNode(id);

  for (const [id, oldNode] of beforeBase) {
    const next = afterBase.get(id);
    if (!next || sameValue(oldNode.payload, next.payload)) continue;
    const existing = currentNodeType(blockRoomBaseNodes(document), id);
    if (!existing) continue;
    if (!sameNodeType(existing, oldNode) || !sameNodeType(next, oldNode))
      fail(`replay:kind_changed:${id}`);
    applyPayloadRootDiff(
      document,
      { id, family: oldNode.family },
      oldNode.payload,
      next.payload,
    );
  }
}
