import type { ExternalVideoAspectRatio } from "../media/block-schemas.ts";

export type PageBlockType =
  | "rich-text"
  | "post-list"
  | "post-table"
  | "post-map"
  | "work-map"
  | "work-table"
  | "work-list"
  | "program-event-list"
  | "release-list"
  | "artist-list"
  | "label-list"
  | "text-marquee"
  | "client-marquee"
  | "label-marquee"
  | "author-list"
  | "form"
  | "immersive-scene"
  | "map"
  | "external-video"
  | "columns";

export interface ExternalVideoProps {
  url: string;
  caption: string;
  aspectRatio: ExternalVideoAspectRatio;
}

export interface PageBlockFixtureInlineContent {
  type: string;
  text?: string;
  styles?: Record<string, unknown>;
}

export interface PageBlockFixtureBlock {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content?: PageBlockFixtureInlineContent[];
  children?: PageBlockFixtureBlock[];
}

export interface PageBlockFixtureSection {
  id: string;
  type: PageBlockType;
  settings: {
    backgroundColor?: string;
    paddingTop?: string;
    paddingBottom?: string;
    paddingLeft?: string;
    paddingRight?: string;
    maxWidth?: "full" | "container" | "narrow";
  };
  props?: Record<string, unknown>;
  content?: PageBlockFixtureBlock[];
  columns?: Array<{
    id: string;
    sections: PageBlockFixtureSection[];
  }>;
}

export const PAGE_BLOCK_TYPES = [
  "rich-text",
  "post-list",
  "post-table",
  "post-map",
  "work-map",
  "work-table",
  "author-list",
  "work-list",
  "program-event-list",
  "release-list",
  "artist-list",
  "label-list",
  "text-marquee",
  "client-marquee",
  "label-marquee",
  "form",
  "immersive-scene",
  "map",
  "external-video",
  "columns",
] as const satisfies readonly PageBlockType[];

function createParagraphBlock(id: string, text: string): PageBlockFixtureBlock {
  return {
    id,
    type: "paragraph",
    props: {},
    content: [{ type: "text", text, styles: {} }],
    children: [],
  };
}

