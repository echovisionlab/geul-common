import { describe, expect, it } from "vitest";
import {
  collectPageBlockTypes,
  createPageBlockFixtureSections,
  PAGE_BLOCK_FIXTURE_SECTIONS,
  PAGE_BLOCK_TYPES,
} from "./block-fixtures.ts";

describe("page block fixtures", () => {
  it("contains a fixture for every registered page block type", () => {
    const types = collectPageBlockTypes(PAGE_BLOCK_FIXTURE_SECTIONS);

    expect(new Set(types)).toEqual(new Set(PAGE_BLOCK_TYPES));
    expect(types).toContain("columns");
    expect(types.filter((type) => type === "external-video")).toHaveLength(2);
    expect(types.filter((type) => type === "rich-text")).toHaveLength(2);
  });

  it("returns an isolated structured clone", () => {
    const first = createPageBlockFixtureSections();
    const second = createPageBlockFixtureSections();

    first[0]!.id = "changed";
    expect(second[0]!.id).toBe("fixture-section-rich-text");
    expect(PAGE_BLOCK_FIXTURE_SECTIONS[0]!.id).toBe(
      "fixture-section-rich-text",
    );
  });

  it("models shared media names and localized captions in top-level and nested rich text", () => {
    const topLevelRichText = PAGE_BLOCK_FIXTURE_SECTIONS.find(
      (section) => section.id === "fixture-section-rich-text",
    );
    const columns = PAGE_BLOCK_FIXTURE_SECTIONS.find(
      (section) => section.id === "fixture-section-columns",
    );
    const nestedRichText = columns?.columns?.[0]?.sections.find(
      (section) => section.id === "fixture-column-rich-text",
    );

    for (const content of [
      topLevelRichText?.content,
      nestedRichText?.content,
    ]) {
      for (const kind of ["audio", "video", "attachment", "file"]) {
        const block = content?.find((candidate) =>
          candidate.id.endsWith(`-${kind}`),
        );
        expect(block?.type).toBe("file");
        expect(block?.props.name).toEqual(expect.any(String));
        expect(block?.props.caption).toEqual(expect.any(String));
      }
    }
  });

  it("provides top-level and Columns-nested audio fixture props", () => {
    const topLevelAudio = PAGE_BLOCK_FIXTURE_SECTIONS.find(
      (section) => section.id === "fixture-section-rich-text",
    )?.content?.find((block) => block.id === "fixture-rich-text-audio");
    const nestedAudio = PAGE_BLOCK_FIXTURE_SECTIONS.find(
      (section) => section.id === "fixture-section-columns",
    )
      ?.columns?.[0]?.sections.find(
        (section) => section.id === "fixture-column-rich-text",
      )
      ?.content?.find((block) => block.id === "fixture-column-rich-text-audio");

    expect(topLevelAudio?.props).toEqual({
      fileId: "fixture-audio-file",
      name: "fixture-audio.wav",
      caption: "Fixture audio caption",
      previewWidth: "100",
      textAlignment: "left",
    });
    expect(nestedAudio?.props).toEqual({
      fileId: "fixture-nested-audio-file",
      name: "fixture-nested-audio.wav",
      caption: "Fixture nested audio caption",
      previewWidth: "100",
      textAlignment: "left",
    });
  });

  it("collects flat and nested custom sections in traversal order", () => {
    expect(
      collectPageBlockTypes([
        { id: "a", type: "map", settings: {} },
        {
          id: "b",
          type: "columns",
          settings: {},
          columns: [
            {
              id: "column",
              sections: [{ id: "c", type: "form", settings: {} }],
            },
          ],
        },
      ]),
    ).toEqual(["map", "columns", "form"]);
  });
});
