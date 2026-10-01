import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  MENU_CONTEXT_MAP_NAME,
  MENU_ITEMS_MAP_NAME,
  MENU_ORDERS_MAP_NAME,
  MENU_PARENTS_MAP_NAME,
  MENU_ROOT_PARENT,
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

function replaceSource(
  document: Y.Doc,
  name: string,
  nextItems: readonly MenuCollaborationItem[],
  previous = sourceSnapshot(document),
): void {
  replaceMenuCanonicalSource(document, name, nextItems, previous);
}

function sourceSnapshot(document: Y.Doc): {
  name: string;
  items: MenuCollaborationItem[];
} {
  return {
    name: extractMenuCanonicalSnapshot(document).name,
    items: materializeMenuCanonicalItems(document),
  };
}

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

    replaceSource(document, "Primary", items);

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

  it("rejects source replacement without an observed previous snapshot", () => {
    const document = hydrateMenuCanonicalRoom({
      sourceLocale: "en",
      locale: "en",
      localeExists: true,
      name: "Main",
      items: [
        { id: "keep", label: "Keep", linkType: "custom" },
        { id: "remove", label: "Remove", linkType: "custom" },
      ],
      sourceLabels: { keep: "Keep", remove: "Remove" },
      requestedLabels: { keep: "Keep", remove: "Remove" },
    });

    expect(() =>
      Reflect.apply(replaceMenuCanonicalSource, undefined, [
        document,
        "Primary",
        [{ id: "keep", label: "Renamed", linkType: "custom", url: "/keep" }],
      ]),
    ).toThrow("Menu source replacement requires an observed previous snapshot");
    expect(extractMenuCanonicalSnapshot(document)).toMatchObject({
      name: "Main",
      items: [{ id: "keep" }, { id: "remove" }],
      requestedLabels: { keep: "Keep", remove: "Remove" },
    });
    expect(document.getMap<string>(MENU_ITEMS_MAP_NAME).has("remove")).toBe(
      true,
    );
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

    const previous = sourceSnapshot(source);
    replaceMenuCanonicalSource(
      source,
      previous.name,
      [
        {
          ...previous.items[0]!,
          localizationMode: "fixed_locale",
          fixedLocale: "ko",
        },
      ],
      previous,
    );
    expect(menuLocaleLabelsMap(source).has("translated")).toBe(false);
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

    replaceSource(document, "Main", [
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

  it("compares stable item arrays while applying a real structure change", () => {
    const document = hydrateMenuCanonicalRoom({
      sourceLocale: "en",
      locale: "en",
      localeExists: true,
      name: "Main",
      items: [
        {
          id: "roles",
          label: "Roles",
          linkType: "custom",
          visibilityRoles: ["admin"],
        },
      ],
      sourceLabels: { roles: "Roles" },
      requestedLabels: { roles: "Roles" },
    });
    const previous = sourceSnapshot(document);

    replaceMenuCanonicalSource(
      document,
      previous.name,
      [
        {
          ...previous.items[0]!,
          visibilityRoles: ["admin", "editor"],
        },
      ],
      previous,
    );

    const stored = JSON.parse(
      document.getMap<string>(MENU_ITEMS_MAP_NAME).get("roles")!,
    ) as MenuCollaborationItem;
    expect(stored.visibilityRoles).toEqual(["admin", "editor"]);
    document.destroy();
  });

  it("applies a stale item edit without rewriting peer items, labels, or name", () => {
    const document = hydrateMenuCanonicalRoom({
      sourceLocale: "en",
      locale: "en",
      localeExists: true,
      name: "Main",
      items: [
        { id: "x", label: "X", linkType: "custom", url: "/x" },
        { id: "y", label: "Y", linkType: "custom", url: "/y" },
      ],
      sourceLabels: { x: "X", y: "Y" },
      requestedLabels: { x: "X", y: "Y" },
    });
    const stalePrevious = sourceSnapshot(document);
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(document));

    const peerNext = [
      { id: "x", label: "X", linkType: "custom", url: "/x" },
      { id: "y", label: "Peer Y", linkType: "custom", url: "/peer-y" },
      { id: "z", label: "Z", linkType: "custom", url: "/z" },
    ];
    replaceMenuCanonicalSource(
      peer,
      "Peer name",
      peerNext,
      sourceSnapshot(peer),
    );
    Y.applyUpdate(
      document,
      Y.encodeStateAsUpdate(peer, Y.encodeStateVector(document)),
    );

    const staleNext = stalePrevious.items.map((item) =>
      item.id === "x" ? { ...item, url: "/local-x" } : item,
    );
    replaceMenuCanonicalSource(
      document,
      stalePrevious.name,
      staleNext,
      stalePrevious,
    );

    expect(extractMenuCanonicalSnapshot(document)).toMatchObject({
      name: "Peer name",
      items: [
        { id: "x", url: "/local-x" },
        { id: "y", url: "/peer-y" },
        { id: "z", url: "/z" },
      ],
      requestedLabels: { x: "X", y: "Peer Y", z: "Z" },
    });
    expect(
      materializeMenuCanonicalItems(document).map((item) => item.label),
    ).toEqual(["X", "Peer Y", "Z"]);
    peer.destroy();
    document.destroy();
  });

  it("deletes only items visible in the previous snapshot", () => {
    const document = hydrateMenuCanonicalRoom({
      sourceLocale: "en",
      locale: "en",
      localeExists: true,
      name: "Main",
      items: [
        { id: "delete-me", label: "Delete", linkType: "custom" },
        { id: "keep", label: "Keep", linkType: "custom", url: "/keep" },
      ],
      sourceLabels: { "delete-me": "Delete", keep: "Keep" },
      requestedLabels: { "delete-me": "Delete", keep: "Keep" },
    });
    const stalePrevious = sourceSnapshot(document);
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(document));
    const peerNext = [
      { id: "delete-me", label: "Delete", linkType: "custom" },
      { id: "keep", label: "Peer keep", linkType: "custom", url: "/peer-keep" },
      {
        id: "new-peer-item",
        label: "Peer add",
        linkType: "custom",
        url: "/new",
      },
    ];
    replaceMenuCanonicalSource(peer, "Main", peerNext, sourceSnapshot(peer));
    Y.applyUpdate(
      document,
      Y.encodeStateAsUpdate(peer, Y.encodeStateVector(document)),
    );

    const staleNext = stalePrevious.items.filter(
      (item) => item.id !== "delete-me",
    );
    replaceMenuCanonicalSource(
      document,
      stalePrevious.name,
      staleNext,
      stalePrevious,
    );

    expect(extractMenuCanonicalSnapshot(document)).toMatchObject({
      items: [
        { id: "keep", url: "/peer-keep" },
        { id: "new-peer-item", url: "/new" },
      ],
      requestedLabels: { keep: "Peer keep", "new-peer-item": "Peer add" },
    });
    expect(
      materializeMenuCanonicalItems(document).map((item) => item.label),
    ).toEqual(["Peer keep", "Peer add"]);
    expect(document.getMap<string>(MENU_ITEMS_MAP_NAME).has("delete-me")).toBe(
      false,
    );
    peer.destroy();
    document.destroy();
  });

  it("cascades current peer descendants when the previous parent is explicitly deleted", () => {
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
        {
          id: "unrelated",
          label: "Unrelated",
          linkType: "custom",
          url: "/before",
        },
      ],
      sourceLabels: {
        parent: "Parent",
        child: "Child",
        unrelated: "Unrelated",
      },
      requestedLabels: {
        parent: "Parent",
        child: "Child",
        unrelated: "Unrelated",
      },
    });
    const stalePrevious = sourceSnapshot(document);
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(document));

    const peerPrevious = sourceSnapshot(peer);
    const peerNext = peerPrevious.items.map((item) =>
      item.id === "parent"
        ? {
            ...item,
            children: [
              ...(item.children ?? []),
              {
                id: "peer-child",
                label: "Peer child",
                linkType: "custom",
                children: [
                  {
                    id: "peer-grandchild",
                    label: "Peer grandchild",
                    linkType: "custom",
                  },
                ],
              },
            ],
          }
        : item,
    );
    replaceMenuCanonicalSource(peer, "Main", peerNext, peerPrevious);
    Y.applyUpdate(
      document,
      Y.encodeStateAsUpdate(peer, Y.encodeStateVector(document)),
    );

    const localNext = stalePrevious.items
      .filter((item) => item.id !== "parent")
      .map((item) =>
        item.id === "unrelated" ? { ...item, url: "/local" } : item,
      );
    replaceMenuCanonicalSource(
      document,
      stalePrevious.name,
      localNext,
      stalePrevious,
    );

    expect(materializeMenuCanonicalItems(document)).toMatchObject([
      { id: "unrelated", url: "/local" },
    ]);
    expect(extractMenuCanonicalSnapshot(document).requestedLabels).toEqual({
      unrelated: "Unrelated",
    });
    const currentItems = document.getMap<string>(MENU_ITEMS_MAP_NAME);
    expect(currentItems.has("parent")).toBe(false);
    expect(currentItems.has("child")).toBe(false);
    expect(currentItems.has("peer-child")).toBe(false);
    expect(currentItems.has("peer-grandchild")).toBe(false);
    peer.destroy();
    document.destroy();
  });

  it("does not resurrect a peer-deleted parent while applying unrelated local edits", () => {
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
        {
          id: "unrelated",
          label: "Unrelated",
          linkType: "custom",
          url: "/before",
        },
      ],
      sourceLabels: {
        parent: "Parent",
        child: "Child",
        unrelated: "Unrelated",
      },
      requestedLabels: {
        parent: "Parent",
        child: "Child",
        unrelated: "Unrelated",
      },
    });
    const stalePrevious = sourceSnapshot(document);
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(document));

    const peerPrevious = sourceSnapshot(peer);
    const peerNext = [
      {
        id: "unrelated",
        label: "Unrelated",
        linkType: "custom",
        url: "/peer",
      },
      {
        id: "peer-added",
        label: "Peer item",
        linkType: "custom",
        url: "/peer-added",
      },
    ];
    replaceMenuCanonicalSource(peer, "Main", peerNext, peerPrevious);
    Y.applyUpdate(
      document,
      Y.encodeStateAsUpdate(peer, Y.encodeStateVector(document)),
    );

    const localNext = stalePrevious.items.map((item) =>
      item.id === "unrelated" ? { ...item, url: "/local" } : item,
    );
    replaceMenuCanonicalSource(
      document,
      stalePrevious.name,
      localNext,
      stalePrevious,
    );

    expect(materializeMenuCanonicalItems(document)).toMatchObject([
      { id: "unrelated", url: "/local" },
      { id: "peer-added", url: "/peer-added" },
    ]);
    const currentItems = document.getMap<string>(MENU_ITEMS_MAP_NAME);
    expect(currentItems.has("parent")).toBe(false);
    expect(currentItems.has("child")).toBe(false);
    peer.destroy();
    document.destroy();
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

    const observed = sourceSnapshot(document);
    replaceMenuCanonicalSource(
      document,
      observed.name,
      observed.items,
      observed,
    );

    expect(() =>
      replaceSource(document, "Main", [
        { id: "duplicate", linkType: "custom" },
        { id: "duplicate", linkType: "custom" },
      ]),
    ).toThrow("Invalid Menu collaboration item identity");
    expect(() =>
      replaceSource(document, "Main", [{ id: "root", linkType: "custom" }]),
    ).toThrow("Invalid Menu collaboration item identity");
    expect(() =>
      replaceSource(document, "Main", [{ id: "", linkType: "custom" }]),
    ).toThrow("Menu collaboration item ID is required");

    const currentItems = sourceSnapshot(document).items;
    expect(() =>
      replaceMenuCanonicalSource(document, "Main", currentItems, {
        name: "Main",
        items: [
          { id: "duplicate", linkType: "custom" },
          { id: "duplicate", linkType: "custom" },
        ],
      }),
    ).toThrow("Invalid Menu collaboration item identity");
    expect(() =>
      replaceMenuCanonicalSource(document, "Main", currentItems, {
        name: "Main",
        items: [{ id: MENU_ROOT_PARENT, linkType: "custom" }],
      }),
    ).toThrow("Invalid Menu collaboration item identity");
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
      replaceMenuCanonicalSource(document, "Main", items.slice(0, 1), {
        name: "Main",
        items: items.slice(0, 1),
      }),
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
