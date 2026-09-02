import { z } from "zod";

export type RuntimeEntityType =
  | "post"
  | "page"
  | "work"
  | "artist"
  | "label"
  | "release"
  | "series"
  | "form"
  | "program_event"
  | "menu"
  | "site"
  | "site_setting"
  | "email_template"
  | "email_layout"
  | "campaign"
  | "privacy"
  | "terms";

export type TranslationLifecycleRuntimeStatus = "failed";

export type MediaProcessingRuntimeStatus = "processing" | "ready" | "failed";

export type OgGenerationRuntimeEntityType =
  | "post"
  | "page"
  | "work"
  | "artist"
  | "label"
  | "release"
  | "series"
  | "form"
  | "site"
  | "privacy"
  | "terms";

export type OgGenerationRuntimeStatus =
  "queued" | "processing" | "ready" | "failed" | "superseded" | "cancelled";

export function isOgGenerationRuntimeTerminal(
  status: OgGenerationRuntimeStatus,
): boolean {
  return (
    status === "ready" ||
    status === "failed" ||
    status === "superseded" ||
    status === "cancelled"
  );
}

export type FileIngestRuntimeSource = "upload" | "embed";

export type FileIngestRuntimeStage =
  | "uploading"
  | "downloading"
  | "finalized"
  | "attached"
  | "completed"
  | "expired"
  | "failed"
  | "unknown";

export interface RuntimeEventEnvelope<K extends string, P> {
  version: 1;
  kind: K;
  entityType: RuntimeEntityType;
  entityId: string;
  locale?: string;
  correlationId?: string;
  sequence?: number;
  timestampMs: number;
  payload: P;
}

export interface OgGenerationLifecycleRuntimePayload {
  generationId: string;
  runId: string;
  status: OgGenerationRuntimeStatus;
  assetId?: string;
  assetUrl?: string;
  errorCode?: string;
  error?: string;
  replacementGenerationId?: string;
}

export interface RenderCompleteRuntimePayload {
  contentHash: string;
  success: boolean;
  error?: string;
}

export interface MediaProcessingRuntimeOutputs {
  spectrogramAssetId?: string;
  thumbnailAssetId?: string;
  hlsGenerationId?: string;
  durationSeconds?: number;
  waveformAssetId?: string;
}

export interface MediaProcessingLifecycleRuntimePayload {
  fileId: string;
  slotId?: string;
  attemptId?: string;
  status: MediaProcessingRuntimeStatus;
  percentage?: number;
  outputs?: MediaProcessingRuntimeOutputs;
  error?: string;
  trackId?: string;
  releaseId?: string;
}

export function isMediaProcessingRuntimeReady(payload: {
  status?: MediaProcessingRuntimeStatus | null;
}): boolean {
  return payload.status === "ready";
}

export interface FileIngestLifecycleRuntimePayload {
  fileId: string;
  uploadId?: string;
  mediaKind?: string;
  slotId?: string;
  attemptId?: string;
  source: FileIngestRuntimeSource;
  stage: FileIngestRuntimeStage;
  progress: number;
  bytesCompleted?: number;
  bytesTotal?: number;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  error?: string;
  trackId?: string;
  releaseId?: string;
}

export interface TranslationLifecycleRuntimePayload {
  jobId: string;
  targetLocale: string;
  status: TranslationLifecycleRuntimeStatus;
  error?: string;
}

export interface RuntimeErrorPayload {
  code: string;
  message: string;
  retryable?: boolean;
  source?: "backend" | "collab" | "worker";
  details?: Record<string, string | number | boolean | null>;
}

export interface OgGenerationLifecycleRuntimeEvent extends RuntimeEventEnvelope<
  "og.lifecycle",
  OgGenerationLifecycleRuntimePayload
> {
  entityType: OgGenerationRuntimeEntityType;
  correlationId: string;
}
export type RenderCompleteRuntimeEvent = RuntimeEventEnvelope<
  "render.complete",
  RenderCompleteRuntimePayload
>;
export type MediaProcessingLifecycleRuntimeEvent = RuntimeEventEnvelope<
  "media.processing.lifecycle",
  MediaProcessingLifecycleRuntimePayload
>;
export type FileIngestLifecycleRuntimeEvent = RuntimeEventEnvelope<
  "file.ingest.lifecycle",
  FileIngestLifecycleRuntimePayload
>;
export type TranslationLifecycleRuntimeEvent = RuntimeEventEnvelope<
  "translation.lifecycle",
  TranslationLifecycleRuntimePayload
>;
export type RuntimeErrorEvent = RuntimeEventEnvelope<
  "runtime.error",
  RuntimeErrorPayload
