import type { JsonValue } from "@bufbuild/protobuf";
import { diffArrays } from "diff";
import { desiredGroups, type Style } from "./inline-content-model.ts";

type Attributes = Record<string, string | boolean>;
type Token =
  | { kind: "text"; value: string; attributes: Attributes }
  | { kind: "mathInline"; attributes: Attributes }
  | { kind: "hardBreak"; attributes: Attributes }
  | { kind: "emptyLink"; attributes: Attributes }
  | { kind: "linkBoundary"; attributes: Attributes };

const MAX_EXACT_EDIT_DISTANCE = 128;

interface Projection {
  readonly retained: Map<number, Token>;
  readonly inserted: Map<number, Token[]>;
}

function tokenIdentity(token: Token): string {
  return token.kind === "text" ? `text:${token.value}` : token.kind;
}

/** Align text by Unicode code point; style/link changes remain attribute edits. */
function project(
  before: readonly Token[],
  after: readonly Token[],
  identity: (token: Token) => string = tokenIdentity,
): Projection {
  const retained = new Map<number, Token>();
  const inserted = new Map<number, Token[]>();
  let position = 0;
  const changes = diffArrays([...before], [...after], {
    comparator: (left, right) => identity(left) === identity(right),
    maxEditLength: MAX_EXACT_EDIT_DISTANCE,
  });
  if (!changes) return projectByForwardAnchors(before, after, identity);
  for (const change of changes) {
    if (change.added) {
      inserted.set(position, change.value);
    } else if (change.removed) {
      position += change.count;
    } else {
      for (const token of change.value) retained.set(position++, token);
    }
  }
  return { retained, inserted };
}

/**
 * Large replacements do not need an optimal edit script. Forward occurrence
 * indexes retain a monotonic common subsequence in linear time, so recovery
 * remains bounded while still replaying insertions/deletions as author intent.
 * Exact Myers alignment remains the normal path for ordinary editing.
 */
function projectByForwardAnchors(
  before: readonly Token[],
  after: readonly Token[],
  identity: (token: Token) => string,
): Projection {
  const occurrences = new Map<string, { positions: number[]; next: number }>();
  before.forEach((token, index) => {
    const key = identity(token);
    let entry = occurrences.get(key);
    if (!entry) {
      entry = { positions: [], next: 0 };
      occurrences.set(key, entry);
    }
    entry.positions.push(index);
  });
  const retained = new Map<number, Token>();
  const inserted = new Map<number, Token[]>();
  let cursor = 0;
  let pending: Token[] = [];
  for (const token of after) {
    const entry = occurrences.get(identity(token));
    if (entry) {
      while (
        entry.next < entry.positions.length &&
        entry.positions[entry.next]! < cursor
      )
        entry.next++;
    }
    const position = entry?.positions[entry.next];
    if (position === undefined) {
      pending.push(token);
      continue;
    }
    if (pending.length) {
      inserted.set(position, pending);
      pending = [];
    }
    retained.set(position, token);
    cursor = position + 1;
    entry!.next++;
  }
  if (pending.length) inserted.set(before.length, pending);
  return { retained, inserted };
}

function mergeAttributes(
  before: Attributes,
  local: Attributes,
  peer: Attributes,
): Attributes {
  const result = { ...peer };
  for (const key of new Set([...Object.keys(before), ...Object.keys(local)])) {
    if (before[key] === local[key]) continue;
    if (local[key] === undefined) delete result[key];
    else result[key] = local[key];
  }
  return result;
}

function withAttributes(token: Token, attributes: Attributes): Token {
  return { ...token, attributes };
}

function insertionIdentity(token: Token): string {
  if (token.kind === "mathInline") return `math:${token.attributes.source}`;
  if (token.kind === "emptyLink") return `emptyLink:${token.attributes.href}`;
  return tokenIdentity(token);
}

function mergeInsertions(
  peer: readonly Token[],
  local: readonly Token[],
): Token[] {
  if (local.length === 0) return [...peer];
  if (peer.length === 0) return [...local];
  // Preserve the order of both insertion sequences. Shared characters may
  // already be durable, with peer edits interleaved between them; merge those
  // once and insert only the missing local characters.
  const localProjection = project(peer, local, insertionIdentity);
  const result: Token[] = [];
  for (let position = 0; position <= peer.length; position++) {
    for (const token of localProjection.inserted.get(position) ?? [])
      result.push(token);
    const peerToken = peer[position];
    if (!peerToken) continue;
    const localToken = localProjection.retained.get(position);
    result.push(
      localToken
        ? withAttributes(
            peerToken,
            mergeAttributes({}, localToken.attributes, peerToken.attributes),
          )
        : peerToken,
    );
  }
  return result;
}

