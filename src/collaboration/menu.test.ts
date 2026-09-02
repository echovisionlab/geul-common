import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  MENU_CONTEXT_MAP_NAME,
  MENU_ITEMS_MAP_NAME,
  MENU_ORDERS_MAP_NAME,
  MENU_PARENTS_MAP_NAME,
  extractMenuCanonicalSnapshot,
  hydrateMenuCanonicalRoom,
  materializeMenuCanonicalItems,
  menuLocaleLabelsMap,
  replaceMenuCanonicalSource,
  setMenuLocaleLabel,
  type MenuCollaborationItem,
  unsetMenuLocaleLabel,
} from "./menu.ts";

const items = [
  {
    id: "translated",
    label: "Posts",
    linkType: "custom",
    url: "/posts",
  },
  {
    id: "korean-only",
    label: "한국어",
    linkType: "custom",
    url: "/ko",
    localizationMode: "fixed_locale",
    fixedLocale: "ko",
  },
] as const;

describe("Menu collaboration room", () => {
  it("keeps structure shared while source values remain locale-owned", () => {
    const document = hydrateMenuCanonicalRoom({
      sourceLocale: "en",
      locale: "en",
      localeExists: true,
      name: "Main",
      items,
      sourceLabels: { translated: "Posts" },
      requestedLabels: { translated: "Posts" },
    });

    replaceMenuCanonicalSource(document, "Primary", items);

    expect(extractMenuCanonicalSnapshot(document)).toEqual({
      name: "Primary",
      items: [
        { id: "translated", linkType: "custom", url: "/posts" },
        {
          id: "korean-only",
          linkType: "custom",
          url: "/ko",
          localizationMode: "fixed_locale",
          fixedLocale: "ko",
        },
      ],
      requestedLabels: { translated: "Posts" },
    });
    expect(materializeMenuCanonicalItems(document)[1]?.label).toBe("");
  });

  it("materializes a fixed-locale label only inside its owning locale room", () => {
    const source = hydrateMenuCanonicalRoom({
      sourceLocale: "en",
      locale: "en",
      localeExists: true,
      name: "Main",
      items,
      sourceLabels: { translated: "Posts", "korean-only": "stale" },
      requestedLabels: { translated: "Posts" },
    });
    const fixed = hydrateMenuCanonicalRoom({
      sourceLocale: "en",
      locale: "ko",
      localeExists: true,
      name: "Main",
      items,
      sourceLabels: { translated: "Posts", "korean-only": "stale" },
      requestedLabels: { "korean-only": "한국어" },
    });

    expect(materializeMenuCanonicalItems(source)[1]?.label).toBe("");
    expect(materializeMenuCanonicalItems(fixed)[1]?.label).toBe("한국어");
  });

  it("rejects items disconnected from the canonical root", () => {
    const document = hydrateMenuCanonicalRoom({
      sourceLocale: "en",
      locale: "en",
      localeExists: true,
      name: "Main",
      items: items.slice(0, 1),
      sourceLabels: { translated: "Posts" },
      requestedLabels: { translated: "Posts" },
    });
    document.getMap<string>(MENU_PARENTS_MAP_NAME).set("translated", "missing");

    expect(() => materializeMenuCanonicalItems(document)).toThrow(
      "Invalid Menu collaboration tree parent",
    );
  });

  it("preserves nested structure and removes retired item state", () => {
    const document = hydrateMenuCanonicalRoom({
      sourceLocale: "en",
      locale: "en",
      localeExists: true,
      name: "Main",
      items: [
        {
          id: "parent",
          label: "Parent",
          linkType: "custom",
          children: [{ id: "child", label: "Child", linkType: "custom" }],
        },
        { id: "retired", label: "Retired", linkType: "custom" },
      ],
      sourceLabels: { parent: "Parent", child: "Child", retired: "Retired" },
      requestedLabels: {
        parent: "Parent",
        child: "Child",
        retired: "Retired",
      },
    });

    replaceMenuCanonicalSource(document, "Main", [
      {
        id: "parent",
        label: "Parent",
        linkType: "custom",
        children: [{ id: "child", linkType: "custom" }],
      },
    ]);

    expect(extractMenuCanonicalSnapshot(document)).toEqual({
      name: "Main",
      items: [
        {
          id: "parent",
          linkType: "custom",
          children: [{ id: "child", linkType: "custom" }],
        },
      ],
      requestedLabels: { parent: "Parent", child: "Child" },
    });
    expect(document.getMap(MENU_ITEMS_MAP_NAME).has("retired")).toBe(false);
  });

  it("uses deterministic defaults and rejects malformed identities", () => {
    const document = hydrateMenuCanonicalRoom({
      sourceLocale: "en",
      locale: "en",
      localeExists: true,
      name: "Main",
      items: [
        { id: "b", label: "B", linkType: "custom" },
        { id: "a", label: "A", linkType: "custom" },
      ],
      sourceLabels: {},
      requestedLabels: {},
    });
    document.getMap<string>(MENU_PARENTS_MAP_NAME).delete("a");
    document.getMap<number>(MENU_ORDERS_MAP_NAME).delete("a");
    document.getMap<number>(MENU_ORDERS_MAP_NAME).delete("b");
    expect(
      materializeMenuCanonicalItems(document).map((item) => item.id),
    ).toEqual(["a", "b"]);
    expect(
      materializeMenuCanonicalItems(document).map((item) => item.label),
    ).toEqual(["", ""]);
    menuLocaleLabelsMap(document).set("a", undefined as unknown as string);
    expect(materializeMenuCanonicalItems(document)[0]?.label).toBe("");
    setMenuLocaleLabel(document, "a", "A");
    expect(menuLocaleLabelsMap(document).get("a")).toBe("A");
    unsetMenuLocaleLabel(document, "a");
    expect(menuLocaleLabelsMap(document).has("a")).toBe(false);
    document.getMap<string>("menu-root").delete("name");
    expect(extractMenuCanonicalSnapshot(document).name).toBe("");

    expect(() =>
      replaceMenuCanonicalSource(document, "Main", [
        { id: "duplicate", linkType: "custom" },
        { id: "duplicate", linkType: "custom" },
      ]),
    ).toThrow("Invalid Menu collaboration item identity");
    expect(() =>
      replaceMenuCanonicalSource(document, "Main", [
        { id: "root", linkType: "custom" },
      ]),
    ).toThrow("Invalid Menu collaboration item identity");
    expect(() =>
      replaceMenuCanonicalSource(document, "Main", [
        { id: "", linkType: "custom" },
      ]),
    ).toThrow("Menu collaboration item ID is required");
  });

  it("fails closed for missing context, unknown labels, and excessive depth", () => {
    expect(() => materializeMenuCanonicalItems(new Y.Doc())).toThrow(
      "Menu collaboration locale is required",
    );

    const document = hydrateMenuCanonicalRoom({
      sourceLocale: "en",
      locale: "en",
      localeExists: true,
      name: "Main",
      items: items.slice(0, 1),
      sourceLabels: { translated: "Posts" },
      requestedLabels: { translated: "Posts" },
    });
    expect(() => setMenuLocaleLabel(document, "unknown", "value")).toThrow(
      "Unknown Menu item",
    );
    menuLocaleLabelsMap(document).set("unknown", "value");
    expect(() => extractMenuCanonicalSnapshot(document)).toThrow(
      "Unknown Menu locale label item",
    );
    document.getMap(MENU_CONTEXT_MAP_NAME).delete("locale");
    expect(() =>
      replaceMenuCanonicalSource(document, "Main", items.slice(0, 1)),
    ).toThrow("Menu collaboration locale is required");

    const deep = new Y.Doc();
    deep.getMap<string | boolean>(MENU_CONTEXT_MAP_NAME).set("locale", "en");
    for (let depth = 0; depth < 34; depth += 1) {
      const id = `node-${depth}`;
      deep
        .getMap<string>(MENU_ITEMS_MAP_NAME)
        .set(id, JSON.stringify({ id, linkType: "custom" }));
      deep
        .getMap<string>(MENU_PARENTS_MAP_NAME)
        .set(id, depth === 0 ? "root" : `node-${depth - 1}`);
      deep.getMap<number>(MENU_ORDERS_MAP_NAME).set(id, 0);
    }
    expect(() => materializeMenuCanonicalItems(deep)).toThrow(
      "Invalid Menu collaboration tree depth",
    );

    let nested: MenuCollaborationItem = {
      id: "leaf",
      linkType: "custom",
    };
    for (let depth = 0; depth < 34; depth += 1) {
      nested = {
        id: `nested-${depth}`,
        linkType: "custom",
        children: [nested],
      };
    }
    expect(() =>
      hydrateMenuCanonicalRoom({
        sourceLocale: "en",
        locale: "en",
        localeExists: true,
        name: "Main",
        items: [nested],
        sourceLabels: {},
        requestedLabels: {},
      }),
    ).toThrow("Invalid Menu collaboration tree depth");
  });
});
