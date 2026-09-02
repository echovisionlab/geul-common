import * as Y from "yjs";
import {
  BLOCK_ROOM_ROOT,
  blockRoomDocumentTypes,
  fail,
  isCollaborativeTextPath,
  stringValue,
  yMap,
  type BlockRoomDocumentType,
  type BlockRoomLocaleRole,
  type BlockRoomNodeFamily,
  type CollaborativeTextPredicate,
} from "./internal.ts";
import {
  blockRoomBaseNodes,
  blockRoomLocaleOverlay,
} from "./materialization.ts";

export interface BlockRoomNodeRef {
  id: string;
  family: BlockRoomNodeFamily;
  locale?: true;
}

export interface BlockRoomPayloadRef extends BlockRoomNodeRef {
  path: string;
}

export interface BlockRoomMutationOptions {
  origin?: unknown;
}

export interface BlockRoomAnchoredMutationOptions extends BlockRoomMutationOptions {
  anchor?: Y.RelativePosition;
}

export function roomDocumentType(yDocument: Y.Doc): BlockRoomDocumentType {
  const value = stringValue(
    yDocument.getMap<unknown>(BLOCK_ROOM_ROOT).get("documentType"),
    "document_type",
  );
  if (!blockRoomDocumentTypes.has(value as BlockRoomDocumentType)) {
    return fail("document_type");
  }
  return value as BlockRoomDocumentType;
}

export function roomSourceLocale(yDocument: Y.Doc): string {
  return stringValue(
    yDocument.getMap<unknown>(BLOCK_ROOM_ROOT).get("sourceLocale"),
    "source_locale",
  );
}

export function roomLocale(yDocument: Y.Doc): string {
  return stringValue(
    yDocument.getMap<unknown>(BLOCK_ROOM_ROOT).get("roomLocale"),
    "room_locale",
  );
}

export function roomLocaleRole(yDocument: Y.Doc): BlockRoomLocaleRole {
  return roomLocale(yDocument) === roomSourceLocale(yDocument)
    ? "source"
    : "target";
}

export function roomNode(
  yDocument: Y.Doc,
  ref: BlockRoomNodeRef,
): Y.Map<unknown> {
  const nodes = ref.locale
    ? blockRoomLocaleOverlay(yDocument)
    : blockRoomBaseNodes(yDocument);
  const node = yMap(nodes.get(ref.id), `node:${ref.id}:missing`);
  const actualFamily = stringValue(node.get("family"), `node:${ref.id}:family`);
  if (actualFamily !== ref.family) fail(`node:${ref.id}:family`);
  return node;
}

type PayloadPathPart = string | number;

function parsePayloadPath(path: string): PayloadPathPart[] {
  if (!path) return fail("payload_path:empty");
  const result: PayloadPathPart[] = [];
  for (const segment of path.split(".")) {
    const match = /^([A-Za-z][A-Za-z0-9]*)(?:\[(\d+)\])?$/.exec(segment);
    if (!match) fail(`payload_path:invalid:${path}`);
    result.push(match[1]!);
    if (match[2] !== undefined) result.push(Number(match[2]));
  }
  return result;
}

function childAtPath(
  value: unknown,
  part: PayloadPathPart,
  reason: string,
): unknown {
  if (typeof part === "string") return yMap(value, reason).get(part);
  const array = value instanceof Y.Array ? value : fail(reason);
  if (part < 0 || part >= array.length) return fail(reason);
  return array.get(part);
}

export function payloadValue(
  node: Y.Map<unknown>,
  path: string,
  reason: string,
): unknown {
  let value: unknown = node.get("payload");
  for (const part of parsePayloadPath(path)) {
    value = childAtPath(value, part, reason);
  }
  return value;
}

export function payloadParent(
  node: Y.Map<unknown>,
  path: string,
  reason: string,
): { parent: Y.Map<unknown> | Y.Array<unknown>; key: PayloadPathPart } {
  const parts = parsePayloadPath(path);
  const key = parts.pop()!;
  let value: unknown = node.get("payload");
  for (const part of parts) value = childAtPath(value, part, reason);
  if (!(value instanceof Y.Map) && !(value instanceof Y.Array))
    return fail(reason);
  if (typeof key === "string" && !(value instanceof Y.Map)) return fail(reason);
  if (typeof key === "number" && !(value instanceof Y.Array))
    return fail(reason);
  return { parent: value, key };
}

export function payloadArray(
  node: Y.Map<unknown>,
  path: string,
  reason: string,
): Y.Array<unknown> {
  const value = payloadValue(node, path, reason);
  return value instanceof Y.Array ? value : fail(reason);
}

export function nodeKind(node: Y.Map<unknown>, ref: BlockRoomNodeRef): string {
  return stringValue(node.get("kind"), `node:${ref.id}:kind`);
}

export function nodeTextPredicate(
  node: Y.Map<unknown>,
  ref: BlockRoomNodeRef,
): CollaborativeTextPredicate {
  const kind = nodeKind(node, ref);
  return (path) => isCollaborativeTextPath(ref.family, kind, path);
}
