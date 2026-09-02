import * as Y from "yjs";

export const MENU_CONTEXT_MAP_NAME = "menu-context";
export const MENU_ROOT_MAP_NAME = "menu-root";
export const MENU_ITEMS_MAP_NAME = "menu-items";
export const MENU_PARENTS_MAP_NAME = "menu-parents";
export const MENU_ORDERS_MAP_NAME = "menu-orders";
export const MENU_SOURCE_LABELS_MAP_NAME = "menu-source-labels";
export const MENU_LOCALE_LABELS_MAP_NAME = "menu-locale-labels";
export const MENU_ROOT_PARENT = "root";

export interface MenuCollaborationItem {
  id: string;
  label?: string;
  linkType: string;
  url?: string;
  targetId?: string;
  targetSlug?: string;
  openInNewTab?: boolean;
  visibilityMode?: string;
  visibilityRoles?: string[];
  localizationMode?: string;
  fixedLocale?: string;
  children?: MenuCollaborationItem[];
}

type StoredMenuItem = Omit<MenuCollaborationItem, "label" | "children">;

export interface MenuCanonicalRoomInput {
  sourceLocale: string;
  locale: string;
  localeExists: boolean;
  name: string;
  items: readonly MenuCollaborationItem[];
  sourceLabels: Readonly<Record<string, string>>;
  requestedLabels: Readonly<Record<string, string>>;
}

export interface MenuCanonicalSnapshot {
  name: string;
  items: MenuCollaborationItem[];
  requestedLabels: Record<string, string>;
}

export function hydrateMenuCanonicalRoom(input: MenuCanonicalRoomInput): Y.Doc {
  const document = new Y.Doc();
  document.transact(() => {
    const context = document.getMap<string | boolean>(MENU_CONTEXT_MAP_NAME);
    context.set("sourceLocale", input.sourceLocale);
    context.set("locale", input.locale);
    context.set("localeExists", input.localeExists);
    document.getMap<string>(MENU_ROOT_MAP_NAME).set("name", input.name);
    replaceMenuStructure(document, input.items);
    const sourceLabels = document.getMap<string>(MENU_SOURCE_LABELS_MAP_NAME);
    const requestedLabels = menuLocaleLabelsMap(document);
    for (const [id, label] of Object.entries(input.sourceLabels))
      sourceLabels.set(id, label);
    for (const [id, label] of Object.entries(input.requestedLabels))
      requestedLabels.set(id, label);
  });
  return document;
}

export function menuLocaleLabelsMap(document: Y.Doc): Y.Map<string> {
  return document.getMap<string>(MENU_LOCALE_LABELS_MAP_NAME);
}

export function materializeMenuCanonicalItems(
  document: Y.Doc,
): MenuCollaborationItem[] {
  const items = document.getMap<string>(MENU_ITEMS_MAP_NAME);
  const parents = document.getMap<string>(MENU_PARENTS_MAP_NAME);
  const orders = document.getMap<number>(MENU_ORDERS_MAP_NAME);
  const sourceLabels = document.getMap<string>(MENU_SOURCE_LABELS_MAP_NAME);
  const requestedLabels = menuLocaleLabelsMap(document);
  const locale = document
    .getMap<string | boolean>(MENU_CONTEXT_MAP_NAME)
    .get("locale");
  if (typeof locale !== "string") {
    throw new Error("Menu collaboration locale is required");
  }
  const children = new Map<string, string[]>();
  for (const id of items.keys()) {
    const parent = parents.get(id) ?? MENU_ROOT_PARENT;
    const ids = children.get(parent) ?? [];
    ids.push(id);
    children.set(parent, ids);
  }
  for (const ids of children.values()) {
    ids.sort(
      (left, right) =>
        (orders.get(left) ?? 0) - (orders.get(right) ?? 0) ||
        left.localeCompare(right),
    );
  }
  let materializedCount = 0;
  const build = (parent: string, depth: number): MenuCollaborationItem[] => {
    if (depth > 32) throw new Error("Invalid Menu collaboration tree depth");
    return (children.get(parent) ?? []).map((id) => {
      materializedCount += 1;
      const raw = items.get(id)!;
      const stored = JSON.parse(raw) as StoredMenuItem;
      const nested = build(id, depth + 1);
      const ownsLabel = menuItemOwnsLocaleLabel(stored, locale);
      return {
        ...stored,
        id,
        label: ownsLabel
          ? requestedLabels.has(id)
            ? (requestedLabels.get(id) ?? "")
            : (sourceLabels.get(id) ?? "")
          : "",
        ...(nested.length > 0 ? { children: nested } : {}),
      };
    });
  };
  const result = build(MENU_ROOT_PARENT, 0);
  if (materializedCount !== items.size) {
    throw new Error("Invalid Menu collaboration tree parent");
  }
  return result;
}

