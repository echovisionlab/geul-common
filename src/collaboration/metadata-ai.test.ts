import { describe, expect, it } from "vitest";
import {
  DEFAULT_METADATA_AI_SHARED_STATE,
  extractMetadataAiSharedState,
  METADATA_AI_GRACE_PERIOD_MS,
  METADATA_AI_JSON_KEYS,
  METADATA_AI_MAP_NAME,
  metadataAiSharedStateSchema,
} from "./metadata-ai.ts";

function fields(values: Record<string, unknown>): Map<string, never> {
  return new Map(Object.entries(values)) as Map<string, never>;
}

describe("metadata AI shared state", () => {
  const memberId = "11111111-1111-4111-8111-111111111111";

  it("uses the complete idle default state", () => {
    expect(extractMetadataAiSharedState(fields({}))).toEqual(
      DEFAULT_METADATA_AI_SHARED_STATE,
    );
    expect(METADATA_AI_MAP_NAME).toBe("metadata-ai");
    expect(METADATA_AI_GRACE_PERIOD_MS).toBe(10_000);
    expect(METADATA_AI_JSON_KEYS).toEqual(new Set(["requestedFields"]));
  });

  it("extracts primitive and JSON-backed state", () => {
    expect(
      extractMetadataAiSharedState(
        fields({
          status: "generating",
          generationId: "generation-1",
          jobId: "job-1",
          requesterMemberId: memberId,
          requesterNickname: "Editor",
          requestedFields: JSON.stringify(["summary"]),
          allMetadata: true,
          startedAt: 1,
          updatedAt: 2,
          orphanedAt: null,
          autoClearAt: 3,
        }),
      ),
    ).toEqual({
      status: "generating",
      generationId: "generation-1",
      jobId: "job-1",
      requesterMemberId: memberId,
      requesterNickname: "Editor",
      requestedFields: ["summary"],
      allMetadata: true,
      startedAt: 1,
      updatedAt: 2,
      orphanedAt: null,
      autoClearAt: 3,
    });

    expect(
      extractMetadataAiSharedState(fields({ requestedFields: ["summary"] })),
    ).toMatchObject({
      requestedFields: ["summary"],
    });
  });

  it("rejects malformed JSON and unknown durable fields", () => {
    expect(() =>
      extractMetadataAiSharedState(fields({ requesterUserId: "legacy" })),
    ).toThrow("Legacy metadata AI requester fields are not supported");
    expect(() =>
      extractMetadataAiSharedState(fields({ requestedFields: "[" })),
    ).toThrow('Failed to parse JSON for metadata AI field "requestedFields"');
    expect(
      metadataAiSharedStateSchema.safeParse({
        ...DEFAULT_METADATA_AI_SHARED_STATE,
        originalUrl: "/media/token/file.mp3",
      }).success,
    ).toBe(false);
    expect(
      metadataAiSharedStateSchema.safeParse({
        ...DEFAULT_METADATA_AI_SHARED_STATE,
        requesterNickname: "Nickname without a Member",
      }).success,
    ).toBe(false);
    expect(
      metadataAiSharedStateSchema.safeParse({
        ...DEFAULT_METADATA_AI_SHARED_STATE,
        requesterMemberId: "not-a-uuid",
      }).success,
    ).toBe(false);
    expect(
      metadataAiSharedStateSchema.safeParse({
        ...DEFAULT_METADATA_AI_SHARED_STATE,
        requesterMemberId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".toUpperCase(),
      }).success,
    ).toBe(false);
  });

  it.each(["", "N".repeat(101)])(
    "rejects out-of-contract nickname %j",
    (nickname) => {
      expect(
        metadataAiSharedStateSchema.safeParse({
          ...DEFAULT_METADATA_AI_SHARED_STATE,
          requesterMemberId: memberId,
          requesterNickname: nickname,
        }).success,
      ).toBe(false);
    },
  );
});
