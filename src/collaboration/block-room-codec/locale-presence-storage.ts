import type { AIDocumentFieldTarget } from "@echovisionlab/geul-proto/secure/ai_pb.ts";
import * as Y from "yjs";
import { BLOCK_ROOM_LOCALE_PRESENCE } from "./internal.ts";
import {
  allBlockRoomLocaleValueTargets,
  canonicalBlockRoomLocaleValueTarget,
  canonicalBlockRoomLocaleValueTargetKey,
  canonicalTarget,
  presenceFail,
  targetFromParts,
  type CanonicalPathSegment,
} from "./locale-targets.ts";
import { blockRoomLocaleValue } from "./locale-value-projection.ts";

export function blockRoomLocalePresence(yDocument: Y.Doc): Y.Map<unknown> {
  const value = yDocument
    .getMap<unknown>("block-document")
    .get(BLOCK_ROOM_LOCALE_PRESENCE);
  return value instanceof Y.Map ? value : presenceFail("map");
}

export function hydrateBlockRoomLocalePresence(
  yDocument: Y.Doc,
  values: readonly AIDocumentFieldTarget[],
): void {
  const presence = blockRoomLocalePresence(yDocument);
  let previous = "";
  for (const value of values) {
    const target = canonicalBlockRoomLocaleValueTarget(yDocument, value);
    const key = canonicalTarget(target).key;
    if (key <= previous) return presenceFail("order_or_duplicate");
    previous = key;
    presence.set(key, true);
  }
}

function targetFromKey(key: string): AIDocumentFieldTarget {
  let decoded: unknown;
  try {
    decoded = JSON.parse(key);
  } catch {
    return presenceFail("key");
  }
  if (
    !Array.isArray(decoded) ||
    decoded.length !== 3 ||
    !Array.isArray(decoded[2])
  )
    return presenceFail("key");
  const [blockId, field, rawPath] = decoded;
  if (typeof blockId !== "string" || typeof field !== "string")
    return presenceFail("key");
  const path: CanonicalPathSegment[] = rawPath.map((segment) => {
    if (
      !Array.isArray(segment) ||
      segment.length !== 2 ||
      (segment[0] !== "field" && segment[0] !== "item") ||
      typeof segment[1] !== "string"
    )
      return presenceFail("key");
    return [segment[0], segment[1]];
  });
  return targetFromParts(blockId, field, path);
}

export function blockRoomPresentLocaleValues(
  yDocument: Y.Doc,
): AIDocumentFieldTarget[] {
  return [...blockRoomLocalePresence(yDocument).entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => {
      if (value !== true) return presenceFail("value");
      const target = targetFromKey(key);
      canonicalBlockRoomLocaleValueTarget(yDocument, target);
      return target;
    });
}

export function markBlockRoomLocaleValuePresent(
  yDocument: Y.Doc,
  value: AIDocumentFieldTarget | undefined,
): void {
  const key = canonicalBlockRoomLocaleValueTargetKey(yDocument, value);
  blockRoomLocalePresence(yDocument).set(key, true);
}

export function markAllBlockRoomLocaleValuesPresentForBlock(
  yDocument: Y.Doc,
  blockId: string,
): void {
  for (const target of allBlockRoomLocaleValueTargets(yDocument)) {
    if (target.owner.case === "blockHandle" && target.owner.value === blockId)
      markBlockRoomLocaleValuePresent(yDocument, target);
  }
}

export function deleteBlockRoomLocalePresenceForBlocks(
  yDocument: Y.Doc,
  blockIds: ReadonlySet<string>,
): void {
  const presence = blockRoomLocalePresence(yDocument);
  for (const key of [...presence.keys()]) {
    const target = canonicalTarget(targetFromKey(key));
    if (blockIds.has(target.blockId)) presence.delete(key);
  }
}

export function assertBlockRoomLocalePresenceNotRemoved(
  before: Y.Doc,
  after: Y.Doc,
): void {
  const beforeKeys = new Set(
    blockRoomPresentLocaleValues(before).map(
      (target) => canonicalTarget(target).key,
    ),
  );
  const afterKeys = new Set(
    blockRoomPresentLocaleValues(after).map(
      (target) => canonicalTarget(target).key,
    ),
  );
  for (const key of beforeKeys) {
    if (afterKeys.has(key)) continue;
    try {
      canonicalBlockRoomLocaleValueTarget(after, targetFromKey(key));
    } catch {
      // Source structural deletion and kind replacement remove targets that no
      // longer exist in the post-state catalog. Those stale markers must go.
      continue;
    }
    return presenceFail("removed");
  }
}

export function assertBlockRoomLocaleValueChangesPresent(
  before: Y.Doc,
  after: Y.Doc,
): void {
  const beforeTargets = new Map(
    allBlockRoomLocaleValueTargets(before).map((target) => [
      canonicalBlockRoomLocaleValueTargetKey(before, target),
      target,
    ]),
  );
  const afterPresence = new Set(
    blockRoomPresentLocaleValues(after).map((target) =>
      canonicalBlockRoomLocaleValueTargetKey(after, target),
    ),
  );
  for (const target of allBlockRoomLocaleValueTargets(after)) {
    const key = canonicalBlockRoomLocaleValueTargetKey(after, target);
    const beforeTarget = beforeTargets.get(key);
    const changed =
      !beforeTarget ||
      JSON.stringify(blockRoomLocaleValue(before, beforeTarget)) !==
        JSON.stringify(blockRoomLocaleValue(after, target));
    if (changed && !afterPresence.has(key))
      return presenceFail("unmarked_change");
  }
}

export function localePresenceTargetsForBlock(
  yDocument: Y.Doc,
  blockId: string,
): AIDocumentFieldTarget[] {
  return blockRoomPresentLocaleValues(yDocument).filter(
    (target) =>
      target.owner.case === "blockHandle" && target.owner.value === blockId,
  );
}
