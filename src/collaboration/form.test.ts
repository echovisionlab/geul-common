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
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  extractFormFields,
  extractFormCanonicalRoom,
  FORM_FIELDS_MAP_NAME,
  FORM_LOCALE_PRESENCE_MAP_NAME,
  hydrateFormCanonicalRoom,
  recordFormLocaleFieldChange,
  type FormCollabFields,
} from "./form.ts";

const source: FormCollabFields = {
  title: "Contact",
  schema: {
    id: "schema_A",
    steps: [
      {
        id: "step_A",
        title: "First",
        description: "",
        fields: [],
      },
      {
        id: "step_B",
        title: "Second",
        fields: [
          {
            id: "field_A",
            key: "email",
            type: "email",
            label: "Email",
            options: [],
            validation: { validators: [] },
          },
        ],
      },
    ],
  },
};

const sourcePresence = [
  formRootTitleTarget(),
  formStepTitleTarget("step_A"),
  formStepDescriptionTarget("step_A"),
  formStepTitleTarget("step_B"),
  formFieldLabelTarget("field_A"),
];

const sparseTargetSchema = {
  id: "schema_A",
  steps: [
    { id: "step_A", fields: [] },
    {
      id: "step_B",
      fields: [
        {
          id: "field_A",
          key: "email",
          type: "email",
          options: [],
          validation: { validators: [] },
        },
      ],
    },
  ],
};

function presenceKey(target: ReturnType<typeof formRootTitleTarget>): string {
  if (target.owner.case !== "blockHandle") {
    throw new Error("expected blockHandle target");
  }
  return `${target.owner.value}\u0000${target.fieldHandle}`;
}

function decoded(document: Y.Doc) {
  const replica = new Y.Doc();
  Y.applyUpdate(replica, Y.encodeStateAsUpdate(document));
  return replica;
}

