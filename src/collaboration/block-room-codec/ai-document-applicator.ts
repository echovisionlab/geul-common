import { create, fromJson } from "@bufbuild/protobuf";
import {
  richTextBlockCatalog,
  richTextBlockKindByProtoCase,
  type RichTextBlockKind,
} from "@echovisionlab/geul-proto/content/block_catalog.ts";
import {
  RichTextBlockDataSchema,
  RichTextBlockLocaleDataSchema,
  RichTextBlockLocaleSchema,
  RichTextBlockNodeSchema,
  type RichTextBlockData,
  type RichTextBlockLocale,
  type RichTextBlockLocaleData,
  type RichTextBlockNode,
} from "@echovisionlab/geul-proto/content/block_content_pb.ts";
import {
  AIDocumentFieldTargetSchema,
  type AIDocumentOperation,
} from "@echovisionlab/geul-proto/secure/ai_pb.ts";
import * as Y from "yjs";
import {
  attachAIDocumentFile,
  detachAIDocumentFile,
  setAIDocumentField,
  unsetAIDocumentField,
} from "./ai-document-field-mutations.ts";
import { applyPageStructureAIDocumentOperation } from "./ai-document-page-structure-mutations.ts";
import { operationFail, requiredHandle } from "./ai-document-values.ts";
import { yMap, type BlockRoomDocumentType } from "./internal.ts";
import { assertBlockRoomLocaleChangeAllowed } from "./locale-change-validation.ts";
import {
  canonicalBlockRoomLocaleValueTarget,
  markBlockRoomLocaleValuePresent,
} from "./locale-presence.ts";
import {
  decodeCanonicalBlockRoom,
  materializeCanonicalBlockRoom,
} from "./materialization.ts";
import { replaceRichTextBlockData } from "./payload-mutations.ts";
import {
  roomDocumentType,
  roomLocale,
  roomLocaleRole,
  roomNode,
} from "./room-access.ts";
import {
  deleteBlockRoomBaseNode,
  insertRichTextBlockNode,
  insertRichTextBlockLocale,
  moveRichTextBlockNode,
} from "./structure-mutations.ts";

export interface ApplyAIDocumentOperationsOptions {
  expectedRoomLocale: string;
  origin: object;
}

const richTextProtoCaseByKind = new Map<string, string>(
  Object.entries(richTextBlockKindByProtoCase).map(([protoCase, kind]) => [
    kind,
    protoCase,
  ]),
);

function siblingPosition(
  yDocument: Y.Doc,
  parentId: string | null,
  afterId: string | undefined,
  movingId?: string,
): number {
  const snapshot = decodeCanonicalBlockRoom(
    yDocument,
    roomDocumentType(yDocument),
  );
  const siblings = snapshot.baseNodes
    .filter((node) => node.parentId === parentId && node.id !== movingId)
    .sort((left, right) => left.position - right.position);
  if (afterId === undefined) return 0;
  const after = siblings.findIndex(({ id }) => id === afterId);
  return after < 0
    ? operationFail(`after_block:${afterId}:not_sibling`)
    : after + 1;
}

function richTextNode(
  blockId: string,
  kind: string,
  parentId: string | undefined,
  index: number,
): { node: RichTextBlockNode; locale: RichTextBlockLocale } {
  const protoCase = richTextProtoCaseByKind.get(kind);
  if (!protoCase) return operationFail(`block_kind:${kind}`);
  return {
    node: fromJson(RichTextBlockNodeSchema, {
      block: { id: blockId, [protoCase]: {} },
      placement: {
        index,
        ...(parentId ? { parentBlockId: parentId } : {}),
      },
    }) as RichTextBlockNode,
    locale: fromJson(RichTextBlockLocaleSchema, {
      blockId,
      [protoCase]: {},
    }) as RichTextBlockLocale,
  };
}

function insertBlock(
  yDocument: Y.Doc,
  value: Extract<
    AIDocumentOperation["operation"],
    { case: "insertBlock" }
  >["value"],
): void {
  const id = requiredHandle(value.blockHandle, "insert:block");
  const kind = requiredHandle(value.kind, "insert:kind");
  const parentId = value.parentBlockHandle ?? null;
  const index = siblingPosition(yDocument, parentId, value.afterBlockHandle);
  const created = richTextNode(id, kind, value.parentBlockHandle, index);
  insertRichTextBlockNode(yDocument, created.node);
  insertRichTextBlockLocale(yDocument, created.locale);
  const content = (
    richTextBlockCatalog as Readonly<
      Record<string, { readonly content: string }>
    >
  )[kind]?.content;
  if (
    roomLocaleRole(yDocument) === "source" &&
    roomDocumentType(yDocument) === "page" &&
    (content === "inline" || content === "locale_text")
  ) {
    const localePayload = yMap(
      roomNode(yDocument, {
        id,
        family: "rich_text",
        locale: true,
      }).get("payload"),
      "insert:locale",
    );
    localePayload.set(
      "content",
      content === "inline" ? new Y.Array<unknown>() : new Y.Text(),
    );
    markBlockRoomLocaleValuePresent(
      yDocument,
      create(AIDocumentFieldTargetSchema, {
        owner: { case: "blockHandle", value: id },
        fieldHandle: "content",
      }),
    );
  }
}

