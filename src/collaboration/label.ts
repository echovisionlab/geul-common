import { z } from "zod";

export const labelCollabFieldsSchema = z
  .object({
    slug: z.string().optional(),
    countryCode: z.string().optional(),
    website: z.string().optional(),
    socialLinks: z.record(z.string(), z.string()).optional(),
    parentLabelId: z.string().nullable().optional(),
  })
  .strict();

export const LABEL_SHARED_FIELD_KEYS = Object.keys(
  labelCollabFieldsSchema.shape,
) as (keyof z.infer<typeof labelCollabFieldsSchema>)[];

export const LABEL_JSON_KEYS: ReadonlySet<
  keyof z.infer<typeof labelCollabFieldsSchema>
> = new Set(["socialLinks"]);

export type LabelCollabFields = z.infer<typeof labelCollabFieldsSchema>;
export type LabelFieldValue = string | Record<string, string> | null;

export function extractLabelFields(fieldsMap: {
  get(key: string): LabelFieldValue | undefined;
}): LabelCollabFields {
  const raw: Record<string, unknown> = {};

  for (const key of Object.keys(labelCollabFieldsSchema.shape)) {
    let value = fieldsMap.get(key);

    if (
      LABEL_JSON_KEYS.has(key as keyof LabelCollabFields) &&
      typeof value === "string"
    ) {
      try {
        value = JSON.parse(value) as LabelFieldValue;
      } catch {
        throw new Error(`Failed to parse JSON for label field "${key}"`);
      }
    }

    if (value !== undefined) {
      raw[key] = value;
    }
  }

  return labelCollabFieldsSchema.parse(raw);
}