>;

export type EditorRuntimeEvent =
  | OgGenerationLifecycleRuntimeEvent
  | RenderCompleteRuntimeEvent
  | MediaProcessingLifecycleRuntimeEvent
  | FileIngestLifecycleRuntimeEvent
  | TranslationLifecycleRuntimeEvent
  | RuntimeErrorEvent;

export const runtimeEntityTypeSchema = z.enum([
  "post",
  "page",
  "work",
  "artist",
  "label",
  "release",
  "series",
  "form",
  "program_event",
  "menu",
  "site",
  "site_setting",
  "email_template",
  "email_layout",
  "campaign",
  "privacy",
  "terms",
]);

export const mediaProcessingRuntimeStatusSchema = z.enum([
  "processing",
  "ready",
  "failed",
]);

export const ogGenerationRuntimeEntityTypeSchema = z.enum([
  "post",
  "page",
  "work",
  "artist",
  "label",
  "release",
  "series",
  "form",
  "site",
  "privacy",
  "terms",
]);

export const ogGenerationRuntimeStatusSchema = z.enum([
  "queued",
  "processing",
  "ready",
  "failed",
  "superseded",
  "cancelled",
]);

export const ogGenerationLifecycleRuntimePayloadSchema = z
  .object({
    generationId: z.string().min(1),
    runId: z.string().min(1),
    status: ogGenerationRuntimeStatusSchema,
    assetId: z.string().min(1).optional(),
    assetUrl: z.string().min(1).optional(),
    errorCode: z.string().min(1).optional(),
    error: z.string().min(1).optional(),
    replacementGenerationId: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((payload, ctx) => {
    if (payload.status === "ready" && !payload.assetId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assetId"],
        message: "ready OG lifecycle requires assetId",
      });
    }
    if (payload.status === "failed" && !payload.error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["error"],
        message: "failed OG lifecycle requires error",
      });
    }
    if (payload.status === "superseded" && !payload.replacementGenerationId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["replacementGenerationId"],
        message: "superseded OG lifecycle requires replacementGenerationId",
      });
    }
    if (payload.status !== "ready" && (payload.assetId || payload.assetUrl)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assetId"],
        message: "only ready OG lifecycle may include an asset",
      });
    }
    if (payload.status !== "superseded" && payload.replacementGenerationId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["replacementGenerationId"],
        message: "only superseded OG lifecycle may include a replacement",
      });
    }
  });

export const mediaProcessingRuntimeOutputsSchema = z
  .object({
    spectrogramAssetId: z.string().optional(),
    thumbnailAssetId: z.string().optional(),
    hlsGenerationId: z.string().optional(),
    durationSeconds: z.number().int().nonnegative().optional(),
    waveformAssetId: z.string().optional(),
  })
  .strict();

export const mediaProcessingLifecycleRuntimePayloadSchema = z
  .object({
    fileId: z.string().min(1),
    slotId: z.string().optional(),
    attemptId: z.string().optional(),
    status: mediaProcessingRuntimeStatusSchema,
    percentage: z.number().int().min(0).max(100).optional(),
    outputs: mediaProcessingRuntimeOutputsSchema.optional(),
    error: z.string().optional(),
    trackId: z.string().optional(),
    releaseId: z.string().optional(),
  })
  .strict()
  .superRefine((payload, ctx) => {
    if (
      payload.status === "processing" &&
      typeof payload.percentage !== "number"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["percentage"],
        message: "processing media lifecycle requires percentage",
      });
    }
    if (payload.status === "processing" && payload.outputs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outputs"],
        message: "processing media lifecycle must not include ready outputs",
      });
    }
    if (payload.status === "ready" && !payload.outputs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outputs"],
        message: "ready media lifecycle requires outputs",
      });
    }
    if (payload.status === "ready" && typeof payload.percentage === "number") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["percentage"],
        message: "ready media lifecycle must not include processing percentage",
      });
    }
    if (payload.status === "failed" && payload.outputs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outputs"],
        message: "failed media lifecycle must not include ready outputs",
      });
    }
    if (payload.status === "failed" && typeof payload.percentage === "number") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["percentage"],
        message:
          "failed media lifecycle must not include processing percentage",
      });
    }
  });

