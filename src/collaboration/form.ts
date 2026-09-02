import type { AIDocumentFieldTarget } from "@echovisionlab/geul-proto/secure/ai_pb.ts";
import {
  formFieldCheckboxLabelTarget,
  formFieldDescriptionTarget,
  formFieldLabelTarget,
  formFieldPlaceholderTarget,
  formOptionLabelTarget,
  formRootTitleTarget,
  formStepDescriptionTarget,
  formStepTitleTarget,
  formValidatorMessageTarget,
} from "@echovisionlab/geul-proto/intra/form_locale_catalog.ts";
import * as Y from "yjs";
import { z } from "zod";

export const FORM_FIELDS_MAP_NAME = "form-fields";
export const FORM_LOCALE_PRESENCE_MAP_NAME = "form-locale-presence";
export const FORM_CANONICAL_CONTEXT_MAP_NAME = "form-canonical-context";

export const formCollabFieldsSchema = z
  .object({
    title: z.string().optional(),
    schema: z.unknown().optional(),
  })
  .strict();

export const FORM_JSON_KEYS: ReadonlySet<
  keyof z.infer<typeof formCollabFieldsSchema>
> = new Set(["schema"]);

export type FormCollabFields = z.infer<typeof formCollabFieldsSchema>;
export type FormFieldValue = unknown;

export interface FormCanonicalRoomInput {
  sourceLocale: string;
  locale: string;
  source: FormCollabFields;
  requested: FormCollabFields;
  requestedExists: boolean;
  presentLocaleValues: readonly AIDocumentFieldTarget[];
}

export interface FormCanonicalRoomOutput {
  fields: FormCollabFields;
  presentLocaleValues: AIDocumentFieldTarget[];
}

type JsonObject = Record<string, unknown>;
type FormObjectKind = "step" | "field" | "option" | "validator";

interface FormLocaleSlot {
  field: string;
  key: string;
  kind: FormObjectKind;
  object: JsonObject;
  stableId: string;
  target: AIDocumentFieldTarget;
}

interface FormObjectIndexes {
  step: Map<string, JsonObject>;
  field: Map<string, JsonObject>;
  option: Map<string, JsonObject>;
  validator: Map<string, JsonObject>;
}

function fail(reason: string): never {
  throw new Error(`form_collaboration:${reason}`);
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function object(value: unknown, reason: string): JsonObject {
  return isObject(value) ? value : fail(reason);
}

function array(value: unknown, reason: string): unknown[] {
  return Array.isArray(value) ? value : fail(reason);
}

function string(value: unknown, reason: string): string {
  return typeof value === "string" ? value : fail(reason);
}

function own(objectValue: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(objectValue, key);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function targetKey(target: AIDocumentFieldTarget): string {
  if (
    target.owner.case !== "blockHandle" ||
    target.owner.value === "" ||
    target.fieldHandle === "" ||
    target.path.length !== 0
  ) {
    return fail("locale_presence_target");
  }
  return `${target.owner.value}\u0000${target.fieldHandle}`;
}

function canonicalTargets(
  values: readonly AIDocumentFieldTarget[],
): AIDocumentFieldTarget[] {
  const targets = new Map<string, AIDocumentFieldTarget>();
  for (const value of values) {
    const key = targetKey(value);
    if (targets.has(key)) return fail("locale_presence_duplicate");
    targets.set(key, value);
  }
  return [...targets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, target]) => target);
}

function schemaObject(value: unknown): JsonObject {
  const schema = object(value, "schema");
  string(schema.id, "schema_id");
  array(schema.steps, "schema_steps");
  return schema;
}

function stableId(value: JsonObject, reason: string): string {
  return string(value.id, reason);
}

function addIndex(
  index: Map<string, JsonObject>,
  value: JsonObject,
  reason: string,
): string {
  const id = stableId(value, reason);
  if (index.has(id)) return fail(`${reason}_duplicate`);
  index.set(id, value);
  return id;
}

