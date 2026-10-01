export type FormSchemaPatchScope = "source" | "target";

export type FormSchemaPatchErrorReason =
  | "invalid_schema"
  | "schema_identity_changed"
  | "target_topology_changed"
  | "schema_identity_collision";

export class FormSchemaPatchError extends Error {
  constructor(readonly reason: FormSchemaPatchErrorReason) {
    super(`form_schema_patch:${reason}`);
    this.name = "FormSchemaPatchError";
  }
}

type NodeKind = "step" | "field" | "option" | "validator";

interface SchemaNode {
  kind: NodeKind;
  id: string;
  parent: string;
  order: number;
  properties: Record<string, unknown>;
  validationProperties?: Record<string, unknown>;
  childrenPresent?: boolean;
  validationPresent?: boolean;
  validatorsPresent?: boolean;
}

interface FormSchemaIndex {
  id: string;
  properties: Record<string, unknown>;
  nodes: Map<string, SchemaNode>;
}

const ROOT_PARENT = "form-root";
const TARGET_LOCALIZED_PROPERTIES: Readonly<
  Record<NodeKind, ReadonlySet<string>>
> = {
  step: new Set(["title", "description"]),
  field: new Set(["label", "description", "placeholder", "checkboxLabel"]),
  option: new Set(["label"]),
  validator: new Set(["message"]),
};

