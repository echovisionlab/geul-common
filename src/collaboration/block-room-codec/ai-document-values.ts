import type { JsonValue } from "@bufbuild/protobuf";
import type {
  AIDocumentFieldPathSegment,
  AIDocumentFieldTarget,
  AIDocumentInlineItem,
  AIDocumentValue,
} from "@echovisionlab/geul-proto/secure/ai_pb.ts";
import { fail, jsonObject } from "./internal.ts";

export type CatalogField = {
  readonly type: string;
  readonly default?: unknown;
  readonly ownership?: string;
  readonly values?: readonly (string | number)[];
  readonly items?: CatalogField;
  readonly fields?: Readonly<Record<string, CatalogField>>;
  readonly item_identity?: {
    readonly strategy: "field" | "fixed" | "value";
    readonly field?: string;
    readonly values?: readonly string[];
  };
};

export type JsonPathPart = string | number;
type MutableJsonObject = { [key: string]: JsonValue };

export function operationFail(reason: string): never {
  return fail(`ai_operation:${reason}`);
}

export function requiredHandle(value: string, reason: string): string {
  return value ? value : operationFail(reason);
}

export function blockTarget(target: AIDocumentFieldTarget | undefined): {
  blockId: string;
  field: string;
  path: readonly AIDocumentFieldPathSegment[];
} {
  if (!target) return operationFail("field_target:missing");
  if (target.owner.case !== "blockHandle") {
    return operationFail("field_target:relation_item");
  }
  return {
    blockId: requiredHandle(target.owner.value, "field_target:block"),
    field: requiredHandle(target.fieldHandle, "field_target:field"),
    path: target.path,
  };
}

function scalarText(
  value: AIDocumentValue | undefined,
  reason: string,
): string {
  if (!value || value.value.case !== "text") return operationFail(reason);
  return value.value.value;
}

type InlineStyle = {
  bold?: true;
  italic?: true;
  underline?: true;
  strike?: true;
  code?: true;
  textColor?: string;
  backgroundColor?: string;
};

function styledText(text: string, style: InlineStyle): JsonValue {
  return Object.keys(style).length === 0
    ? { text: { text } }
    : { text: { text, styles: style } };
}

function inlineItems(
  items: readonly AIDocumentInlineItem[],
  style: InlineStyle = {},
  insideLink = false,
): JsonValue[] {
  const result: JsonValue[] = [];
  for (const item of items) {
    switch (item.item.case) {
      case "text":
        result.push(styledText(item.item.value, style));
        break;
      case "mark": {
        const mark = item.item.value;
        const next = { ...style };
        switch (mark.mark) {
          case "bold":
          case "italic":
          case "underline":
          case "strike":
          case "code":
            if (mark.parameter) operationFail(`inline:${mark.mark}:parameter`);
            next[mark.mark] = true;
            break;
          case "textColor":
          case "backgroundColor":
            next[mark.mark] = scalarText(
              mark.parameter,
              `inline:${mark.mark}:parameter`,
            );
            break;
          default:
            operationFail(`inline:mark:${mark.mark || "missing"}`);
        }
        result.push(...inlineItems(mark.children, next, insideLink));
        break;
      }
      case "link": {
        if (insideLink) operationFail("inline:nested_link");
        const content = inlineItems(item.item.value.children, style, true).map(
          (child) => {
            const object = jsonObject(child, "ai_operation:inline:link_child");
            return object.text!;
          },
        );
        result.push({
          link: {
            href: requiredHandle(item.item.value.target, "inline:link_target"),
            content,
          },
        });
        break;
      }
      case "hardBreak":
        if (insideLink || Object.keys(style).length !== 0)
          operationFail("inline:marked_hard_break");
        result.push({ hardBreak: {} });
        break;
      case "math":
        if (insideLink || Object.keys(style).length !== 0)
          operationFail("inline:marked_math");
        result.push({ mathInline: { source: item.item.value } });
        break;
      case "placeholderHandle":
        operationFail("inline:placeholder");
      case undefined:
        operationFail("inline:missing");
    }
  }
  return result;
}

function decimal(value: string): number {
  if (value.trim() !== value || value === "")
    return operationFail("value:number");
  const number = Number(value);
  return Number.isFinite(number) ? number : operationFail("value:number");
}

