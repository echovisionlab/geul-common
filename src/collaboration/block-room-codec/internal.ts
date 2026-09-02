import { fromJson, toJson, type JsonValue } from "@bufbuild/protobuf";
import {
  canonicalLocalizedPageDocumentBytes,
  canonicalLocalizedRichTextDocumentBytes,
  isPageSectionCollaborativeTextPath,
  isRichTextCollaborativeTextPath,
  pageSectionKindByProtoCase,
  richTextBlockKindByProtoCase,
  validateLocalizedPageDocument,
  validateLocalizedRichTextDocument,
  type PageSectionKind,
  type RichTextBlockKind,
} from "@echovisionlab/geul-proto/content/block_catalog.ts";
import {
  LocalizedPageDocumentSchema,
  LocalizedRichTextDocumentSchema,
  RichTextProfile,
  type LocalizedPageDocument,
  type LocalizedRichTextDocument,
} from "@echovisionlab/geul-proto/content/block_content_pb.ts";
import * as Y from "yjs";

export const BLOCK_ROOM_ROOT = "block-document";
export const BLOCK_ROOM_BASE_NODES = "baseNodes";
export const BLOCK_ROOM_BASE_ORDER = "baseOrder";
export const BLOCK_ROOM_LOCALE_OVERLAY = "localeOverlay";
export const BLOCK_ROOM_LOCALE_PRESENCE = "localePresence";

export type BlockRoomDocumentType =
  | "post"
  | "page"
  | "work"
  | "program-event"
  | "artist"
  | "label"
  | "release"
  | "campaign"
  | "email-template"
  | "terms-history"
  | "privacy-history";
export type BlockRoomTypedDocument =
  LocalizedRichTextDocument | LocalizedPageDocument;
export type RichTextBlockRoomDocumentType = Exclude<
  BlockRoomDocumentType,
  "page"
>;
export type BlockRoomLocaleRole = "source" | "target";
export type BlockRoomNodeFamily = "page_section" | "rich_text";
export type JsonObject = { [key: string]: JsonValue };
export type CollaborativeTextPredicate = (path: string) => boolean;

const richTextProfileByDocumentType = {
  post: RichTextProfile.POST,
  work: RichTextProfile.WORK,
  "program-event": RichTextProfile.PROGRAM_EVENT,
  artist: RichTextProfile.COMPACT,
  label: RichTextProfile.COMPACT,
  release: RichTextProfile.COMPACT,
  campaign: RichTextProfile.EMAIL,
  "email-template": RichTextProfile.EMAIL,
  "terms-history": RichTextProfile.POLICY,
  "privacy-history": RichTextProfile.POLICY,
} as const satisfies Record<
  Exclude<BlockRoomDocumentType, "page">,
  RichTextProfile
>;

export const blockRoomDocumentTypes = new Set<BlockRoomDocumentType>([
  "post",
  "page",
  "work",
  "program-event",
  "artist",
  "label",
  "release",
  "campaign",
  "email-template",
  "terms-history",
  "privacy-history",
]);

export const ROOT_KEYS = new Set([
  "documentType",
  "blockCatalogFingerprint",
  "profile",
  "sourceLocale",
  "roomLocale",
  BLOCK_ROOM_BASE_NODES,
  BLOCK_ROOM_BASE_ORDER,
  BLOCK_ROOM_LOCALE_OVERLAY,
  BLOCK_ROOM_LOCALE_PRESENCE,
]);
export const BASE_NODE_KEYS = new Set([
  "family",
  "kind",
  "payload",
  "parentId",
  "containerSlot",
  "columnId",
]);
export const LOCALE_NODE_KEYS = new Set(["family", "kind", "payload"]);

export function fail(reason: string): never {
  throw new Error(`block_room_invalid:${reason}`);
}

export function jsonObject(
  value: JsonValue | undefined,
  reason: string,
): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail(reason);
  return value as JsonObject;
}

export function stringValue(value: unknown, reason: string): string {
  return typeof value === "string" && value !== "" ? value : fail(reason);
}

export function integerValue(value: unknown, reason: string): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : fail(reason);
}

export function assertExactKeys(
  map: Y.Map<unknown>,
  allowed: ReadonlySet<string>,
  reason: string,
): void {
  for (const key of map.keys()) {
    if (!allowed.has(key)) fail(`${reason}:unknown_key:${key}`);
  }
}

export function yMap(value: unknown, reason: string): Y.Map<unknown> {
  return value instanceof Y.Map ? value : fail(reason);
}

