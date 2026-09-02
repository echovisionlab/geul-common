export const MEDIA_HYDRATION_DOM_ATTRS = {
  mediaKind: "data-media-kind",
  fileId: "data-file-id",
  entityType: "data-entity-type",
  entityId: "data-entity-id",
  playbackUrl: "data-playback-url",
  playbackSource: "data-playback-source",
  originalUrl: "data-original-url",
  waveformUrl: "data-waveform-url",
  spectrogramUrl: "data-spectrogram-url",
  hlsUrl: "data-hls-src",
  posterUrl: "data-poster-url",
} as const;

export type MediaHydrationDomAttrs = Record<string, string | undefined>;
export type AudioPlaybackSource = "hls";

export interface AudioMediaHydrationInput {
  fileId?: string;
  entityType?: string;
  entityId?: string;
  playbackUrl?: string;
  playbackSource?: string | null;
  originalUrl?: string;
  hlsUrl?: string;
  waveformUrl?: string;
  spectrogramUrl?: string;
}

export interface VideoMediaHydrationInput {
  fileId?: string;
  entityType?: string;
  entityId?: string;
  originalUrl?: string;
  hlsUrl?: string;
  posterUrl?: string;
}

export interface HydratedAudioMedia {
  fileId: string;
  entityType: string;
  entityId: string;
  playbackUrl: string;
  playbackSource: AudioPlaybackSource | null;
  originalUrl: string;
  hlsUrl: string;
  waveformUrl: string;
  spectrogramUrl: string;
}

export interface HydratedVideoMedia {
  fileId: string;
  entityType: string;
  entityId: string;
  originalUrl: string;
  hlsUrl: string;
  posterUrl: string;
}

export interface AudioPlaybackHydrationInput {
  originalUrl?: string;
  hlsUrl?: string;
}

export interface AudioPlaybackHydration {
  originalUrl: string;
  hlsUrl: string;
  playbackUrl: string;
  playbackSource: AudioPlaybackSource | null;
  hasOriginal: boolean;
  canPlayHls: boolean;
}

export function normalizeHydrationUrl(
  value: string | undefined | null,
): string {
  const trimmed = (value ?? "").trim();
  return !trimmed || trimmed === "undefined" || trimmed === "null"
    ? ""
    : trimmed;
}

function getHydrationAttr(
  primary: Element | null | undefined,
  attr: string,
  secondary?: Element | null,
): string {
  return normalizeHydrationUrl(
    primary?.getAttribute(attr) ?? secondary?.getAttribute(attr) ?? "",
  );
}

