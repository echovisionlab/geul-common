import { toJson, type JsonValue } from "@bufbuild/protobuf";
import {
  richTextBlockKindByProtoCase,
  type RichTextBlockKind,
} from "@echovisionlab/geul-proto/content/block_catalog.ts";
import {
  RichTextBlockDataSchema,
  RichTextBlockLocaleDataSchema,
  type RichTextBlockData,
  type RichTextBlockLocaleData,
} from "@echovisionlab/geul-proto/content/block_content_pb.ts";
import * as Y from "yjs";
import {
  arrayPath,
  fail,
  fromYValue,
  isCollaborativeTextPath,
  jsonObject,
  setNodePayload,
  toYValue,
} from "./internal.ts";
import { blockRoomLocaleOverlay } from "./materialization.ts";
import {
  nodeKind,
  nodeTextPredicate,
  payloadArray,
  payloadParent,
  payloadValue,
  roomNode,
  type BlockRoomMutationOptions,
  type BlockRoomNodeRef,
  type BlockRoomPayloadRef,
  roomLocaleRole,
} from "./room-access.ts";
import {
  deleteBlockRoomLocalePresenceForBlocks,
  markAllBlockRoomLocaleValuesPresentForBlock,
} from "./locale-presence.ts";

export type BlockRoomAtomicValue = string | number | boolean | null;

export function getBlockRoomCollaborativeText(
  yDocument: Y.Doc,
  ref: BlockRoomPayloadRef,
): Y.Text {
  const node = roomNode(yDocument, ref);
  if (!isCollaborativeTextPath(ref.family, nodeKind(node, ref), ref.path)) {
    return fail(`node:${ref.id}:not_collaborative_text:${ref.path}`);
  }
  const value = payloadValue(node, ref.path, `node:${ref.id}:path:${ref.path}`);
  return value instanceof Y.Text
    ? value
    : fail(`node:${ref.id}:text_shape:${ref.path}`);
}

export function replaceBlockRoomCollaborativeText(
  yDocument: Y.Doc,
  ref: BlockRoomPayloadRef,
  value: string,
  options: BlockRoomMutationOptions = {},
): void {
  yDocument.transact(() => {
    const node = roomNode(yDocument, ref);
    if (!isCollaborativeTextPath(ref.family, nodeKind(node, ref), ref.path)) {
      fail(`node:${ref.id}:not_collaborative_text:${ref.path}`);
    }
    const { parent, key } = payloadParent(
      node,
      ref.path,
      `node:${ref.id}:path:${ref.path}`,
    );
    const textParent = parent as Y.Map<unknown>;
    const textKey = key as string;
    const existing = textParent.get(textKey);
    const text = existing === undefined ? new Y.Text() : existing;
    if (!(text instanceof Y.Text))
      fail(`node:${ref.id}:text_shape:${ref.path}`);
    if (existing === undefined) textParent.set(textKey, text);
    if (text.length > 0) text.delete(0, text.length);
    if (value) text.insert(0, value);
  }, options.origin);
}

export function getBlockRoomAtomicValue(
  yDocument: Y.Doc,
  ref: BlockRoomPayloadRef,
): BlockRoomAtomicValue {
  const node = roomNode(yDocument, ref);
  if (isCollaborativeTextPath(ref.family, nodeKind(node, ref), ref.path)) {
    return fail(`node:${ref.id}:collaborative_text:${ref.path}`);
  }
  const value = payloadValue(node, ref.path, `node:${ref.id}:path:${ref.path}`);
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return value;
  return fail(`node:${ref.id}:not_atomic:${ref.path}`);
}

