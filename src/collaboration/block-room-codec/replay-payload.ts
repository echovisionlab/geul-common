import type { JsonValue } from "@bufbuild/protobuf";
import * as Y from "yjs";
import {
  deleteBlockRoomPayloadArrayItem,
  insertBlockRoomPayloadArrayItem,
  moveBlockRoomPayloadArrayItem,
  replaceBlockRoomCollaborativeText,
  replaceBlockRoomPayloadArray,
  setBlockRoomAtomicValue,
} from "./payload-mutations.ts";
import { fail, fromYValue } from "./internal.ts";
import {
  nodeTextPredicate,
  payloadParent,
  payloadValue,
  roomNode,
  type BlockRoomNodeRef,
  type BlockRoomPayloadRef,
} from "./room-access.ts";
import { longestCommonSubsequence } from "./replay-structure.ts";

const STABLE_ARRAY_ID_FIELDS = ["id", "rowId", "cellId", "unitId"] as const;

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function jsonObject(
  value: JsonValue | undefined,
): Record<string, JsonValue> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : undefined;
}

function payloadRef(node: BlockRoomNodeRef, path: string): BlockRoomPayloadRef {
  return { ...node, path };
}

function readPayload(document: Y.Doc, ref: BlockRoomPayloadRef): unknown {
  return payloadValue(
    roomNode(document, ref),
    ref.path,
    `replay:payload:${ref.id}:${ref.path}`,
  );
}

function isJsonArray(value: unknown): value is JsonValue[] {
  return Array.isArray(value);
}

function stableArrayIdentityField(
  before: readonly JsonValue[],
  after: readonly JsonValue[],
): (typeof STABLE_ARRAY_ID_FIELDS)[number] | undefined {
  const compatible = (values: readonly JsonValue[], field: string) => {
    const ids = values.map((value) => jsonObject(value)?.[field]);
    return (
      ids.every((id) => typeof id === "string" && id.length > 0) &&
      new Set(ids).size === ids.length
    );
  };
  for (const field of STABLE_ARRAY_ID_FIELDS) {
    if (compatible(before, field) && compatible(after, field)) return field;
  }
  return undefined;
}

function identityOf(value: JsonValue, field: string): string {
  const identity = jsonObject(value)?.[field];
  return typeof identity === "string" && identity.length > 0
    ? identity
    : fail(`replay:stable_array_identity:${field}`);
}

function currentArrayItems(
  array: Y.Array<unknown>,
  field: string,
): JsonValue[] {
  const values = array.toArray().map((value) => fromYValue(value));
  const ids = values.map((value) => identityOf(value, field));
  if (new Set(ids).size !== ids.length)
    fail(`replay:stable_array_duplicate:${field}`);
  return values;
}

function indexOfIdentity(
  values: readonly JsonValue[],
  field: string,
  id: string,
): number {
  return values.findIndex((value) => identityOf(value, field) === id);
}

function arrayPathItem(path: string, index: number): string {
  return `${path}[${index}]`;
}

function mergeStableArray(
  document: Y.Doc,
  ref: BlockRoomNodeRef,
  path: string,
  before: readonly JsonValue[],
  after: readonly JsonValue[],
  identityField: string,
): void {
  const initial = readPayload(document, payloadRef(ref, path));
  if (initial === undefined) {
    replaceBlockRoomPayloadArray(document, payloadRef(ref, path), []);
  }
  const inserted = readPayload(document, payloadRef(ref, path));
  if (!(inserted instanceof Y.Array))
    fail(`replay:stable_array_shape:${ref.id}:${path}`);
  const raw: Y.Array<unknown> = inserted;
  const beforeIds = before.map((value) => identityOf(value, identityField));
  const afterIds = after.map((value) => identityOf(value, identityField));
  const beforeSet = new Set(beforeIds);
  const afterSet = new Set(afterIds);
  const beforeById = new Map(
    before.map((value) => [identityOf(value, identityField), value]),
  );
  const afterById = new Map(
    after.map((value) => [identityOf(value, identityField), value]),
  );

  for (const id of beforeIds) {
    if (afterSet.has(id)) continue;
    const values = currentArrayItems(raw, identityField);
    const index = indexOfIdentity(values, identityField, id);
    if (index >= 0)
      deleteBlockRoomPayloadArrayItem(document, payloadRef(ref, path), index);
  }

  for (const id of beforeIds) {
    if (!afterSet.has(id)) continue;
    const values = currentArrayItems(raw, identityField);
    const index = indexOfIdentity(values, identityField, id);
    if (index < 0) continue;
    const oldValue = beforeById.get(id)!;
    const nextValue = afterById.get(id)!;
    if (!sameValue(oldValue, nextValue)) {
      applyPayloadDiff(
        document,
        payloadRef(ref, arrayPathItem(path, index)),
        oldValue,
        nextValue,
      );
    }
  }

  for (let afterIndex = 0; afterIndex < afterIds.length; afterIndex += 1) {
    const id = afterIds[afterIndex]!;
    if (beforeSet.has(id)) continue;
    const values = currentArrayItems(raw, identityField);
    if (indexOfIdentity(values, identityField, id) >= 0) continue;
    const nextId = afterIds
      .slice(afterIndex + 1)
      .find(
        (candidate) => indexOfIdentity(values, identityField, candidate) >= 0,
      );
    const insertionIndex = nextId
      ? indexOfIdentity(values, identityField, nextId)
      : values.length;
    insertBlockRoomPayloadArrayItem(
      document,
      payloadRef(ref, path),
      insertionIndex,
      afterById.get(id)!,
    );
  }

  const common = beforeIds.filter((id) => afterSet.has(id));
  const afterCommon = afterIds.filter((id) => beforeSet.has(id));
  const retained = longestCommonSubsequence(common, afterCommon);
  for (const id of [...afterCommon].reverse()) {
    if (retained.has(id)) continue;
    const values = currentArrayItems(raw, identityField);
    const fromIndex = indexOfIdentity(values, identityField, id);
    if (fromIndex < 0) continue;
    const afterPosition = afterIds.indexOf(id);
    const nextId = afterIds
      .slice(afterPosition + 1)
      .find(
        (candidate) => indexOfIdentity(values, identityField, candidate) >= 0,
      );
    const nextIndex = nextId
      ? indexOfIdentity(values, identityField, nextId)
      : values.length;
    const toIndex = nextIndex - (fromIndex < nextIndex ? 1 : 0);
    if (fromIndex === toIndex) continue;
    moveBlockRoomPayloadArrayItem(
      document,
      payloadRef(ref, path),
      fromIndex,
      Math.max(0, toIndex),
    );
  }
}

