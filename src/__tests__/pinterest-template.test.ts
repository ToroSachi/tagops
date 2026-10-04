/**
 * TOR-2560: Pinterest ViewCategory must fire on category/listing views,
 * never on product (PDP) views.
 */
import { describe, it, expect } from "vitest";
import { pinterestTag } from "../templates/vendors/index.js";
import { installTemplate } from "../templates/registry.js";
import { TRIGGER_MAP } from "../lib/architecture.js";

const tags = pinterestTag.tags({ pixelId: "1234567890" });
const viewCategoryTags = tags.filter((t) => t.html?.includes("'viewcategory'"));

describe("pinterest template — viewcategory trigger (TOR-2560)", () => {
  it("fires viewcategory only on view_item_list, not on view_item", () => {
    expect(viewCategoryTags.length).toBeGreaterThan(0);
    for (const tag of viewCategoryTags) {
      expect(tag.triggerEvent).toBe("view_item_list");
    }
    expect(tags.some((t) => t.triggerEvent === "view_item")).toBe(false);
  });

  it("view_item_list resolves to the CE - View Item List trigger", () => {
    expect(TRIGGER_MAP["view_item_list"]?.name).toBe("CE - View Item List");
  });

  it("base tag still covers page views via pagevisit", () => {
    const base = tags.find((t) => t.name === "Pinterest – Base Tag");
    expect(base?.triggerEvent).toBe("page_view");
    expect(base?.html).toContain("pintrk('page')");
  });

  it("dry-run install wires ViewCategory to CE - View Item List", async () => {
    const result = await installTemplate("pinterest-tag", {
      dryRun: true,
      pixelId: "1234567890",
    });
    const details = result.actions.filter((a) => a.detail).map((a) => a.detail!);
    expect(details.some((d) => d.includes("CE - View Item List"))).toBe(true);
  });
});
