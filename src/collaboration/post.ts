import { z } from "zod";

export const postCollabFieldsSchema = z
  .object({
    title: z.string().optional(),
    summary: z.string().optional(),
    categoryIds: z.array(z.string()).optional(),
    tagIds: z.array(z.string()).optional(),
  })
  .strict();

export const POST_JSON_KEYS: ReadonlySet<
  keyof z.infer<typeof postCollabFieldsSchema>
> = new Set(["categoryIds", "tagIds"]);

export const POST_SOURCE_OWNED_FIELD_KEYS = ["title", "summary"] as const;
export const POST_SHARED_FIELD_KEYS = ["categoryIds", "tagIds"] as const;

export type PostCollabFields = z.infer<typeof postCollabFieldsSchema>;
export type PostFieldValue = string | string[];
export type PostSourceOwnedFieldKey =
  (typeof POST_SOURCE_OWNED_FIELD_KEYS)[number];
export type PostSharedFieldKey = (typeof POST_SHARED_FIELD_KEYS)[number];

export function extractPostFields(fieldsMap: {
  get(key: string): PostFieldValue | undefined;
}): PostCollabFields {
  const raw: Record<string, unknown> = {};

  for (const key of Object.keys(postCollabFieldsSchema.shape)) {
    let value = fieldsMap.get(key);

    if (
      POST_JSON_KEYS.has(key as keyof PostCollabFields) &&
      typeof value === "string"
    ) {
      try {
        value = JSON.parse(value) as PostFieldValue;
      } catch {
        throw new Error(`Failed to parse JSON for post field "${key}"`);
      }
    }

    if (value !== undefined) {
      raw[key] = value;
    }
  }

  return postCollabFieldsSchema.parse(raw);
}

export function pickPostSharedFields(
  fields: PostCollabFields,
): Pick<PostCollabFields, PostSharedFieldKey> {
  return {
    categoryIds: fields.categoryIds,
    tagIds: fields.tagIds,
  };
}