export function setBlockRoomAtomicValue(
  yDocument: Y.Doc,
  ref: BlockRoomPayloadRef,
  value: BlockRoomAtomicValue,
  options: BlockRoomMutationOptions = {},
): void {
  yDocument.transact(() => {
    const node = roomNode(yDocument, ref);
    if (isCollaborativeTextPath(ref.family, nodeKind(node, ref), ref.path)) {
      fail(`node:${ref.id}:collaborative_text:${ref.path}`);
    }
    const { parent, key } = payloadParent(
      node,
      ref.path,
      `node:${ref.id}:path:${ref.path}`,
    );
    if (parent instanceof Y.Map && typeof key === "string") {
      parent.set(key, value);
      return;
    }
    const array = parent as Y.Array<unknown>;
    const index = key as number;
    if (index < 0 || index >= array.length)
      fail(`node:${ref.id}:path:${ref.path}`);
    array.delete(index, 1);
    array.insert(index, [value]);
  }, options.origin);
}

export function deleteBlockRoomAtomicValue(
  yDocument: Y.Doc,
  ref: BlockRoomPayloadRef,
  options: BlockRoomMutationOptions = {},
): void {
  yDocument.transact(() => {
    const node = roomNode(yDocument, ref);
    if (isCollaborativeTextPath(ref.family, nodeKind(node, ref), ref.path)) {
      fail(`node:${ref.id}:collaborative_text:${ref.path}`);
    }
    const { parent, key } = payloadParent(
      node,
      ref.path,
      `node:${ref.id}:path:${ref.path}`,
    );
    if (parent instanceof Y.Map && typeof key === "string") {
      if (!parent.has(key)) fail(`node:${ref.id}:path:${ref.path}`);
      parent.delete(key);
      return;
    }
    const array = parent as Y.Array<unknown>;
    const index = key as number;
    if (index < 0 || index >= array.length)
      fail(`node:${ref.id}:path:${ref.path}`);
    array.delete(index, 1);
  }, options.origin);
}

function payloadArrayForReplacement(
  node: Y.Map<unknown>,
  path: string,
  reason: string,
): Y.Array<unknown> {
  const { parent, key } = payloadParent(node, path, reason);
  if (!(parent instanceof Y.Map) || typeof key !== "string") {
    return payloadArray(node, path, reason);
  }
  const existing = parent.get(key);
  if (existing instanceof Y.Array) return existing;
  if (existing !== undefined) return fail(reason);
  const array = new Y.Array<unknown>();
  parent.set(key, array);
  return array;
}

export function insertBlockRoomPayloadArrayItem(
  yDocument: Y.Doc,
  ref: BlockRoomPayloadRef,
  index: number,
  value: JsonValue,
  options: BlockRoomMutationOptions = {},
): void {
  yDocument.transact(() => {
    const node = roomNode(yDocument, ref);
    const array = payloadArray(
      node,
      ref.path,
      `node:${ref.id}:path:${ref.path}`,
    );
    if (!Number.isSafeInteger(index) || index < 0 || index > array.length) {
      fail(`node:${ref.id}:array_index:${ref.path}`);
    }
    array.insert(index, [
      toYValue(value, arrayPath(ref.path, index), nodeTextPredicate(node, ref)),
    ]);
  }, options.origin);
}

export function replaceBlockRoomPayloadArray(
  yDocument: Y.Doc,
  ref: BlockRoomPayloadRef,
  values: readonly JsonValue[],
  options: BlockRoomMutationOptions = {},
): void {
  yDocument.transact(() => {
    const node = roomNode(yDocument, ref);
    const array = payloadArrayForReplacement(
      node,
      ref.path,
      `node:${ref.id}:path:${ref.path}`,
    );
    if (array.length > 0) array.delete(0, array.length);
    if (values.length > 0) {
      array.insert(
        0,
        values.map((value, index) =>
          toYValue(
            value,
            arrayPath(ref.path, index),
            nodeTextPredicate(node, ref),
          ),
        ),
      );
    }
  }, options.origin);
}