function formObjectIndexes(schemaValue: JsonObject): FormObjectIndexes {
  const indexes: FormObjectIndexes = {
    step: new Map(),
    field: new Map(),
    option: new Map(),
    validator: new Map(),
  };
  for (const rawStep of array(schemaValue.steps, "schema_steps")) {
    const step = object(rawStep, "step");
    addIndex(indexes.step, step, "step_id");
    for (const rawField of Array.isArray(step.fields) ? step.fields : []) {
      const field = object(rawField, "field");
      addIndex(indexes.field, field, "field_id");
      for (const rawOption of Array.isArray(field.options)
        ? field.options
        : []) {
        addIndex(indexes.option, object(rawOption, "option"), "option_id");
      }
      const validation = isObject(field.validation) ? field.validation : {};
      for (const rawValidator of Array.isArray(validation.validators)
        ? validation.validators
        : []) {
        addIndex(
          indexes.validator,
          object(rawValidator, "validator"),
          "validator_id",
        );
      }
    }
  }
  return indexes;
}

function visitLocaleSlots(
  schemaValue: JsonObject,
  visit: (slot: FormLocaleSlot) => void,
): void {
  const indexes = formObjectIndexes(schemaValue);
  for (const [stepId, step] of indexes.step) {
    for (const [field, target] of [
      ["title", formStepTitleTarget(stepId)],
      ["description", formStepDescriptionTarget(stepId)],
    ] as const) {
      visit({
        field,
        key: targetKey(target),
        kind: "step",
        object: step,
        stableId: stepId,
        target,
      });
    }
  }
  for (const [fieldId, fieldValue] of indexes.field) {
    for (const [field, target] of [
      ["label", formFieldLabelTarget(fieldId)],
      ["description", formFieldDescriptionTarget(fieldId)],
      ["placeholder", formFieldPlaceholderTarget(fieldId)],
      ["checkboxLabel", formFieldCheckboxLabelTarget(fieldId)],
    ] as const) {
      visit({
        field,
        key: targetKey(target),
        kind: "field",
        object: fieldValue,
        stableId: fieldId,
        target,
      });
    }
  }
  for (const [optionId, option] of indexes.option) {
    const target = formOptionLabelTarget(optionId);
    visit({
      field: "label",
      key: targetKey(target),
      kind: "option",
      object: option,
      stableId: optionId,
      target,
    });
  }
  for (const [validatorId, validator] of indexes.validator) {
    const target = formValidatorMessageTarget(validatorId);
    visit({
      field: "message",
      key: targetKey(target),
      kind: "validator",
      object: validator,
      stableId: validatorId,
      target,
    });
  }
}

function localeTargets(fields: FormCollabFields): AIDocumentFieldTarget[] {
  const values: AIDocumentFieldTarget[] = [];
  if (fields.title !== undefined) values.push(formRootTitleTarget());
  if (fields.schema !== undefined) {
    visitLocaleSlots(schemaObject(fields.schema), (slot) => {
      if (own(slot.object, slot.field)) {
        string(slot.object[slot.field], `${slot.kind}_${slot.field}`);
        values.push(slot.target);
      }
    });
  }
  return canonicalTargets(values);
}

function stripLocaleFields(schemaValue: JsonObject): JsonObject {
  const stripped = clone(schemaValue);
  visitLocaleSlots(stripped, (slot) => {
    delete slot.object[slot.field];
  });
  return stripped;
}

function requestedIndexes(
  source: JsonObject,
  requested: FormCollabFields,
): FormObjectIndexes {
  if (requested.schema === undefined) {
    return formObjectIndexes(stripLocaleFields(source));
  }
  const requestedSchema = schemaObject(requested.schema);
  if (
    stableJson(stripLocaleFields(source)) !==
    stableJson(stripLocaleFields(requestedSchema))
  ) {
    return fail("target_topology");
  }
  return formObjectIndexes(requestedSchema);
}

