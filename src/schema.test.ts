import { describe, it, expect } from "vitest";
import {
  FindingSchema,
  ReviewResultSchema,
  ReviewPlanInputSchema,
} from "./schema.js";

describe("FindingSchema", () => {
  it("accepts a well-formed finding", () => {
    const f = {
      severity: "major",
      category: "risk",
      issue: "No rollback plan",
      suggestion: "Add a rollback section",
    };
    expect(FindingSchema.parse(f)).toEqual(f);
  });

  it("rejects an unknown severity", () => {
    const f = { severity: "blocker", category: "risk", issue: "x", suggestion: "y" };
    expect(() => FindingSchema.parse(f)).toThrow();
  });
});

describe("ReviewResultSchema", () => {
  it("accepts an empty findings list", () => {
    const r = { summary: "Looks good", findings: [] };
    expect(ReviewResultSchema.parse(r)).toEqual(r);
  });
});

describe("ReviewPlanInputSchema", () => {
  it("rejects an empty plan", () => {
    expect(() => ReviewPlanInputSchema.parse({ plan: "   " })).toThrow();
  });

  it("accepts plan with optional fields", () => {
    const input = { plan: "Build X", focus_areas: ["security"], model: "gemini-3.1-pro-preview" };
    expect(ReviewPlanInputSchema.parse(input)).toEqual(input);
  });
});
