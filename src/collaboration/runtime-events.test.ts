import { describe, expect, it } from "vitest";
import {
  isMediaProcessingRuntimeReady,
  isOgGenerationRuntimeTerminal,
  parseEditorRuntimeEventMessage,
} from "./runtime-events.js";

function ogLifecycleEvent({
  entityType = "post",
  locale = "ko",
  correlationId = "generation-1",
  status = "queued",
  statusFields = {},
}: {
  entityType?: string;
  locale?: string | null;
  correlationId?: string | null;
  status?: string;
  statusFields?: Record<string, unknown>;
} = {}) {
  return {
    version: 1,
    kind: "og.lifecycle",
    entityType,
    entityId: entityType === "site" ? "default" : `${entityType}-1`,
    ...(locale === null ? {} : { locale }),
    ...(correlationId === null ? {} : { correlationId }),
    timestampMs: 1_700_000_000_000,
    payload: {
      generationId: "generation-1",
      runId: "run-1",
      status,
      ...statusFields,
    },
  };
}

describe("isMediaProcessingRuntimeReady", () => {
  it("uses only canonical status for readiness", () => {
    expect(isMediaProcessingRuntimeReady({ status: "ready" })).toBe(true);
    expect(isMediaProcessingRuntimeReady({ status: "processing" })).toBe(false);
    expect(isMediaProcessingRuntimeReady({ status: "failed" })).toBe(false);
  });
});

describe("isOgGenerationRuntimeTerminal", () => {
  it.each(["ready", "failed", "superseded", "cancelled"] as const)(
    "recognizes %s as terminal",
    (status) => expect(isOgGenerationRuntimeTerminal(status)).toBe(true),
  );

  it.each(["queued", "processing"] as const)("keeps %s active", (status) =>
    expect(isOgGenerationRuntimeTerminal(status)).toBe(false),
  );
});