function upperSnake(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function enumName(
  field: string,
  canonical: string,
  type: string,
  item: boolean,
): string {
  let token = upperSnake(canonical);
  if (type !== "enum_int" && /^[0-9]/.test(token)) token = `X_${token}`;
  return `${upperSnake(field)}${item ? "_ITEM" : ""}_${token}`;
}

export function plainValue(
  value: AIDocumentValue | undefined,
  descriptor?: CatalogField,
  field = "value",
  item = false,
): JsonValue {
  if (!value) return operationFail("value:missing");
  switch (value.value.case) {
    case "text":
      if (descriptor?.type === "enum" || descriptor?.type === "enum_int") {
        const canonical = value.value.value;
        if (
          descriptor.values &&
          !descriptor.values.some(
            (candidate) => String(candidate) === canonical,
          )
        ) {
          return operationFail(`value:enum:${field}`);
        }
        return enumName(field, canonical, descriptor.type, item);
      }
      return value.value.value;
    case "boolean":
      return value.value.value;
    case "number":
      return decimal(value.value.value);
    case "inline":
      return inlineItems(value.value.value.items);
    case "list":
      return value.value.value.items.map((item) =>
        plainValue(item.value, descriptor?.items, field, true),
      );
    case "object": {
      const result: MutableJsonObject = {};
      for (const item of value.value.value.fields) {
        const child = requiredHandle(item.fieldHandle, "value:object_field");
        if (child in result) operationFail(`value:duplicate_field:${child}`);
        result[child] = plainValue(
          item.value,
          descriptor?.fields?.[child],
          child,
        );
      }
      return result;
    }
    case undefined:
      return operationFail("value:missing");
  }
}

function canonicalIdentity(
  descriptor: CatalogField,
  field: string,
  handle: string,
  item: boolean,
): JsonValue {
  if (descriptor.type === "enum" || descriptor.type === "enum_int") {
    if (
      descriptor.values &&
      !descriptor.values.some((value) => String(value) === handle)
    ) {
      return operationFail(`field_path:item:${handle}`);
    }
    return enumName(field, handle, descriptor.type, item);
  }
  if (descriptor.type === "integer" || descriptor.type === "number")
    return decimal(handle);
  return handle;
}

function itemIndex(
  array: readonly JsonValue[],
  handle: string,
  descriptor: CatalogField | undefined,
  field: string,
): number {
  const identity = descriptor?.item_identity;
  if (!descriptor?.items || !identity)
    return operationFail("field_path:item_identity");
  if (identity.strategy === "fixed") {
    const index = identity.values?.indexOf(handle) ?? -1;
    return index >= 0 && index < array.length
      ? index
      : operationFail(`field_path:item:${handle}`);
  }
  if (identity.strategy === "value") {
    const expected = canonicalIdentity(descriptor.items, field, handle, true);
    const index = array.findIndex((value) => value === expected);
    return index >= 0 ? index : operationFail(`field_path:item:${handle}`);
  }
  const identityField = requiredHandle(
    identity.field ?? "",
    "field_path:item_identity_field",
  );
  const fieldDescriptor =
    descriptor.items.fields?.[identityField] ??
    operationFail("field_path:item_identity_descriptor");
  const expected = canonicalIdentity(
    fieldDescriptor,
    identityField,
    handle,
    false,
  );
  const index = array.findIndex((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return false;
    return (value as MutableJsonObject)[identityField] === expected;
  });
  return index >= 0 ? index : operationFail(`field_path:item:${handle}`);
}

export function resolvedPath(
  root: JsonValue,
  prefix: readonly JsonPathPart[],
  segments: readonly AIDocumentFieldPathSegment[],
  createMissing: boolean,
  descriptor?: CatalogField,
  field = "value",
): JsonPathPart[] {
  const path = [...prefix];
  let current: JsonValue = root;
  for (const part of path) {
    if (typeof part === "string") {
      const object = jsonObject(current, `ai_operation:field_path:${part}`);
      const child = object[part];
      current = child === undefined && createMissing ? {} : child!;
    } else {
      if (!Array.isArray(current) || part < 0 || part >= current.length)
        operationFail("field_path:index");
      current = current[part]!;
    }
  }
  let currentDescriptor = descriptor;
  for (const segment of segments) {
    if (segment.selector.case === "fieldHandle") {
      const key = requiredHandle(
        segment.selector.value,
        "field_path:field_handle",
      );
      const object = jsonObject(current, `ai_operation:field_path:${key}`);
      path.push(key);
      const child = object[key];
      current = child === undefined && createMissing ? {} : child!;
      currentDescriptor = currentDescriptor?.fields?.[key];
      continue;
    }
    if (segment.selector.case === "itemHandle") {
      if (!Array.isArray(current)) operationFail("field_path:not_array");
      const index = itemIndex(
        current,
        requiredHandle(segment.selector.value, "field_path:item_handle"),
        currentDescriptor,
        field,
      );
      path.push(index);
      current = current[index]!;
      currentDescriptor = currentDescriptor?.items;
      continue;
    }
    operationFail("field_path:selector");
  }
  return path;
}

export function resolvedCatalogField(
  descriptor: CatalogField | undefined,
  segments: readonly AIDocumentFieldPathSegment[],
): CatalogField | undefined {
  let current = descriptor;
  for (const segment of segments) {
    if (!current) return undefined;
    if (segment.selector.case === "fieldHandle") {
      const field = requiredHandle(
        segment.selector.value,
        "field_path:field_handle",
      );
      current = current.fields?.[field] ?? operationFail(`field:${field}`);
      continue;
    }
    if (segment.selector.case === "itemHandle") {
      current = current.items ?? operationFail("field_path:item_descriptor");
      continue;
    }
    operationFail("field_path:selector");
  }
  return current;
}

export function yPath(path: readonly JsonPathPart[]): string {
  if (path.length === 0) return operationFail("field_path:empty");
  return path
    .map((part, index) =>
      typeof part === "number" ? `[${part}]` : index === 0 ? part : `.${part}`,
    )
    .join("")
    .replace(/\.\[/g, "[");
}
