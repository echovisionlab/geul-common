import { z } from "zod";

export const MAP_THEME_META_MAP_NAME = "map-theme-meta";
export const MAP_THEME_SETTINGS_MAP_NAME = "map-theme-settings";
export const MAP_THEME_NAME_MAX_LENGTH = 255;

export function mapThemeNameCodePointLength(value: string): number {
  return Array.from(value).length;
}

function isValidMapThemeName(value: string): boolean {
  const normalized = value.trim();
  return (
    normalized.length > 0 &&
    mapThemeNameCodePointLength(normalized) <= MAP_THEME_NAME_MAX_LENGTH
  );
}

export function getMapThemeVariantMapName(scheme: "light" | "dark"): string {
  return `map-theme-${scheme}-variant`;
}

const calloutFieldSchema = z.enum([
  "name",
  "address",
  "coordinates",
  "street",
  "city",
  "region",
  "country",
  "postalCode",
]);

const MapThemeEditingNameSchema = z.string().refine(isValidMapThemeName, {
  message: `Map Theme name must contain 1-${MAP_THEME_NAME_MAX_LENGTH} Unicode code points`,
});

const MapThemeCanonicalNameSchema = MapThemeEditingNameSchema.transform(
  (value) => value.trim(),
);

export const MapThemeDocumentEditingMetaSchema = z
  .object({
    name: MapThemeEditingNameSchema,
  })
  .strict();

export const MapThemeDocumentMetaSchema = z
  .object({
    name: MapThemeCanonicalNameSchema,
  })
  .strict();

export type MapThemeDocumentMeta = z.infer<typeof MapThemeDocumentMetaSchema>;

export const MAP_THEME_META_JSON_KEYS: ReadonlySet<keyof MapThemeDocumentMeta> =
  new Set([]);

export const MapThemeDocumentSettingsSchema = z
  .object({
    calloutScale: z.number().min(0.5).max(2),
    calloutOffsetX: z.number().int().min(-50).max(50),
    calloutOffsetY: z.number().int().min(-50).max(50),
    calloutFields: z.array(calloutFieldSchema).min(1).max(8),
    showAreaLabels: z.boolean(),
    showPoiLabels: z.boolean(),
    attributionFontSize: z.number().int().min(9).max(14),
  })
  .strict();

export type MapThemeDocumentSettings = z.infer<
  typeof MapThemeDocumentSettingsSchema
>;

export const MAP_THEME_SETTINGS_JSON_KEYS: ReadonlySet<
  keyof MapThemeDocumentSettings
> = new Set(["calloutFields"]);

const HEX_COLOR_PATTERN =
  /^#[\da-f]{3}(?:[\da-f]{1}|[\da-f]{3}(?:[\da-f]{2})?)?$/i;
const RGB_COLOR_PATTERN =
  /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i;
const RGBA_COLOR_PATTERN =
  /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*((?:0(?:\.\d+)?)|(?:1(?:\.0+)?))\s*\)$/i;

export function isMapThemeColor(value: string): boolean {
  if (value === "transparent" || HEX_COLOR_PATTERN.test(value)) {
    return true;
  }

  const rgb = RGB_COLOR_PATTERN.exec(value);
  if (rgb) {
    return rgb.slice(1).every((channel) => Number(channel) <= 255);
  }

  const rgba = RGBA_COLOR_PATTERN.exec(value);
  if (!rgba) {
    return false;
  }

  return rgba.slice(1, 4).every((channel) => Number(channel) <= 255);
}

export const MapThemeColorSchema = z
  .string()
  .trim()
  .max(50)
  .refine(isMapThemeColor, {
    message: "Invalid map theme color",
  });

export const MapThemeDocumentVariantSchema = z
  .object({
    backgroundColor: MapThemeColorSchema,
    waterColor: MapThemeColorSchema,
    landColor: MapThemeColorSchema,
    roadColor: MapThemeColorSchema,
    buildingFillColor: MapThemeColorSchema,
    buildingStrokeEnabled: z.boolean(),
    buildingStrokeColor: MapThemeColorSchema,
    calloutLineColor: MapThemeColorSchema,
    calloutHoverLineColor: MapThemeColorSchema,
    calloutTextColor: MapThemeColorSchema,
    calloutHoverTextColor: MapThemeColorSchema,
    calloutDescriptionColor: MapThemeColorSchema,
    calloutHoverDescriptionColor: MapThemeColorSchema,
    calloutBackgroundColor: MapThemeColorSchema,
    calloutHoverBackgroundColor: MapThemeColorSchema,
    attributionColor: MapThemeColorSchema,
    labelTextColor: MapThemeColorSchema,
    clusterColor: MapThemeColorSchema,
    clusterHoverColor: MapThemeColorSchema,
    clusterTextColor: MapThemeColorSchema,
    clusterTextHoverColor: MapThemeColorSchema,
  })
  .strict();

export type MapThemeDocumentVariant = z.infer<
  typeof MapThemeDocumentVariantSchema
>;

export const MAP_THEME_VARIANT_JSON_KEYS: ReadonlySet<
  keyof MapThemeDocumentVariant
> = new Set([]);

export const MapThemeDocumentSnapshotSchema = z
  .object({
    name: MapThemeDocumentMetaSchema.shape.name,
    settings: MapThemeDocumentSettingsSchema,
    lightVariant: MapThemeDocumentVariantSchema,
    darkVariant: MapThemeDocumentVariantSchema,
  })
  .strict();

export type MapThemeDocumentSnapshot = z.infer<
  typeof MapThemeDocumentSnapshotSchema
>;
