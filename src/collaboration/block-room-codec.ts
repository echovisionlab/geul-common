export {
  canonicalBlockRoomDocumentBytes,
  type BlockRoomDocumentType,
  type BlockRoomLocaleRole,
  type BlockRoomNodeFamily,
  type BlockRoomTypedDocument,
  type RichTextBlockRoomDocumentType,
} from "./block-room-codec/internal.ts";
export { hydrateCanonicalBlockRoom } from "./block-room-codec/hydration.ts";
export {
  applyAIDocumentOperationsToBlockRoom,
  type ApplyAIDocumentOperationsOptions,
} from "./block-room-codec/ai-document-applicator.ts";
export {
  assertCanonicalBlockRoomParity,
  decodeCanonicalBlockRoom,
  materializeCanonicalBlockRoom,
  type BlockRoomBaseNodeSnapshot,
  type BlockRoomLocaleNodeSnapshot,
  type CanonicalBlockRoomSnapshot,
} from "./block-room-codec/materialization.ts";
export {
  deleteBlockRoomAtomicValue,
  deleteBlockRoomPayloadArrayItem,
  getBlockRoomAtomicValue,
  getBlockRoomCollaborativeText,
  insertBlockRoomPayloadArrayItem,
  moveBlockRoomPayloadArrayItem,
  replaceBlockRoomCollaborativeText,
  replaceBlockRoomPayloadArray,
  replaceRichTextBlockData,
  setBlockRoomAtomicValue,
  type BlockRoomAtomicValue,
  type ReplaceRichTextBlockDataOptions,
} from "./block-room-codec/payload-mutations.ts";
export {
  roomDocumentType,
  roomLocale,
  roomLocaleRole,
  roomSourceLocale,
  type BlockRoomAnchoredMutationOptions,
  type BlockRoomMutationOptions,
  type BlockRoomNodeRef,
  type BlockRoomPayloadRef,
} from "./block-room-codec/room-access.ts";
export {
  assertBlockRoomLocaleChangeAllowed,
  BlockRoomLocaleChangeError,
  BlockRoomLocaleChangeRejectionReason,
  type BlockRoomLocaleChangeRejectionReason as BlockRoomLocaleChangeRejectionReasonType,
} from "./block-room-codec/locale-change-validation.ts";
export {
  blockRoomPresentLocaleValues,
  blockRoomLocaleValueTargetIdentity,
  blockRoomLocaleValueTargetBlockId,
  canonicalBlockRoomLocaleValueTarget,
  canonicalBlockRoomLocaleValueTargetKey,
  canonicalBlockRoomLocaleValueTargets,
  markBlockRoomLocaleValuePresent,
} from "./block-room-codec/locale-presence.ts";
export {
  createBlockRoomInsertionAnchor,
  deleteBlockRoomBaseNode,
  deleteBlockRoomLocaleNode,
  insertPageSectionLocale,
  insertPageSectionNode,
  insertRichTextBlockLocale,
  insertRichTextBlockNode,
  movePageSectionNode,
  moveRichTextBlockNode,
  type BlockRoomContainerRef,
  type InsertRichTextBlockNodeOptions,
} from "./block-room-codec/structure-mutations.ts";
export {
  decodeCanonicalBlockRoomAffectedNodes,
  mergeBlockRoomChangeSets,
  observeBlockRoomChanges,
  observeCanonicalBlockRoom,
  transactBlockRoom,
  type BlockRoomAffectedBaseNodeSnapshot,
  type BlockRoomChangeSet,
  type BlockRoomTransactionOriginKind,
  type CanonicalBlockRoomAffectedSnapshot,
  type CanonicalBlockRoomTransaction,
  type ObservedBlockRoomChange,
} from "./block-room-codec/observation.ts";