function indexedObject(
  indexes: FormObjectIndexes,
  slot: FormLocaleSlot,
): JsonObject {
  return indexes[slot.kind].get(slot.stableId) ?? fail("target_identity");
}

function assertExactPresence(
  requested: FormCollabFields,
  presentLocaleValues: readonly AIDocumentFieldTarget[],
): AIDocumentFieldTarget[] {
  const canonical = canonicalTargets(presentLocaleValues);
  const derived = localeTargets(requested);
  if (
    canonical.map(targetKey).join("\n") !== derived.map(targetKey).join("\n")
  ) {
    return fail("locale_presence_mismatch");
  }
  return canonical;
}

function materializedFields(input: FormCanonicalRoomInput): FormCollabFields {
  const sourceSchema = schemaObject(input.source.schema);
  if (input.locale === input.sourceLocale) {
    if (!input.requestedExists) return fail("source_missing");
    assertExactPresence(input.source, input.presentLocaleValues);
    return clone(input.source);
  }
  if (!input.requestedExists) return fail("target_missing");
  const present = new Set(
    assertExactPresence(input.requested, input.presentLocaleValues).map(
      targetKey,
    ),
  );
  const materialized = clone(sourceSchema);
  const requested = requestedIndexes(sourceSchema, input.requested);
  visitLocaleSlots(materialized, (slot) => {
    if (!present.has(slot.key)) return;
    const requestedObject = indexedObject(requested, slot);
    if (!own(requestedObject, slot.field)) return fail("target_value_missing");
    slot.object[slot.field] = string(
      requestedObject[slot.field],
      "target_value",
    );
  });
  return {
    ...(present.has(targetKey(formRootTitleTarget()))
      ? { title: input.requested.title ?? fail("target_title_missing") }
      : input.source.title === undefined
        ? {}
        : { title: input.source.title }),
    schema: materialized,
  };
}

function presenceMap(document: Y.Doc): Y.Map<boolean> {
  return document.getMap<boolean>(FORM_LOCALE_PRESENCE_MAP_NAME);
}

function contextMap(document: Y.Doc): Y.Map<string> {
  return document.getMap<string>(FORM_CANONICAL_CONTEXT_MAP_NAME);
}

function setPresence(
  document: Y.Doc,
  values: readonly AIDocumentFieldTarget[],
): void {
  const map = presenceMap(document);
  for (const key of [...map.keys()]) map.delete(key);
  for (const target of canonicalTargets(values))
    map.set(targetKey(target), true);
}

function readPresenceKeys(document: Y.Doc): Set<string> {
  const keys = new Set<string>();
  for (const [key, value] of presenceMap(document).entries()) {
    if (value !== true) fail("locale_presence_value");
    keys.add(key);
  }
  return keys;
}

function targetByKey(
  source: FormCollabFields,
): Map<string, AIDocumentFieldTarget> {
  const values = new Map<string, AIDocumentFieldTarget>();
  values.set(targetKey(formRootTitleTarget()), formRootTitleTarget());
  visitLocaleSlots(schemaObject(source.schema), (slot) => {
    values.set(slot.key, slot.target);
  });
  return values;
}

export function hydrateFormCanonicalRoom(input: FormCanonicalRoomInput): Y.Doc {
  if (input.sourceLocale === "" || input.locale === "") {
    return fail("locale");
  }
  const fields = materializedFields(input);
  const document = new Y.Doc();
  document.transact(() => {
    const map = document.getMap<unknown>(FORM_FIELDS_MAP_NAME);
    if (fields.title !== undefined) map.set("title", fields.title);
    if (fields.schema !== undefined)
      map.set("schema", JSON.stringify(fields.schema));
    setPresence(document, input.presentLocaleValues);
    const context = contextMap(document);
    context.set("sourceLocale", input.sourceLocale);
    context.set("locale", input.locale);
  });
  return document;
}