function childPath(parent: string, child: string): string {
  return parent ? `${parent}.${child}` : child;
}

export function arrayPath(parent: string, index: number): string {
  return `${parent}[${index}]`;
}

export function toYValue(
  value: JsonValue,
  path: string,
  isCollaborativeText: CollaborativeTextPredicate,
): unknown {
  if (typeof value === "string") {
    if (!isCollaborativeText(path)) return value;
    const text = new Y.Text();
    if (value) text.insert(0, value);
    return text;
  }
  if (Array.isArray(value)) {
    const array = new Y.Array<unknown>();
    if (value.length > 0) {
      array.insert(
        0,
        value.map((child, index) =>
          toYValue(child, arrayPath(path, index), isCollaborativeText),
        ),
      );
    }
    return array;
  }
  if (value && typeof value === "object") {
    const map = new Y.Map<unknown>();
    for (const [key, child] of Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      map.set(key, toYValue(child, childPath(path, key), isCollaborativeText));
    }
    return map;
  }
  return value;
}

export function fromYValue(value: unknown): JsonValue {
  if (value instanceof Y.Text) return value.toString();
  if (value instanceof Y.Array) return value.toArray().map(fromYValue);
  if (value instanceof Y.Map) {
    return Object.fromEntries(
      [...value.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, fromYValue(child)]),
    );
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return value;
  return fail("non_json_value");
}

export function oneofPayload(
  message: JsonObject,
  idField: string,
  reason: string,
): { id: string; kind: string; payload: JsonValue } {
  const id = stringValue(message[idField], `${reason}:missing_id`);
  const cases = Object.keys(message).filter((key) => key !== idField);
  if (cases.length !== 1) fail(`${reason}:invalid_oneof`);
  const kind = cases[0]!;
  return { id, kind, payload: message[kind]! };
}

export function pageSectionPayload(
  message: JsonObject,
  reason: string,
): { id: string; kind: string; payload: JsonValue } {
  const id = stringValue(message.id, `${reason}:missing_id`);
  const cases = Object.keys(message).filter(
    (key) => key !== "id" && key !== "settings",
  );
  if (cases.length !== 1) fail(`${reason}:invalid_oneof`);
  const kind = cases[0]!;
  const value = jsonObject(message[kind], `${reason}:${kind}`);
  const settings = message.settings;
  return {
    id,
    kind,
    payload: settings === undefined ? value : { ...value, settings },
  };
}

export function materializePageSectionPayload(
  payload: JsonValue,
  reason: string,
): { value: JsonObject; settings?: JsonValue } {
  const object = jsonObject(payload, reason);
  const { settings, ...value } = object;
  return settings === undefined ? { value } : { value, settings };
}

export function isCollaborativeTextPath(
  family: BlockRoomNodeFamily,
  kind: string,
  path: string,
): boolean {
  if (family === "rich_text") {
    const catalogKind =
      richTextBlockKindByProtoCase[
        kind as keyof typeof richTextBlockKindByProtoCase
      ];
    return (
      catalogKind !== undefined &&
      isRichTextCollaborativeTextPath(catalogKind as RichTextBlockKind, path)
    );
  }
  const catalogKind =
    pageSectionKindByProtoCase[kind as keyof typeof pageSectionKindByProtoCase];
  return (
    catalogKind !== undefined &&
    isPageSectionCollaborativeTextPath(catalogKind as PageSectionKind, path)
  );
}

export function setNodePayload(
  target: Y.Map<unknown>,
  family: BlockRoomNodeFamily,
  kind: string,
  payload: JsonValue,
): void {
  target.set("family", family);
  target.set("kind", kind);
  target.set(
    "payload",
    toYValue(payload, "", (path) =>
      isCollaborativeTextPath(family, kind, path),
    ),
  );
}

export function withoutField(
  value: JsonValue,
  field: string,
  reason: string,
): JsonObject {
  const object = jsonObject(value, reason);
  return Object.fromEntries(
    Object.entries(object).filter(([key]) => key !== field),
  );
}

export function richTextSlot(): string {
  return "content";
}

export function pageSectionSlot(
  parentId: string | undefined,
  columnId?: string,
): string {
  if (!parentId) {
    if (columnId) fail("page_node:orphan_column");
    return "sections";
  }
  return columnId ? `column-${columnId}` : fail("page_node:missing_column");
}

export function orderContainerKey(
  parentId: string | null,
  containerSlot: string,
): string {
  return JSON.stringify([parentId, containerSlot]);
}