export const fileIngestLifecycleRuntimePayloadSchema = z
  .object({
    fileId: z.string().min(1),
    uploadId: z.string().optional(),
    mediaKind: z.string().optional(),
    slotId: z.string().optional(),
    attemptId: z.string().optional(),
    source: z.enum(["upload", "embed"]),
    stage: z.enum([
      "uploading",
      "downloading",
      "finalized",
      "attached",
      "completed",
      "expired",
      "failed",
      "unknown",
    ]),
    progress: z.number().int().min(0).max(100),
    bytesCompleted: z.number().int().nonnegative().optional(),
    bytesTotal: z.number().int().nonnegative().optional(),
    fileName: z.string().optional(),
    mimeType: z.string().optional(),
    fileSize: z.number().int().nonnegative().optional(),
    error: z.string().optional(),
    trackId: z.string().optional(),
    releaseId: z.string().optional(),
  })
  .strict();

const localeScopedOgEntityTypes = new Set<OgGenerationRuntimeEntityType>([
  "post",
  "page",
  "form",
  "privacy",
  "terms",
]);

const ogGenerationLifecycleRuntimeEventSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("og.lifecycle"),
    entityType: ogGenerationRuntimeEntityTypeSchema,
    entityId: z.string().min(1),
    locale: z.string().min(1).optional(),
    correlationId: z.string().min(1),
    sequence: z.number().int().optional(),
    timestampMs: z.number().int(),
    payload: ogGenerationLifecycleRuntimePayloadSchema,
  })
  .strict()
  .superRefine((event, ctx) => {
    const requiresLocale = localeScopedOgEntityTypes.has(event.entityType);
    if (requiresLocale && !event.locale) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["locale"],
        message: `${event.entityType} OG lifecycle requires a locale target`,
      });
    }
    if (!requiresLocale && event.locale) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["locale"],
        message: `${event.entityType} OG lifecycle requires an entity target`,
      });
    }
    if (event.correlationId !== event.payload.generationId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["correlationId"],
        message: "OG lifecycle correlationId must equal payload.generationId",
      });
    }
  });

export const translationLifecycleRuntimePayloadSchema = z
  .object({
    jobId: z.string().min(1),
    targetLocale: z.string().min(1),
    status: z.literal("failed"),
    error: z.string().optional(),
  })
  .strict();

export const editorRuntimeEventSchema = z.discriminatedUnion("kind", [
  ogGenerationLifecycleRuntimeEventSchema,
  z
    .object({
      version: z.literal(1),
      kind: z.literal("render.complete"),
      entityType: runtimeEntityTypeSchema,
      entityId: z.string().min(1),
      locale: z.string().optional(),
      correlationId: z.string().optional(),
      sequence: z.number().int().optional(),
      timestampMs: z.number().int(),
      payload: z
        .object({
          contentHash: z.string(),
          success: z.boolean(),
          error: z.string().optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      kind: z.literal("media.processing.lifecycle"),
      entityType: runtimeEntityTypeSchema,
      entityId: z.string().min(1),
      locale: z.string().optional(),
      correlationId: z.string().optional(),
      sequence: z.number().int().optional(),
      timestampMs: z.number().int(),
      payload: mediaProcessingLifecycleRuntimePayloadSchema,
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      kind: z.literal("file.ingest.lifecycle"),
      entityType: runtimeEntityTypeSchema,
      entityId: z.string().min(1),
      locale: z.string().optional(),
      correlationId: z.string().optional(),
      sequence: z.number().int().optional(),
      timestampMs: z.number().int(),
      payload: fileIngestLifecycleRuntimePayloadSchema,
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      kind: z.literal("translation.lifecycle"),
      entityType: runtimeEntityTypeSchema,
      entityId: z.string().min(1),
      locale: z.string().optional(),
      correlationId: z.string().optional(),
      sequence: z.number().int().optional(),
      timestampMs: z.number().int(),
      payload: translationLifecycleRuntimePayloadSchema,
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      kind: z.literal("runtime.error"),
      entityType: runtimeEntityTypeSchema,
      entityId: z.string().min(1),
      locale: z.string().optional(),
      correlationId: z.string().optional(),
      sequence: z.number().int().optional(),
      timestampMs: z.number().int(),
      payload: z
        .object({
          code: z.string().min(1),
          message: z.string(),
          retryable: z.boolean().optional(),
          source: z.enum(["backend", "collab", "worker"]).optional(),
          details: z
            .record(
              z.string(),
              z.union([z.string(), z.number(), z.boolean(), z.null()]),
            )
            .optional(),
        })
        .strict(),
    })
    .strict(),
]);

export function parseEditorRuntimeEventMessage(
  payload: string,
): EditorRuntimeEvent | null {
  try {
    const data = JSON.parse(payload) as unknown;
    const result = editorRuntimeEventSchema.safeParse(data);
    if (!result.success) {
      return null;
    }
    return result.data as EditorRuntimeEvent;
  } catch {
    return null;
  }
}
