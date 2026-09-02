import * as Y from "yjs";
import { type BlockRoomDocumentType, type JsonObject } from "./internal.ts";
import {
  blockRoomBaseNodes,
  blockRoomLocaleOverlay,
  decodeCanonicalBlockRoom,
} from "./materialization.ts";
import {
  roomDocumentType,
  roomLocale,
  roomLocaleRole,
  roomSourceLocale,
} from "./room-access.ts";
import {
  assertBlockRoomLocalePresenceNotRemoved,
  assertBlockRoomLocaleValueChangesPresent,
  blockRoomLocaleValueIsEncoded,
  blockRoomLocaleValueTargetBlockId,
  blockRoomPresentLocaleValues,
  canonicalBlockRoomLocaleValueTarget,
} from "./locale-presence.ts";

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export const BlockRoomLocaleChangeRejectionReason = {
  NonSourceStructure: "NON_SOURCE_STRUCTURE",
  RoomLocaleMismatch: "ROOM_LOCALE_MISMATCH",
  NonSourceSharedField: "NON_SOURCE_SHARED_FIELD",
  NonSourceFileRelation: "NON_SOURCE_FILE_RELATION",
  NonSourceDocumentMetadata: "NON_SOURCE_DOCUMENT_METADATA",
} as const;

export type BlockRoomLocaleChangeRejectionReason =
  (typeof BlockRoomLocaleChangeRejectionReason)[keyof typeof BlockRoomLocaleChangeRejectionReason];

export class BlockRoomLocaleChangeError extends Error {
  readonly reason: BlockRoomLocaleChangeRejectionReason;

  constructor(reason: BlockRoomLocaleChangeRejectionReason, detail: string) {
    super(`block_room_invalid:${detail}`);
    this.name = "BlockRoomLocaleChangeError";
    this.reason = reason;
  }
}

function reject(
  reason: BlockRoomLocaleChangeRejectionReason,
  detail: string,
): never {
  throw new BlockRoomLocaleChangeError(reason, detail);
}

function structure(nodes: readonly { payload: unknown }[]) {
  return nodes.map((node) => {
    const result: Partial<typeof node> = { ...node };
    delete result.payload;
    return result;
  });
}

function withoutFileIdentities(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutFileIdentities);
  if (!value || typeof value !== "object") return value;
  const result: JsonObject = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "activeFileId") continue;
    result[key] = withoutFileIdentities(child) as never;
  }
  return result;
}

function hasRemovedEncodedLocaleValue(before: Y.Doc, after: Y.Doc): boolean {
  return blockRoomPresentLocaleValues(before).some((target) => {
    if (!blockRoomLocaleValueIsEncoded(before, target)) return false;
    const blockId = blockRoomLocaleValueTargetBlockId(target);
    const beforeOwner = blockRoomBaseNodes(before).get(blockId);
    const afterOwner = blockRoomBaseNodes(after).get(blockId);
    if (!(beforeOwner instanceof Y.Map) || !(afterOwner instanceof Y.Map))
      return false;
    if (
      beforeOwner.get("family") !== afterOwner.get("family") ||
      beforeOwner.get("kind") !== afterOwner.get("kind")
    )
      return false;
    try {
      canonicalBlockRoomLocaleValueTarget(after, target);
    } catch {
      return false;
    }
    return !blockRoomLocaleValueIsEncoded(after, target);
  });
}

function containsNullishYValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (value instanceof Y.Map)
    return [...value.values()].some(containsNullishYValue);
  if (value instanceof Y.Array)
    return value.toArray().some(containsNullishYValue);
  return false;
}

function localeOverlayContainsNullish(yDocument: Y.Doc): boolean {
  return [...blockRoomLocaleOverlay(yDocument).values()].some(
    containsNullishYValue,
  );
}

/**
 * Validates an already-applied candidate room against its prior state.
 * Target rooms may only change their locale overlay; their shared graph and
 * exact-room identity remain immutable.
 */
