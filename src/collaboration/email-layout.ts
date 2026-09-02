import * as Y from "yjs";

export const EMAIL_LAYOUT_CONTEXT_MAP_NAME = "email-layout-context";
export const EMAIL_LAYOUT_HTML_TEXT_NAME = "html-content";
export const EMAIL_LAYOUT_UNITS_ARRAY_NAME = "email-layout-units";
export const EMAIL_LAYOUT_LOCALE_VALUES_MAP_NAME = "email-layout-locale-values";

export type EmailLayoutUnitKind = "text" | "attribute";

export interface EmailLayoutUnit {
  handle: string;
  kind: EmailLayoutUnitKind;
  element: string;
  attribute: string;
  order: number;
  sourceValue: string;
}

export interface MaterializedEmailLayoutUnit extends EmailLayoutUnit {
  value: string;
  localeValuePresent: boolean;
}

export interface EmailLayoutCanonicalRoomInput {
  sourceLocale: string;
  locale: string;
  localeExists: boolean;
  contentHtml: string;
  units?: readonly EmailLayoutUnit[];
  localeValues?: Readonly<Record<string, string>>;
}

export function emailLayoutLocaleValuesMap(document: Y.Doc): Y.Map<string> {
  return document.getMap<string>(EMAIL_LAYOUT_LOCALE_VALUES_MAP_NAME);
}

export function hydrateEmailLayoutCanonicalRoom(
  input: EmailLayoutCanonicalRoomInput,
): Y.Doc {
  const document = new Y.Doc();
  document.transact(() => {
    const context = document.getMap<string | boolean>(
      EMAIL_LAYOUT_CONTEXT_MAP_NAME,
    );
    context.set("sourceLocale", input.sourceLocale);
    context.set("locale", input.locale);
    context.set("localeExists", input.localeExists);
    if (input.locale === input.sourceLocale) {
      if (input.contentHtml.length > 0) {
        document
          .getText(EMAIL_LAYOUT_HTML_TEXT_NAME)
          .insert(0, input.contentHtml);
      }
      return;
    }
    const units = [...(input.units ?? [])].sort(
      (left, right) => left.order - right.order,
    );
    assertEmailLayoutUnits(units);
    document
      .getArray<EmailLayoutUnit>(EMAIL_LAYOUT_UNITS_ARRAY_NAME)
      .insert(0, units);
    const values = emailLayoutLocaleValuesMap(document);
    for (const [handle, value] of Object.entries(input.localeValues ?? {})) {
      if (units.some((unit) => unit.handle === handle)) {
        values.set(handle, value);
      }
    }
  });
  return document;
}

export function materializeEmailLayoutUnits(
  document: Y.Doc,
): MaterializedEmailLayoutUnit[] {
  const values = emailLayoutLocaleValuesMap(document);
  return document
    .getArray<EmailLayoutUnit>(EMAIL_LAYOUT_UNITS_ARRAY_NAME)
    .toArray()
    .sort((left, right) => left.order - right.order)
    .map((unit) => ({
      ...unit,
      value: values.has(unit.handle)
        ? (values.get(unit.handle) ?? "")
        : unit.sourceValue,
      localeValuePresent: values.has(unit.handle),
    }));
}

export function setEmailLayoutLocaleValue(
  document: Y.Doc,
  handle: string,
  value: string,
): void {
  requireEmailLayoutHandle(document, handle);
  emailLayoutLocaleValuesMap(document).set(handle, value);
}

export function unsetEmailLayoutLocaleValue(
  document: Y.Doc,
  handle: string,
): void {
  requireEmailLayoutHandle(document, handle);
  emailLayoutLocaleValuesMap(document).delete(handle);
}

export function extractEmailLayoutLocaleValues(
  document: Y.Doc,
): Record<string, string> {
  const allowed = new Set(
    document
      .getArray<EmailLayoutUnit>(EMAIL_LAYOUT_UNITS_ARRAY_NAME)
      .toArray()
      .map((unit) => unit.handle),
  );
  const output: Record<string, string> = {};
  for (const [handle, value] of emailLayoutLocaleValuesMap(document)) {
    if (!allowed.has(handle)) {
      throw new Error(`Unknown Email Layout unit handle: ${handle}`);
    }
    output[handle] = value;
  }
  return output;
}

function requireEmailLayoutHandle(document: Y.Doc, handle: string): void {
  if (
    !document
      .getArray<EmailLayoutUnit>(EMAIL_LAYOUT_UNITS_ARRAY_NAME)
      .toArray()
      .some((unit) => unit.handle === handle)
  ) {
    throw new Error(`Unknown Email Layout unit handle: ${handle}`);
  }
}

function assertEmailLayoutUnits(units: readonly EmailLayoutUnit[]): void {
  const handles = new Set<string>();
  for (const unit of units) {
    if (
      !unit.handle ||
      handles.has(unit.handle) ||
      !Number.isSafeInteger(unit.order) ||
      unit.order < 0
    ) {
      throw new Error("Invalid Email Layout unit catalog");
    }
    handles.add(unit.handle);
  }
}
