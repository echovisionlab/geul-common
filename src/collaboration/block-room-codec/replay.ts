import * as Y from "yjs";
import {
  decodeCanonicalBlockRoom,
  type CanonicalBlockRoomSnapshot,
} from "./materialization.ts";
import { fail, type BlockRoomDocumentType } from "./internal.ts";
import {
  roomDocumentType,
  roomLocale,
  roomLocaleRole,
  type BlockRoomMutationOptions,
} from "./room-access.ts";
import {
  compareBaseState,
  validateSnapshotDocument,
} from "./replay-structure.ts";
import { applyBaseAdditions, applyBaseChanges } from "./replay-base.ts";
import { applyLocaleAdditions, applyLocaleChanges } from "./replay-locale.ts";

function applyOneChange(
  document: Y.Doc,
  type: BlockRoomDocumentType,
  before: CanonicalBlockRoomSnapshot,
  after: CanonicalBlockRoomSnapshot,
): void {
  const isTarget = roomLocaleRole(document) === "target";
  if (isTarget && !compareBaseState(before.baseNodes, after.baseNodes))
    fail("replay:target_base_changed");

  if (!isTarget) applyBaseAdditions(document, type, before, after);
  // New base nodes need their locale projection before structural and payload
  // replay decodes the staged document.
  applyLocaleAdditions(document, before, after, isTarget);
  if (!isTarget) applyBaseChanges(document, before, after);
  applyLocaleChanges(document, before, after);
}

/** Replays stable-node user intent onto the current canonical Block room. */
export function replayBlockRoomChanges(
  current: Y.Doc,
  changes: readonly {
    before: CanonicalBlockRoomSnapshot;
    after: CanonicalBlockRoomSnapshot;
  }[],
  options: BlockRoomMutationOptions = {},
): void {
  if (changes.length === 0) return;
  const type = roomDocumentType(current);
  const locale = roomLocale(current);
  for (const change of changes) {
    validateSnapshotDocument(change.before, type, locale);
    validateSnapshotDocument(change.after, type, locale);
  }

  // Stage first so malformed or incompatible intent cannot leave a partially
  // replayed resident. Apply the resulting update to the caller's Y.Doc in one
  // transaction so its recovery journal sees one atomic replay boundary.
  const staged = new Y.Doc();
  Y.applyUpdate(staged, Y.encodeStateAsUpdate(current));
  try {
    staged.transact(() => {
      for (const change of changes)
        applyOneChange(staged, type, change.before, change.after);
      decodeCanonicalBlockRoom(staged, type);
    }, options.origin);
    const update = Y.encodeStateAsUpdate(staged, Y.encodeStateVector(current));
    if (update.length > 0) {
      current.transact(() => {
        Y.applyUpdate(current, update, options.origin);
      }, options.origin);
    }
  } finally {
    staged.destroy();
  }
}
