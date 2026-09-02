export const fileBlockType = "file" as const;

export const EXTERNAL_VIDEO_ASPECT_RATIO_VALUES = [
  "auto",
  "16:9",
  "4:3",
  "1:1",
  "9:16",
] as const;

export type ExternalVideoAspectRatio =
  (typeof EXTERNAL_VIDEO_ASPECT_RATIO_VALUES)[number];

export const EXTERNAL_VIDEO_PREVIEW_WIDTH_MIN_PERCENT = 10;
export const EXTERNAL_VIDEO_PREVIEW_WIDTH_MAX_PERCENT = 100;
export const EXTERNAL_VIDEO_PREVIEW_WIDTH_DEFAULT = "100";

export interface ExternalVideoLinkLayoutProps {
  previewWidth: string;
  aspectRatio: ExternalVideoAspectRatio;
}

export function deriveMediaDisplayName(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) {
    return "";
  }

  const basename = trimmed.split(/[\\/]/).pop() || trimmed;
  const dotIndex = basename.lastIndexOf(".");
  if (dotIndex <= 0) {
    return basename;
  }

  const displayName = basename.slice(0, dotIndex).trim();
  return displayName || basename;
}

/**
 * A rich-text File becomes public content only after the authoritative File
 * projection has attached a non-empty File identity. Upload names, slots and
 * temporary delivery URLs are editor state and never make a placeholder
 * publishable by themselves.
 */
export function hasAttachedFileId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Durable layout props composed into rich-text paragraph specs that preview a
 * standalone external-video link. The URL and label remain ordinary inline
 * link content, while the document textAlignment prop owns alignment.
 */
export const externalVideoLinkLayoutPropSchema = {
  previewWidth: { default: EXTERNAL_VIDEO_PREVIEW_WIDTH_DEFAULT },
  aspectRatio: {
    default: "auto" as ExternalVideoAspectRatio,
    values: EXTERNAL_VIDEO_ASPECT_RATIO_VALUES,
  },
} as const;

/**
 * Canonical durable rich-text attachment schema. File MIME is resolved from
 * the verified File record at runtime and is intentionally not persisted.
 */
export const fileBlockPropSchema = {
  fileId: { default: "" },
  name: { default: "" },
  alt: { default: "" },
  caption: { default: "" },
  width: { default: "0" },
  height: { default: "0" },
  previewWidth: { default: "100" },
  textAlignment: {
    default: "left" as const,
    values: ["left", "center", "right"] as const,
  },
} as const;
