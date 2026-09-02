export type ReleaseDescriptionTranslation = unknown[];
export type ReleaseCreditNoteTranslations = Record<string, string>;

export interface LegacyReleaseTranslationContent {
  description: ReleaseDescriptionTranslation;
  creditNotes: ReleaseCreditNoteTranslations;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

export function normalizeReleaseDescriptionTranslation(
  value: unknown,
): ReleaseDescriptionTranslation {
  return Array.isArray(value) ? value : [];
}

export function normalizeReleaseCreditNoteTranslations(
  value: unknown,
): ReleaseCreditNoteTranslations {
  const record = readRecord(value);
  if (!record) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(record).flatMap(([creditId, note]) => {
      const normalizedCreditId = creditId.trim();
      const normalizedNote = typeof note === "string" ? note.trim() : "";
      if (!normalizedCreditId || !normalizedNote) {
        return [];
      }
      return [[normalizedCreditId, normalizedNote]];
    }),
  );
}

/** Converter-only decoder for pre-Block combined translation payloads. */
export function decodeReleaseTranslationContent(
  contentJson?: Uint8Array | null,
): LegacyReleaseTranslationContent | null {
  if (!contentJson || contentJson.length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(new TextDecoder().decode(contentJson)) as unknown;
    if (Array.isArray(parsed)) {
      return {
        description: parsed,
        creditNotes: {},
      };
    }

    const record = readRecord(parsed);
    if (!record) {
      return null;
    }

    return {
      description: normalizeReleaseDescriptionTranslation(record.description),
      creditNotes: normalizeReleaseCreditNoteTranslations(record.creditNotes),
    };
  } catch {
    return null;
  }
}

/** Converter-only encoder for pre-Block combined translation payloads. */
export function encodeReleaseTranslationContent(
  content: LegacyReleaseTranslationContent,
): Uint8Array {
  const payload: Record<string, unknown> = {
    description: normalizeReleaseDescriptionTranslation(content.description),
  };

  const creditNotes = normalizeReleaseCreditNoteTranslations(
    content.creditNotes,
  );
  if (Object.keys(creditNotes).length > 0) {
    payload.creditNotes = creditNotes;
  }

  return new TextEncoder().encode(JSON.stringify(payload));
}