function ensureObjectAtPath(
  document: Y.Doc,
  ref: BlockRoomPayloadRef,
): Y.Map<unknown> {
  const value = readPayload(document, ref);
  if (value instanceof Y.Map) return value;
  const { parent, key } = payloadParent(
    roomNode(document, ref),
    ref.path,
    `replay:payload:${ref.id}:${ref.path}`,
  );
  // Object diffs recurse only after ensuring their parent object path.
  const objectParent = parent as Y.Map<unknown>;
  const objectKey = key as string;
  const map = new Y.Map<unknown>();
  objectParent.set(objectKey, map);
  return map;
}

function deletePayloadValue(document: Y.Doc, ref: BlockRoomPayloadRef): void {
  const value = readPayload(document, ref);
  if (value === undefined) return;
  const { parent, key } = payloadParent(
    roomNode(document, ref),
    ref.path,
    `replay:payload:${ref.id}:${ref.path}`,
  );
  // Deletion diffs are emitted only for object keys, never array indexes.
  const objectParent = parent as Y.Map<unknown>;
  const objectKey = key as string;
  objectParent.delete(objectKey);
}

function writePayloadValue(
  document: Y.Doc,
  ref: BlockRoomPayloadRef,
  value: JsonValue[] | string | number | boolean | null,
): void {
  if (Array.isArray(value)) {
    replaceBlockRoomPayloadArray(document, ref, value);
    return;
  }
  const node = roomNode(document, ref);
  if (typeof value === "string" && nodeTextPredicate(node, ref)(ref.path)) {
    replaceBlockRoomCollaborativeText(document, ref, value);
  } else {
    setBlockRoomAtomicValue(document, ref, value);
  }
}

function applyPayloadDiff(
  document: Y.Doc,
  ref: BlockRoomPayloadRef,
  before: JsonValue | undefined,
  after: JsonValue | undefined,
): void {
  if (after === undefined) {
    deletePayloadValue(document, ref);
    return;
  }
  const beforeObject = jsonObject(before);
  if (after !== null && typeof after === "object" && !Array.isArray(after)) {
    const afterObject = after as Record<string, JsonValue>;
    const current = (() => {
      try {
        return readPayload(document, ref);
      } catch {
        return undefined;
      }
    })();
    if (current !== undefined && !(current instanceof Y.Map))
      fail(`replay:payload_shape:${ref.id}:${ref.path}`);
    ensureObjectAtPath(document, ref);
    for (const key of new Set([
      ...Object.keys(beforeObject ?? {}),
      ...Object.keys(afterObject),
    ])) {
      const oldValue = beforeObject?.[key];
      const nextValue = afterObject[key];
      if (sameValue(oldValue, nextValue)) continue;
      applyPayloadDiff(
        document,
        payloadRef(ref, `${ref.path}.${key}`),
        oldValue,
        nextValue,
      );
    }
    return;
  }
  if (isJsonArray(before) && isJsonArray(after)) {
    const identityField = stableArrayIdentityField(before, after);
    if (identityField) {
      mergeStableArray(document, ref, ref.path, before, after, identityField);
      return;
    }
  }
  writePayloadValue(document, ref, after);
}

export function applyPayloadRootDiff(
  document: Y.Doc,
  ref: BlockRoomNodeRef,
  before: JsonValue,
  after: JsonValue,
): void {
  const beforeObject = jsonObject(before);
  const afterObject = jsonObject(after);
  if (!beforeObject || !afterObject) fail(`replay:payload_root:${ref.id}`);
  for (const key of new Set([
    ...Object.keys(beforeObject),
    ...Object.keys(afterObject),
  ])) {
    const oldValue = beforeObject[key];
    const nextValue = afterObject[key];
    if (sameValue(oldValue, nextValue)) continue;
    applyPayloadDiff(document, payloadRef(ref, key), oldValue, nextValue);
  }
}
