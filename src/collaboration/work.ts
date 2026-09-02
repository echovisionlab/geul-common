import { z } from "zod";

export const workCollabFieldsSchema = z
  .object({
    title: z.string().optional(),
    slug: z.string().nullable().optional(),
    type: z.string().optional(),
    summary: z.string().optional(),
    featured: z.boolean().optional(),
    year: z.number().int().min(1).max(9999).optional(),
    month: z.number().int().min(1).max(12).optional(),
    untilYear: z.number().int().min(1).max(9999).nullable().optional(),
    untilMonth: z.number().int().min(1).max(12).nullable().optional(),
    isPresent: z.boolean().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    featuredImageFileId: z.string().nullable().optional(),
    creditsVersion: z.number().optional(),
    creditOrder: z
      .array(
        z.discriminatedUnion("type", [
          z.object({ type: z.literal("group"), id: z.string() }),
          z.object({
            type: z.literal("credit"),
            id: z.string(),
            creditType: z.enum(["artist", "member", "name"]),
          }),
        ]),
      )
      .optional(),
    clients: z.array(z.string()).optional(), // Ordered list of client IDs
  })
  .strict();

export const WORK_JSON_KEYS: ReadonlySet<
  keyof z.infer<typeof workCollabFieldsSchema>
> = new Set(["metadata", "creditOrder", "clients"]);

export const WORK_SOURCE_OWNED_FIELD_KEYS = ["title", "summary"] as const;
export const WORK_SHARED_FIELD_KEYS = [
  "slug",
  "type",
  "featured",
  "year",
  "month",
  "untilYear",
  "untilMonth",
  "isPresent",
  "metadata",
  "featuredImageFileId",
  "creditsVersion",
  "creditOrder",
  "clients",
] as const;

export type WorkCollabFields = z.infer<typeof workCollabFieldsSchema>;
export type WorkFieldValue =
  string | boolean | number | unknown[] | Record<string, unknown> | null;
export type WorkSourceOwnedFieldKey =
  (typeof WORK_SOURCE_OWNED_FIELD_KEYS)[number];
export type WorkSharedFieldKey = (typeof WORK_SHARED_FIELD_KEYS)[number];

export function extractWorkFields(metaMap: {
  get(key: string): WorkFieldValue | undefined;
}): WorkCollabFields {
  const raw: Record<string, unknown> = {};

  for (const key of Object.keys(workCollabFieldsSchema.shape)) {
    let value = metaMap.get(key);

    if (
      WORK_JSON_KEYS.has(key as keyof WorkCollabFields) &&
      typeof value === "string"
    ) {
      try {
        value = JSON.parse(value) as WorkFieldValue;
      } catch {
        throw new Error(`Failed to parse JSON for work field "${key}"`);
      }
    }

    if (value !== undefined) {
      raw[key] = value;
    }
  }

  return workCollabFieldsSchema.parse(raw);
}

export function pickWorkSharedFields(
  fields: WorkCollabFields,
): Pick<WorkCollabFields, WorkSharedFieldKey> {
  return {
    slug: fields.slug,
    type: fields.type,
    featured: fields.featured,
    year: fields.year,
    month: fields.month,
    untilYear: fields.untilYear,
    untilMonth: fields.untilMonth,
    isPresent: fields.isPresent,
    metadata: fields.metadata,
    featuredImageFileId: fields.featuredImageFileId,
    creditsVersion: fields.creditsVersion,
    creditOrder: fields.creditOrder,
    clients: fields.clients,
  };
}
