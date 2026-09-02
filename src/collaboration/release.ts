import { z } from "zod";
import { memberIdSchema } from "./member-id.ts";

export const releaseTypeSchema = z.enum([
  "album",
  "compilation",
  "ep",
  "single",
]);
export const creditTargetTypeSchema = z.enum(["artist", "member", "text"]);

const creditItemSchema = z.object({
  id: z.string().uuid(),
  credit_type: creditTargetTypeSchema,
  artist_id: z.string().uuid().nullable(),
  artist_name: z.string().nullable(),
  artist_slug: z.string().nullable(),
  member_id: memberIdSchema.nullable(),
  member_name: z.string().nullable(),
  credited_name: z.string().nullable(),
  credit_role: z.string().nullable(),
  sort_order: z.number(),
});

function requireMemberCreditId(
  credit: z.infer<typeof creditItemSchema>,
): boolean {
  return credit.credit_type !== "member" || credit.member_id !== null;
}

const memberCreditRefinement = {
  message: "Member credit requires member_id",
  path: ["member_id"] as PropertyKey[],
};

export const releaseCreditItemSchema = creditItemSchema
  .strict()
  .refine(requireMemberCreditId, memberCreditRefinement);

export const releaseArtistItemSchema = z
  .object({
    artist_id: z.string().uuid(),
    artist_name: z.string(),
    artist_slug: z.string().nullable(),
    sort_order: z.number(),
  })
  .strict();

export const releaseLabelItemSchema = z
  .object({
    label_id: z.string().uuid(),
    label_name: z.string(),
    label_slug: z.string().nullable(),
    catalog_number: z.string().nullable(),
    sort_order: z.number(),
  })
  .strict();

export const releaseGenreItemSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
  })
  .strict();

export const releaseCategoryItemSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
  })
  .strict();

export const releaseStyleItemSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
  })
  .strict();

export const releaseFormatItemSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    format_description: z.string().nullable(),
  })
  .strict();

export const trackCreditItemSchema = creditItemSchema
  .strict()
  .refine(requireMemberCreditId, memberCreditRefinement);

export const releaseTrackItemSchema = z
  .object({
    id: z.string().uuid(),
    track_number: z.number(),
    title: z.string(),
    audio_original_file_id: z.string().uuid().nullable().optional(),
    credits: z.array(trackCreditItemSchema),
  })
  .strict();

export const releaseCollabFieldsSchema = z
  .object({
    title: z.string().optional(),
    type: releaseTypeSchema.optional(),
    releaseDate: z.string().nullable().optional(),
    spotifyUrl: z.string().optional(),
    appleMusicUrl: z.string().optional(),
    bandcampUrl: z.string().optional(),
    youtubeMusicUrl: z.string().optional(),
    artists: z.array(releaseArtistItemSchema).optional(),
    credits: z.array(releaseCreditItemSchema).optional(),
    labels: z.array(releaseLabelItemSchema).optional(),
    categories: z.array(releaseCategoryItemSchema).optional(),
    genres: z.array(releaseGenreItemSchema).optional(),
    styles: z.array(releaseStyleItemSchema).optional(),
    formats: z.array(releaseFormatItemSchema).optional(),
    tracks: z.array(releaseTrackItemSchema).optional(),
  })
  .strict();

export const RELEASE_JSON_KEYS: ReadonlySet<
  keyof z.infer<typeof releaseCollabFieldsSchema>
> = new Set([
  "artists",
  "credits",
  "labels",
  "categories",
  "genres",
  "styles",
  "formats",
  "tracks",
]);

export const RELEASE_SOURCE_OWNED_FIELD_KEYS = ["title"] as const;
export const RELEASE_SHARED_FIELD_KEYS = [
  "type",
  "releaseDate",
  "spotifyUrl",
  "appleMusicUrl",
  "bandcampUrl",
  "youtubeMusicUrl",
  "artists",
  "credits",
  "labels",
  "categories",
  "genres",
  "styles",
  "formats",
  "tracks",
] as const;

export type ReleaseType = z.infer<typeof releaseTypeSchema>;
export type CreditTargetType = z.infer<typeof creditTargetTypeSchema>;
export type ReleaseCreditItem = z.infer<typeof releaseCreditItemSchema>;
export type ReleaseArtistItem = z.infer<typeof releaseArtistItemSchema>;
export type ReleaseLabelItem = z.infer<typeof releaseLabelItemSchema>;
export type ReleaseCategoryItem = z.infer<typeof releaseCategoryItemSchema>;
export type ReleaseGenreItem = z.infer<typeof releaseGenreItemSchema>;
export type ReleaseStyleItem = z.infer<typeof releaseStyleItemSchema>;
export type ReleaseFormatItem = z.infer<typeof releaseFormatItemSchema>;
export type TrackCreditItem = z.infer<typeof trackCreditItemSchema>;
export type ReleaseTrackItem = z.infer<typeof releaseTrackItemSchema>;
export type ReleaseCollabFields = z.infer<typeof releaseCollabFieldsSchema>;
export type ReleaseFieldValue =
  string | number | boolean | Record<string, unknown>[] | null;
export type ReleaseSourceOwnedFieldKey =
  (typeof RELEASE_SOURCE_OWNED_FIELD_KEYS)[number];
export type ReleaseSharedFieldKey = (typeof RELEASE_SHARED_FIELD_KEYS)[number];

export function extractReleaseFields(fieldsMap: {
  get(key: string): ReleaseFieldValue | undefined;
}): ReleaseCollabFields {
  const raw: Record<string, unknown> = {};

  for (const key of Object.keys(releaseCollabFieldsSchema.shape)) {
    let value = fieldsMap.get(key);

    if (
      RELEASE_JSON_KEYS.has(key as keyof ReleaseCollabFields) &&
      typeof value === "string"
    ) {
      try {
        value = JSON.parse(value) as ReleaseFieldValue;
      } catch {
        throw new Error(`Failed to parse JSON for release field "${key}"`);
      }
    }

    if (value !== undefined) {
      raw[key] = value;
    }
  }

  return releaseCollabFieldsSchema.parse(raw);
}

export function pickReleaseSharedFields(
  fields: ReleaseCollabFields,
): Pick<ReleaseCollabFields, ReleaseSharedFieldKey> {
  return {
    type: fields.type,
    releaseDate: fields.releaseDate,
    spotifyUrl: fields.spotifyUrl,
    appleMusicUrl: fields.appleMusicUrl,
    bandcampUrl: fields.bandcampUrl,
    youtubeMusicUrl: fields.youtubeMusicUrl,
    artists: fields.artists,
    credits: fields.credits,
    labels: fields.labels,
    categories: fields.categories,
    genres: fields.genres,
    styles: fields.styles,
    formats: fields.formats,
    tracks: fields.tracks,
  };
}
