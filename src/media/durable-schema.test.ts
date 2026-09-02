import { describe, expect, it } from "vitest";
import { sanitizePageVisualUnitsJson } from "../collaboration/page.ts";
import {
  deriveMediaDisplayName,
  EXTERNAL_VIDEO_ASPECT_RATIO_VALUES,
  EXTERNAL_VIDEO_PREVIEW_WIDTH_DEFAULT,
  EXTERNAL_VIDEO_PREVIEW_WIDTH_MAX_PERCENT,
  EXTERNAL_VIDEO_PREVIEW_WIDTH_MIN_PERCENT,
  externalVideoLinkLayoutPropSchema,
  fileBlockPropSchema,
  hasAttachedFileId,
} from "./block-schemas.ts";

describe("durable media schemas", () => {
  it("derives canonical extensionless display names from attached filenames", () => {
    expect(deriveMediaDisplayName("  field.recording.wav  ")).toBe(
      "field.recording",
    );
    expect(deriveMediaDisplayName("/uploads/session.mp3")).toBe("session");
    expect(deriveMediaDisplayName(String.raw`C:\uploads\session.aiff`)).toBe(
      "session",
    );
    expect(deriveMediaDisplayName(".recording")).toBe(".recording");
    expect(deriveMediaDisplayName("extensionless")).toBe("extensionless");
    expect(deriveMediaDisplayName("/")).toBe("/");
    expect(deriveMediaDisplayName("folder/ .wav")).toBe(" .wav");
    expect(deriveMediaDisplayName("  ")).toBe("");
  });

  it("publishes File blocks only from a non-empty authoritative File identity", () => {
    expect(hasAttachedFileId("file-1")).toBe(true);
    expect(hasAttachedFileId("  file-1  ")).toBe(true);
    expect(hasAttachedFileId("")).toBe(false);
    expect(hasAttachedFileId("   ")).toBe(false);
    expect(hasAttachedFileId(null)).toBe(false);
  });

  it("exposes external-video link layout without duplicating inline link data", () => {
    expect(externalVideoLinkLayoutPropSchema).toEqual({
      previewWidth: { default: "100" },
      aspectRatio: {
        default: "auto",
        values: ["auto", "16:9", "4:3", "1:1", "9:16"],
      },
    });
    expect(EXTERNAL_VIDEO_ASPECT_RATIO_VALUES).toEqual([
      "auto",
      "16:9",
      "4:3",
      "1:1",
      "9:16",
    ]);
    expect(EXTERNAL_VIDEO_PREVIEW_WIDTH_DEFAULT).toBe("100");
    expect(EXTERNAL_VIDEO_PREVIEW_WIDTH_MIN_PERCENT).toBe(10);
    expect(EXTERNAL_VIDEO_PREVIEW_WIDTH_MAX_PERCENT).toBe(100);
  });

  it("exposes ID and authored settings only in durable media props", () => {
    expect(Object.keys(fileBlockPropSchema)).toContain("fileId");
    expect(fileBlockPropSchema).toMatchObject({
      name: { default: "" },
      alt: { default: "" },
      caption: { default: "" },
      width: { default: "0" },
      height: { default: "0" },
    });
    expect(fileBlockPropSchema).not.toHaveProperty("fileName");
    expect(fileBlockPropSchema).not.toHaveProperty("mimeType");
    expect(fileBlockPropSchema).not.toHaveProperty("url");
    expect(fileBlockPropSchema).not.toHaveProperty("mediaAttemptId");
  });

  it("allow-lists only IDs, candidate selection, and authored visual settings", () => {
    const sanitized = JSON.parse(
      sanitizePageVisualUnitsJson(
        JSON.stringify([
          {
            id: "unit-1",
            mesh: "sphere",
            meshFileId: "mesh-file",
            meshOptimizationCandidateId: "candidate-1",
            meshOptimizationSourceFileId: "mesh-file",
            meshOptimizationFileId: "optimized-file",
            meshOptimizationMethod: "draco",
            meshOptimizationTargetRatioPercent: "70",
            textureFileId: "texture-file",
            darkTextureFileId: "dark-texture-file",
            name: "Opening",
            attribution:
              "Created by [Example Artist](https://example.com/artist)",
            scale: "1.5",
            particleSize: "4",
            holdSeconds: "3",
            rotationX: "15",
            rotationY: "-30",
            rotationZ: "45",
            rotationSpeedX: "0.1",
            rotationSpeedY: "-0.2",
            rotationSpeedZ: "0.3",
            scrollRotationTurnsX: "0.25",
            scrollRotationTurnsY: "-0.5",
            scrollRotationTurnsZ: "0.75",
            color: "#fff",
            meshUrl: "/media/token/mesh.glb",
            textureUrl: "/media/token/texture.webp",
            arbitraryKey: "untrusted/object-key",
            meshFileName: "mesh.glb",
            meshFileSize: 1000,
            meshOptimizationFileName: "optimized.glb",
            meshOptimizationFileSize: 700,
            meshOptimizationTriangleCount: "100",
            meshOptimizationVertexCount: "80",
          },
        ]),
      ),
    );

    expect(sanitized).toEqual([
      {
        id: "unit-1",
        mesh: "sphere",
        meshFileId: "mesh-file",
        meshOptimizationCandidateId: "candidate-1",
        meshOptimizationSourceFileId: "mesh-file",
        meshOptimizationFileId: "optimized-file",
        textureFileId: "texture-file",
        darkTextureFileId: "dark-texture-file",
        name: "Opening",
        attribution: "Created by [Example Artist](https://example.com/artist)",
        scale: "1.5",
        particleSize: "4",
        holdSeconds: "3",
        rotationX: "15",
        rotationY: "-30",
        rotationZ: "45",
        rotationSpeedX: "0.1",
        rotationSpeedY: "-0.2",
        rotationSpeedZ: "0.3",
        scrollRotationTurnsX: "0.25",
        scrollRotationTurnsY: "-0.5",
        scrollRotationTurnsZ: "0.75",
        color: "#fff",
      },
    ]);
  });
});
