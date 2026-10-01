import { describe, expect, it } from "vitest";
import { applyFormSchemaPatch } from "./form-schema-delta.ts";

function schema(
  overrides: Partial<{
    firstLabel: string;
    secondLabel: string;
    firstMessage: string;
    includeSecond: boolean;
    includeSecondOption: boolean;
    firstType: string;
    addField: boolean;
  }> = {},
) {
  const fields: Record<string, unknown>[] = [
    {
      id: "field-a",
      key: "a",
      type: overrides.firstType ?? "text",
      label: overrides.firstLabel ?? "A",
      validation: {
        validators: [
          {
            id: "validator-a",
            name: "Required",
            predicate: "required",
            ...(overrides.firstMessage === undefined
              ? {}
              : { message: overrides.firstMessage }),
          },
        ],
      },
    },
  ];
  if (overrides.includeSecond !== false) {
    fields.push({
      id: "field-b",
      key: "b",
      type: "select",
      label: overrides.secondLabel ?? "B",
      validation: { validators: [] },
      options:
        overrides.includeSecondOption === false
          ? []
          : [{ id: "option-b1", value: "one", label: "One" }],
    });
  }
  if (overrides.addField) {
    fields.push({ id: "field-c", key: "c", type: "text", label: "C" });
  }
  return {
    id: "form-schema",
    steps: [{ id: "step-a", title: "First", fields }],
  };
}

type TestFormSchema = ReturnType<typeof schema> & Record<string, unknown>;

function patchError(
  current: unknown,
  previous: unknown,
  next: unknown,
  scope: "source" | "target" = "source",
) {
  try {
    applyFormSchemaPatch(current, previous, next, scope);
  } catch (error) {
    return error;
  }
  throw new Error("expected patch to be rejected");
}

