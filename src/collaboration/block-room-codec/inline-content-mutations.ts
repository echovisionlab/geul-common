import type { JsonValue } from "@bufbuild/protobuf";
import {
  richTextBlockCatalog,
  richTextBlockKindByProtoCase,
  type RichTextBlockKind,
} from "@echovisionlab/geul-proto/content/block_catalog.ts";
import * as Y from "yjs";
import {
  arrayPath,
  fail,
  isCollaborativeTextPath,
  toYValue,
} from "./internal.ts";
import {
  fromYInlineContent,
  projectedStyledTextRuns,
  richTextStyleKeys,
} from "./inline-content-projection.ts";
import {
  nodeKind,
  payloadArray,
  payloadParent,
  roomNode,
  type BlockRoomMutationOptions,
  type BlockRoomPayloadRef,
} from "./room-access.ts";

type RichTextCatalogEntry = {
  readonly content: string;
};

const richTextCatalog = richTextBlockCatalog as Readonly<
  Record<string, RichTextCatalogEntry>
>;
const styleKeys = richTextStyleKeys();

type StyleValue = boolean | string;
type Style = Partial<Record<(typeof styleKeys)[number], StyleValue>>;
type StyledRun = { text: string; styles: Style };

interface RawTextSegment {
  text?: Y.Text;
  readonly styledText: Y.Map<unknown>;
  readonly rawIndex: number;
}

interface RawTextGroup {
  readonly kind: "text";
  rawStart: number;
  rawEnd: number;
  readonly segments: RawTextSegment[];
}

interface RawLinkGroup {
  readonly kind: "link";
  readonly rawStart: number;
  readonly rawEnd: number;
  readonly link: Y.Map<unknown>;
  readonly content?: Y.Array<unknown>;
  readonly segments: RawTextSegment[];
}

interface RawMathGroup {
  readonly kind: "mathInline";
  readonly rawStart: number;
  readonly rawEnd: number;
  readonly text: Y.Text;
}

interface RawHardBreakGroup {
  readonly kind: "hardBreak";
  readonly rawStart: number;
  readonly rawEnd: number;
}

type RawGroup = RawTextGroup | RawLinkGroup | RawMathGroup | RawHardBreakGroup;

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

type DesiredGroup =
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