export const PAGE_BLOCK_FIXTURE_SECTIONS: PageBlockFixtureSection[] = [
  {
    id: "fixture-section-rich-text",
    type: "rich-text",
    settings: {},
    props: {},
    content: [
      createParagraphBlock(
        "fixture-rich-text-paragraph",
        "Fixture rich text block",
      ),
      {
        id: "fixture-rich-text-audio",
        type: "file",
        props: {
          fileId: "fixture-audio-file",
          name: "fixture-audio.wav",
          caption: "Fixture audio caption",
          previewWidth: "100",
          textAlignment: "left",
        },
        children: [],
      },
      {
        id: "fixture-rich-text-video",
        type: "file",
        props: {
          fileId: "fixture-video-file",
          name: "fixture-video.mp4",
          caption: "Fixture video caption",
          previewWidth: "100",
          textAlignment: "left",
        },
        children: [],
      },
      {
        id: "fixture-rich-text-attachment",
        type: "file",
        props: {
          fileId: "fixture-attachment-file",
          name: "fixture-score.pdf",
          caption: "Fixture attachment caption",
          previewWidth: "100",
          textAlignment: "left",
        },
        children: [],
      },
      {
        id: "fixture-rich-text-file",
        type: "file",
        props: {
          fileId: "fixture-file",
          name: "fixture-archive.zip",
          caption: "Fixture file caption",
          previewWidth: "100",
          textAlignment: "left",
        },
        children: [],
      },
    ],
  },
  {
    id: "fixture-section-post-list",
    type: "post-list",
    settings: {},
    props: {
      layout: "grid",
      columns: "2",
      limit: "4",
      showFeaturedImage: "true",
      showMeta: "true",
      imageAspectRatio: "16:9",
    },
  },
  {
    id: "fixture-section-post-table",
    type: "post-table",
    settings: {},
    props: {
      categoryIds: "",
      tagIds: "",
      authorIds: "",
      seriesId: "",
      pageSize: "5",
    },
  },
  {
    id: "fixture-section-post-map",
    type: "post-map",
    settings: {},
    props: {
      seriesId: "00000000-0000-0000-0000-000000000000",
      requirePlace: "true",
      sortBy: "published_at",
      sortOrder: "desc",
      aspectRatio: "4:3",
      previewWidth: "100",
      primaryLabel: "content_title",
      preferredScheme: "auto",
      areaLabelsMode: "inherit",
      poiLabelsMode: "inherit",
    },
  },
  {
    id: "fixture-section-work-map",
    type: "work-map",
    settings: {},
    props: {
      workTypes: "music_project,portfolio",
      featuredOnly: "false",
      sortBy: "published_at",
      sortOrder: "desc",
      aspectRatio: "4:3",
      previewWidth: "100",
      primaryLabel: "content_title",
      preferredScheme: "auto",
      areaLabelsMode: "inherit",
      poiLabelsMode: "inherit",
    },
  },
  {
    id: "fixture-section-work-table",
    type: "work-table",
    settings: {},
    props: {
      workTypes: "music_project,portfolio",
      featuredOnly: "false",
      pageSize: "5",
    },
  },
  {
    id: "fixture-section-author-list",
    type: "author-list",
    settings: {},
    props: {
      layout: "grid",
      columns: "2",
      limit: "4",
      showBio: "true",
      showAvatar: "true",
    },
  },
  {
    id: "fixture-section-work-list",
    type: "work-list",
    settings: {},
    props: {
      layout: "grid",
      columns: "2",
      limit: "4",
      workTypes: "music_project,portfolio",
      sortBy: "published_at",
      sortOrder: "desc",
      showPagination: "false",
      showImage: "true",
      showMeta: "true",
      imageAspectRatio: "16:9",
      carouselLoop: "true",
      carouselIndicators: "true",
    },
  },
  {
    id: "fixture-section-program-event-list",
    type: "program-event-list",
    settings: {},
    props: {
      layout: "grid",
      columns: "2",
      limit: "4",
      typeIds: "",
      seriesId: "",
      timeWindow: "all",
      sortBy: "starts_at",
      sortOrder: "asc",
      showPagination: "false",
      showImage: "true",
      showMeta: "true",
      imageAspectRatio: "16:9",
      carouselLoop: "true",
      carouselIndicators: "true",
    },
  },
  {
    id: "fixture-section-release-list",
    type: "release-list",
    settings: {},
    props: {
      layout: "grid",
      columns: "2",
      limit: "4",
      types: "album,single",
      categoryIds: "",
      sortBy: "release_date",
      sortOrder: "desc",
      showPagination: "false",
      showImage: "true",
      showMeta: "true",
      imageAspectRatio: "1:1",
      carouselLoop: "true",
      carouselIndicators: "true",
    },
  },
  {
    id: "fixture-section-artist-list",
    type: "artist-list",
    settings: {},
    props: {
      layout: "grid",
      sortBy: "name",
      sortOrder: "asc",
      columns: "2",
      limit: "4",
      showPagination: "false",
      showImage: "true",
      showMeta: "true",
      imageAspectRatio: "1:1",
    },
  },
  {
    id: "fixture-section-label-list",
    type: "label-list",
    settings: {},
    props: {
      layout: "grid",
      sortBy: "name",
      sortOrder: "asc",
      columns: "2",
      limit: "4",
      showPagination: "false",
      showImage: "true",
      showMeta: "true",
      imageAspectRatio: "1:1",
      carouselLoop: "true",
      carouselIndicators: "true",
    },
  },
  {
    id: "fixture-section-text-marquee",
    type: "text-marquee",
    settings: {},
    props: {
      itemsJson: JSON.stringify([
        { text: "Fixture announcement", href: "https://example.com" },
        { text: "Fixture item" },
      ]),
      direction: "left",
      speed: "normal",
      speedPxPerSecond: "12",
      itemHeight: "md",
      itemHeightPx: "28",
      gap: "lg",
      pauseOnHover: "true",
      linkTarget: "same-tab",
    },
  },
  {
    id: "fixture-section-client-marquee",
    type: "client-marquee",
    settings: {},
    props: {
      source: "all",
      ids: "",
      linkMode: "entity",
      logoScale: "contain",
      fallbackMode: "name",
      limit: "12",
      direction: "left",
      speed: "normal",
      speedPxPerSecond: "12",
      itemHeight: "md",
      itemHeightPx: "28",
      gap: "lg",
      pauseOnHover: "true",
      linkTarget: "same-tab",
    },
  },
  {
    id: "fixture-section-label-marquee",
    type: "label-marquee",
    settings: {},
    props: {
      source: "all",
      ids: "",
      linkMode: "entity",
      logoScale: "contain",
      fallbackMode: "name",
      limit: "12",
      direction: "left",
      speed: "normal",
      speedPxPerSecond: "12",
      itemHeight: "md",
      itemHeightPx: "28",
      gap: "lg",
      pauseOnHover: "true",
      linkTarget: "same-tab",
    },
  },
  {
    id: "fixture-section-form",
    type: "form",
    settings: {},
    props: {
      formId: "",
      showTitle: "true",
    },
  },
  {
    id: "fixture-section-immersive-scene",
    type: "immersive-scene",
    settings: {},
    props: {
      playback: "scroll",
      loop: "false",
      transition: "smooth",
      transitionWindow: "0.22",
      textureSize: "64",
      heightVh: "300",
      minHeightPx: "720",
      unitHoldSeconds: "3",
      unitGapSeconds: "1",
      particleSize: "1",
      backgroundColor: "#070a0d",
      unitsJson:
        '[{"id":"fixture-intro","mesh":"sphere","color":"#d8dde5"},{"id":"fixture-focus","mesh":"torus","color":"#f97316"}]',
      copyJson:
        '[{"id":"fixture-intro","title":"Fixture intro","text":"Fixture intro copy."},{"id":"fixture-focus","title":"Fixture focus","text":"Fixture focus copy."}]',
    },
  },
  {
    id: "fixture-section-map",
    type: "map",
    settings: {},
    props: {
      mapPlaceIds: "",
      mapPlaceId: "",
      location: "",
      aspectRatio: "16:9",
      previewWidth: "100",
      zoom: "15",
      url: "map",
      showPreview: "true",
      draggable: "true",
      zoomable: "true",
      rotatable: "false",
      tiltable: "false",
      pinClickable: "true",
      centerLat: "",
      centerLng: "",
      pitch: "0",
      bearing: "0",
      show3DBuildings: "false",
      autoRotate: "false",
      autoRotateSpeed: "1",
      showDirections: "true",
      variant: "default",
      themeId: "",
      preferredScheme: "auto",
      areaLabelsMode: "inherit",
      poiLabelsMode: "inherit",
      caption: "",
    },
  },
  {
    id: "fixture-section-external-video",
    type: "external-video",
    settings: {},
    props: {
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      caption: "Fixture external video",
      aspectRatio: "auto",
    } satisfies ExternalVideoProps,
  },
  {
    id: "fixture-section-columns",
    type: "columns",
    settings: {},
    props: {
      columns: "2",
      gap: "24",
      columnRatios: "1:1",
      mobileStack: "true",
    },
    columns: [
      {
        id: "fixture-column-1",
        sections: [
          {
            id: "fixture-column-rich-text",
            type: "rich-text",
            settings: {},
            props: {},
            content: [
              createParagraphBlock(
                "fixture-column-rich-text-paragraph",
                "Fixture nested rich text block",
              ),
              {
                id: "fixture-column-rich-text-audio",
                type: "file",
                props: {
                  fileId: "fixture-nested-audio-file",
                  name: "fixture-nested-audio.wav",
                  caption: "Fixture nested audio caption",
                  previewWidth: "100",
                  textAlignment: "left",
                },
                children: [],
              },
              {
                id: "fixture-column-rich-text-video",
                type: "file",
                props: {
                  fileId: "fixture-nested-video-file",
                  name: "fixture-nested-video.mp4",
                  caption: "Fixture nested video caption",
                  previewWidth: "100",
                  textAlignment: "left",
                },
                children: [],
              },
              {
                id: "fixture-column-rich-text-attachment",
                type: "file",
                props: {
                  fileId: "fixture-nested-attachment-file",
                  name: "fixture-nested-score.pdf",
                  caption: "Fixture nested attachment caption",
                  previewWidth: "100",
                  textAlignment: "left",
                },
                children: [],
              },
              {
                id: "fixture-column-rich-text-file",
                type: "file",
                props: {
                  fileId: "fixture-nested-file",
                  name: "fixture-nested-archive.zip",
                  caption: "Fixture nested file caption",
                  previewWidth: "100",
                  textAlignment: "left",
                },
                children: [],
              },
            ],
          },
        ],
      },
      {
        id: "fixture-column-2",
        sections: [
          {
            id: "fixture-column-external-video",
            type: "external-video",
            settings: {},
            props: {
              url: "https://vimeo.com/76979871",
              caption: "Fixture nested external video",
              aspectRatio: "16:9",
            } satisfies ExternalVideoProps,
          },
        ],
      },
    ],
  },
];

export function createPageBlockFixtureSections(): PageBlockFixtureSection[] {
  return structuredClone(PAGE_BLOCK_FIXTURE_SECTIONS);
}

export function collectPageBlockTypes(
  sections: ReadonlyArray<PageBlockFixtureSection>,
): PageBlockType[] {
  const types: PageBlockType[] = [];

  const visit = (items: ReadonlyArray<PageBlockFixtureSection>) => {
    for (const section of items) {
      types.push(section.type);
      if (section.columns) {
        for (const column of section.columns) {
          visit(column.sections);
        }
      }
    }
  };

  visit(sections);
  return types;
}
