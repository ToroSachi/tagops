import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GtmTag, GtmTrigger, GtmVariable } from "../types/gtm.js";

const compareContainers = vi.fn();
const listTags = vi.fn();
const listTriggers = vi.fn();
const listVariables = vi.fn();
const createVariable = vi.fn();
const updateVariable = vi.fn();
const createTrigger = vi.fn();
const updateTrigger = vi.fn();
const createTag = vi.fn();
const updateTag = vi.fn();

vi.mock("../tools/compare.js", () => ({
  compareContainers,
}));

vi.mock("../lib/gtm-cli.js", () => ({
  buildCompleteTagConfig: vi.fn((tag: object, overrides: Record<string, unknown> = {}) => ({
    ...(structuredClone(tag) as Record<string, unknown>),
    ...overrides,
  })),
  listTags,
  listTriggers,
  listVariables,
  createVariable,
  updateVariable,
  createTrigger,
  updateTrigger,
  createTag,
  updateTag,
}));

vi.mock("../lib/permission-guard.js", () => ({
  requireWriteAccess: vi.fn(),
  requirePublishAccess: vi.fn(),
}));

describe("mapVariablesInTrigger", () => {
  it("maps nested template values across trigger payloads", async () => {
    const { mapVariablesInTrigger } = await import("../tools/sync.js");
    const sourceTrigger = {
      triggerId: "t1",
      name: "Test",
      type: "CUSTOM_EVENT",
      filter: [
        {
          type: "EQUALS",
          parameter: [{ type: "template", value: "{{My Source Var}}" }],
        },
      ],
      parameter: [
        {
          type: "template",
          value: "{{My Source Var}}",
        },
      ],
    } as unknown as GtmTrigger;

    const sourceVars = [] as GtmVariable[];
    const targetVars = [{ variableId: "v2", name: "My Source Var", type: "v" }] as GtmVariable[];

    const result = mapVariablesInTrigger(sourceTrigger, sourceVars, targetVars) as GtmTrigger & {
      parameter?: Array<{ value?: string }>;
    };
    expect(result.filter?.[0].parameter?.[0].value).toBe("{{My Source Var}}");
    expect(result.parameter?.[0].value).toBe("{{My Source Var}}");
  });

  it("maps bare variable IDs to target variable IDs", async () => {
    const { mapVariablesInTrigger } = await import("../tools/sync.js");
    const sourceTrigger = {
      triggerId: "t1",
      name: "Test",
      type: "CUSTOM_EVENT",
      filter: [
        {
          type: "EQUALS",
          parameter: [{ type: "template", value: "88" }],
        },
      ],
    } as unknown as GtmTrigger;

    const sourceVars = [{ variableId: "88", name: "Var1", type: "v" }] as GtmVariable[];
    const targetVars = [{ variableId: "99", name: "Var1", type: "v" }] as GtmVariable[];

    const result = mapVariablesInTrigger(sourceTrigger, sourceVars, targetVars);
    expect(result.filter?.[0].parameter?.[0].value).toBe("99");
  });
});