export function replaceMenuCanonicalSource(
  document: Y.Doc,
  name: string,
  items: readonly MenuCollaborationItem[],
): void {
  document.getMap<string>(MENU_ROOT_MAP_NAME).set("name", name);
  replaceMenuStructure(document, items);
  const labels = menuLocaleLabelsMap(document);
  const locale = document
    .getMap<string | boolean>(MENU_CONTEXT_MAP_NAME)
    .get("locale");
  if (typeof locale !== "string") {
    throw new Error("Menu collaboration locale is required");
  }
  const ids = new Set(flattenMenuItems(items).map(({ item }) => item.id));
  for (const id of [...labels.keys()]) if (!ids.has(id)) labels.delete(id);
  for (const { item } of flattenMenuItems(items)) {
    if (!menuItemOwnsLocaleLabel(item, locale)) {
      labels.delete(item.id);
    } else if (item.label !== undefined) {
      labels.set(item.id, item.label);
    }
  }
}

export function setMenuLocaleLabel(
  document: Y.Doc,
  itemId: string,
  label: string,
): void {
  if (!document.getMap<string>(MENU_ITEMS_MAP_NAME).has(itemId)) {
    throw new Error(`Unknown Menu item: ${itemId}`);
  }
  menuLocaleLabelsMap(document).set(itemId, label);
}

export function unsetMenuLocaleLabel(document: Y.Doc, itemId: string): void {
  menuLocaleLabelsMap(document).delete(itemId);
}

export function extractMenuCanonicalSnapshot(
  document: Y.Doc,
): MenuCanonicalSnapshot {
  const requestedLabels: Record<string, string> = {};
  const items = document.getMap<string>(MENU_ITEMS_MAP_NAME);
  for (const [id, label] of menuLocaleLabelsMap(document)) {
    if (!items.has(id))
      throw new Error(`Unknown Menu locale label item: ${id}`);
    requestedLabels[id] = label;
  }
  return {
    name: document.getMap<string>(MENU_ROOT_MAP_NAME).get("name") ?? "",
    items: materializeMenuCanonicalItems(document).map(stripMenuLabels),
    requestedLabels,
  };
}

function replaceMenuStructure(
  document: Y.Doc,
  nextItems: readonly MenuCollaborationItem[],
): void {
  const flattened = flattenMenuItems(nextItems);
  const nextIDs = new Set(flattened.map(({ item }) => item.id));
  if (nextIDs.size !== flattened.length || nextIDs.has(MENU_ROOT_PARENT)) {
    throw new Error("Invalid Menu collaboration item identity");
  }
  const items = document.getMap<string>(MENU_ITEMS_MAP_NAME);
  const parents = document.getMap<string>(MENU_PARENTS_MAP_NAME);
  const orders = document.getMap<number>(MENU_ORDERS_MAP_NAME);
  for (const id of [...items.keys()]) {
    if (!nextIDs.has(id)) {
      items.delete(id);
      parents.delete(id);
      orders.delete(id);
    }
  }
  for (const { item, parent, order } of flattened) {
    const stored = menuItemStructure(item);
    items.set(item.id, JSON.stringify(stored));
    parents.set(item.id, parent);
    orders.set(item.id, order);
  }
}

function flattenMenuItems(items: readonly MenuCollaborationItem[]): Array<{
  item: MenuCollaborationItem;
  parent: string;
  order: number;
}> {
  const output: Array<{
    item: MenuCollaborationItem;
    parent: string;
    order: number;
  }> = [];
  const walk = (
    current: readonly MenuCollaborationItem[],
    parent: string,
    depth: number,
  ) => {
    if (depth > 32) throw new Error("Invalid Menu collaboration tree depth");
    current.forEach((item, order) => {
      if (!item.id) throw new Error("Menu collaboration item ID is required");
      output.push({ item, parent, order });
      walk(item.children ?? [], item.id, depth + 1);
    });
  };
  walk(items, MENU_ROOT_PARENT, 0);
  return output;
}

function stripMenuLabels(item: MenuCollaborationItem): MenuCollaborationItem {
  const shared = menuItemStructure(item);
  const children = item.children;
  return {
    ...shared,
    ...(children?.length ? { children: children.map(stripMenuLabels) } : {}),
  };
}

function menuItemStructure(item: MenuCollaborationItem): StoredMenuItem {
  const stored = { ...item };
  delete stored.label;
  delete stored.children;
  return stored;
}

function menuItemOwnsLocaleLabel(
  item: MenuCollaborationItem,
  locale: string,
): boolean {
  const fixed =
    item.localizationMode === "fixed_locale" ||
    (item.localizationMode === undefined && item.fixedLocale !== undefined);
  return !fixed || item.fixedLocale === locale;
}