export function assertBlockRoomLocaleChangeAllowed(
  before: Y.Doc,
  after: Y.Doc,
  documentType: BlockRoomDocumentType,
): void {
  if (
    roomDocumentType(before) !== documentType ||
    roomDocumentType(after) !== documentType
  ) {
    reject(
      BlockRoomLocaleChangeRejectionReason.RoomLocaleMismatch,
      "document_type",
    );
  }
  const beforeSourceLocale = roomSourceLocale(before);
  const beforeRoomLocale = roomLocale(before);
  if (
    roomSourceLocale(after) !== beforeSourceLocale ||
    roomLocale(after) !== beforeRoomLocale ||
    roomLocaleRole(after) !== roomLocaleRole(before)
  ) {
    reject(
      BlockRoomLocaleChangeRejectionReason.RoomLocaleMismatch,
      "locale_room:identity_changed",
    );
  }
  const beforeRoot = before.getMap<unknown>("block-document");
  const afterRoot = after.getMap<unknown>("block-document");
  if (
    beforeRoot.get("blockCatalogFingerprint") !==
      afterRoot.get("blockCatalogFingerprint") ||
    beforeRoot.get("profile") !== afterRoot.get("profile")
  ) {
    reject(
      BlockRoomLocaleChangeRejectionReason.NonSourceDocumentMetadata,
      "target_room:document_metadata_changed",
    );
  }
  const targetRoom = roomLocaleRole(before) === "target";
  if (localeOverlayContainsNullish(after)) {
    reject(
      BlockRoomLocaleChangeRejectionReason.NonSourceSharedField,
      `${targetRoom ? "target_room" : "locale_room"}:locale_value_removed`,
    );
  }
  let beforeSnapshot: ReturnType<typeof decodeCanonicalBlockRoom>;
  let afterSnapshot: ReturnType<typeof decodeCanonicalBlockRoom>;
  try {
    beforeSnapshot = decodeCanonicalBlockRoom(before, documentType);
    afterSnapshot = decodeCanonicalBlockRoom(after, documentType);
  } catch (error) {
    const projectionDetail =
      error instanceof Error &&
      error.message.includes("table_identity_mismatch")
        ? "table_identity_mismatch"
        : error instanceof Error &&
            error.message.includes("immersive_identity_mismatch")
          ? "immersive_identity_mismatch"
          : "invalid_projection";
    reject(
      BlockRoomLocaleChangeRejectionReason.NonSourceStructure,
      `${targetRoom ? "target_room" : "locale_room"}:${projectionDetail}`,
    );
  }
  if (hasRemovedEncodedLocaleValue(before, after)) {
    reject(
      BlockRoomLocaleChangeRejectionReason.NonSourceSharedField,
      `${targetRoom ? "target_room" : "locale_room"}:locale_value_removed`,
    );
  }
  try {
    assertBlockRoomLocalePresenceNotRemoved(before, after);
  } catch {
    reject(
      BlockRoomLocaleChangeRejectionReason.NonSourceSharedField,
      `${targetRoom ? "target_room" : "locale_room"}:locale_presence_removed`,
    );
  }
  if (!targetRoom) {
    try {
      assertBlockRoomLocaleValueChangesPresent(before, after);
    } catch {
      reject(
        BlockRoomLocaleChangeRejectionReason.NonSourceSharedField,
        "locale_room:unmarked_locale_value_change",
      );
    }
    return;
  }
  if (
    !sameValue(
      structure(beforeSnapshot.baseNodes),
      structure(afterSnapshot.baseNodes),
    )
  )
    reject(
      BlockRoomLocaleChangeRejectionReason.NonSourceStructure,
      "target_room:shared_graph_changed",
    );
  const beforePayloads = beforeSnapshot.baseNodes.map(({ payload }) => payload);
  const afterPayloads = afterSnapshot.baseNodes.map(({ payload }) => payload);
  if (!sameValue(beforePayloads, afterPayloads)) {
    const fileOnly = sameValue(
      withoutFileIdentities(beforePayloads),
      withoutFileIdentities(afterPayloads),
    );
    reject(
      fileOnly
        ? BlockRoomLocaleChangeRejectionReason.NonSourceFileRelation
        : BlockRoomLocaleChangeRejectionReason.NonSourceSharedField,
      "target_room:shared_graph_changed",
    );
  }
  try {
    assertBlockRoomLocaleValueChangesPresent(before, after);
  } catch {
    reject(
      BlockRoomLocaleChangeRejectionReason.NonSourceSharedField,
      "target_room:unmarked_locale_value_change",
    );
  }
}