function moveBlock(
  yDocument: Y.Doc,
  blockId: string,
  parentId: string | undefined,
  afterId: string | undefined,
): void {
  const snapshot = decodeCanonicalBlockRoom(
    yDocument,
    roomDocumentType(yDocument),
  );
  const node = snapshot.baseNodes.find(({ id }) => id === blockId);
  if (!node) return operationFail(`move:block:${blockId}`);
  const index = siblingPosition(yDocument, parentId ?? null, afterId, blockId);
  moveRichTextBlockNode(yDocument, blockId, {
    ...(parentId ? { parentBlockId: parentId } : {}),
    index,
  });
}

function replaceBlockKind(
  yDocument: Y.Doc,
  blockId: string,
  kind: string,
): void {
  const snapshot = decodeCanonicalBlockRoom(
    yDocument,
    roomDocumentType(yDocument),
  );
  const current = snapshot.baseNodes.find(({ id }) => id === blockId);
  if (!current) return operationFail(`replace:block:${blockId}`);
  const protoCase = richTextProtoCaseByKind.get(kind);
  const currentCatalogKind =
    richTextBlockKindByProtoCase[
      current.kind as keyof typeof richTextBlockKindByProtoCase
    ];
  if (!protoCase) return operationFail(`replace:kind:${kind}`);
  const data = fromJson(RichTextBlockDataSchema, {
    [protoCase]: {},
  }) as RichTextBlockData;
  const locale = fromJson(RichTextBlockLocaleDataSchema, {
    [protoCase]: {},
  }) as RichTextBlockLocaleData;
  replaceRichTextBlockData(yDocument, blockId, data, {
    expectedKind: currentCatalogKind as RichTextBlockKind,
    localeData: locale,
  });
}

function applyOperation(
  yDocument: Y.Doc,
  documentType: BlockRoomDocumentType,
  operation: AIDocumentOperation,
): void {
  if (
    documentType === "page" &&
    applyPageStructureAIDocumentOperation(yDocument, operation)
  ) {
    return;
  }
  switch (operation.operation.case) {
    case "setField":
      setAIDocumentField(
        yDocument,
        operation.operation.value.target,
        operation.operation.value.value,
      );
      return;
    case "unsetField":
      unsetAIDocumentField(yDocument, operation.operation.value.target);
      return;
    case "insertBlock":
      insertBlock(yDocument, operation.operation.value);
      return;
    case "deleteBlock":
      deleteBlockRoomBaseNode(
        yDocument,
        requiredHandle(operation.operation.value.blockHandle, "delete:block"),
      );
      return;
    case "moveBlock":
      moveBlock(
        yDocument,
        requiredHandle(operation.operation.value.blockHandle, "move:block"),
        operation.operation.value.parentBlockHandle,
        operation.operation.value.afterBlockHandle,
      );
      return;
    case "replaceBlockKind":
      replaceBlockKind(
        yDocument,
        requiredHandle(operation.operation.value.blockHandle, "replace:block"),
        requiredHandle(operation.operation.value.kind, "replace:kind"),
      );
      return;
    case "attachFile":
      attachAIDocumentFile(
        yDocument,
        operation.operation.value.target,
        operation.operation.value.fileHandle,
      );
      return;
    case "detachFile":
      detachAIDocumentFile(yDocument, operation.operation.value.target);
      return;
    case "insertRelationItem":
    case "deleteRelationItem":
    case "moveRelationItem":
    case "createTranslation":
    case "deleteTranslation":
      operationFail(`unsupported:${operation.operation.case}`);
    case undefined:
      operationFail("missing_kind");
  }
}

/**
 * Applies one already-authorized and normalized DCDP batch to a Block Room.
 * The resident document stays untouched unless the complete result validates.
 */
export function applyAIDocumentOperationsToBlockRoom(
  yDocument: Y.Doc,
  documentType: BlockRoomDocumentType,
  operations: readonly AIDocumentOperation[],
  options: ApplyAIDocumentOperationsOptions,
): boolean {
  if (roomDocumentType(yDocument) !== documentType)
    operationFail("document_type");
  if (
    !options.expectedRoomLocale ||
    roomLocale(yDocument) !== options.expectedRoomLocale
  )
    operationFail("room_locale");
  if (!options.origin || typeof options.origin !== "object")
    operationFail("origin");
  if (operations.length === 0) return false;
  if (
    operations.some(({ operation }) => {
      if (operation.case !== "unsetField") return false;
      if (roomLocaleRole(yDocument) === "target") return true;
      try {
        canonicalBlockRoomLocaleValueTarget(yDocument, operation.value.target);
        return true;
      } catch {
        return operation.value.target?.fieldHandle === "tableContent";
      }
    })
  ) {
    operationFail("locale_clear");
  }
  const before = Y.encodeStateVector(yDocument);
  const working = new Y.Doc();
  let update: Uint8Array;
  try {
    Y.applyUpdate(working, Y.encodeStateAsUpdate(yDocument));
    for (const operation of operations)
      applyOperation(working, documentType, operation);
    assertBlockRoomLocaleChangeAllowed(yDocument, working, documentType);
    materializeCanonicalBlockRoom(working, documentType);
    update = Y.encodeStateAsUpdate(working, before);
  } finally {
    working.destroy();
  }
  Y.applyUpdate(yDocument, update, options.origin);
  return true;
}