describe("applyFormSchemaPatch", () => {
  it("merges stale edits to different fields against the latest canonical schema", () => {
    const previous = schema();
    const peerCommit = schema({ secondLabel: "B from peer" });
    const localNext = schema({ firstLabel: "A from local" });

    expect(
      applyFormSchemaPatch(peerCommit, previous, localNext, "source"),
    ).toEqual(
      schema({ firstLabel: "A from local", secondLabel: "B from peer" }),
    );
  });

  it("applies same-property edits in server commit order", () => {
    const previous = schema();
    const firstCommit = schema({ firstLabel: "first" });
    const laterCommit = schema({ firstLabel: "later" });
    const afterFirst = applyFormSchemaPatch(
      previous,
      previous,
      firstCommit,
      "source",
    );

    expect(
      applyFormSchemaPatch(afterFirst, previous, laterCommit, "source"),
    ).toEqual(laterCommit);
  });

  it("does not resurrect an untouched node deleted by a peer", () => {
    const previous = schema();
    const peerDelete = schema({ includeSecond: false });
    const localNext = schema({ firstLabel: "A translated" });

    expect(
      applyFormSchemaPatch(peerDelete, previous, localNext, "source"),
    ).toEqual({
      id: "form-schema",
      steps: [
        {
          id: "step-a",
          title: "First",
          fields: [
            {
              id: "field-a",
              key: "a",
              type: "text",
              label: "A translated",
              validation: {
                validators: [
                  {
                    id: "validator-a",
                    name: "Required",
                    predicate: "required",
                  },
                ],
              },
            },
          ],
        },
      ],
    });
  });

  it("skips additions beneath a peer-deleted parent and keeps independent edits", () => {
    const previous = schema();
    previous.steps.push({
      id: "step-b",
      title: "Second",
      fields: [
        {
          id: "field-z",
          key: "z",
          type: "text",
          label: "Z",
          description: "before",
        },
      ],
    });

    const current = structuredClone(previous);
    current.steps = current.steps.filter((step) => step.id !== "step-a");
    current.steps[0]!.fields[0]!.label = "Peer label";

    const next = structuredClone(previous);
    next.steps[0]!.fields.push({
      id: "field-new",
      key: "new",
      type: "select",
      label: "New",
      options: [{ id: "option-new", value: "one", label: "One" }],
      validation: {
        validators: [
          { id: "validator-new", name: "Required", predicate: "required" },
        ],
      },
    });
    next.steps[1]!.fields[0]!.description = "local description";

    expect(applyFormSchemaPatch(current, previous, next, "source")).toEqual({
      id: "form-schema",
      steps: [
        {
          id: "step-b",
          title: "Second",
          fields: [
            {
              id: "field-z",
              key: "z",
              type: "text",
              label: "Peer label",
              description: "local description",
            },
          ],
        },
      ],
    });
  });

  it("permits target localized leaves but rejects target structural changes", () => {
    const previous = schema();
    const changedLabel = schema({ firstLabel: "A 번역" });
    expect(
      applyFormSchemaPatch(previous, previous, changedLabel, "target"),
    ).toEqual(changedLabel);

    expect(
      patchError(previous, previous, schema({ firstType: "email" }), "target"),
    ).toMatchObject({
      reason: "target_topology_changed",
    });
    expect(
      patchError(previous, previous, schema({ addField: true }), "target"),
    ).toMatchObject({
      reason: "target_topology_changed",
    });
  });

  it("cascades an explicit parent deletion over an unseen live child", () => {
    const previous = schema();
    const peerAddedOption = schema();
    (
      peerAddedOption.steps[0]!.fields[1] as { options: unknown[] }
    ).options.push({
      id: "option-peer",
      value: "peer",
      label: "Peer",
    });
    const localDeleteParent = schema({ includeSecond: false });

    expect(
      applyFormSchemaPatch(
        peerAddedOption,
        previous,
        localDeleteParent,
        "source",
      ),
    ).toEqual(localDeleteParent);
  });

  it("rejects malformed schemas and identity changes while skipping adds under a deleted parent", () => {
    expect(patchError({}, schema(), schema())).toMatchObject({
      reason: "invalid_schema",
    });
    expect(
      patchError(schema(), schema(), { ...schema(), id: "other" }),
    ).toMatchObject({
      reason: "schema_identity_changed",
    });
    const previousWithParent = schema();
    const nextWithChildUnderMissingParent = schema();
    nextWithChildUnderMissingParent.steps[0]!.fields.push({
      id: "field-new",
      key: "new",
      type: "text",
      label: "New",
    });
    const currentWithoutStep = { id: "form-schema", steps: [] };
    expect(
      applyFormSchemaPatch(
        currentWithoutStep,
        previousWithParent,
        nextWithChildUnderMissingParent,
        "source",
      ),
    ).toEqual(currentWithoutStep);
  });

  it("rejects malformed collection entries, duplicate identities, and non-JSON properties", () => {
    const malformed: unknown[] = [
      null,
      [],
      { id: "form-schema", steps: {} },
      { id: "form-schema", steps: [null] },
      { id: "form-schema", steps: [{ id: "step-a", fields: {} }] },
      {
        id: "form-schema",
        steps: [
          { id: "step-a", fields: [{ id: "field-a", validation: null }] },
        ],
      },
      {
        id: "form-schema",
        steps: [{ id: "step-a", fields: [{ id: "field-a", options: [null] }] }],
      },
      {
        id: "form-schema",
        steps: [
          {
            id: "step-a",
            fields: [{ id: "field-a", validation: { validators: {} } }],
          },
        ],
      },
      {
        id: "form-schema",
        steps: [
          {
            id: "step-a",
            fields: [
              {
                id: "field-a",
                validation: { validators: [{ name: "Missing ID" }] },
              },
            ],
          },
        ],
      },
    ];
    for (const candidate of malformed) {
      expect(patchError(candidate, schema(), schema())).toMatchObject({
        reason: "invalid_schema",
      });
    }

    const duplicate = schema();
    duplicate.steps.push({
      id: "step-a",
      title: "Duplicate step identity",
      fields: [],
    });
    expect(patchError(duplicate, schema(), schema())).toMatchObject({
      reason: "invalid_schema",
    });

    const nonJson = schema() as ReturnType<typeof schema> & {
      unsupported?: () => void;
    };
    nonJson.unsupported = () => undefined;
    expect(patchError(nonJson, schema(), schema())).toMatchObject({
      reason: "invalid_schema",
    });
  });

  it("preserves peer root and field properties unless the submitted snapshot changed them", () => {
    const previous = schema() as TestFormSchema;
    Object.assign(previous, {
      layout: { columns: [1, 2], mode: "compact" },
      retired: "remove me",
      ignored: undefined,
    });
    Object.assign(previous.steps[0]!.fields[0]!, {
      accessibility: { description: "old", order: [1, 2] },
      retiredFieldProperty: true,
    });

    const current = structuredClone(previous);
    Object.assign(current, {
      layout: { peer: "latest" },
      concurrent: { enabled: true },
    });
    Object.assign(current.steps[0]!.fields[0]!, {
      accessibility: { peer: "latest" },
      concurrentFieldProperty: "keep",
    });

    const next = structuredClone(previous);
    next.layout = { mode: "compact", columns: [1, 2] };
    delete next.retired;
    next.title = "local title";
    const nextField = next.steps[0]!.fields[0]!;
    delete nextField.retiredFieldProperty;
    nextField.label = "Local field label";

    const merged = applyFormSchemaPatch(
      current,
      previous,
      next,
      "source",
    ) as TestFormSchema;
    expect(merged.layout).toEqual({ peer: "latest" });
    expect(merged.concurrent).toEqual({ enabled: true });
    expect(merged.title).toBe("local title");
    expect(merged).not.toHaveProperty("retired");
    expect(merged).not.toHaveProperty("ignored");
    expect(merged.steps[0]!.fields[0]).toMatchObject({
      label: "Local field label",
      accessibility: { peer: "latest" },
      concurrentFieldProperty: "keep",
    });
    expect(merged.steps[0]!.fields[0]).not.toHaveProperty(
      "retiredFieldProperty",
    );
  });

  it("adds nested nodes without duplicating an identical peer addition and rejects identity collisions", () => {
    const previous = schema({ includeSecond: false });
    const next = structuredClone(previous);
    next.steps[0]!.fields.push({
      id: "field-new",
      key: "new",
      type: "select",
      options: [{ id: "option-new", value: "one", label: "One" }],
      validation: {
        validators: [
          { id: "validator-new", name: "Required", predicate: "required" },
        ],
      },
    });

    const current = structuredClone(next);
    expect(applyFormSchemaPatch(current, previous, next, "source")).toEqual(
      next,
    );

    const collision = structuredClone(current);
    collision.steps[0]!.fields[1]!.label = "Peer used the same stable ID";
    expect(patchError(collision, previous, next)).toMatchObject({
      reason: "schema_identity_collision",
    });
  });

  it("merges reorders with concurrent children and preserves a peer move when its destination is missing", () => {
    const previous = schema();
    const current = structuredClone(previous);
    current.steps[0]!.fields.push({
      id: "field-peer",
      key: "peer",
      type: "text",
      label: "Peer",
    });
    const next = structuredClone(previous);
    next.steps[0]!.fields.reverse();

    const reordered = applyFormSchemaPatch(
      current,
      previous,
      next,
      "source",
    ) as typeof current;
    expect(reordered.steps[0]!.fields.map((field) => field.id)).toEqual([
      "field-b",
      "field-a",
      "field-peer",
    ]);

    const previousWithDestination = structuredClone(previous);
    previousWithDestination.steps.push({
      id: "step-b",
      title: "Second",
      fields: [],
    });
    const nextMovesField = structuredClone(previousWithDestination);
    const moved = nextMovesField.steps[0]!.fields.pop()!;
    nextMovesField.steps[1]!.fields.push(moved);
    const currentWithoutDestination = structuredClone(previousWithDestination);
    currentWithoutDestination.steps.pop();

    const retainedPeerPlacement = applyFormSchemaPatch(
      currentWithoutDestination,
      previousWithDestination,
      nextMovesField,
      "source",
    ) as typeof previousWithDestination;
    expect(retainedPeerPlacement.steps.map((step) => step.id)).toEqual([
      "step-a",
    ]);
    expect(
      retainedPeerPlacement.steps[0]!.fields.map((field) => field.id),
    ).toEqual(["field-a", "field-b"]);
  });

  it("moves a field between steps and does not undo a peer move when only its stale order changed", () => {
    const previous = schema();
    previous.steps.push({ id: "step-b", title: "Second", fields: [] });

    const current = structuredClone(previous);
    const peerMoved = current.steps[0]!.fields.shift()!;
    current.steps[1]!.fields.push(peerMoved);

    const next = structuredClone(previous);
    next.steps[0]!.fields.reverse();
    const merged = applyFormSchemaPatch(
      current,
      previous,
      next,
      "source",
    ) as typeof previous;
    expect(merged.steps[0]!.fields.map((field) => field.id)).toEqual([
      "field-b",
    ]);
    expect(merged.steps[1]!.fields.map((field) => field.id)).toEqual([
      "field-a",
    ]);

    const movedByLocal = structuredClone(previous);
    const locallyMoved = movedByLocal.steps[0]!.fields.pop()!;
    movedByLocal.steps[1]!.fields.push(locallyMoved);
    const peerAlsoAdded = structuredClone(previous);
    peerAlsoAdded.steps[1]!.fields.push({
      id: "field-peer",
      key: "peer",
      type: "text",
    });
    const mergedMove = applyFormSchemaPatch(
      peerAlsoAdded,
      previous,
      movedByLocal,
      "source",
    ) as typeof previous;
    expect(mergedMove.steps[1]!.fields.map((field) => field.id)).toEqual([
      "field-b",
      "field-peer",
    ]);
  });

  it("does not recreate a locally edited node after a peer deletes it", () => {
    const previous = schema();
    const next = structuredClone(previous);
    next.steps[0]!.fields[0]!.label = "Local edit";
    const current = structuredClone(previous);
    current.steps[0]!.fields.shift();

    const merged = applyFormSchemaPatch(current, previous, next, "source");
    expect(merged).toEqual(current);
  });

  it("merges validation leaves and preserves absent versus explicitly empty child containers", () => {
    const previous = schema({ includeSecond: false });
    const field = previous.steps[0]!.fields[0]!;
    field.validation = { mode: "strict", locale: "en", validators: [] };

    const current = structuredClone(previous);
    (
      current.steps[0]!.fields[0]!.validation as Record<string, unknown>
    ).peerMode = "latest";

    const next = structuredClone(previous);
    (next.steps[0]!.fields[0]!.validation as Record<string, unknown>).mode =
      "relaxed";
    (
      next.steps[0]!.fields[0]!.validation as Record<string, unknown>
    ).validators = [
      {
        id: "validator-local",
        name: "Length",
        predicate: "min:2",
        message: "Too short",
      },
    ];
    next.steps[0]!.fields[0]!.options = [];

    const merged = applyFormSchemaPatch(
      current,
      previous,
      next,
      "source",
    ) as typeof next;
    expect(merged.steps[0]!.fields[0]!.options).toEqual([]);
    expect(merged.steps[0]!.fields[0]!.validation).toEqual({
      mode: "relaxed",
      locale: "en",
      peerMode: "latest",
      validators: [
        {
          id: "validator-local",
          name: "Length",
          predicate: "min:2",
          message: "Too short",
        },
      ],
    });

    const explicitlyEmpty = structuredClone(next);
    delete explicitlyEmpty.steps[0]!.fields[0]!.validation;
    const removed = applyFormSchemaPatch(
      merged,
      next,
      explicitlyEmpty,
      "source",
    ) as typeof next;
    expect(removed.steps[0]!.fields[0]!).not.toHaveProperty("validation");

    const shapePrevious: { id: string; steps: Array<Record<string, unknown>> } =
      {
        id: "form-schema",
        steps: [{ id: "step-shapes" }],
      };
    const shapeNext = structuredClone(shapePrevious);
    shapeNext.steps[0]!.fields = [];
    let shapeCurrent = applyFormSchemaPatch(
      shapePrevious,
      shapePrevious,
      shapeNext,
      "source",
    );
    expect(shapeCurrent).toEqual(shapeNext);

    const withoutFields = structuredClone(shapeNext);
    delete withoutFields.steps[0]!.fields;
    shapeCurrent = applyFormSchemaPatch(
      shapeCurrent,
      shapeNext,
      withoutFields,
      "source",
    );
    expect(shapeCurrent).toEqual(withoutFields);

    const validationWithoutValidators = schema({ includeSecond: false });
    validationWithoutValidators.steps[0]!.fields[0]!.validation = {};
    const validationWithValidators = structuredClone(
      validationWithoutValidators,
    );
    validationWithValidators.steps[0]!.fields[0]!.validation = {
      validators: [],
    };
    const explicitValidators = applyFormSchemaPatch(
      validationWithoutValidators,
      validationWithoutValidators,
      validationWithValidators,
      "source",
    );
    expect(explicitValidators).toEqual(validationWithValidators);
    const validationWithoutList = structuredClone(validationWithValidators);
    const validationWithoutListProperties = validationWithoutList.steps[0]!
      .fields[0]!.validation as Record<string, unknown>;
    delete validationWithoutListProperties.validators;
    expect(
      applyFormSchemaPatch(
        explicitValidators,
        validationWithValidators,
        validationWithoutList,
        "source",
      ),
    ).toEqual(validationWithoutList);

    const emptyContainers = {
      id: "form-schema",
      steps: [{ id: "step-empty", fields: [] }],
    };
    expect(
      applyFormSchemaPatch(
        emptyContainers,
        emptyContainers,
        emptyContainers,
        "source",
      ),
    ).toEqual(emptyContainers);

    const withoutNodes = { id: "form-schema", steps: [] };
    expect(
      applyFormSchemaPatch(withoutNodes, withoutNodes, withoutNodes, "source"),
    ).toEqual(withoutNodes);

    const fieldWithoutValidation = schema({ includeSecond: false });
    delete fieldWithoutValidation.steps[0]!.fields[0]!.validation;
    expect(
      applyFormSchemaPatch(
        fieldWithoutValidation,
        fieldWithoutValidation,
        fieldWithoutValidation,
        "source",
      ),
    ).toEqual(fieldWithoutValidation);

    const validationAdded = structuredClone(fieldWithoutValidation);
    validationAdded.steps[0]!.fields[0]!.validation = { mode: "strict" };
    expect(
      applyFormSchemaPatch(
        fieldWithoutValidation,
        fieldWithoutValidation,
        validationAdded,
        "source",
      ),
    ).toEqual(validationAdded);
  });

  it("allows localized target property add/remove but rejects target validation and nonlocalized changes", () => {
    const previous = schema();
    const next = structuredClone(previous);
    next.steps[0]!.title = "번역된 단계";
    next.steps[0]!.fields[0]!.description = "번역된 설명";
    next.steps[0]!.fields[0]!.label = undefined;
    const expectedTarget = structuredClone(previous);
    expectedTarget.steps[0]!.title = "번역된 단계";
    expectedTarget.steps[0]!.fields[0]!.description = "번역된 설명";
    delete expectedTarget.steps[0]!.fields[0]!.label;
    expect(applyFormSchemaPatch(previous, previous, next, "target")).toEqual(
      expectedTarget,
    );

    const targetValidation = structuredClone(previous);
    (
      targetValidation.steps[0]!.fields[0]!.validation as Record<
        string,
        unknown
      >
    ).mode = "strict";
    expect(
      patchError(previous, previous, targetValidation, "target"),
    ).toMatchObject({
      reason: "target_topology_changed",
    });

    const targetRootProperty = structuredClone(previous) as typeof previous & {
      name?: string;
    };
    targetRootProperty.name = "Not localized";
    expect(
      patchError(previous, previous, targetRootProperty, "target"),
    ).toMatchObject({
      reason: "target_topology_changed",
    });
  });
});
