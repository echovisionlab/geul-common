import { describe, expect, it } from "vitest";
import {
  applyMediaHydrationDomAttrs,
  buildAudioMediaHydrationAttrs,
  buildVideoMediaHydrationAttrs,
  MEDIA_HYDRATION_DOM_ATTRS,
  normalizeHydrationUrl,
  readAudioMediaHydration,
  readVideoMediaHydration,
  resolveAudioPlaybackHydration,
} from "./hydration.ts";

class FakeElement {
  private readonly attrs = new Map<string, string>();

  constructor(attrs: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(attrs)) {
      this.attrs.set(key, value);
    }
  }

  getAttribute(attr: string): string | null {
    return this.attrs.get(attr) ?? null;
  }

  setAttribute(attr: string, value: string): void {
    this.attrs.set(attr, value);
  }

  removeAttribute(attr: string): void {
    this.attrs.delete(attr);
  }
}

describe("transient media hydration", () => {
  it.each([
    [undefined, ""],
    [null, ""],
    ["", ""],
    ["   ", ""],
    ["undefined", ""],
    ["null", ""],
    [" value ", "value"],
  ])("normalizes delivery value %s", (input, expected) => {
    expect(normalizeHydrationUrl(input)).toBe(expected);
  });

  it("resolves public HLS playback and DB-authorized original delivery independently", () => {
    expect(
      resolveAudioPlaybackHydration({
        originalUrl: " https://cdn.test/original.wav ",
        hlsUrl: " https://cdn.test/audio.m3u8 ",
      }),
    ).toEqual({
      originalUrl: "https://cdn.test/original.wav",
      hlsUrl: "https://cdn.test/audio.m3u8",
      playbackUrl: "https://cdn.test/audio.m3u8",
      playbackSource: "hls",
      hasOriginal: true,
      canPlayHls: true,
    });

    expect(resolveAudioPlaybackHydration({})).toEqual({
      originalUrl: "",
      hlsUrl: "",
      playbackUrl: "",
      playbackSource: null,
      hasOriginal: false,
      canPlayHls: false,
    });
  });

  it("builds complete and empty audio hydration attributes", () => {
    const attrs = buildAudioMediaHydrationAttrs({
      fileId: " file-1 ",
      entityType: " release ",
      entityId: " release-1 ",
      playbackUrl: " https://cdn.test/audio.mp3 ",
      playbackSource: "hls",
      originalUrl: " https://cdn.test/original.wav ",
      hlsUrl: " https://cdn.test/audio.m3u8 ",
      waveformUrl: " https://cdn.test/waveform.json ",
      spectrogramUrl: " https://cdn.test/spectrogram.png ",
    });

    expect(attrs).toEqual({
      [MEDIA_HYDRATION_DOM_ATTRS.mediaKind]: "audio",
      [MEDIA_HYDRATION_DOM_ATTRS.fileId]: "file-1",
      [MEDIA_HYDRATION_DOM_ATTRS.entityType]: "release",
      [MEDIA_HYDRATION_DOM_ATTRS.entityId]: "release-1",
      [MEDIA_HYDRATION_DOM_ATTRS.playbackUrl]: "https://cdn.test/audio.mp3",
      [MEDIA_HYDRATION_DOM_ATTRS.playbackSource]: "hls",
      [MEDIA_HYDRATION_DOM_ATTRS.originalUrl]: "https://cdn.test/original.wav",
      [MEDIA_HYDRATION_DOM_ATTRS.hlsUrl]: "https://cdn.test/audio.m3u8",
      [MEDIA_HYDRATION_DOM_ATTRS.waveformUrl]: "https://cdn.test/waveform.json",
      [MEDIA_HYDRATION_DOM_ATTRS.spectrogramUrl]:
        "https://cdn.test/spectrogram.png",
    });

    expect(
      buildAudioMediaHydrationAttrs({
        fileId: "file-2",
        playbackSource: "original",
      }),
    ).toEqual({
      [MEDIA_HYDRATION_DOM_ATTRS.mediaKind]: "audio",
      [MEDIA_HYDRATION_DOM_ATTRS.fileId]: "file-2",
      [MEDIA_HYDRATION_DOM_ATTRS.entityType]: undefined,
      [MEDIA_HYDRATION_DOM_ATTRS.entityId]: undefined,
      [MEDIA_HYDRATION_DOM_ATTRS.playbackUrl]: undefined,
      [MEDIA_HYDRATION_DOM_ATTRS.playbackSource]: undefined,
      [MEDIA_HYDRATION_DOM_ATTRS.originalUrl]: undefined,
      [MEDIA_HYDRATION_DOM_ATTRS.hlsUrl]: undefined,
      [MEDIA_HYDRATION_DOM_ATTRS.waveformUrl]: undefined,
      [MEDIA_HYDRATION_DOM_ATTRS.spectrogramUrl]: undefined,
    });
    expect(buildAudioMediaHydrationAttrs({})).toMatchObject({
      [MEDIA_HYDRATION_DOM_ATTRS.fileId]: undefined,
    });
  });

  it("builds complete and empty video hydration attributes", () => {
    expect(
      buildVideoMediaHydrationAttrs({
        fileId: " video-1 ",
        entityType: " page ",
        entityId: " page-1 ",
        originalUrl: " https://cdn.test/video.mp4 ",
        hlsUrl: " https://cdn.test/video.m3u8 ",
        posterUrl: " https://cdn.test/poster.webp ",
      }),
    ).toEqual({
      [MEDIA_HYDRATION_DOM_ATTRS.mediaKind]: "video",
      [MEDIA_HYDRATION_DOM_ATTRS.fileId]: "video-1",
      [MEDIA_HYDRATION_DOM_ATTRS.entityType]: "page",
      [MEDIA_HYDRATION_DOM_ATTRS.entityId]: "page-1",
      [MEDIA_HYDRATION_DOM_ATTRS.originalUrl]: "https://cdn.test/video.mp4",
      [MEDIA_HYDRATION_DOM_ATTRS.hlsUrl]: "https://cdn.test/video.m3u8",
      [MEDIA_HYDRATION_DOM_ATTRS.posterUrl]: "https://cdn.test/poster.webp",
    });

    expect(buildVideoMediaHydrationAttrs({})).toMatchObject({
      [MEDIA_HYDRATION_DOM_ATTRS.fileId]: undefined,
      [MEDIA_HYDRATION_DOM_ATTRS.hlsUrl]: undefined,
    });
  });

  it("applies attributes by setting values and removing empty entries", () => {
    const element = new FakeElement({ keep: "old", remove: "old" });

    applyMediaHydrationDomAttrs(element as unknown as HTMLElement, {
      keep: "new",
      remove: undefined,
    });

    expect(element.getAttribute("keep")).toBe("new");
    expect(element.getAttribute("remove")).toBeNull();
  });

  it("reads audio hydration from root attributes with media fallbacks", () => {
    const root = new FakeElement({
      [MEDIA_HYDRATION_DOM_ATTRS.fileId]: " file-1 ",
      [MEDIA_HYDRATION_DOM_ATTRS.entityType]: "release",
      [MEDIA_HYDRATION_DOM_ATTRS.entityId]: "release-1",
      [MEDIA_HYDRATION_DOM_ATTRS.playbackUrl]:
        " https://cdn.test/playback.mp3 ",
      [MEDIA_HYDRATION_DOM_ATTRS.playbackSource]: "hls",
      [MEDIA_HYDRATION_DOM_ATTRS.hlsUrl]: "https://cdn.test/playback.m3u8",
      [MEDIA_HYDRATION_DOM_ATTRS.waveformUrl]: "waveform",
      [MEDIA_HYDRATION_DOM_ATTRS.spectrogramUrl]: "spectrogram",
    });
    const audio = new FakeElement({
      src: "https://cdn.test/fallback.mp3",
      [MEDIA_HYDRATION_DOM_ATTRS.originalUrl]:
        " https://cdn.test/original.wav ",
    });

    expect(
      readAudioMediaHydration(
        root as unknown as HTMLElement,
        audio as unknown as HTMLAudioElement,
      ),
    ).toEqual({
      fileId: "file-1",
      entityType: "release",
      entityId: "release-1",
      playbackUrl: "https://cdn.test/playback.mp3",
      playbackSource: "hls",
      originalUrl: "https://cdn.test/original.wav",
      hlsUrl: "https://cdn.test/playback.m3u8",
      waveformUrl: "waveform",
      spectrogramUrl: "spectrogram",
    });

    const emptyRoot = new FakeElement();
    const sourceOnly = new FakeElement({ src: "https://cdn.test/source.mp3" });
    expect(
      readAudioMediaHydration(
        emptyRoot as unknown as HTMLElement,
        sourceOnly as unknown as HTMLAudioElement,
      ),
    ).toMatchObject({
      playbackUrl: "https://cdn.test/source.mp3",
      playbackSource: null,
      originalUrl: "",
    });
  });

  it("reads video hydration with explicit and media-element delivery fallbacks", () => {
    const fullRoot = new FakeElement({
      [MEDIA_HYDRATION_DOM_ATTRS.fileId]: "video-1",
      [MEDIA_HYDRATION_DOM_ATTRS.entityType]: "page",
      [MEDIA_HYDRATION_DOM_ATTRS.entityId]: "page-1",
      [MEDIA_HYDRATION_DOM_ATTRS.originalUrl]: "https://cdn.test/original.mp4",
      [MEDIA_HYDRATION_DOM_ATTRS.hlsUrl]: "https://cdn.test/video.m3u8",
      [MEDIA_HYDRATION_DOM_ATTRS.posterUrl]: "https://cdn.test/poster.webp",
    });

    expect(readVideoMediaHydration(fullRoot as unknown as HTMLElement)).toEqual(
      {
        fileId: "video-1",
        entityType: "page",
        entityId: "page-1",
        originalUrl: "https://cdn.test/original.mp4",
        hlsUrl: "https://cdn.test/video.m3u8",
        posterUrl: "https://cdn.test/poster.webp",
      },
    );

    const emptyRoot = new FakeElement();
    const hlsVideo = new FakeElement({
      src: "https://cdn.test/current.m3u8?token=1",
      poster: " https://cdn.test/fallback.webp ",
      [MEDIA_HYDRATION_DOM_ATTRS.fileId]: "video-2",
    });
    expect(
      readVideoMediaHydration(
        emptyRoot as unknown as HTMLElement,
        hlsVideo as unknown as HTMLVideoElement,
      ),
    ).toMatchObject({
      fileId: "video-2",
      originalUrl: "https://cdn.test/current.m3u8?token=1",
      hlsUrl: "https://cdn.test/current.m3u8?token=1",
      posterUrl: "https://cdn.test/fallback.webp",
    });

    const plainVideo = new FakeElement({ src: "https://cdn.test/current.mp4" });
    expect(
      readVideoMediaHydration(
        emptyRoot as unknown as HTMLElement,
        plainVideo as unknown as HTMLVideoElement,
      ).hlsUrl,
    ).toBe("");
  });
});