function fail(): never {
  throw new FormSchemaPatchError("invalid_schema");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function object(value: unknown): Record<string, unknown> {
  return isObject(value) ? value : fail();
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : fail();
}

function requiredId(value: Record<string, unknown>): string {
  return typeof value.id === "string" && value.id.length > 0
    ? value.id
    : fail();
}

function nodeKey(kind: NodeKind, id: string): string {
  return `${kind}\u0000${id}`;
}

function cloneJson(value: unknown): unknown {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return fail();
  return JSON.parse(serialized) as unknown;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (isObject(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function copyProperties(
  value: Record<string, unknown>,
  excluded: ReadonlySet<string>,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (excluded.has(key) || entry === undefined) continue;
    properties[key] = cloneJson(entry);
  }
  return properties;
}

function addNode(index: FormSchemaIndex, node: SchemaNode): void {
  const key = nodeKey(node.kind, node.id);
  if ([...index.nodes.values()].some((existing) => existing.id === node.id))
    fail();
  index.nodes.set(key, node);
}

function indexFormSchema(value: unknown): FormSchemaIndex {
  const schema = object(value);
  const id = requiredId(schema);
  if (!Array.isArray(schema.steps)) fail();
  const index: FormSchemaIndex = {
    id,
    properties: copyProperties(schema, new Set(["steps"])),
    nodes: new Map(),
  };

  array(schema.steps).forEach((rawStep, stepOrder) => {
    const step = object(rawStep);
    const stepId = requiredId(step);
    addNode(index, {
      kind: "step",
      id: stepId,
      parent: ROOT_PARENT,
      order: stepOrder,
      properties: copyProperties(step, new Set(["fields"])),
      ...(Object.hasOwn(step, "fields") && step.fields !== undefined
        ? { childrenPresent: true }
        : {}),
    });

    if (step.fields !== undefined) {
      array(step.fields).forEach((rawField, fieldOrder) => {
        const field = object(rawField);
        const fieldId = requiredId(field);
        const validation =
          field.validation === undefined ? undefined : object(field.validation);
        const validatorsPresent =
          validation !== undefined && Object.hasOwn(validation, "validators");
        const validationProperties = validation
          ? copyProperties(validation, new Set(["validators"]))
          : undefined;
        addNode(index, {
          kind: "field",
          id: fieldId,
          parent: nodeKey("step", stepId),
          order: fieldOrder,
          properties: copyProperties(field, new Set(["options", "validation"])),
          ...(validationProperties ? { validationProperties } : {}),
          ...(Object.hasOwn(field, "options") && field.options !== undefined
            ? { childrenPresent: true }
            : {}),
          ...(validation !== undefined ? { validationPresent: true } : {}),
          ...(validatorsPresent ? { validatorsPresent: true } : {}),
        });

        if (field.options !== undefined) {
          array(field.options).forEach((rawOption, optionOrder) => {
            const option = object(rawOption);
            const optionId = requiredId(option);
            addNode(index, {
              kind: "option",
              id: optionId,
              parent: nodeKey("field", fieldId),
              order: optionOrder,
              properties: copyProperties(option, new Set()),
            });
          });
        }

        if (validatorsPresent) {
          array(validation!.validators).forEach(
            (rawValidator, validatorOrder) => {
              const validator = object(rawValidator);
              const validatorId = requiredId(validator);
              addNode(index, {
                kind: "validator",
                id: validatorId,
                parent: nodeKey("field", fieldId),
                order: validatorOrder,
                properties: copyProperties(validator, new Set()),
              });
            },
          );
        }
      });
    }
  });
  return index;
}

function targetTopology(index: FormSchemaIndex): unknown {
  const nodes = [...index.nodes.values()].map((node) => {
    const properties = { ...node.properties };
    for (const key of TARGET_LOCALIZED_PROPERTIES[node.kind])
      delete properties[key];
    return {
      kind: node.kind,
      id: node.id,
      parent: node.parent,
      order: node.order,
      properties,
      validationProperties: node.validationProperties,
      childrenPresent: node.childrenPresent,
      validationPresent: node.validationPresent,
      validatorsPresent: node.validatorsPresent,
    };
  });
  return { id: index.id, properties: index.properties, nodes };
}

function sameNode(left: SchemaNode, right: SchemaNode): boolean {
  return (
    left.parent === right.parent &&
    left.order === right.order &&
    stableJson(left.properties) === stableJson(right.properties) &&
    stableJson(left.validationProperties) ===
      stableJson(right.validationProperties) &&
    left.childrenPresent === right.childrenPresent &&
    left.validationPresent === right.validationPresent &&
    left.validatorsPresent === right.validatorsPresent
  );
}

function orderedChildren(
  nodes: Map<string, SchemaNode>,
  parent: string,
  kind: NodeKind,
): SchemaNode[] {
  return [...nodes.values()]
    .filter((node) => node.parent === parent && node.kind === kind)
    .sort(
      (left, right) =>
        left.order - right.order || left.id.localeCompare(right.id),
    );
}

function materialize(index: FormSchemaIndex): Record<string, unknown> {
  const buildField = (node: SchemaNode): Record<string, unknown> => {
    const field: Record<string, unknown> = { ...node.properties, id: node.id };
    if (node.childrenPresent) {
      field.options = orderedChildren(
        index.nodes,
        nodeKey("field", node.id),
        "option",
      ).map((option) => ({ ...option.properties, id: option.id }));
    }
    if (node.validationPresent) {
      const validationProperties = { ...node.validationProperties };
      if (node.validatorsPresent) {
        validationProperties.validators = orderedChildren(
          index.nodes,
          nodeKey("field", node.id),
          "validator",
        ).map((validator) => ({ ...validator.properties, id: validator.id }));
      }
      field.validation = validationProperties;
    }
    return field;
  };
  const buildStep = (node: SchemaNode): Record<string, unknown> => {
    const step: Record<string, unknown> = { ...node.properties, id: node.id };
    if (node.childrenPresent) {
      step.fields = orderedChildren(
        index.nodes,
        nodeKey("step", node.id),
        "field",
      ).map(buildField);
    }
    return step;
  };

  // The index is parent-first and only receives validated additions and moves.
  const result: Record<string, unknown> = { ...index.properties, id: index.id };
  result.steps = orderedChildren(index.nodes, ROOT_PARENT, "step").map(
    buildStep,
  );
  return result;
}

/**
 * Applies only the stable-ID property and structural changes between previous
 * and next to the latest server schema. Missing live IDs are never restored
 * by unchanged stale snapshot data. An explicit source parent deletion
 * cascades over its current descendants; target edits are restricted to
 * catalogued localized properties and cannot change topology.
 */
export function applyFormSchemaPatch(
  currentSchema: unknown,
  previousSchema: unknown,
  nextSchema: unknown,
  scope: FormSchemaPatchScope,
): unknown {
  const current = indexFormSchema(currentSchema);
  const previous = indexFormSchema(previousSchema);
  const next = indexFormSchema(nextSchema);
  if (current.id !== previous.id || previous.id !== next.id) {
    throw new FormSchemaPatchError("schema_identity_changed");
  }
  if (
    scope === "target" &&
    stableJson(targetTopology(previous)) !== stableJson(targetTopology(next))
  ) {
    throw new FormSchemaPatchError("target_topology_changed");
  }

  const result: FormSchemaIndex = {
    id: current.id,
    properties: { ...current.properties },
    nodes: new Map(
      [...current.nodes].map(([key, node]) => [key, structuredClone(node)]),
    ),
  };

  for (const key of new Set([
    ...Object.keys(previous.properties),
    ...Object.keys(next.properties),
  ])) {
    if (key === "id") continue;
    const beforeHas = Object.hasOwn(previous.properties, key);
    const afterHas = Object.hasOwn(next.properties, key);
    if (
      beforeHas === afterHas &&
      stableJson(previous.properties[key]) === stableJson(next.properties[key])
    ) {
      continue;
    }
    if (afterHas)
      result.properties[key] = structuredClone(next.properties[key]);
    else delete result.properties[key];
  }

  const added = new Set<string>();
  const skippedAdditions = new Set<string>();
  for (const [key, node] of next.nodes) {
    if (previous.nodes.has(key)) continue;
    if (result.nodes.has(key)) {
      const live = result.nodes.get(key)!;
      if (!sameNode(live, node)) {
        throw new FormSchemaPatchError("schema_identity_collision");
      }
      continue;
    }
    // Schemas are indexed parent-first. A missing parent here is an observed
    // peer deletion or a new parent already skipped beneath one.
    if (
      node.parent !== ROOT_PARENT &&
      (skippedAdditions.has(node.parent) ||
        (previous.nodes.has(node.parent) && !current.nodes.has(node.parent)))
    ) {
      skippedAdditions.add(key);
      continue;
    }
    result.nodes.set(key, structuredClone(node));
    added.add(key);
  }

  for (const [key, after] of next.nodes) {
    const before = previous.nodes.get(key);
    if (!before || added.has(key)) continue;
    const live = result.nodes.get(key);
    if (!live) continue;

    for (const property of new Set([
      ...Object.keys(before.properties),
      ...Object.keys(after.properties),
    ])) {
      const beforeHas = Object.hasOwn(before.properties, property);
      const afterHas = Object.hasOwn(after.properties, property);
      if (
        beforeHas === afterHas &&
        stableJson(before.properties[property]) ===
          stableJson(after.properties[property])
      ) {
        continue;
      }
      if (afterHas)
        live.properties[property] = structuredClone(after.properties[property]);
      else delete live.properties[property];
    }

    const beforeValidation = before.validationProperties ?? {};
    const afterValidation = after.validationProperties ?? {};
    for (const property of new Set([
      ...Object.keys(beforeValidation),
      ...Object.keys(afterValidation),
    ])) {
      const beforeHas = Object.hasOwn(beforeValidation, property);
      const afterHas = Object.hasOwn(afterValidation, property);
      if (
        beforeHas === afterHas &&
        stableJson(beforeValidation[property]) ===
          stableJson(afterValidation[property])
      ) {
        continue;
      }
      const updated = { ...(live.validationProperties ?? {}) };
      if (afterHas)
        updated[property] = structuredClone(afterValidation[property]);
      else delete updated[property];
      live.validationProperties = updated;
    }

    if (
      before.parent !== after.parent &&
      (after.parent === ROOT_PARENT || result.nodes.has(after.parent))
    ) {
      live.parent = after.parent;
      live.order = after.order;
    } else if (
      before.parent === after.parent &&
      before.order !== after.order &&
      live.parent === before.parent
    ) {
      live.order = after.order;
    }
    if (before.childrenPresent !== after.childrenPresent) {
      live.childrenPresent = after.childrenPresent;
    }
    if (before.validationPresent !== after.validationPresent) {
      live.validationPresent = after.validationPresent;
    }
    if (before.validatorsPresent !== after.validatorsPresent) {
      live.validatorsPresent = after.validatorsPresent;
    }
  }

  const deleted = new Set(
    [...previous.nodes.keys()].filter((key) => !next.nodes.has(key)),
  );
  let addedDescendant = true;
  while (addedDescendant) {
    addedDescendant = false;
    for (const [key, node] of result.nodes) {
      if (deleted.has(node.parent) && !deleted.has(key)) {
        deleted.add(key);
        addedDescendant = true;
      }
    }
  }
  for (const key of deleted) result.nodes.delete(key);

  return materialize(result);
}
