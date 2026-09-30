import type { JsonValue } from "@bufbuild/protobuf";
import { fail } from "./internal.ts";

export const RICH_TEXT_STYLE_KEYS = [
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
  "textColor",
  "backgroundColor",
] as const;
const styleKeys = RICH_TEXT_STYLE_KEYS;

export type RichTextStyleKey = (typeof styleKeys)[number];

export type StyleValue = boolean | string;
export type Style = Partial<Record<(typeof styleKeys)[number], StyleValue>>;
export type StyledRun = { text: string; styles: Style };

interface DesiredTextGroup {
  readonly kind: "text";
  readonly runs: StyledRun[];
}

interface DesiredLinkGroup {
  readonly kind: "link";
  readonly href: string;
  readonly runs: StyledRun[];
}

interface DesiredMathGroup {
  readonly kind: "mathInline";
  readonly source: string;
}

interface DesiredHardBreakGroup {
  readonly kind: "hardBreak";
}

export type DesiredGroup =
  | DesiredTextGroup
  | DesiredLinkGroup
  | DesiredMathGroup
  | DesiredHardBreakGroup;

function object(value: unknown, reason: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail(reason);
  }
  return value as Record<string, unknown>;
}

function checkedStyles(value: unknown, reason: string): Style {
  if (value === undefined || value === null) {
    return {};
  }
  const raw = object(value, reason);
  const result: Style = {};
  for (const key of styleKeys) {
    const style = raw[key];
    if (style === undefined || style === null) {
      continue;
    }
    if (key === "textColor" || key === "backgroundColor") {
      if (typeof style !== "string") {
        return fail(`${reason}:${key}`);
      }
    } else if (typeof style !== "boolean") {
      return fail(`${reason}:${key}`);
    }
    result[key] = style;
  }
  return result;
}

function normalizeStyles(value: Style): Style {
  const result: Style = {};
  for (const key of styleKeys) {
    const style = value[key];
    if (style === undefined || style === false || style === "") {
      continue;
    }
    result[key] = style;
  }
  return result;
}

function styleKey(value: Style): string {
  return JSON.stringify(normalizeStyles(value));
}

function appendRun(target: StyledRun[], next: StyledRun): void {
  const previous = target[target.length - 1];
  if (previous && styleKey(previous.styles) === styleKey(next.styles)) {
    previous.text += next.text;
    return;
  }
  target.push({ text: next.text, styles: { ...next.styles } });
}

function appendSourceRun(target: StyledRun[], next: StyledRun): void {
  if (next.text.length > 0) {
    target.push({ text: next.text, styles: { ...next.styles } });
  }
}

export function styledInput(value: unknown, reason: string): StyledRun {
  if (typeof value === "string") {
    return { text: value, styles: {} };
  }
  const styled = object(value, reason);
  if (typeof styled.text !== "string") {
    return fail(`${reason}:text`);
  }
  return {
    text: styled.text,
    styles: checkedStyles(styled.styles, `${reason}:styles`),
  };
}

function inputItem(value: JsonValue, reason: string): DesiredGroup {
  const item = object(value, reason);
  const cases = ["text", "link", "mathInline", "hardBreak"].filter(
    (key) => item[key] !== undefined,
  );
  if (cases.length !== 1) {
    return fail(`${reason}:oneof`);
  }
  const selected = cases[0]!;
  if (selected === "text") {
    const run = styledInput(item.text, `${reason}:text`);
    return { kind: "text", runs: run.text ? [run] : [] };
  }
  if (selected === "link") {
    const link = object(item.link, `${reason}:link`);
    if (typeof link.href !== "string" || !Array.isArray(link.content)) {
      return fail(`${reason}:link_shape`);
    }
    const runs: StyledRun[] = [];
    link.content.forEach((child, index) => {
      appendSourceRun(
        runs,
        styledInput(child, `${reason}:link_content:${index}`),
      );
    });
    return { kind: "link", href: link.href, runs };
  }
  if (selected === "mathInline") {
    const math = object(item.mathInline, `${reason}:math`);
    if (math.source !== undefined && typeof math.source !== "string") {
      return fail(`${reason}:math_source`);
    }
    return {
      kind: "mathInline",
      source: (math.source as string | undefined) ?? "",
    };
  }
  return { kind: "hardBreak" };
}

