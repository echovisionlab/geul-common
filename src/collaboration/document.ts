/**
 * Resident collaboration document identity.
 *
 * Every room uses `{type}:{entity UUID}:{canonical locale}`. Source and target
 * are current roles derived by the owning API, never document-name segments.
 */

import { CollaborativeDocumentType } from "@echovisionlab/geul-proto/secure/collaboration_pb.ts";
import type * as Y from "yjs";
import { z } from "zod";
import { memberIdSchema } from "./member-id.ts";
import type { BlockRoomDocumentType } from "./block-room-codec.ts";

export { CollaborativeDocumentType };

const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type SupportedCollaborativeDocumentType = Exclude<
  CollaborativeDocumentType,
  CollaborativeDocumentType.UNSPECIFIED
>;

const documentPrefixes = {
  [CollaborativeDocumentType.POST]: "post",
  [CollaborativeDocumentType.PAGE]: "page",
  [CollaborativeDocumentType.WORK]: "work",
  [CollaborativeDocumentType.CAMPAIGN]: "campaign",
  [CollaborativeDocumentType.EMAIL_TEMPLATE]: "email-template",
  [CollaborativeDocumentType.EMAIL_LAYOUT]: "email-layout",
  [CollaborativeDocumentType.TERMS_HISTORY]: "terms-history",
  [CollaborativeDocumentType.PRIVACY_HISTORY]: "privacy-history",
  [CollaborativeDocumentType.ARTIST]: "artist",
  [CollaborativeDocumentType.RELEASE]: "release",
  [CollaborativeDocumentType.LABEL]: "label",
  [CollaborativeDocumentType.FORM]: "form",
  [CollaborativeDocumentType.MAP_THEME]: "map-theme",
  [CollaborativeDocumentType.PROGRAM_EVENT]: "program-event",
  [CollaborativeDocumentType.MENU]: "menu",
  [CollaborativeDocumentType.POST_SERIES]: "post-series",
} as const satisfies Record<SupportedCollaborativeDocumentType, string>;

const documentTypesByPrefix = new Map<
  string,
  SupportedCollaborativeDocumentType
>(
  Object.entries(documentPrefixes).map(([type, prefix]) => [
    prefix,
    Number(type) as SupportedCollaborativeDocumentType,
  ]),
);

function assertEntityId(entityId: string): void {
  if (!CANONICAL_UUID_PATTERN.test(entityId)) {
    throw new Error(`Invalid collaboration entity UUID: ${entityId}`);
  }
}

function assertCanonicalLocale(locale: string): void {
  let canonical: string | undefined;
  try {
    [canonical] = Intl.getCanonicalLocales(locale);
  } catch {
    throw new Error(`Invalid collaboration locale: ${locale}`);
  }
  if (canonical !== locale || locale === "source" || locale === "target") {
    throw new Error(`Invalid collaboration locale: ${locale}`);
  }
}

function assertDocumentLocale(
  type: SupportedCollaborativeDocumentType,
  locale: string,
): void {
  assertCanonicalLocale(locale);
  if (type === CollaborativeDocumentType.MAP_THEME && locale !== "und") {
    throw new Error("Map Theme collaboration uses the locale-neutral und room");
  }
}

export function residentBlockDocumentType(
  type: CollaborativeDocumentType,
): BlockRoomDocumentType | undefined {
  switch (type) {
    case CollaborativeDocumentType.POST:
      return "post";
    case CollaborativeDocumentType.PAGE:
      return "page";
    case CollaborativeDocumentType.WORK:
      return "work";
    case CollaborativeDocumentType.PROGRAM_EVENT:
      return "program-event";
    case CollaborativeDocumentType.ARTIST:
      return "artist";
    case CollaborativeDocumentType.LABEL:
      return "label";
    case CollaborativeDocumentType.RELEASE:
      return "release";
    case CollaborativeDocumentType.CAMPAIGN:
      return "campaign";
    case CollaborativeDocumentType.EMAIL_TEMPLATE:
      return "email-template";
    case CollaborativeDocumentType.TERMS_HISTORY:
      return "terms-history";
    case CollaborativeDocumentType.PRIVACY_HISTORY:
      return "privacy-history";
    default:
      return undefined;
  }
}

export interface ParsedDocument {
  type: CollaborativeDocumentType;
  entityId: string;
  locale: string;
}

export const documentSaveOptionsSchema = z
  .object({
    /** Distinct authenticated Members whose edits are included in this persisted state. */
    contributorMemberIds: z.array(memberIdSchema).optional(),
    /** Requests a source version checkpoint after ordinary durable persistence. */
    versionCheckpoint: z.boolean().optional(),
  })
  .strict();

export type DocumentSaveOptions = z.infer<typeof documentSaveOptionsSchema>;

export function parseDocumentSaveOptions(value: unknown): DocumentSaveOptions {
  return documentSaveOptionsSchema.parse(value);
}

export interface DocumentHandler {
  /** Declares that this domain adapter supports generic collaboration version checkpoints. */
  supportsVersionCheckpoints?: boolean;
  store(id: string, doc: Y.Doc, options?: DocumentSaveOptions): Promise<void>;
  load(id: string): Promise<Buffer | null>;
}

function getDocumentPrefix(type: CollaborativeDocumentType): string {
  const prefix = documentPrefixes[type as SupportedCollaborativeDocumentType];
  if (!prefix) throw new Error(`Unknown document type: ${type}`);
  return prefix;
}

/**
 * Create a document name from type, canonical entity UUID, and canonical locale.
 * Always use this function instead of manual string concatenation.
 *
 * @example
 * createDocumentName(CollaborativeDocumentType.POST, entityId, 'ko')
 */
export function createDocumentName(
  type: CollaborativeDocumentType,
  entityId: string,
  locale: string,
): string {
  assertEntityId(entityId);
  const prefix = getDocumentPrefix(type);
  assertDocumentLocale(type as SupportedCollaborativeDocumentType, locale);
  return `${prefix}:${entityId}:${locale}`;
}

/**
 * Parse and validate a canonical resident document name.
 *
 * @example
 * parseDocumentName(`post:${entityId}:ko`)
 *
 * @throws Error if document name format is invalid
 */
export function parseDocumentName(documentName: string): ParsedDocument {
  const segments = documentName.split(":");
  if (segments.length !== 3) {
    throw new Error(`Invalid document name format: ${documentName}`);
  }
  const [prefix, entityId, locale] = segments;
  const type = documentTypesByPrefix.get(prefix!);
  if (type === undefined || !entityId || !locale) {
    throw new Error(`Invalid document name format: ${documentName}`);
  }
  assertEntityId(entityId);
  assertDocumentLocale(type, locale);
  return { type, entityId, locale };
}