describe("parseEditorRuntimeEventMessage", () => {
  it.each([
    [
      "queued",
      { errorCode: "temporary_unavailable", error: "retry scheduled" },
    ],
    ["processing", {}],
    [
      "ready",
      { assetId: "asset-1", assetUrl: "https://cdn.test/asset/asset-1.webp" },
    ],
    ["failed", { errorCode: "render_failed", error: "render failed" }],
    [
      "superseded",
      {
        replacementGenerationId: "generation-2",
        errorCode: "lease_expired",
        error: "worker lease expired before replacement",
      },
    ],
    ["cancelled", {}],
  ] as const)(
    "accepts strict %s OG lifecycle events",
    (status, statusFields) => {
      const event = parseEditorRuntimeEventMessage(
        JSON.stringify(ogLifecycleEvent({ status, statusFields })),
      );

      expect(event?.kind).toBe("og.lifecycle");
      if (event?.kind !== "og.lifecycle") {
        throw new Error("expected OG generation lifecycle event");
      }
      expect(event.payload).toMatchObject({
        generationId: "generation-1",
        runId: "run-1",
        status,
      });
    },
  );

  it.each([
    ["post", "ko"],
    ["page", "ko"],
    ["form", "ko"],
    ["privacy", "ko"],
    ["terms", "ko"],
    ["work", null],
    ["artist", null],
    ["label", null],
    ["release", null],
    ["series", null],
    ["site", null],
  ] as const)("accepts the canonical %s target scope", (entityType, locale) => {
    const event = parseEditorRuntimeEventMessage(
      JSON.stringify(ogLifecycleEvent({ entityType, locale })),
    );

    expect(event?.kind).toBe("og.lifecycle");
    expect(event?.entityType).toBe(entityType);
    expect(event?.locale).toBe(locale ?? undefined);
  });

  it.each([
    ["removed dispatched status", "dispatched", {}],
    ["ready without an asset", "ready", {}],
    ["failed without an error", "failed", {}],
    ["superseded without a replacement", "superseded", {}],
    ["queued with an asset", "queued", { assetId: "asset-1" }],
    [
      "cancelled with a replacement",
      "cancelled",
      { replacementGenerationId: "generation-2" },
    ],
  ] as const)("rejects %s", (_name, status, statusFields) => {
    const event = parseEditorRuntimeEventMessage(
      JSON.stringify(ogLifecycleEvent({ status, statusFields })),
    );

    expect(event).toBeNull();
  });

  it.each([
    ["non-OG entity type", { entityType: "program_event", locale: "ko" }],
    ["missing locale target", { entityType: "post", locale: null }],
    ["empty locale target", { entityType: "page", locale: "" }],
    ["locale on base-only entity", { entityType: "work", locale: "ko" }],
    ["missing correlation id", { correlationId: null }],
    ["mismatched correlation id", { correlationId: "generation-other" }],
  ] as const)("rejects %s", (_name, overrides) => {
    expect(
      parseEditorRuntimeEventMessage(
        JSON.stringify(ogLifecycleEvent(overrides)),
      ),
    ).toBeNull();
  });

  it("accepts a strict backend-owned media processing lifecycle event", () => {
    const event = parseEditorRuntimeEventMessage(
      JSON.stringify({
        version: 1,
        kind: "media.processing.lifecycle",
        entityType: "post",
        entityId: "post-1",
        correlationId: "job-1",
        sequence: 7,
        timestampMs: 1_700_000_000_000,
        payload: {
          fileId: "file-1",
          status: "processing",
          percentage: 42,
        },
      }),
    );

    expect(event?.kind).toBe("media.processing.lifecycle");
    if (event?.kind !== "media.processing.lifecycle") {
      throw new Error("expected media processing lifecycle event");
    }
    expect(event.payload.status).toBe("processing");
    expect(event.payload.percentage).toBe(42);
  });

  it("rejects processing media lifecycle events without percentage", () => {
    const event = parseEditorRuntimeEventMessage(
      JSON.stringify({
        version: 1,
        kind: "media.processing.lifecycle",
        entityType: "post",
        entityId: "post-1",
        timestampMs: 1_700_000_000_000,
        payload: {
          fileId: "file-1",
          status: "processing",
        },
      }),
    );

    expect(event).toBeNull();
  });

  it("rejects ready media lifecycle events without outputs", () => {
    const event = parseEditorRuntimeEventMessage(
      JSON.stringify({
        version: 1,
        kind: "media.processing.lifecycle",
        entityType: "post",
        entityId: "post-1",
        timestampMs: 1_700_000_000_000,
        payload: {
          fileId: "file-1",
          status: "ready",
        },
      }),
    );

    expect(event).toBeNull();
  });

  it("rejects ready outputs on non-ready lifecycle events", () => {
    const event = parseEditorRuntimeEventMessage(
      JSON.stringify({
        version: 1,
        kind: "media.processing.lifecycle",
        entityType: "post",
        entityId: "post-1",
        timestampMs: 1_700_000_000_000,
        payload: {
          fileId: "file-1",
          status: "processing",
          percentage: 42,
          outputs: {
            hlsGenerationId: "generation-1",
          },
        },
      }),
    );

    expect(event).toBeNull();
  });

  it("rejects processing percentage on ready lifecycle events", () => {
    const event = parseEditorRuntimeEventMessage(
      JSON.stringify({
        version: 1,
        kind: "media.processing.lifecycle",
        entityType: "post",
        entityId: "post-1",
        timestampMs: 1_700_000_000_000,
        payload: {
          fileId: "file-1",
          status: "ready",
          percentage: 100,
          outputs: {
            hlsGenerationId: "generation-1",
          },
        },
      }),
    );

    expect(event).toBeNull();
  });

  it("rejects outputs and processing percentages on failed lifecycle events", () => {
    const invalid = parseEditorRuntimeEventMessage(
      JSON.stringify({
        version: 1,
        kind: "media.processing.lifecycle",
        entityType: "post",
        entityId: "post-1",
        timestampMs: 1_700_000_000_000,
        payload: {
          fileId: "file-1",
          status: "failed",
          percentage: 50,
          outputs: { waveformAssetId: "asset-waveform" },
          error: "transcode failed",
        },
      }),
    );
    const valid = parseEditorRuntimeEventMessage(
      JSON.stringify({
        version: 1,
        kind: "media.processing.lifecycle",
        entityType: "post",
        entityId: "post-1",
        timestampMs: 1_700_000_000_000,
        payload: {
          fileId: "file-1",
          status: "failed",
          error: "transcode failed",
        },
      }),
    );

    expect(invalid).toBeNull();
    expect(valid?.kind).toBe("media.processing.lifecycle");
  });

  it("rejects runtime event payload fields outside the shared contract", () => {
    const event = parseEditorRuntimeEventMessage(
      JSON.stringify({
        version: 1,
        kind: "media.processing.lifecycle",
        entityType: "post",
        entityId: "post-1",
        timestampMs: 1_700_000_000_000,
        payload: {
          fileId: "file-1",
          status: "ready",
          outputs: {
            hlsGenerationId: "generation-1",
          },
          collabOwnedStatus: true,
        },
      }),
    );

    expect(event).toBeNull();
  });

  it("accepts ready media lifecycle outputs by asset and generation id", () => {
    const event = parseEditorRuntimeEventMessage(
      JSON.stringify({
        version: 1,
        kind: "media.processing.lifecycle",
        entityType: "post",
        entityId: "post-1",
        timestampMs: 1_700_000_000_000,
        payload: {
          fileId: "file-1",
          status: "ready",
          outputs: {
            hlsGenerationId: "generation-1",
            spectrogramAssetId: "asset-spectrogram",
            waveformAssetId: "asset-waveform",
            thumbnailAssetId: "asset-thumbnail",
            durationSeconds: 123,
          },
        },
      }),
    );

    expect(event?.kind).toBe("media.processing.lifecycle");
    if (event?.kind !== "media.processing.lifecycle") {
      throw new Error("expected media processing lifecycle event");
    }
    expect(event.payload.outputs).toMatchObject({
      hlsGenerationId: "generation-1",
      spectrogramAssetId: "asset-spectrogram",
      waveformAssetId: "asset-waveform",
      thumbnailAssetId: "asset-thumbnail",
      durationSeconds: 123,
    });
  });

  it("accepts strict file ingest lifecycle runtime events", () => {
    const event = parseEditorRuntimeEventMessage(
      JSON.stringify({
        version: 1,
        kind: "file.ingest.lifecycle",
        entityType: "post",
        entityId: "post-1",
        correlationId: "upload-1",
        sequence: 3,
        timestampMs: 1_700_000_000_000,
        payload: {
          fileId: "file-1",
          source: "upload",
          mediaKind: "EDITOR_IMAGE",
          stage: "attached",
          progress: 100,
          bytesCompleted: 1024,
          bytesTotal: 1024,
          fileName: "cover.png",
          mimeType: "image/png",
          fileSize: 1024,
        },
      }),
    );

    expect(event?.kind).toBe("file.ingest.lifecycle");
    if (event?.kind !== "file.ingest.lifecycle") {
      throw new Error("expected file ingest lifecycle event");
    }
    expect(event.payload.stage).toBe("attached");
    expect(event.payload.mediaKind).toBe("EDITOR_IMAGE");
    expect(event.payload.fileName).toBe("cover.png");
    expect(event.payload.mimeType).toBe("image/png");
    expect(event.payload.fileSize).toBe(1024);
  });

  function translationLifecycleEvent(payload: Record<string, unknown> = {}) {
    return {
      version: 1,
      kind: "translation.lifecycle",
      entityType: "post",
      entityId: "post-1",
      timestampMs: 1_700_000_000_000,
      payload: {
        jobId: "job-1",
        targetLocale: "ko",
        status: "failed",
        ...payload,
      },
    };
  }

  it("accepts the exact failed translation lifecycle payload", () => {
    const event = parseEditorRuntimeEventMessage(
      JSON.stringify(
        translationLifecycleEvent({ error: "provider_unavailable" }),
      ),
    );

    expect(event?.kind).toBe("translation.lifecycle");
    if (event?.kind !== "translation.lifecycle") {
      throw new Error("expected translation lifecycle event");
    }
    expect(event.payload).toEqual({
      jobId: "job-1",
      targetLocale: "ko",
      status: "failed",
      error: "provider_unavailable",
    });
  });

  it("accepts a failed translation lifecycle without an optional error", () => {
    const event = parseEditorRuntimeEventMessage(
      JSON.stringify(translationLifecycleEvent()),
    );

    expect(event?.kind).toBe("translation.lifecycle");
  });

  it.each(["queued", "running", "applied", "cancelled"] as const)(
    "rejects the removed %s translation lifecycle status",
    (status) => {
      const event = parseEditorRuntimeEventMessage(
        JSON.stringify(translationLifecycleEvent({ status })),
      );

      expect(event).toBeNull();
    },
  );

  it.each([
    "sourceLocale",
    "translationSpecVersion",
    "sourceEpoch",
    "sourceHash",
    "sourceRevision",
  ] as const)("rejects removed translation payload field %s", (field) => {
    const event = parseEditorRuntimeEventMessage(
      JSON.stringify(translationLifecycleEvent({ [field]: "legacy" })),
    );

    expect(event).toBeNull();
  });

  it("accepts expired Release Track ingest lifecycle runtime events", () => {
    const event = parseEditorRuntimeEventMessage(
      JSON.stringify({
        version: 1,
        kind: "file.ingest.lifecycle",
        entityType: "release",
        entityId: "release-1",
        correlationId: "upload-1",
        sequence: 1,
        timestampMs: 1_700_000_000_000,
        payload: {
          fileId: "file-1",
          uploadId: "upload-1",
          source: "upload",
          mediaKind: "AUDIO",
          slotId: "original",
          attemptId: "attempt-1",
          stage: "expired",
          progress: 0,
          error: "upload session expired before Track attachment",
          trackId: "track-1",
          releaseId: "release-1",
        },
      }),
    );

    expect(event?.kind).toBe("file.ingest.lifecycle");
    if (event?.kind !== "file.ingest.lifecycle") {
      throw new Error("expected file ingest lifecycle event");
    }
    expect(event.payload.stage).toBe("expired");
  });

  it("returns null for malformed JSON", () => {
    expect(parseEditorRuntimeEventMessage("{")).toBeNull();
  });
});