describe("syncContainers", () => {
  const sourceTags: GtmTag[] = [
    {
      tagId: "tag-source",
      name: "Meta Pixel",
      type: "html",
      notes: "TagOps-ID: tag-1",
      parameter: [{ key: "html", type: "template", value: "<script>one</script>" }],
      firingTriggerId: ["trigger-source"],
      blockingTriggerId: ["trigger-block-source"],
      tagFiringOption: "oncePerLoad",
      fingerprint: "source-fp",
    } as GtmTag,
  ];

  const targetTags: GtmTag[] = [
    {
      tagId: "tag-target",
      name: "Meta Pixel",
      type: "html",
      notes: "TagOps-ID: tag-1",
      parameter: [{ key: "html", type: "template", value: "<script>two</script>" }],
      firingTriggerId: ["trigger-target"],
      blockingTriggerId: ["trigger-block-target"],
      tagFiringOption: "oncePerEvent",
      fingerprint: "target-fp",
    } as GtmTag,
  ];

  const sourceTriggers: GtmTrigger[] = [
    {
      triggerId: "trigger-source",
      name: "CE - Purchase",
      type: "CUSTOM_EVENT",
      notes: "TagOps-ID: trig-1",
      filter: [
        {
          type: "EQUALS",
          parameter: [
            { key: "arg0", type: "template", value: "{{_event}}" },
            { key: "arg1", type: "template", value: "purchase" },
          ],
        },
      ],
      parameter: [{ key: "eventName", type: "template", value: "{{DLV - Event Name}}" }],
      fingerprint: "source-trigger-fp",
    } as unknown as GtmTrigger,
  ];

  const targetTriggers: GtmTrigger[] = [
    {
      triggerId: "trigger-target",
      name: "CE - Purchase",
      type: "CUSTOM_EVENT",
      notes: "TagOps-ID: trig-1",
      filter: [
        {
          type: "EQUALS",
          parameter: [
            { key: "arg0", type: "template", value: "{{_event}}" },
            { key: "arg1", type: "template", value: "begin_checkout" },
          ],
        },
      ],
      parameter: [{ key: "eventName", type: "template", value: "{{DLV - Event Name}}" }],
      fingerprint: "target-trigger-fp",
    } as unknown as GtmTrigger,
  ];

  const sourceVariables: GtmVariable[] = [
    {
      variableId: "variable-source",
      name: "DLV - Ecommerce Value",
      type: "v",
      notes: "TagOps-ID: var-1",
      parameter: [{ key: "value", type: "template", value: "ecommerce.value" }],
      fingerprint: "source-var-fp",
    } as GtmVariable,
  ];

  const targetVariables: GtmVariable[] = [
    {
      variableId: "variable-target",
      name: "DLV - Ecommerce Value",
      type: "v",
      notes: "TagOps-ID: var-1",
      parameter: [{ key: "value", type: "template", value: "ecommerce.total_value" }],
      fingerprint: "target-var-fp",
    } as GtmVariable,
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    listTags.mockImplementation(async (profileName?: string) =>
      profileName === "source" ? sourceTags : targetTags,
    );
    listTriggers.mockImplementation(async (profileName?: string) =>
      profileName === "source" ? sourceTriggers : targetTriggers,
    );
    listVariables.mockImplementation(async (profileName?: string) =>
      profileName === "source" ? sourceVariables : targetVariables,
    );

    compareContainers.mockResolvedValue({
      sourceProfile: "source",
      targetProfile: "target",
      tags: [
        {
          name: "Meta Pixel",
          status: "different",
          sourceId: "tag-source",
          targetId: "tag-target",
          differences: ["parameter[0].value"],
        },
      ],
      triggers: [
        {
          name: "CE - Purchase",
          status: "different",
          sourceId: "trigger-source",
          targetId: "trigger-target",
          differences: ["filter[0].parameter[1].value", "parameter[0].value"],
        },
      ],
      variables: [
        {
          name: "DLV - Ecommerce Value",
          status: "different",
          sourceId: "variable-source",
          targetId: "variable-target",
          differences: ["parameter[0].value"],
        },
      ],
      summary: "3 differ",
    });
  });

  const sourceTriggerWithParameter = sourceTriggers[0] as GtmTrigger & { parameter?: unknown[] };

  it("updates resources with the full normalized source body", async () => {
    const { syncContainers } = await import("../tools/sync.js");

    await syncContainers({ source: "source", target: "target", force: true });

    expect(updateVariable).toHaveBeenCalledWith(
      "variable-target",
      expect.objectContaining({
        name: "DLV - Ecommerce Value",
        type: "v",
        parameter: sourceVariables[0].parameter,
        notes: "TagOps-ID: var-1",
      }),
    );

    expect(updateTrigger).toHaveBeenCalledWith(
      "trigger-target",
      expect.objectContaining({
        name: "CE - Purchase",
        type: "CUSTOM_EVENT",
        parameter: sourceTriggerWithParameter.parameter,
        filter: sourceTriggerWithParameter.filter,
        notes: "TagOps-ID: trig-1",
      }),
    );

    expect(updateTag).toHaveBeenCalledWith(
      expect.objectContaining({
        tagId: "tag-target",
        name: "Meta Pixel",
        fingerprint: "target-fp",
        firingTriggerId: ["trigger-target"],
        config: expect.objectContaining({
          parameter: sourceTags[0].parameter,
          blockingTriggerId: sourceTags[0].blockingTriggerId,
          tagFiringOption: "oncePerLoad",
          notes: "TagOps-ID: tag-1",
        }),
      }),
    );
  });

  it("still supports create paths for missing resources", async () => {
    compareContainers.mockResolvedValue({
      sourceProfile: "source",
      targetProfile: "target",
      tags: [{ name: "Meta Pixel", status: "only_in_source", sourceId: "tag-source" }],
      triggers: [{ name: "CE - Purchase", status: "only_in_source", sourceId: "trigger-source" }],
      variables: [
        { name: "DLV - Ecommerce Value", status: "only_in_source", sourceId: "variable-source" },
      ],
      summary: "3 only in source",
    });

    const { syncContainers } = await import("../tools/sync.js");

    await syncContainers({ source: "source", target: "target", force: true });

    expect(createVariable).toHaveBeenCalledWith(
      "DLV - Ecommerce Value",
      "v",
      expect.objectContaining({
        parameter: sourceVariables[0].parameter,
        notes: "TagOps-ID: var-1",
      }),
    );

    expect(createTrigger).toHaveBeenCalledWith(
      "CE - Purchase",
      "CUSTOM_EVENT",
      expect.objectContaining({
        parameter: sourceTriggerWithParameter.parameter,
        filter: sourceTriggerWithParameter.filter,
        notes: "TagOps-ID: trig-1",
      }),
    );

    expect(createTag).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Meta Pixel",
        type: "html",
        firingTriggerId: ["trigger-target"],
        config: expect.objectContaining({
          parameter: sourceTags[0].parameter,
          blockingTriggerId: sourceTags[0].blockingTriggerId,
          notes: "TagOps-ID: tag-1",
        }),
      }),
    );
  });

  it("redacts sensitive API details in sync errors", async () => {
    createVariable.mockRejectedValue(new Error("access_token=secret-token Bearer abc.def"));

    compareContainers.mockResolvedValue({
      sourceProfile: "source",
      targetProfile: "target",
      tags: [],
      triggers: [],
      variables: [
        { name: "DLV - Ecommerce Value", status: "only_in_source", sourceId: "variable-source" },
      ],
      summary: "1 only in source",
    });

    const { syncContainers } = await import("../tools/sync.js");
    const result = await syncContainers({
      source: "source",
      target: "target",
      force: true,
      silent: true,
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("[REDACTED]");
    expect(result.errors[0]).not.toContain("secret-token");
  });

  it("tolerates unexpected null list responses", async () => {
    listTags.mockResolvedValue(null);
    listTriggers.mockResolvedValue(null);
    listVariables.mockResolvedValue(null);

    compareContainers.mockResolvedValue({
      sourceProfile: "source",
      targetProfile: "target",
      tags: [],
      triggers: [],
      variables: [],
      summary: "0 differ",
    });

    const { syncContainers } = await import("../tools/sync.js");
    const result = await syncContainers({
      source: "source",
      target: "target",
      force: true,
      silent: true,
    });

    expect(result.errors).toEqual([]);
    expect(result.tagsCreated).toBe(0);
    expect(result.variablesCreated).toBe(0);
  });
});
