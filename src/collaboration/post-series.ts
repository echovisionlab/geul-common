import * as Y from "yjs";

export const POST_SERIES_CONTEXT_MAP_NAME = "post-series-context";
export const POST_SERIES_SOURCE_FIELDS_MAP_NAME = "post-series-source-fields";
export const POST_SERIES_LOCALE_FIELDS_MAP_NAME = "post-series-locale-fields";

export interface PostSeriesLocaleFields {
  title: string;
  summary: string;
}

export interface PostSeriesStoredLocaleFields {
  title?: string;
  summary?: string;
}

export interface PostSeriesCanonicalRoomInput {
  sourceLocale: string;
  locale: string;
  localeExists: boolean;
  source: PostSeriesStoredLocaleFields;
  requested: PostSeriesStoredLocaleFields;
}

export function postSeriesLocaleFieldsMap(document: Y.Doc): Y.Map<string> {
  return document.getMap<string>(POST_SERIES_LOCALE_FIELDS_MAP_NAME);
}

export function hydratePostSeriesCanonicalRoom(
  input: PostSeriesCanonicalRoomInput,
): Y.Doc {
  const document = new Y.Doc();
  document.transact(() => {
    const context = document.getMap<string | boolean>(
      POST_SERIES_CONTEXT_MAP_NAME,
    );
    context.set("sourceLocale", input.sourceLocale);
    context.set("locale", input.locale);
    context.set("localeExists", input.localeExists);
    const source = document.getMap<string>(POST_SERIES_SOURCE_FIELDS_MAP_NAME);
    const requested = postSeriesLocaleFieldsMap(document);
    assignPresentFields(source, input.source);
    assignPresentFields(requested, input.requested);
  });
  return document;
}

export function materializePostSeriesLocaleFields(
  document: Y.Doc,
): PostSeriesLocaleFields {
  const source = document.getMap<string>(POST_SERIES_SOURCE_FIELDS_MAP_NAME);
  const requested = postSeriesLocaleFieldsMap(document);
  return {
    title: requested.has("title")
      ? (requested.get("title") ?? "")
      : (source.get("title") ?? ""),
    summary: requested.has("summary")
      ? (requested.get("summary") ?? "")
      : (source.get("summary") ?? ""),
  };
}

export function extractPostSeriesStoredLocaleFields(
  document: Y.Doc,
): PostSeriesStoredLocaleFields {
  const requested = postSeriesLocaleFieldsMap(document);
  return {
    ...(requested.has("title") ? { title: requested.get("title") ?? "" } : {}),
    ...(requested.has("summary")
      ? { summary: requested.get("summary") ?? "" }
      : {}),
  };
}

export function setPostSeriesLocaleField(
  document: Y.Doc,
  field: keyof PostSeriesLocaleFields,
  value: string,
): void {
  postSeriesLocaleFieldsMap(document).set(field, value);
}

export function unsetPostSeriesLocaleField(
  document: Y.Doc,
  field: keyof PostSeriesLocaleFields,
): void {
  postSeriesLocaleFieldsMap(document).delete(field);
}

function assignPresentFields(
  target: Y.Map<string>,
  fields: PostSeriesStoredLocaleFields,
): void {
  if (fields.title !== undefined) target.set("title", fields.title);
  if (fields.summary !== undefined) target.set("summary", fields.summary);
}
