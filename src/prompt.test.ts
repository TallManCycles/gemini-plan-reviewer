import { describe, it, expect } from "vitest";
import { buildReviewPrompt } from "./prompt.js";

describe("buildReviewPrompt", () => {
  it("includes the JSON output contract", () => {
    const p = buildReviewPrompt();
    expect(p).toContain('"summary"');
    expect(p).toContain('"findings"');
    expect(p).toContain("critical");
    expect(p).toContain("ONLY");
  });

  it("includes focus areas when provided", () => {
    const p = buildReviewPrompt(["security", "edge cases"]);
    expect(p).toContain("security");
    expect(p).toContain("edge cases");
  });

  it("omits the focus line when no areas given", () => {
    const p = buildReviewPrompt();
    expect(p).not.toContain("Pay particular attention");
  });

  it("adds a stricter reminder in strict mode", () => {
    const p = buildReviewPrompt(undefined, true);
    expect(p.toLowerCase()).toContain("could not be parsed");
  });
});
