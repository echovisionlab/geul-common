import { z } from "zod";

export const artistCollabFieldsSchema = z
  .object({
    status: z.enum(["draft", "published"]).optional(),
    realName: z.string().optional(),
    countryCode: z.string().optional(),
    website: z.string().optional(),
    socialLinks: z.record(z.string(), z.string()).optional(),
    slug: z.string().optional(),
    labelIds: z.array(z.string()).optional(),
    parentArtistId: z.string().nullable().optional(),
  })
  .strict();

export const ARTIST_JSON_KEYS: ReadonlySet<
  keyof z.infer<typeof artistCollabFieldsSchema>
> = new Set(["socialLinks", "labelIds"]);

export const ARTIST_SOURCE_OWNED_FIELD_KEYS = ["name"] as const;
export const ARTIST_SHARED_FIELD_KEYS = [
  "status",
  "realName",
  "countryCode",
  "website",
  "socialLinks",
  "slug",
  "labelIds",
  "parentArtistId",
] as const;

export type ArtistCollabFields = z.infer<typeof artistCollabFieldsSchema>;
export type ArtistSourceOwnedFieldKey =
  (typeof ARTIST_SOURCE_OWNED_FIELD_KEYS)[number];
export type ArtistFieldValue =
  string | string[] | Record<string, string> | null;

export function extractArtistFields(fieldsMap: {
  get(key: string): ArtistFieldValue | undefined;
}): ArtistCollabFields {
  const raw: Record<string, unknown> = {};

  for (const key of Object.keys(artistCollabFieldsSchema.shape)) {
    let value = fieldsMap.get(key);

    if (
      ARTIST_JSON_KEYS.has(key as keyof ArtistCollabFields) &&
      typeof value === "string"
    ) {
      try {
        value = JSON.parse(value) as ArtistFieldValue;
      } catch {
        throw new Error(`Failed to parse JSON for artist field "${key}"`);
      }
    }

    if (value !== undefined) {
      raw[key] = value;
    }
  }

  return artistCollabFieldsSchema.parse(raw);
}