export function desiredGroups(values: readonly JsonValue[]): DesiredGroup[] {
  const result: DesiredGroup[] = [];
  values.forEach((value, index) => {
    const group = inputItem(value, `inline_content:input:${index}`);
    const previous = result[result.length - 1];
    if (group.kind === "text" && previous?.kind === "text") {
      for (const run of group.runs) {
        appendSourceRun(previous.runs, run);
      }
      return;
    }
    if (group.kind === "text" && group.runs.length === 0) {
      return;
    }
    result.push(group);
  });
  return result;
}

export function normalizeInlineContent(values: readonly JsonValue[]): string {
  const normalized = desiredGroups(values).map((group) => {
    if (group.kind === "text") {
      const canonicalRuns: StyledRun[] = [];
      for (const run of group.runs) {
        appendRun(canonicalRuns, run);
      }
      return {
        text: canonicalRuns.map((run) => ({
          text: run.text,
          styles: normalizeStyles(run.styles),
        })),
      };
    }
    if (group.kind === "link") {
      const canonicalRuns: StyledRun[] = [];
      for (const run of group.runs) {
        appendRun(canonicalRuns, run);
      }
      return {
        link: {
          href: group.href,
          content: canonicalRuns.map((run) => ({
            text: run.text,
            styles: normalizeStyles(run.styles),
          })),
        },
      };
    }
    if (group.kind === "mathInline") {
      return { mathInline: { source: group.source } };
    }
    return { hardBreak: {} };
  });
  return JSON.stringify(normalized);
}

export interface StyleSpan {
  readonly from: number;
  readonly to: number;
  readonly styles: Style;
}

export function styleSpans(runs: readonly StyledRun[], start = 0): StyleSpan[] {
  const result: StyleSpan[] = [];
  let from = start;
  for (const run of runs) {
    const to = from + run.text.length;
    result.push({ from, to, styles: normalizeStyles(run.styles) });
    from = to;
  }
  return result;
}

export function changedStyleAttributes(
  before: Style,
  after: Style,
): Record<string, StyleValue> {
  const current = normalizeStyles(before);
  const desired = normalizeStyles(after);
  const result: Record<string, StyleValue> = {};
  for (const key of styleKeys) {
    if (current[key] === desired[key]) {
      continue;
    }
    const value = desired[key];
    result[key] =
      value !== undefined
        ? value
        : key === "textColor" || key === "backgroundColor"
          ? ""
          : false;
  }
  return result;
}

function isSurrogatePairBoundary(value: string, boundary: number): boolean {
  if (boundary <= 0 || boundary >= value.length) {
    return false;
  }
  const before = value.charCodeAt(boundary - 1);
  const after = value.charCodeAt(boundary);
  return (
    before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff
  );
}

export function minimalDiff(
  before: string,
  after: string,
): {
  from: number;
  oldTo: number;
  newTo: number;
} {
  let from = 0;
  while (
    from < before.length &&
    from < after.length &&
    before[from] === after[from]
  ) {
    from += 1;
  }
  if (
    isSurrogatePairBoundary(before, from) ||
    isSurrogatePairBoundary(after, from)
  ) {
    from -= 1;
  }
  let oldTo = before.length;
  let newTo = after.length;
  while (
    oldTo > from &&
    newTo > from &&
    before[oldTo - 1] === after[newTo - 1]
  ) {
    oldTo -= 1;
    newTo -= 1;
  }
  if (
    isSurrogatePairBoundary(before, oldTo) ||
    isSurrogatePairBoundary(after, newTo)
  ) {
    oldTo += 1;
    newTo += 1;
  }
  return { from, oldTo, newTo };
}