export function deleteBlockRoomPayloadArrayItem(
  yDocument: Y.Doc,
  ref: BlockRoomPayloadRef,
  index: number,
  options: BlockRoomMutationOptions = {},
): void {
  yDocument.transact(() => {
    const node = roomNode(yDocument, ref);
    const array = payloadArray(
      node,
      ref.path,
      `node:${ref.id}:path:${ref.path}`,
    );
    if (!Number.isSafeInteger(index) || index < 0 || index >= array.length) {
      fail(`node:${ref.id}:array_index:${ref.path}`);
    }
    array.delete(index, 1);
  }, options.origin);
}

export function moveBlockRoomPayloadArrayItem(
  yDocument: Y.Doc,
  ref: BlockRoomPayloadRef,
  fromIndex: number,
  toIndex: number,
  options: BlockRoomMutationOptions = {},
): void {
  yDocument.transact(() => {
    const node = roomNode(yDocument, ref);
    const array = payloadArray(
      node,
      ref.path,
      `node:${ref.id}:path:${ref.path}`,
    );
    if (
      !Number.isSafeInteger(fromIndex) ||
      !Number.isSafeInteger(toIndex) ||
      fromIndex < 0 ||
      fromIndex >= array.length ||
      toIndex < 0 ||
      toIndex >= array.length
    )
      fail(`node:${ref.id}:array_index:${ref.path}`);
    if (fromIndex === toIndex) return;
    const value = fromYValue(array.get(fromIndex));
    array.delete(fromIndex, 1);
    array.insert(toIndex, [
      toYValue(
        value,
        arrayPath(ref.path, toIndex),
        nodeTextPredicate(node, ref),
      ),
    ]);
  }, options.origin);
}

function oneofData(
  value: JsonValue,
  reason: string,
): { kind: string; payload: JsonValue } {
  const object = jsonObject(value, reason);
  const cases = Object.keys(object);
  if (cases.length !== 1) fail(`${reason}:invalid_oneof`);
  const kind = cases[0]!;
  return { kind, payload: object[kind]! };
}

export interface ReplaceRichTextBlockDataOptions extends BlockRoomMutationOptions {
  expectedKind: RichTextBlockKind;
  localeData: RichTextBlockLocaleData | null;
}

export function replaceRichTextBlockData(
  yDocument: Y.Doc,
  id: string,
  data: RichTextBlockData,
  options: ReplaceRichTextBlockDataOptions,
): void {
  yDocument.transact(() => {
    const ref: BlockRoomNodeRef = { id, family: "rich_text" };
    const node = roomNode(yDocument, ref);
    const currentKind = nodeKind(node, ref);
    const currentCatalogKind =
      richTextBlockKindByProtoCase[
        currentKind as keyof typeof richTextBlockKindByProtoCase
      ];
    if (currentCatalogKind !== options.expectedKind)
      fail(`node:${id}:kind_changed`);
    const base = oneofData(
      toJson(RichTextBlockDataSchema, data),
      `node:${id}:base_data`,
    );
    const parsedLocale =
      options.localeData === null
        ? null
        : oneofData(
            toJson(RichTextBlockLocaleDataSchema, options.localeData),
            `node:${id}:locale_data`,
          );
    if (parsedLocale && parsedLocale.kind !== base.kind)
      fail(`node:${id}:locale_kind`);
    const sourceRoom = roomLocaleRole(yDocument) === "source";
    if (sourceRoom)
      deleteBlockRoomLocalePresenceForBlocks(yDocument, new Set([id]));
    setNodePayload(node, "rich_text", base.kind, base.payload);
    const localeNodes = blockRoomLocaleOverlay(yDocument);
    localeNodes.delete(id);
    if (!parsedLocale) return;
    const localeNode = new Y.Map<unknown>();
    setNodePayload(
      localeNode,
      "rich_text",
      parsedLocale.kind,
      parsedLocale.payload,
    );
    localeNodes.set(id, localeNode);
    if (sourceRoom) markAllBlockRoomLocaleValuesPresentForBlock(yDocument, id);
  }, options.origin);
}
