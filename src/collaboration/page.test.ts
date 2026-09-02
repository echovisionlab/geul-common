import { describe, expect, it } from "vitest";
import {
  extractPageTranslationContentText,
  extractPageFields,
  mergeLocalizedBlockProps,
  mergePageLocaleSectionProps,
  pickPageLocaleSectionProps,
  pickSharedRichTextBlockProps,
  sanitizePageVisualCopyJson,
  sanitizePageVisualUnitsJson,
  stripPageLocaleSectionProps,
} from "./page.js";

describe("extractPageFields", () => {
  it("returns the closed empty page field contract", () => {
    expect(extractPageFields(new Map())).toEqual({});
  });
});

describe("extractPageTranslationContentText", () => {
  it("extracts rich text, localized block props, children, and table cells", () => {
    expect(
      extractPageTranslationContentText([
        null,
        {
          type: "rich-text",
          props: { title: " Section title " },
          content: [
            null,
            {
              type: "paragraph",
              props: {},
              content: [
                null,
                { type: "text", text: " " },
                { type: "text", text: "Hello " },
                { type: "link", content: [] },
                { type: "link", content: [{ type: "text", text: "world" }] },
                { type: "unsupported", text: "ignored" },
              ],
              children: [
                {
                  type: "file",
                  props: { alt: " Child alt ", caption: "Child caption" },
                  content: [],
                },
              ],
            },
            {
              type: "table",
              props: {},
              content: {
                type: "tableContent",
                rows: [
                  null,
                  {
                    cells: [
                      null,
                      { content: [{ type: "text", text: "Cell A" }] },
                      { content: [{ type: "text", text: "Cell B" }] },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ]),
    ).toBe(
      "Hello world\nChild alt\nChild caption\nCell ACell B\nSection title",
    );
  });

  it("extracts immersive copy, common props, and nested column sections", () => {
    expect(
      extractPageTranslationContentText([
        {
          type: "immersive-scene",
          props: {
            title: "Scene heading",
            label: "Scene label",
            description: "Scene description",
            caption: "Scene caption",
            copyJson: JSON.stringify([
              null,
              { id: "unit-1", title: "Unit title", text: "Unit copy" },
              { id: "unit-2", title: " ", text: 3 },
            ]),
          },
        },
        {
          type: "columns",
          columns: [
            null,
            {
              sections: [
                { type: "map", props: { caption: "Nested map caption" } },
                {
                  type: "custom",
                  props: { copyJson: '[{"title":"ignored"}]' },
                },
              ],
            },
          ],
        },
      ]),
    ).toBe(
      "Scene heading\nScene label\nScene description\nScene caption\nUnit title\nUnit copy\nNested map caption",
    );
  });

  it("ignores malformed, empty, and unsupported structures", () => {
    expect(extractPageTranslationContentText(null)).toBe("");
    expect(
      extractPageTranslationContentText([
        { type: "immersive-scene", props: { copyJson: "", caption: 3 } },
        { type: "immersive-scene", props: { copyJson: "not-json" } },
        { type: "immersive-scene", props: { copyJson: "{}" } },
        { type: "rich-text", content: [{ type: "table", content: {} }] },
        { type: "columns", columns: "invalid" },
      ]),
    ).toBe("");
  });

  it("extracts file captions and alt text but not shared names or removed titles", () => {
    expect(
      extractPageTranslationContentText([
        {
          type: "rich-text",
          content: [
            {
              type: "file",
              props: {
                name: "top-level-file.wav",
                title: "Removed title",
                alt: "Top-level file alt",
                caption: "Top-level file caption",
              },
            },
          ],
        },
        {
          type: "columns",
          columns: [
            {
              sections: [
                {
                  type: "rich-text",
                  content: [
                    {
                      type: "file",
                      props: {
                        name: "nested-file.zip",
                        title: "Legacy file title",
                        caption: "Nested file caption",
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]),
    ).toBe(
      [
        "Top-level file alt",
        "Top-level file caption",
        "Nested file caption",
      ].join("\n"),
    );
  });
});

describe("mergePageLocaleSectionProps", () => {
  it("keeps shared map props while removing locale-owned captions", () => {
    expect(pickSharedRichTextBlockProps({}, "map")).toEqual({});
    expect(mergeLocalizedBlockProps({}, {}, "map")).toBeUndefined();
    expect(
      pickSharedRichTextBlockProps(
        {
          mapPlaceIds: ["place-1"],
          zoom: 12,
          caption: "Localized map caption",
        },
        "map",
      ),
    ).toEqual({
      mapPlaceIds: ["place-1"],
      zoom: 12,
    });
  });

  it("keeps unit attribution shared while merging localized copy", () => {
    const attribution =
      "Created by [Example Artist](https://example.com/artist)";
    const unitsJson = JSON.stringify([
      {
        id: "unit-1",
        meshSource: "file",
        meshFileId: "mesh-file-1",
        attribution,
      },
    ]);
    const localizedCopyJson = JSON.stringify([
      {
        id: "unit-1",
        title: "Localized title",
        text: "Localized copy",
        attribution: "Localized attribution must not win",
      },
    ]);
    const durableLocalizedCopyJson = JSON.stringify([
      { id: "unit-1", title: "Localized title", text: "Localized copy" },
    ]);

    expect(
      pickPageLocaleSectionProps({ unitsJson, copyJson: localizedCopyJson }),
    ).toEqual({
      copyJson: durableLocalizedCopyJson,
    });
    expect(
      stripPageLocaleSectionProps({ unitsJson, copyJson: localizedCopyJson }),
    ).toEqual({
      unitsJson,
    });
    expect(
      mergePageLocaleSectionProps(
        { unitsJson },
        { copyJson: localizedCopyJson },
      ),
    ).toEqual({
      unitsJson,
      copyJson: durableLocalizedCopyJson,
    });
    expect(
      extractPageTranslationContentText([
        {
          type: "immersive-scene",
          props: { unitsJson, copyJson: localizedCopyJson },
        },
      ]),
    ).toBe("Localized title\nLocalized copy");
  });

  it("keeps signed mesh vertical offsets shared and strips them from localized copy", () => {
    const unitsJson = JSON.stringify([
      { id: "lowered", meshOffsetY: "-1.25" },
      { id: "raised", meshOffsetY: "0.75" },
    ]);
    const localizedCopyJson = JSON.stringify([
      {
        id: "lowered",
        title: "Lowered",
        text: "Localized copy",
        meshOffsetY: "4",
      },
      {
        id: "raised",
        title: "Raised",
        text: "More localized copy",
        meshOffsetY: "-4",
      },
    ]);
    const durableLocalizedCopyJson = JSON.stringify([
      { id: "lowered", title: "Lowered", text: "Localized copy" },
      { id: "raised", title: "Raised", text: "More localized copy" },
    ]);

    expect(sanitizePageVisualUnitsJson(unitsJson)).toBe(unitsJson);
    expect(stripPageLocaleSectionProps({ unitsJson })).toEqual({ unitsJson });
    expect(
      pickPageLocaleSectionProps({ unitsJson, copyJson: localizedCopyJson }),
    ).toEqual({
      copyJson: durableLocalizedCopyJson,
    });
    expect(
      mergePageLocaleSectionProps(
        { unitsJson },
        { copyJson: localizedCopyJson },
      ),
    ).toEqual({
      unitsJson,
      copyJson: durableLocalizedCopyJson,
    });
  });

  it("keeps per-unit rotation axes shared and strips them from localized copy", () => {
    const unitsJson = JSON.stringify([
      {
        id: "rotating",
        rotationX: "15",
        rotationY: "-30",
        rotationZ: "45",
        rotationSpeedX: "0.1",
        rotationSpeedY: "-0.2",
        rotationSpeedZ: "0.3",
        scrollRotationTurnsX: "0.25",
        scrollRotationTurnsY: "-0.5",
        scrollRotationTurnsZ: "0.75",
      },
    ]);
    const localizedCopyJson = JSON.stringify([
      {
        id: "rotating",
        title: "Localized title",
        text: "Localized copy",
        rotationX: "180",
        rotationSpeedY: "2",
        scrollRotationTurnsZ: "-2",
      },
    ]);

    expect(sanitizePageVisualUnitsJson(unitsJson)).toBe(unitsJson);
    expect(stripPageLocaleSectionProps({ unitsJson })).toEqual({ unitsJson });
    expect(
      pickPageLocaleSectionProps({ unitsJson, copyJson: localizedCopyJson }),
    ).toEqual({
      copyJson: JSON.stringify([
        { id: "rotating", title: "Localized title", text: "Localized copy" },
      ]),
    });
    expect(
      mergePageLocaleSectionProps(
        { unitsJson },
        { copyJson: localizedCopyJson },
      ),
    ).toEqual({
      unitsJson,
      copyJson: JSON.stringify([
        { id: "rotating", title: "Localized title", text: "Localized copy" },
      ]),
    });
  });

  it("removes source immersive scene copy when the locale has no copy", () => {
    expect(
      mergePageLocaleSectionProps(
        {
          unitsJson: '[{"id":"unit-1","meshSource":"file"}]',
          copyJson:
            '[{"id":"unit-1","title":"Source title","text":"Source copy"}]',
          caption: "Source caption",
        },
        {},
      ),
    ).toEqual({
      unitsJson: '[{"id":"unit-1","meshSource":"file"}]',
    });
  });

  it("uses localized immersive scene copy once present", () => {
    expect(
      mergePageLocaleSectionProps(
        {
          unitsJson: '[{"id":"unit-1","meshSource":"file"}]',
          copyJson:
            '[{"id":"unit-1","title":"Source title","text":"Source copy"}]',
        },
        {
          copyJson:
            '[{"id":"unit-1","title":"현지화 제목","text":"현지화 카피"}]',
        },
      ),
    ).toEqual({
      unitsJson: '[{"id":"unit-1","meshSource":"file"}]',
      copyJson: '[{"id":"unit-1","title":"현지화 제목","text":"현지화 카피"}]',
    });
  });

  it("keeps immersive visual identity and settings while removing hydrated metadata", () => {
    const unitsJson = JSON.stringify([
      {
        id: "unit-1",
        name: "Opening",
        meshFileId: "source-file-1",
        meshOptimizationCandidateId: "candidate-1",
        meshOptimizationSourceFileId: "source-file-1",
        meshOptimizationFileId: "optimized-file-1",
        meshOptimizationUrl: "https://cdn.test/optimized.glb",
        meshOptimizationFileName: "optimized.glb",
        meshOptimizationFileSize: 123456,
        meshOptimizationMethod: "draco",
        meshOptimizationTargetRatioPercent: "70",
        meshOptimizationTriangleCount: 4096,
        meshOptimizationVertexCount: 2048,
        particleSize: "4",
      },
    ]);
    const durableUnitsJson = JSON.stringify([
      {
        id: "unit-1",
        name: "Opening",
        meshFileId: "source-file-1",
        meshOptimizationCandidateId: "candidate-1",
        meshOptimizationSourceFileId: "source-file-1",
        meshOptimizationFileId: "optimized-file-1",
        particleSize: "4",
      },
    ]);

    expect(stripPageLocaleSectionProps({ title: "Title", unitsJson })).toEqual({
      unitsJson: durableUnitsJson,
    });
    expect(
      mergePageLocaleSectionProps(
        {
          unitsJson,
          copyJson:
            '[{"id":"unit-1","title":"Source title","text":"Source copy"}]',
        },
        {
          copyJson:
            '[{"id":"unit-1","title":"Localized title","text":"Localized copy"}]',
        },
      ),
    ).toEqual({
      unitsJson: durableUnitsJson,
      copyJson:
        '[{"id":"unit-1","title":"Localized title","text":"Localized copy"}]',
    });
  });

  it("keeps only locale copy identity, title, and rich description text", () => {
    const description =
      "First line with **Markdown**\n\nSecond line with controls 🎛️ and sparkles ✨";
    const copyJson = JSON.stringify([
      {
        id: "unit-1",
        title: "Opening 🎬",
        text: description,
        name: "Locale must not own visual names",
        particleSize: "8",
        meshOptimizationCandidateId: "locale-candidate",
        meshOptimizationUrl: "/media/token/optimized.glb",
      },
    ]);
    const durableCopyJson = JSON.stringify([
      { id: "unit-1", title: "Opening 🎬", text: description },
    ]);

    expect(sanitizePageVisualCopyJson(copyJson)).toBe(durableCopyJson);
    expect(pickPageLocaleSectionProps({ copyJson })).toEqual({
      copyJson: durableCopyJson,
    });
    expect(mergePageLocaleSectionProps({}, { copyJson })).toEqual({
      copyJson: durableCopyJson,
    });
    expect(JSON.parse(durableCopyJson)).toEqual([
      { id: "unit-1", title: "Opening 🎬", text: description },
    ]);
  });

  it("rejects malformed visual unit JSON instead of persisting opaque managed URLs", () => {
    expect(() =>
      sanitizePageVisualUnitsJson('{"meshUrl":"/media/token/file.glb"}'),
    ).toThrow("must be an array");
    expect(() => sanitizePageVisualUnitsJson("not-json")).toThrow(
      "Failed to parse page visual units JSON",
    );
    expect(sanitizePageVisualUnitsJson('[null,"copy",[]]')).toBe(
      '[null,"copy",[]]',
    );
    expect(() => sanitizePageVisualCopyJson('{"text":"Copy"}')).toThrow(
      "must be an array",
    );
    expect(() => sanitizePageVisualCopyJson("not-json")).toThrow(
      "Failed to parse page visual copy JSON",
    );
    expect(sanitizePageVisualCopyJson("")).toBe("");
    expect(
      sanitizePageVisualCopyJson(
        '[null,"copy",[],{"id":1,"title":null,"text":true}]',
      ),
    ).toBe('[null,"copy",[],{}]');
  });

  it("keeps localized section props when shared props are absent", () => {
    expect(
      mergePageLocaleSectionProps(undefined, {
        copyJson:
          '[{"id":"unit-1","title":"Localized title","text":"Localized copy"}]',
      }),
    ).toEqual({
      copyJson:
        '[{"id":"unit-1","title":"Localized title","text":"Localized copy"}]',
    });
  });

  it("covers empty, non-object, and non-string section prop boundaries", () => {
    expect(pickPageLocaleSectionProps(undefined)).toBeUndefined();
    expect(pickPageLocaleSectionProps({ description: 1 })).toBeUndefined();
    expect(stripPageLocaleSectionProps(undefined)).toEqual({});
    expect(stripPageLocaleSectionProps({ unitsJson: 1, stable: true })).toEqual(
      {
        unitsJson: 1,
        stable: true,
      },
    );
    expect(
      mergePageLocaleSectionProps({}, { title: "Localized title" }),
    ).toEqual({
      title: "Localized title",
    });
    expect(mergePageLocaleSectionProps([], [])).toBeUndefined();
    expect(mergePageLocaleSectionProps({}, {})).toBeUndefined();
  });

  it("keeps external video URL and ratio shared while projecting localized captions", () => {
    expect(
      stripPageLocaleSectionProps({
        url: "https://vimeo.com/76979871",
        caption: "Source caption",
        aspectRatio: "4:3",
      }),
    ).toEqual({
      url: "https://vimeo.com/76979871",
      aspectRatio: "4:3",
    });
    expect(
      mergePageLocaleSectionProps(
        {
          url: "https://vimeo.com/76979871",
          aspectRatio: "4:3",
        },
        { caption: "Localized caption" },
      ),
    ).toEqual({
      url: "https://vimeo.com/76979871",
      aspectRatio: "4:3",
      caption: "Localized caption",
    });
  });

  it("merges only durable shared media props and localized text", () => {
    expect(mergeLocalizedBlockProps(null, {}, "file")).toBeUndefined();
    expect(mergeLocalizedBlockProps("invalid", {}, "file")).toBeUndefined();
    expect(mergeLocalizedBlockProps([], {}, "file")).toBeUndefined();
    expect(
      mergeLocalizedBlockProps(
        {
          fileId: "file-1",
          fileName: "archive.zip",
          name: "Archive",
          previewWidth: "100",
          textAlignment: "right",
        },
        {
          title: "Removed localized file title",
          caption: "Localized file caption",
        },
        "file",
      ),
    ).toEqual({
      fileId: "file-1",
      name: "Archive",
      previewWidth: "100",
      textAlignment: "right",
      caption: "Localized file caption",
    });
    expect(
      mergeLocalizedBlockProps(
        { fileId: "file-1", title: "source", custom: true },
        { title: 123 },
        "custom-block",
      ),
    ).toEqual({ fileId: "file-1", title: "source", custom: true });
  });
});