export function extractFormCanonicalRoom(
  document: Y.Doc,
  source: FormCollabFields,
): FormCanonicalRoomOutput {
  const sourceLocale = contextMap(document).get("sourceLocale");
  const locale = contextMap(document).get("locale");
  if (!sourceLocale || !locale) return fail("context");
  const materialized = extractFormFields(
    document.getMap<FormFieldValue>(FORM_FIELDS_MAP_NAME),
  );
  schemaObject(materialized.schema);
  if (locale === sourceLocale) {
    return {
      fields: materialized,
      presentLocaleValues: localeTargets(materialized),
    };
  }

  const sourceSchema = schemaObject(source.schema);
  const materializedSchema = schemaObject(materialized.schema);
  if (
    stableJson(stripLocaleFields(sourceSchema)) !==
    stableJson(stripLocaleFields(materializedSchema))
  ) {
    return fail("target_topology");
  }
  const allowed = targetByKey(source);
  const present = readPresenceKeys(document);
  for (const key of present) {
    if (!allowed.has(key)) return fail("locale_presence_unknown");
  }
  const sparseSchema = stripLocaleFields(sourceSchema);
  const materializedIndexes = formObjectIndexes(materializedSchema);
  visitLocaleSlots(sparseSchema, (slot) => {
    if (!present.has(slot.key)) return;
    const sourceObject = indexedObject(materializedIndexes, slot);
    if (!own(sourceObject, slot.field)) return fail("target_value_missing");
    slot.object[slot.field] = string(sourceObject[slot.field], "target_value");
  });
  const presentLocaleValues = [...present]
    .sort((left, right) => left.localeCompare(right))
    .map((key) => allowed.get(key) ?? fail("locale_presence_unknown"));
  return {
    fields: {
      ...(present.has(targetKey(formRootTitleTarget()))
        ? { title: materialized.title ?? fail("target_title_missing") }
        : {}),
      schema: sparseSchema,
    },
    presentLocaleValues,
  };
}

function localeValuesByKey(fields: FormCollabFields): Map<string, string> {
  const values = new Map<string, string>();
  if (fields.title !== undefined)
    values.set(targetKey(formRootTitleTarget()), fields.title);
  if (fields.schema !== undefined) {
    visitLocaleSlots(schemaObject(fields.schema), (slot) => {
      if (own(slot.object, slot.field)) {
        values.set(slot.key, string(slot.object[slot.field], "locale_value"));
      }
    });
  }
  return values;
}

export function recordFormLocaleFieldChange(
  document: Y.Doc,
  previous: FormCollabFields,
  next: FormCollabFields,
): void {
  const context = contextMap(document);
  if (context.get("locale") === context.get("sourceLocale")) return;
  const before = localeValuesByKey(previous);
  const after = localeValuesByKey(next);
  const presence = presenceMap(document);
  const keys = new Set([...before.keys(), ...after.keys()]);
  document.transact(() => {
    for (const key of keys) {
      if (before.get(key) === after.get(key)) continue;
      if (after.has(key)) presence.set(key, true);
      else presence.delete(key);
    }
  });
}

export function extractFormFields(fieldsMap: {
  get(key: string): FormFieldValue | undefined;
}): FormCollabFields {
  const raw: Record<string, unknown> = {};

  for (const key of Object.keys(formCollabFieldsSchema.shape)) {
    let value = fieldsMap.get(key);

    if (
      FORM_JSON_KEYS.has(key as keyof FormCollabFields) &&
      typeof value === "string"
    ) {
      try {
        value = JSON.parse(value) as FormFieldValue;
      } catch {
        throw new Error(`Failed to parse JSON for form field "${key}"`);
      }
    }

    if (value !== undefined) {
      raw[key] = value;
    }
  }

  return formCollabFieldsSchema.parse(raw);
}
