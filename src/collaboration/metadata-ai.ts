import { z } from "zod";
import { memberIdSchema } from "./member-id.ts";

export const metadataAiFieldSchema = z.enum(["summary"]);

export const metadataAiStatusSchema = z.enum([
  "idle",
  "generating",
  "ready",
  "applying",
]);

export const metadataAiSharedStateSchema = z
  .object({
    status: metadataAiStatusSchema,
    generationId: z.string().nullable(),
    jobId: z.string().nullable(),
    requesterMemberId: memberIdSchema.nullable(),
    /** Non-authoritative Member nickname snapshot; never a Member lookup or mapping key. */
    requesterNickname: z.string().min(1).max(100).nullable(),
    requestedFields: z.array(metadataAiFieldSchema),
    allMetadata: z.boolean(),
    startedAt: z.number().int().nullable(),
    updatedAt: z.number().int().nullable(),
    orphanedAt: z.number().int().nullable(),
    autoClearAt: z.number().int().nullable(),
  })
  .strict()
  .refine(
    (state) =>
      state.requesterNickname === null || state.requesterMemberId !== null,
    {
      message: "requesterNickname requires requesterMemberId",
      path: ["requesterNickname"],
    },
  );

export const METADATA_AI_MAP_NAME = "metadata-ai";
export const METADATA_AI_GRACE_PERIOD_MS = 10_000;

export type MetadataAiField = z.infer<typeof metadataAiFieldSchema>;
export type MetadataAiStatus = z.infer<typeof metadataAiStatusSchema>;
export type MetadataAiSharedState = z.infer<typeof metadataAiSharedStateSchema>;
export type MetadataAiFieldValue = string | number | boolean | string[] | null;

export const DEFAULT_METADATA_AI_SHARED_STATE: MetadataAiSharedState = {
  status: "idle",
  generationId: null,
  jobId: null,
  requesterMemberId: null,
  requesterNickname: null,
  requestedFields: [],
  allMetadata: false,
  startedAt: null,
  updatedAt: null,
  orphanedAt: null,
  autoClearAt: null,
};

export const METADATA_AI_JSON_KEYS: ReadonlySet<keyof MetadataAiSharedState> =
  new Set(["requestedFields"]);

export function extractMetadataAiSharedState(fieldsMap: {
  get(key: string): MetadataAiFieldValue | undefined;
}): MetadataAiSharedState {
  if (
    fieldsMap.get("requesterUserId") !== undefined ||
    fieldsMap.get("requesterName") !== undefined ||
    fieldsMap.get("requesterDisplayName") !== undefined
  ) {
    throw new Error("Legacy metadata AI requester fields are not supported");
  }

  const raw: Record<string, unknown> = {};

  for (const key of Object.keys(metadataAiSharedStateSchema.shape)) {
    let value = fieldsMap.get(key);

    if (
      METADATA_AI_JSON_KEYS.has(key as keyof MetadataAiSharedState) &&
      typeof value === "string"
    ) {
      try {
        value = JSON.parse(value) as MetadataAiFieldValue;
      } catch {
        throw new Error(`Failed to parse JSON for metadata AI field "${key}"`);
      }
    }

    if (value !== undefined) {
      raw[key] = value;
    }
  }

  return metadataAiSharedStateSchema.parse({
    ...DEFAULT_METADATA_AI_SHARED_STATE,
    ...raw,
  });
}