export function normalizeBlockDocument(
  documentType: BlockRoomDocumentType,
  document: BlockRoomTypedDocument,
): BlockRoomTypedDocument {
  if (documentType === "page") {
    if (document.$typeName !== "api.content.v1.LocalizedPageDocument")
      fail("document_type");
    const normalized = fromJson(
      LocalizedPageDocumentSchema,
      toJson(LocalizedPageDocumentSchema, document),
    ) as LocalizedPageDocument;
    validateLocalizedPageDocument(normalized);
    return normalized;
  }
  if (document.$typeName !== "api.content.v1.LocalizedRichTextDocument")
    fail("document_type");
  if (document.profile !== richTextProfileByDocumentType[documentType])
    fail("document_profile");
  const normalized = fromJson(
    LocalizedRichTextDocumentSchema,
    toJson(LocalizedRichTextDocumentSchema, document),
  ) as LocalizedRichTextDocument;
  validateLocalizedRichTextDocument(normalized);
  return normalized;
}

export function canonicalBlockRoomDocumentBytes(
  documentType: BlockRoomDocumentType,
  document: BlockRoomTypedDocument,
): Uint8Array {
  const normalized = normalizeBlockDocument(documentType, document);
  return documentType === "page"
    ? canonicalLocalizedPageDocumentBytes(normalized as LocalizedPageDocument)
    : canonicalLocalizedRichTextDocumentBytes(
        normalized as LocalizedRichTextDocument,
      );
}

function identityArray(
  value: JsonValue,
  collection: string,
  identity: string,
  nestedCollection?: string,
  nestedIdentity?: string,
): unknown[] {
  const object = jsonObject(value, "locale_identity:payload");
  const children = object[collection];
  if (!Array.isArray(children)) return [];
  return children.map((child) => {
    const item = jsonObject(child, "locale_identity:item");
    if (!nestedCollection || !nestedIdentity) return item[identity];
    const nested = item[nestedCollection];
    return {
      id: item[identity],
      children: Array.isArray(nested)
        ? nested.map(
            (entry) =>
              jsonObject(entry, "locale_identity:nested")[nestedIdentity],
          )
        : [],
    };
  });
}

/** Exact resident projections carry one locale wrapper for every base node. */
export function assertBlockRoomLocaleProjectionParity(yDocument: Y.Doc): void {
  const root = yDocument.getMap<unknown>(BLOCK_ROOM_ROOT);
  const baseNodes = yMap(root.get(BLOCK_ROOM_BASE_NODES), "base_nodes");
  const localeNodes = yMap(
    root.get(BLOCK_ROOM_LOCALE_OVERLAY),
    "locale_overlay",
  );
  for (const [id, rawBase] of baseNodes.entries()) {
    const base = yMap(rawBase, `base_node:${id}`);
    const locale = yMap(localeNodes.get(id), `locale:${id}:missing`);
    const family = stringValue(base.get("family"), `base_node:${id}:family`);
    const kind = stringValue(base.get("kind"), `base_node:${id}:kind`);
    if (locale.get("family") !== family || locale.get("kind") !== kind)
      fail(`locale:${id}:identity_mismatch`);
    const basePayload = fromYValue(base.get("payload"));
    const localePayload = fromYValue(locale.get("payload"));
    if (family === "rich_text" && kind === "table") {
      const baseContent = jsonObject(
        jsonObject(basePayload, `base_node:${id}:payload`).content,
        `base_node:${id}:content`,
      );
      const localeContent = jsonObject(
        jsonObject(localePayload, `locale:${id}:payload`).content,
        `locale:${id}:content`,
      );
      const baseIdentity = identityArray(
        baseContent,
        "rows",
        "id",
        "cells",
        "id",
      );
      const localeIdentity = identityArray(
        localeContent,
        "rows",
        "rowId",
        "cells",
        "cellId",
      );
      if (JSON.stringify(baseIdentity) !== JSON.stringify(localeIdentity))
        fail(`locale:${id}:table_identity_mismatch`);
    }
    if (family === "page_section" && kind === "immersiveScene") {
      const baseIdentity = identityArray(basePayload, "units", "id");
      const localeIdentity = identityArray(localePayload, "units", "unitId");
      if (JSON.stringify(baseIdentity) !== JSON.stringify(localeIdentity))
        fail(`locale:${id}:immersive_identity_mismatch`);
    }
  }
  for (const id of localeNodes.keys()) {
    if (!baseNodes.has(id)) fail(`locale:${id}:missing_base`);
  }
}