function looksLikeHlsUrl(url: string): boolean {
  return /\.m3u8(?:$|[?#])/i.test(url);
}

export function resolveAudioPlaybackHydration(
  input: AudioPlaybackHydrationInput,
): AudioPlaybackHydration {
  const originalUrl = normalizeHydrationUrl(input.originalUrl);
  const hlsUrl = normalizeHydrationUrl(input.hlsUrl);
  const hasOriginal = originalUrl.length > 0;
  const canPlayHls = hlsUrl.length > 0;

  return {
    originalUrl,
    hlsUrl,
    playbackUrl: canPlayHls ? hlsUrl : "",
    playbackSource: canPlayHls ? "hls" : null,
    hasOriginal,
    canPlayHls,
  };
}

export function applyMediaHydrationDomAttrs(
  element: HTMLElement,
  attrs: MediaHydrationDomAttrs,
): void {
  for (const [key, value] of Object.entries(attrs)) {
    if (value) {
      element.setAttribute(key, value);
    } else {
      element.removeAttribute(key);
    }
  }
}

export function buildAudioMediaHydrationAttrs(
  input: AudioMediaHydrationInput,
): MediaHydrationDomAttrs {
  return {
    [MEDIA_HYDRATION_DOM_ATTRS.mediaKind]: "audio",
    [MEDIA_HYDRATION_DOM_ATTRS.fileId]:
      normalizeHydrationUrl(input.fileId) || undefined,
    [MEDIA_HYDRATION_DOM_ATTRS.entityType]:
      normalizeHydrationUrl(input.entityType) || undefined,
    [MEDIA_HYDRATION_DOM_ATTRS.entityId]:
      normalizeHydrationUrl(input.entityId) || undefined,
    [MEDIA_HYDRATION_DOM_ATTRS.playbackUrl]:
      normalizeHydrationUrl(input.playbackUrl) || undefined,
    [MEDIA_HYDRATION_DOM_ATTRS.playbackSource]:
      input.playbackSource === "hls" ? "hls" : undefined,
    [MEDIA_HYDRATION_DOM_ATTRS.originalUrl]:
      normalizeHydrationUrl(input.originalUrl) || undefined,
    [MEDIA_HYDRATION_DOM_ATTRS.hlsUrl]:
      normalizeHydrationUrl(input.hlsUrl) || undefined,
    [MEDIA_HYDRATION_DOM_ATTRS.waveformUrl]:
      normalizeHydrationUrl(input.waveformUrl) || undefined,
    [MEDIA_HYDRATION_DOM_ATTRS.spectrogramUrl]:
      normalizeHydrationUrl(input.spectrogramUrl) || undefined,
  };
}

export function buildVideoMediaHydrationAttrs(
  input: VideoMediaHydrationInput,
): MediaHydrationDomAttrs {
  return {
    [MEDIA_HYDRATION_DOM_ATTRS.mediaKind]: "video",
    [MEDIA_HYDRATION_DOM_ATTRS.fileId]:
      normalizeHydrationUrl(input.fileId) || undefined,
    [MEDIA_HYDRATION_DOM_ATTRS.entityType]:
      normalizeHydrationUrl(input.entityType) || undefined,
    [MEDIA_HYDRATION_DOM_ATTRS.entityId]:
      normalizeHydrationUrl(input.entityId) || undefined,
    [MEDIA_HYDRATION_DOM_ATTRS.originalUrl]:
      normalizeHydrationUrl(input.originalUrl) || undefined,
    [MEDIA_HYDRATION_DOM_ATTRS.hlsUrl]:
      normalizeHydrationUrl(input.hlsUrl) || undefined,
    [MEDIA_HYDRATION_DOM_ATTRS.posterUrl]:
      normalizeHydrationUrl(input.posterUrl) || undefined,
  };
}

export function readAudioMediaHydration(
  root: HTMLElement,
  audio?: HTMLAudioElement | null,
): HydratedAudioMedia {
  const playbackUrl =
    getHydrationAttr(root, MEDIA_HYDRATION_DOM_ATTRS.playbackUrl, audio) ||
    normalizeHydrationUrl(audio?.getAttribute("src"));
  const playbackSource =
    getHydrationAttr(root, MEDIA_HYDRATION_DOM_ATTRS.playbackSource) === "hls"
      ? "hls"
      : null;

  return {
    fileId: getHydrationAttr(root, MEDIA_HYDRATION_DOM_ATTRS.fileId, audio),
    entityType: getHydrationAttr(root, MEDIA_HYDRATION_DOM_ATTRS.entityType),
    entityId: getHydrationAttr(root, MEDIA_HYDRATION_DOM_ATTRS.entityId),
    playbackUrl,
    playbackSource,
    originalUrl: getHydrationAttr(
      root,
      MEDIA_HYDRATION_DOM_ATTRS.originalUrl,
      audio,
    ),
    hlsUrl: getHydrationAttr(root, MEDIA_HYDRATION_DOM_ATTRS.hlsUrl, audio),
    waveformUrl: getHydrationAttr(root, MEDIA_HYDRATION_DOM_ATTRS.waveformUrl),
    spectrogramUrl: getHydrationAttr(
      root,
      MEDIA_HYDRATION_DOM_ATTRS.spectrogramUrl,
    ),
  };
}

export function readVideoMediaHydration(
  root: HTMLElement,
  video?: HTMLVideoElement | null,
): HydratedVideoMedia {
  const currentSrc = normalizeHydrationUrl(video?.getAttribute("src"));

  return {
    fileId: getHydrationAttr(root, MEDIA_HYDRATION_DOM_ATTRS.fileId, video),
    entityType: getHydrationAttr(root, MEDIA_HYDRATION_DOM_ATTRS.entityType),
    entityId: getHydrationAttr(root, MEDIA_HYDRATION_DOM_ATTRS.entityId),
    originalUrl:
      getHydrationAttr(root, MEDIA_HYDRATION_DOM_ATTRS.originalUrl, video) ||
      currentSrc,
    hlsUrl:
      getHydrationAttr(root, MEDIA_HYDRATION_DOM_ATTRS.hlsUrl, video) ||
      (looksLikeHlsUrl(currentSrc) ? currentSrc : ""),
    posterUrl:
      getHydrationAttr(root, MEDIA_HYDRATION_DOM_ATTRS.posterUrl, video) ||
      normalizeHydrationUrl(video?.getAttribute("poster")),
  };
}