function mergeTokens(
  before: readonly Token[],
  local: readonly Token[],
  peer: readonly Token[],
): Token[] {
  const localProjection = project(before, local);
  const peerProjection = project(before, peer);
  const result: Token[] = [];
  for (let position = 0; position <= before.length; position++) {
    for (const token of mergeInsertions(
      peerProjection.inserted.get(position) ?? [],
      localProjection.inserted.get(position) ?? [],
    ))
      result.push(token);
    const localToken = localProjection.retained.get(position);
    const peerToken = peerProjection.retained.get(position);
    // An observed character removed on either side is never resurrected by
    // formatting or another edit to the old projection.
    if (localToken && peerToken) {
      result.push(
        withAttributes(
          peerToken,
          mergeAttributes(
            before[position]!.attributes,
            localToken.attributes,
            peerToken.attributes,
          ),
        ),
      );
    }
  }
  return result;
}

function normalizedStyles(styles: Style): Attributes {
  return Object.fromEntries(
    Object.entries(styles).filter(
      ([, value]) => value !== false && value !== "",
    ),
  );
}

function inlineTokens(content: readonly JsonValue[]): Token[] {
  const tokens: Token[] = [];
  let previousKind: string | undefined;
  for (const group of desiredGroups(content)) {
    if (group.kind === "link" && previousKind === "link")
      tokens.push({ kind: "linkBoundary", attributes: {} });
    previousKind = group.kind;
    if (group.kind === "text" || group.kind === "link") {
      if (group.kind === "link" && group.runs.length === 0)
        tokens.push({ kind: "emptyLink", attributes: { href: group.href } });
      for (const run of group.runs) {
        const attributes = {
          ...normalizedStyles(run.styles),
          ...(group.kind === "link" ? { href: group.href } : {}),
        };
        for (const value of run.text)
          tokens.push({ kind: "text", value, attributes });
      }
    } else if (group.kind === "mathInline") {
      tokens.push({ kind: "mathInline", attributes: { source: group.source } });
    } else {
      tokens.push({ kind: "hardBreak", attributes: {} });
    }
  }
  return tokens;
}

function inlineContent(tokens: readonly Token[]): JsonValue[] {
  const result: JsonValue[] = [];
  let runs: Array<{ text: string; styles?: Attributes }> | undefined;
  let previousHref: string | boolean | undefined;
  for (const token of tokens) {
    if (token.kind !== "text") {
      runs = undefined;
      if (token.kind === "linkBoundary") continue;
      result.push(
        token.kind === "emptyLink"
          ? { link: { href: token.attributes.href as string, content: [] } }
          : token.kind === "mathInline"
            ? { mathInline: { source: token.attributes.source as string } }
            : { hardBreak: {} },
      );
      continue;
    }
    const { href, ...styles } = token.attributes;
    if (!runs || previousHref !== href) {
      runs = [];
      if (href !== undefined) result.push({ link: { href, content: runs } });
      previousHref = href;
    }
    const last = runs[runs.length - 1];
    if (last && JSON.stringify(last.styles ?? {}) === JSON.stringify(styles)) {
      last.text += token.value;
    } else {
      const run = {
        text: token.value,
        ...(Object.keys(styles).length ? { styles } : {}),
      };
      runs.push(run);
      if (href === undefined) result.push({ text: run });
    }
  }
  return result;
}

/** Replay only local character/attribute intent over the canonical projection. */
export function mergeInlineIntent(
  before: readonly JsonValue[],
  local: readonly JsonValue[],
  peer: readonly JsonValue[],
): JsonValue[] {
  return inlineContent(
    mergeTokens(inlineTokens(before), inlineTokens(local), inlineTokens(peer)),
  );
}

export function mergeTextIntent(
  before: string,
  local: string,
  peer: string,
): string {
  const tokens = (value: string): Token[] =>
    Array.from(value, (character) => ({
      kind: "text",
      value: character,
      attributes: {},
    }));
  return mergeTokens(tokens(before), tokens(local), tokens(peer))
    .map((token) => (token as Extract<Token, { kind: "text" }>).value)
    .join("");
}
