const PLACEHOLDER_PROTOCOL_RE = /^(https?:\/\/)(\{\{[^{}]+\}\})$/i;
const DUPLICATE_PROTOCOL_RE = /^(https?:\/\/)(https?:\/\/)(.+)$/i;
const HREF_ATTR_RE =
  /(^|[\s])href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
const HREF_ATTR_LOOKUP_RE = /href\s*=/i;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const OBFUSCATED_SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i;
const SCHEME_COMPACT_RE = /[\u0000-\u0020\u007f]+/g;
const SCHEME_ENTITY_RE =
  /&(?:(?:#(\d+)|#x([0-9a-f]+));?|((?:colon|tab|newline));)/gi;
const MAX_UNICODE_CODE_POINT = 0x10ffff;
const ALLOWED_SCHEMES = new Set(["http", "https", "mailto", "tel"]);

type LinkableInlineProps = Record<string, unknown> & {
  href?: string;
};

type LinkableInlineNode<TInline extends LinkableInlineNode<TInline>> = {
  type?: string;
  href?: string;
  props?: LinkableInlineProps;
  content?: readonly TInline[];
};

type LinkableBlockNode<
  TInline extends LinkableInlineNode<TInline>,
  TBlock extends LinkableBlockNode<TInline, TBlock>,
> = {
  content?: readonly TInline[] | string | object;
  children?: readonly TBlock[];
};

export function normalizeRichTextHref(href: string): string {
  const original = href;
  let normalized = href.trim();

  for (;;) {
    const before = normalized;
    const placeholderMatch = normalized.match(PLACEHOLDER_PROTOCOL_RE);
    if (placeholderMatch) {
      normalized = placeholderMatch[2];
    }

    normalized = normalized.replace(DUPLICATE_PROTOCOL_RE, "$1$3");
    if (normalized === before) {
      break;
    }
  }

  if (!isAllowedRichTextHref(normalized)) {
    return "";
  }

  return normalized === original ? original : normalized;
}

function isAllowedRichTextHref(href: string): boolean {
  if (href === "") {
    return true;
  }

  const compacted = decodeSchemeEntities(href).replace(SCHEME_COMPACT_RE, "");
  const schemeMatch = compacted.match(OBFUSCATED_SCHEME_RE);
  if (!schemeMatch) {
    return true;
  }

  return ALLOWED_SCHEMES.has(schemeMatch[1].toLowerCase());
}

function decodeSchemeEntities(value: string): string {
  return value.replace(
    SCHEME_ENTITY_RE,
    (
      match: string,
      decimal: string | undefined,
      hex: string | undefined,
      named: string | undefined,
    ) => {
      if (decimal) {
        return decodeSchemeCodePoint(decimal, 10, match);
      }
      if (hex) {
        return decodeSchemeCodePoint(hex, 16, match);
      }
      const normalizedNamed = named!.toLowerCase();
      return normalizedNamed === "colon"
        ? ":"
        : normalizedNamed === "tab"
          ? "\t"
          : "\n";
    },
  );
}

function decodeSchemeCodePoint(
  value: string,
  radix: number,
  fallback: string,
): string {
  const codePoint = Number.parseInt(value, radix);
  if (codePoint > MAX_UNICODE_CODE_POINT) {
    return fallback;
  }

  return String.fromCodePoint(codePoint);
}

export function normalizeRichTextHtmlLinks(html: string): string {
  if (!html || !HREF_ATTR_LOOKUP_RE.test(html)) {
    return html;
  }

  return html.replace(
    HREF_ATTR_RE,
    (match, prefix: string, ...groups: string[]) => {
      const { href, quote } = readHrefAttributeGroups(
        groups[0],
        groups[1],
        groups[2],
      );
      const normalizedHref = normalizeRichTextHref(href);
      if (normalizedHref === "" && href.trim() !== "") {
        return prefix;
      }
      if (normalizedHref === href) {
        return match;
      }

      return `${prefix}href=${quote}${normalizedHref}${quote}`;
    },
  );
}

function readHrefAttributeGroups(
  doubleQuotedHref: string | undefined,
  singleQuotedHref: string | undefined,
  unquotedHref: string | undefined,
): { href: string; quote: string } {
  if (doubleQuotedHref !== undefined) {
    return { href: doubleQuotedHref, quote: '"' };
  }
  if (singleQuotedHref !== undefined) {
    return { href: singleQuotedHref, quote: "'" };
  }
  return { href: unquotedHref!, quote: "" };
}

function collectRestorableLinkHrefPairs<
  TInline extends LinkableInlineNode<TInline>,
>(content: readonly TInline[], pairs: Map<string, string>): void {
  for (const node of content) {
    const rawHref = node.href ?? node.props?.href;
    const normalizedHref =
      typeof rawHref === "string" ? normalizeRichTextHref(rawHref) : null;
    if (
      normalizedHref &&
      normalizedHref.length > 0 &&
      !SCHEME_RE.test(normalizedHref)
    ) {
      pairs.set(`https://${normalizedHref}`, normalizedHref);
    }

    if (Array.isArray(node.content) && node.content.length > 0) {
      collectRestorableLinkHrefPairs(node.content, pairs);
    }
  }
}

function collectRestorableBlockHrefPairs<
  TInline extends LinkableInlineNode<TInline>,
  TBlock extends LinkableBlockNode<TInline, TBlock>,
>(blocks: readonly TBlock[], pairs: Map<string, string>): void {
  for (const block of blocks) {
    if (Array.isArray(block.content) && block.content.length > 0) {
      collectRestorableLinkHrefPairs(block.content, pairs);
    }
    if (Array.isArray(block.children) && block.children.length > 0) {
      collectRestorableBlockHrefPairs(block.children, pairs);
    }
  }
}

export function normalizeRichTextHtmlLinksFromBlocks<
  TInline extends LinkableInlineNode<TInline>,
  TBlock extends LinkableBlockNode<TInline, TBlock>,
>(blocks: readonly TBlock[], html: string): string {
  if (!html || blocks.length === 0 || !HREF_ATTR_LOOKUP_RE.test(html)) {
    return normalizeRichTextHtmlLinks(html);
  }

  const replacementPairs = new Map<string, string>();
  collectRestorableBlockHrefPairs(blocks, replacementPairs);

  const restored = html.replace(
    HREF_ATTR_RE,
    (match, prefix: string, ...groups: string[]) => {
      const { href, quote } = readHrefAttributeGroups(
        groups[0],
        groups[1],
        groups[2],
      );
      const restoredHref = replacementPairs.get(href);
      if (!restoredHref) {
        return match;
      }
      return `${prefix}href=${quote}${restoredHref}${quote}`;
    },
  );

  return normalizeRichTextHtmlLinks(restored);
}