describe("Form canonical collaboration codec", () => {
  it("round-trips ordered source structure and multiple explicit empty values", () => {
    const output = extractFormCanonicalRoom(
      decoded(
        hydrateFormCanonicalRoom({
          sourceLocale: "en",
          locale: "en",
          source,
          requested: source,
          requestedExists: true,
          presentLocaleValues: sourcePresence,
        }),
      ),
      source,
    );

    expect(output.fields).toEqual(source);
    expect(output.presentLocaleValues).toHaveLength(sourcePresence.length);
    expect((output.fields.schema as { steps: unknown[] }).steps).toHaveLength(
      2,
    );
  });

  it("materializes sparse target fallback while preserving exact empty and absent presence", () => {
    const requested: FormCollabFields = {
      title: "",
      schema: {
        id: "schema_A",
        steps: [
          { id: "step_A", title: "", fields: [] },
          {
            id: "step_B",
            fields: [
              {
                id: "field_A",
                key: "email",
                type: "email",
                options: [],
                validation: { validators: [] },
              },
            ],
          },
        ],
      },
    };
    const document = hydrateFormCanonicalRoom({
      sourceLocale: "en",
      locale: "ko",
      source,
      requested,
      requestedExists: true,
      presentLocaleValues: [
        formRootTitleTarget(),
        formStepTitleTarget("step_A"),
      ],
    });
    const materialized = JSON.parse(
      document.getMap("form-fields").get("schema") as string,
    ) as { steps: Array<{ title?: string; description?: string }> };
    expect(materialized.steps.map((step) => step.title)).toEqual([
      "",
      "Second",
    ]);
    expect(materialized.steps[0]?.description).toBe("");

    const output = extractFormCanonicalRoom(decoded(document), source);
    expect(output.fields.title).toBe("");
    expect(output.fields.schema).toEqual(requested.schema);
    expect(output.presentLocaleValues).toHaveLength(2);
  });

  it("records only changed target locale leaves and rejects missing target rooms", () => {
    expect(() =>
      hydrateFormCanonicalRoom({
        sourceLocale: "en",
        locale: "ko",
        source,
        requested: {},
        requestedExists: false,
        presentLocaleValues: [],
      }),
    ).toThrow("form_collaboration:target_missing");

    const document = hydrateFormCanonicalRoom({
      sourceLocale: "en",
      locale: "ko",
      source,
      requested: {
        schema: sparseTargetSchema,
      },
      requestedExists: true,
      presentLocaleValues: [],
    });
    const previous = {
      title: "Contact",
      schema: JSON.parse(
        document.getMap("form-fields").get("schema") as string,
      ),
    };
    const next = structuredClone(previous);
    next.schema.steps[1].fields[0].label = "";
    recordFormLocaleFieldChange(document, previous, next);
    document.getMap("form-fields").set("schema", JSON.stringify(next.schema));

    const output = extractFormCanonicalRoom(document, source);
    expect(output.fields.title).toBeUndefined();
    expect(
      (
        output.fields.schema as {
          steps: Array<{ fields?: Array<{ label?: string }> }>;
        }
      ).steps[1]?.fields?.[0]?.label,
    ).toBe("");
  });

  it("rejects target topology changes atomically", () => {
    const document = hydrateFormCanonicalRoom({
      sourceLocale: "en",
      locale: "ko",
      source,
      requested: {
        schema: sparseTargetSchema,
      },
      requestedExists: true,
      presentLocaleValues: [],
    });
    const schema = JSON.parse(
      document.getMap("form-fields").get("schema") as string,
    ) as { steps: Array<{ id: string }> };
    schema.steps.reverse();
    document.getMap("form-fields").set("schema", JSON.stringify(schema));
    expect(() => extractFormCanonicalRoom(document, source)).toThrow(
      "form_collaboration:target_topology",
    );
  });

  it("rejects mismatched canonical presence before materializing a room", () => {
    expect(() =>
      hydrateFormCanonicalRoom({
        sourceLocale: "en",
        locale: "en",
        source,
        requested: source,
        requestedExists: true,
        presentLocaleValues: [],
      }),
    ).toThrow("form_collaboration:locale_presence_mismatch");
  });

  it("rejects requested target topology changes before hydration", () => {
    expect(() =>
      hydrateFormCanonicalRoom({
        sourceLocale: "en",
        locale: "ko",
        source,
        requested: {
          schema: {
            id: "schema_A",
            steps: [
              {
                id: "step_B",
                fields: [
                  {
                    id: "field_A",
                    key: "email",
                    type: "email",
                    options: [],
                    validation: { validators: [] },
                  },
                ],
              },
              { id: "step_A", fields: [] },
            ],
          },
        },
        requestedExists: true,
        presentLocaleValues: [],
      }),
    ).toThrow("form_collaboration:target_topology");
  });

  it.each([
    { sourceLocale: "", locale: "en" },
    { sourceLocale: "en", locale: "" },
  ])("rejects an empty canonical locale identity", (identity) => {
    expect(() =>
      hydrateFormCanonicalRoom({
        ...identity,
        source,
        requested: source,
        requestedExists: true,
        presentLocaleValues: [],
      }),
    ).toThrow("form_collaboration:locale");
  });

  it("removes target presence when an explicit locale value is deleted", () => {
    const document = hydrateFormCanonicalRoom({
      sourceLocale: "en",
      locale: "ko",
      source,
      requested: {
        title: "",
        schema: sparseTargetSchema,
      },
      requestedExists: true,
      presentLocaleValues: [formRootTitleTarget()],
    });
    const previous: FormCollabFields = {
      title: document.getMap("form-fields").get("title") as string,
      schema: JSON.parse(
        document.getMap("form-fields").get("schema") as string,
      ) as unknown,
    };
    const next: FormCollabFields = structuredClone(previous);
    delete next.title;

    recordFormLocaleFieldChange(document, previous, next);
    document.getMap("form-fields").delete("title");

    const output = extractFormCanonicalRoom(document, source);
    expect(output.fields.title).toBeUndefined();
    expect(output.presentLocaleValues).toEqual([]);
  });

  it("round-trips option and validator locale slots with optional structure omitted", () => {
    const richSource: FormCollabFields = {
      title: "Survey",
      schema: {
        id: "schema_rich",
        steps: [
          {
            id: "step_rich",
            title: "Question",
            fields: [
              {
                id: "field_rich",
                label: "Choice",
                description: "",
                placeholder: "Pick one",
                checkboxLabel: "Accept",
                options: [{ id: "option_A", label: "Alpha", value: "a" }],
                validation: {
                  validators: [
                    {
                      id: "validator_A",
                      message: "Required",
                      type: "required",
                    },
                  ],
                },
              },
              { id: "field_sparse" },
            ],
          },
          { id: "step_sparse", title: "Done" },
        ],
      },
    };
    const presence = [
      formRootTitleTarget(),
      formStepTitleTarget("step_rich"),
      formFieldLabelTarget("field_rich"),
      formFieldDescriptionTarget("field_rich"),
      formFieldPlaceholderTarget("field_rich"),
      formFieldCheckboxLabelTarget("field_rich"),
      formOptionLabelTarget("option_A"),
      formValidatorMessageTarget("validator_A"),
      formStepTitleTarget("step_sparse"),
    ];

    const output = extractFormCanonicalRoom(
      hydrateFormCanonicalRoom({
        sourceLocale: "en",
        locale: "en",
        source: richSource,
        requested: richSource,
        requestedExists: true,
        presentLocaleValues: presence,
      }),
      richSource,
    );
    expect(output.fields).toEqual(richSource);
    expect(output.presentLocaleValues).toHaveLength(presence.length);
    expect(output.presentLocaleValues).toEqual(
      expect.arrayContaining(presence),
    );
  });

  it.each([
    [{ schema: null }, "form_collaboration:schema"],
    [
      { schema: { id: "schema_invalid", steps: {} } },
      "form_collaboration:schema_steps",
    ],
    [{ schema: { id: 1, steps: [] } }, "form_collaboration:schema_id"],
  ])("rejects malformed canonical schema values", (invalid, reason) => {
    expect(() =>
      hydrateFormCanonicalRoom({
        sourceLocale: "en",
        locale: "en",
        source: invalid,
        requested: invalid,
        requestedExists: true,
        presentLocaleValues: [],
      }),
    ).toThrow(reason);
  });

  it("rejects invalid and duplicate locale presence targets", () => {
    const invalidTarget = structuredClone(formRootTitleTarget());
    invalidTarget.fieldHandle = "";
    expect(() =>
      hydrateFormCanonicalRoom({
        sourceLocale: "en",
        locale: "en",
        source,
        requested: source,
        requestedExists: true,
        presentLocaleValues: [invalidTarget],
      }),
    ).toThrow("form_collaboration:locale_presence_target");

    expect(() =>
      hydrateFormCanonicalRoom({
        sourceLocale: "en",
        locale: "en",
        source,
        requested: source,
        requestedExists: true,
        presentLocaleValues: [formRootTitleTarget(), formRootTitleTarget()],
      }),
    ).toThrow("form_collaboration:locale_presence_duplicate");
  });

  it("rejects duplicate stable form identities", () => {
    const duplicateSteps: FormCollabFields = {
      schema: {
        id: "schema_duplicate",
        steps: [
          { id: "step_duplicate", fields: [] },
          { id: "step_duplicate", fields: [] },
        ],
      },
    };
    expect(() =>
      hydrateFormCanonicalRoom({
        sourceLocale: "en",
        locale: "en",
        source: duplicateSteps,
        requested: duplicateSteps,
        requestedExists: true,
        presentLocaleValues: [],
      }),
    ).toThrow("form_collaboration:step_id_duplicate");
  });

  it("materializes a locale row with no explicit target values from source topology", () => {
    const document = hydrateFormCanonicalRoom({
      sourceLocale: "en",
      locale: "ko",
      source,
      requested: {},
      requestedExists: true,
      presentLocaleValues: [],
    });

    expect(document.getMap(FORM_FIELDS_MAP_NAME).get("title")).toBe("Contact");
    expect(extractFormCanonicalRoom(document, source)).toEqual({
      fields: { schema: sparseTargetSchema },
      presentLocaleValues: [],
    });
  });

  it("preserves an absent source title while materializing a sparse target", () => {
    const sourceWithoutTitle: FormCollabFields = { schema: source.schema };
    const document = hydrateFormCanonicalRoom({
      sourceLocale: "en",
      locale: "ko",
      source: sourceWithoutTitle,
      requested: {},
      requestedExists: true,
      presentLocaleValues: [],
    });

    expect(document.getMap(FORM_FIELDS_MAP_NAME).has("title")).toBe(false);
    expect(
      extractFormCanonicalRoom(document, sourceWithoutTitle).fields,
    ).toEqual({ schema: sparseTargetSchema });
  });

  it("rejects a missing canonical source row", () => {
    expect(() =>
      hydrateFormCanonicalRoom({
        sourceLocale: "en",
        locale: "en",
        source,
        requested: {},
        requestedExists: false,
        presentLocaleValues: [],
      }),
    ).toThrow("form_collaboration:source_missing");
  });

  it("rejects target values that disappear after their presence is derived", () => {
    const step = { id: "step_A", fields: [] } as Record<string, unknown>;
    Object.defineProperty(step, "title", {
      configurable: true,
      enumerable: true,
      get() {
        delete step.title;
        return "";
      },
    });
    expect(() =>
      hydrateFormCanonicalRoom({
        sourceLocale: "en",
        locale: "ko",
        source,
        requested: {
          schema: {
            id: "schema_A",
            steps: [step, sparseTargetSchema.steps[1]],
          },
        },
        requestedExists: true,
        presentLocaleValues: [formStepTitleTarget("step_A")],
      }),
    ).toThrow("form_collaboration:target_value_missing");
  });

  it("rejects requested topology whose indexed identity disappears", () => {
    const requestedSteps: Array<Record<string, unknown>> = structuredClone(
      sparseTargetSchema.steps,
    );
    requestedSteps[0] = { ...requestedSteps[0], title: "" };
    let reads = 0;
    const requestedSchema = {
      id: "schema_A",
      get steps() {
        reads += 1;
        return reads < 5 ? requestedSteps : [];
      },
    };

    expect(() =>
      hydrateFormCanonicalRoom({
        sourceLocale: "en",
        locale: "ko",
        source,
        requested: { schema: requestedSchema },
        requestedExists: true,
        presentLocaleValues: [formStepTitleTarget("step_A")],
      }),
    ).toThrow("form_collaboration:target_identity");
  });

  it("rejects a target title that disappears after its presence is derived", () => {
    let reads = 0;
    const requested = {
      get title() {
        reads += 1;
        return reads === 1 ? "" : undefined;
      },
      schema: sparseTargetSchema,
    };
    expect(() =>
      hydrateFormCanonicalRoom({
        sourceLocale: "en",
        locale: "ko",
        source,
        requested,
        requestedExists: true,
        presentLocaleValues: [formRootTitleTarget()],
      }),
    ).toThrow("form_collaboration:target_title_missing");
  });

  it("rejects missing context and malformed persisted presence", () => {
    expect(() => extractFormCanonicalRoom(new Y.Doc(), source)).toThrow(
      "form_collaboration:context",
    );

    const document = hydrateFormCanonicalRoom({
      sourceLocale: "en",
      locale: "ko",
      source,
      requested: {},
      requestedExists: true,
      presentLocaleValues: [],
    });
    document
      .getMap<boolean>(FORM_LOCALE_PRESENCE_MAP_NAME)
      .set(presenceKey(formRootTitleTarget()), false);
    expect(() => extractFormCanonicalRoom(document, source)).toThrow(
      "form_collaboration:locale_presence_value",
    );
  });

  it("rejects unknown presence and present values missing from the room", () => {
    const unknownPresence = hydrateFormCanonicalRoom({
      sourceLocale: "en",
      locale: "ko",
      source,
      requested: {},
      requestedExists: true,
      presentLocaleValues: [],
    });
    unknownPresence
      .getMap<boolean>(FORM_LOCALE_PRESENCE_MAP_NAME)
      .set("unknown\u0000field", true);
    expect(() => extractFormCanonicalRoom(unknownPresence, source)).toThrow(
      "form_collaboration:locale_presence_unknown",
    );

    const missingValue = hydrateFormCanonicalRoom({
      sourceLocale: "en",
      locale: "ko",
      source,
      requested: {
        schema: {
          ...sparseTargetSchema,
          steps: [
            { ...sparseTargetSchema.steps[0], title: "" },
            sparseTargetSchema.steps[1],
          ],
        },
      },
      requestedExists: true,
      presentLocaleValues: [formStepTitleTarget("step_A")],
    });
    const schema = JSON.parse(
      missingValue.getMap(FORM_FIELDS_MAP_NAME).get("schema") as string,
    ) as { steps: Array<Record<string, unknown>> };
    delete schema.steps[0]?.title;
    missingValue
      .getMap(FORM_FIELDS_MAP_NAME)
      .set("schema", JSON.stringify(schema));
    expect(() => extractFormCanonicalRoom(missingValue, source)).toThrow(
      "form_collaboration:target_value_missing",
    );
  });

  it("rejects a present target title missing from the room", () => {
    const document = hydrateFormCanonicalRoom({
      sourceLocale: "en",
      locale: "ko",
      source,
      requested: { title: "", schema: sparseTargetSchema },
      requestedExists: true,
      presentLocaleValues: [formRootTitleTarget()],
    });
    document.getMap(FORM_FIELDS_MAP_NAME).delete("title");

    expect(() => extractFormCanonicalRoom(document, source)).toThrow(
      "form_collaboration:target_title_missing",
    );
  });

  it("fails closed if validated presence can no longer resolve its target", () => {
    const document = hydrateFormCanonicalRoom({
      sourceLocale: "en",
      locale: "ko",
      source,
      requested: { title: "", schema: sparseTargetSchema },
      requestedExists: true,
      presentLocaleValues: [formRootTitleTarget()],
    });
    const titleKey = presenceKey(formRootTitleTarget());
    const originalGet = Map.prototype.get;
    const mapGet = vi.spyOn(Map.prototype, "get");
    mapGet.mockImplementation(function (
      this: Map<unknown, unknown>,
      key: unknown,
    ) {
      if (key === titleKey) return undefined;
      return originalGet.call(this, key);
    });

    try {
      expect(() => extractFormCanonicalRoom(document, source)).toThrow(
        "form_collaboration:locale_presence_unknown",
      );
    } finally {
      mapGet.mockRestore();
    }
  });

  it("does not write an optional schema that disappears during canonical cloning", () => {
    let reads = 0;
    const volatileSource: FormCollabFields = {
      get schema() {
        reads += 1;
        return reads === 1 ? source.schema : undefined;
      },
    };
    const document = hydrateFormCanonicalRoom({
      sourceLocale: "en",
      locale: "en",
      source: volatileSource,
      requested: volatileSource,
      requestedExists: true,
      presentLocaleValues: [],
    });

    expect(document.getMap(FORM_FIELDS_MAP_NAME).has("schema")).toBe(false);
  });

  it("clears stale presence before writing canonical presence", () => {
    const seed = new Y.Doc();
    const stalePresence = seed.getMap<boolean>(FORM_LOCALE_PRESENCE_MAP_NAME);
    stalePresence.set("stale", true);
    const originalGetMap = Y.Doc.prototype.getMap;
    const getMap = vi.spyOn(Y.Doc.prototype, "getMap");
    getMap.mockImplementation(function (this: Y.Doc, name?: string) {
      if (name === FORM_LOCALE_PRESENCE_MAP_NAME) {
        return stalePresence as unknown as Y.Map<unknown>;
      }
      return originalGetMap.call(this, name);
    });

    try {
      hydrateFormCanonicalRoom({
        sourceLocale: "en",
        locale: "ko",
        source,
        requested: {},
        requestedExists: true,
        presentLocaleValues: [],
      });
      expect([...stalePresence.keys()]).toEqual([]);
    } finally {
      getMap.mockRestore();
      seed.destroy();
    }
  });

  it("ignores source-locale and unchanged target presence updates", () => {
    const sourceDocument = hydrateFormCanonicalRoom({
      sourceLocale: "en",
      locale: "en",
      source,
      requested: source,
      requestedExists: true,
      presentLocaleValues: sourcePresence,
    });
    recordFormLocaleFieldChange(sourceDocument, source, {});
    expect(sourceDocument.getMap(FORM_LOCALE_PRESENCE_MAP_NAME).size).toBe(
      sourcePresence.length,
    );

    const targetDocument = hydrateFormCanonicalRoom({
      sourceLocale: "en",
      locale: "ko",
      source,
      requested: {},
      requestedExists: true,
      presentLocaleValues: [],
    });
    recordFormLocaleFieldChange(targetDocument, {}, {});
    expect(targetDocument.getMap(FORM_LOCALE_PRESENCE_MAP_NAME).size).toBe(0);
  });

  it("accepts already-decoded canonical JSON fields", () => {
    expect(
      extractFormFields(
        new Map<string, unknown>([["schema", sparseTargetSchema]]),
      ),
    ).toEqual({ schema: sparseTargetSchema });
    expect(() =>
      extractFormFields(new Map<string, unknown>([["schema", "{"]])),
    ).toThrow('Failed to parse JSON for form field "schema"');
  });
});