function yMap(value: unknown, reason: string): Y.Map<unknown> {
  if (!(value instanceof Y.Map)) {
    return fail(reason);
  }
  return value;
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

function styledInput(value: unknown, reason: string): StyledRun {
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

function desiredGroups(values: readonly JsonValue[]): DesiredGroup[] {
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

function normalizeInlineContent(values: readonly JsonValue[]): string {
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

function rawStyledText(
  value: unknown,
  rawIndex: number,
  reason: string,
): RawTextSegment {
  const styledText = yMap(value, reason);
  const text = styledText.get("text");
  if (text !== undefined && !(text instanceof Y.Text)) {
    return fail(`${reason}:text`);
  }
  return {
    ...(text instanceof Y.Text ? { text } : {}),
    styledText,
    rawIndex,
  };
}

function rawInlineItem(
  array: Y.Array<unknown>,
  index: number,
  reason: string,
): RawGroup {
  // reconcileArray first runs fromYInlineContent, which validates this map and
  // its oneof before the raw handles are resolved.
  const item = array.get(index) as Y.Map<unknown>;
  const selected = ["text", "link", "mathInline", "hardBreak"].find((key) =>
    item.has(key),
  )!;
  if (selected === "text") {
    const segment = rawStyledText(item.get("text"), index, `${reason}:text`);
    return {
      kind: "text",
      rawStart: index,
      rawEnd: index + 1,
      segments: [segment],
    };
  }
  if (selected === "link") {
    const link = yMap(item.get("link"), `${reason}:link`);
    const rawContent = link.get("content");
    const content = rawContent as Y.Array<unknown> | undefined;
    const segments =
      content
        ?.toArray()
        .map((child, childIndex) =>
          rawStyledText(
            child,
            childIndex,
            `${reason}:link_content:${childIndex}`,
          ),
        ) ?? [];
    return {
      kind: "link",
      rawStart: index,
      rawEnd: index + 1,
      link,
      content,
      segments,
    };
  }
  if (selected === "mathInline") {
    const math = yMap(item.get("mathInline"), `${reason}:math`);
    const text = math.get("source");
    if (!(text instanceof Y.Text)) {
      return fail(`${reason}:math_source`);
    }
    return {
      kind: "mathInline",
      rawStart: index,
      rawEnd: index + 1,
      text,
    };
  }
  return { kind: "hardBreak", rawStart: index, rawEnd: index + 1 };
}

function rawGroups(array: Y.Array<unknown>): RawGroup[] {
  const result: RawGroup[] = [];
  for (let index = 0; index < array.length; index += 1) {
    const item = rawInlineItem(array, index, `inline_content:raw:${index}`);
    const previous = result[result.length - 1];
    if (item.kind === "text" && previous?.kind === "text") {
      previous.segments.push(...item.segments);
      previous.rawEnd = item.rawEnd;
      continue;
    }
    result.push(item);
  }
  return result;
}

function rawGroupKind(group: RawGroup): DesiredGroup["kind"] {
  return group.kind;
}

interface StyleSpan {
  readonly from: number;
  readonly to: number;
  readonly styles: Style;
}

function styleSpans(runs: readonly StyledRun[], start = 0): StyleSpan[] {
  const result: StyleSpan[] = [];
  let from = start;
  for (const run of runs) {
    const to = from + run.text.length;
    result.push({ from, to, styles: normalizeStyles(run.styles) });
    from = to;
  }
  return result;
}

function changedStyleAttributes(
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

function minimalDiff(
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

function segmentText(segment: RawTextSegment): string {
  return segment.text?.toString() ?? "";
}

function ensureText(segment: RawTextSegment): Y.Text {
  if (segment.text) {
    return segment.text;
  }
  const text = new Y.Text();
  segment.styledText.set("text", text);
  segment.text = text;
  return text;
}

function applyDesiredTextStyles(
  segments: readonly RawTextSegment[],
  runs: readonly StyledRun[],
): void {
  const desiredSpans = styleSpans(runs);
  let globalStart = 0;
  for (const segment of segments) {
    const segmentLength = segment.text!.length;
    const segmentEnd = globalStart + segmentLength;
    const currentRuns = projectedStyledTextRuns(
      segment.styledText,
      "inline_content:current_styles",
    ).map((value) => styledInput(value, "inline_content:current_style_run"));
    const currentSpans = styleSpans(currentRuns, globalStart);
    let position = globalStart;
    let currentIndex = 0;
    let desiredIndex = 0;
    while (position < segmentEnd) {
      while (
        currentSpans[currentIndex] &&
        currentSpans[currentIndex]!.to <= position
      ) {
        currentIndex += 1;
      }
      while (
        desiredSpans[desiredIndex] &&
        desiredSpans[desiredIndex]!.to <= position
      ) {
        desiredIndex += 1;
      }
      const currentSpan = currentSpans[currentIndex]!;
      const desiredSpan = desiredSpans[desiredIndex]!;
      const end = Math.min(segmentEnd, currentSpan.to, desiredSpan.to);
      const attributes = changedStyleAttributes(
        currentSpan.styles,
        desiredSpan.styles,
      );
      if (Object.keys(attributes).length > 0) {
        ensureText(segment).format(
          position - globalStart,
          end - position,
          attributes,
        );
      }
      position = end;
    }
    globalStart = segmentEnd;
  }
}

function reconcileTextSegments(
  segments: RawTextSegment[],
  array: Y.Array<unknown>,
  rawInsertIndex: number,
  desiredRuns: readonly StyledRun[],
  path: string,
  predicate: (path: string) => boolean,
): void {
  const before = segments.map(segmentText).join("");
  const after = desiredRuns.map((run) => run.text).join("");

  const currentRunsBySegment = segments.map((segment) =>
    projectedStyledTextRuns(
      segment.styledText,
      "inline_content:current_styles",
    ).map((value) => styledInput(value, "inline_content:current_style_run")),
  );
  const projectedRunCount = currentRunsBySegment.reduce(
    (count, runs) => count + runs.length,
    0,
  );
  if (
    segments.length === desiredRuns.length &&
    segments.length === projectedRunCount &&
    currentRunsBySegment.every((runs) => runs.length === 1)
  ) {
    segments.forEach((segment, index) => {
      const currentText = segmentText(segment);
      const desiredText = desiredRuns[index]!.text;
      const diff = minimalDiff(currentText, desiredText);
      if (diff.oldTo > diff.from) {
        segment.text!.delete(diff.from, diff.oldTo - diff.from);
      }
      const inserted = desiredText.slice(diff.from, diff.newTo);
      if (inserted.length > 0) {
        ensureText(segment).insert(diff.from, inserted);
      }
    });
    applyDesiredTextStyles(segments, desiredRuns);
    return;
  }

  const diff = minimalDiff(before, after);
  const starts: number[] = [];
  let position = 0;
  for (const segment of segments) {
    starts.push(position);
    position += segment.text?.length ?? 0;
  }
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]!;
    const start = starts[index]!;
    const end = start + (segment.text?.length ?? 0);
    const deleteStart = Math.max(start, diff.from);
    const deleteEnd = Math.min(end, diff.oldTo);
    if (deleteEnd > deleteStart) {
      segment.text!.delete(deleteStart - start, deleteEnd - deleteStart);
    }
  }
  const inserted = desiredRuns
    .map((run) => run.text)
    .join("")
    .slice(diff.from, diff.newTo);
  if (inserted.length > 0) {
    if (segments.length === 0) {
      // Only an empty nested link can have no raw text segments. The top-level
      // inline projection represents an empty text item with one segment.
      const value = { text: inserted };
      const raw = toYValue(value, arrayPath(path, rawInsertIndex), predicate);
      array.insert(rawInsertIndex, [raw]);
      segments.push(
        rawStyledText(
          array.get(rawInsertIndex),
          rawInsertIndex,
          "inline_content:new_link_text",
        ),
      );
    } else {
      let consumed = 0;
      let target = segments[segments.length - 1]!;
      let localOffset = target.text?.length ?? 0;
      for (const segment of segments) {
        const length = segment.text?.length ?? 0;
        if (diff.from <= consumed + length) {
          target = segment;
          localOffset = diff.from - consumed;
          break;
        }
        consumed += length;
      }
      ensureText(target).insert(localOffset, inserted);
    }
  }
  applyDesiredTextStyles(segments, desiredRuns);
}

function reconcileRawGroup(
  raw: RawGroup,
  desired: DesiredGroup,
  array: Y.Array<unknown>,
  path: string,
  predicate: (path: string) => boolean,
): void {
  if (raw.kind === "text" && desired.kind === "text") {
    reconcileTextSegments(
      raw.segments,
      array,
      raw.rawStart,
      desired.runs,
      path,
      predicate,
    );
    return;
  }
  if (raw.kind === "link" && desired.kind === "link") {
    if (raw.link.get("href") !== desired.href) {
      raw.link.set("href", desired.href);
    }
    const content = raw.content ?? new Y.Array<unknown>();
    if (!raw.content && desired.runs.some((run) => run.text.length > 0)) {
      raw.link.set("content", content);
    }
    reconcileTextSegments(
      raw.segments,
      content,
      0,
      desired.runs,
      `${arrayPath(path, raw.rawStart)}.link.content`,
      predicate,
    );
    return;
  }
  if (raw.kind === "mathInline" && desired.kind === "mathInline") {
    const diff = minimalDiff(raw.text.toString(), desired.source);
    if (diff.oldTo > diff.from) {
      raw.text.delete(diff.from, diff.oldTo - diff.from);
    }
    const inserted = desired.source.slice(diff.from, diff.newTo);
    if (inserted.length > 0) {
      raw.text.insert(diff.from, inserted);
    }
  }
}

function createRawValue(group: DesiredGroup): JsonValue {
  if (group.kind === "text") {
    const text = group.runs.map((run) => run.text).join("");
    return { text: { text } };
  }
  if (group.kind === "link") {
    const text = group.runs.map((run) => run.text).join("");
    return {
      link: {
        href: group.href,
        content: text.length > 0 ? [{ text }] : [],
      },
    };
  }
  if (group.kind === "mathInline") {
    return { mathInline: { source: group.source } };
  }
  return { hardBreak: {} };
}

function formatNewGroup(
  array: Y.Array<unknown>,
  index: number,
  group: DesiredGroup,
): void {
  if (group.kind !== "text" && group.kind !== "link") {
    return;
  }
  const raw = rawInlineItem(array, index, "inline_content:new_group") as
    RawTextGroup | RawLinkGroup;
  applyDesiredTextStyles(raw.segments, group.runs);
}

function inlinePathKind(kind: string, path: string): "inline" | "table" | null {
  const catalogKind =
    richTextBlockKindByProtoCase[
      kind as keyof typeof richTextBlockKindByProtoCase
    ];
  if (!catalogKind) {
    return null;
  }
  const entry = richTextCatalog[catalogKind as RichTextBlockKind]!;
  if (entry.content === "inline" && path === "content") {
    return "inline";
  }
  if (
    entry.content === "table" &&
    /^content\.rows\[\d+\]\.cells\[\d+\]\.content$/.test(path)
  ) {
    return "table";
  }
  return null;
}

function canonicalInlinePrevious(
  current: readonly JsonValue[],
  previous: readonly JsonValue[],
): void {
  const currentKey = normalizeInlineContent(current);
  const previousKey = normalizeInlineContent(previous);
  if (currentKey !== previousKey) {
    fail("stale_inline_content");
  }
}

function reconcileArray(
  array: Y.Array<unknown>,
  ref: BlockRoomPayloadRef,
  kind: string,
  previous: readonly JsonValue[],
  next: readonly JsonValue[],
): void {
  const current = fromYInlineContent(array);
  canonicalInlinePrevious(current, previous);
  const currentGroups = rawGroups(array);
  const nextGroups = desiredGroups(next);
  if (normalizeInlineContent(current) === normalizeInlineContent(next)) {
    return;
  }
  const predicate = (textPath: string): boolean =>
    isCollaborativeTextPath(ref.family, kind, textPath);
  let prefix = 0;
  while (
    prefix < currentGroups.length &&
    prefix < nextGroups.length &&
    rawGroupKind(currentGroups[prefix]!) === nextGroups[prefix]!.kind
  ) {
    reconcileRawGroup(
      currentGroups[prefix]!,
      nextGroups[prefix]!,
      array,
      ref.path,
      predicate,
    );
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < currentGroups.length - prefix &&
    suffix < nextGroups.length - prefix &&
    rawGroupKind(currentGroups[currentGroups.length - 1 - suffix]!) ===
      nextGroups[nextGroups.length - 1 - suffix]!.kind
  ) {
    suffix += 1;
  }
  for (let index = 0; index < suffix; index += 1) {
    const raw = currentGroups[currentGroups.length - suffix + index]!;
    const desired = nextGroups[nextGroups.length - suffix + index]!;
    reconcileRawGroup(raw, desired, array, ref.path, predicate);
  }
  const removed = currentGroups.slice(prefix, currentGroups.length - suffix);
  if (removed.length > 0) {
    const start = removed[0]!.rawStart;
    const end = removed[removed.length - 1]!.rawEnd;
    array.delete(start, end - start);
  }
  const inserted = nextGroups.slice(prefix, nextGroups.length - suffix);
  let rawIndex =
    removed.length > 0
      ? removed[0]!.rawStart
      : prefix < currentGroups.length
        ? currentGroups[prefix]!.rawStart
        : array.length;
  for (const group of inserted) {
    const value = createRawValue(group);
    const raw = toYValue(value, arrayPath(ref.path, rawIndex), predicate);
    array.insert(rawIndex, [raw]);
    formatNewGroup(array, rawIndex, group);
    rawIndex += 1;
  }
}

function ensureMissingInlineArray(
  node: Y.Map<unknown>,
  ref: BlockRoomPayloadRef,
): Y.Array<unknown> {
  const { parent, key } = payloadParent(
    node,
    ref.path,
    `node:${ref.id}:path:${ref.path}`,
  );
  const array = new Y.Array<unknown>();
  (parent as Y.Map<unknown>).set(key as string, array);
  return array;
}

export function isBlockRoomInlineContentRef(ref: BlockRoomPayloadRef): boolean {
  return (
    ref.family === "rich_text" &&
    ref.locale === true &&
    (ref.path === "content" ||
      /^content\.rows\[\d+\]\.cells\[\d+\]\.content$/.test(ref.path))
  );
}

/**
 * Reconciles canonical protobuf inline JSON with collaborative inline Y.Text.
 * Text item indexes in `previous` and `next` are projections, not raw Y.Array
 * indexes. Reconciliation therefore resolves all raw text handles from the
 * validated current payload before applying any writes.
 */
export function reconcileBlockRoomInlineContent(
  yDocument: Y.Doc,
  ref: BlockRoomPayloadRef,
  previous: readonly JsonValue[],
  next: readonly JsonValue[],
  options: BlockRoomMutationOptions = {},
): void {
  yDocument.transact(() => {
    if (ref.family !== "rich_text" || ref.locale !== true) {
      fail(`node:${ref.id}:inline_content_scope:${ref.path}`);
    }
    const node = roomNode(yDocument, ref);
    const kind = nodeKind(node, ref);
    const pathKind = inlinePathKind(kind, ref.path);
    if (!pathKind) {
      fail(`node:${ref.id}:not_inline_content:${ref.path}`);
    }
    const parent = payloadParent(
      node,
      ref.path,
      `node:${ref.id}:path:${ref.path}`,
    );
    const rawCurrent = (parent.parent as Y.Map<unknown>).get(
      parent.key as string,
    );
    if (rawCurrent === undefined) {
      const previousKey = normalizeInlineContent(previous);
      const nextKey = normalizeInlineContent(next);
      if (previousKey !== "[]") {
        fail("stale_inline_content");
      }
      if (nextKey === "[]") {
        return;
      }
      const array = ensureMissingInlineArray(node, ref);
      reconcileArray(array, ref, kind, previous, next);
      return;
    }
    const array = payloadArray(
      node,
      ref.path,
      `node:${ref.id}:path:${ref.path}`,
    );
    reconcileArray(array, ref, kind, previous, next);
  }, options.origin);
}
