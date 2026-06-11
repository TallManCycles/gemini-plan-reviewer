import { describe, it, expect } from "vitest";
import { renderFindings } from "./render.js";
import type { ReviewResult } from "./schema.js";

describe("renderFindings", () => {
  it("renders summary and groups by severity in order", () => {
    const result: ReviewResult = {
      summary: "Overall solid.",
      findings: [
        { severity: "minor", category: "clarity", issue: "Vague naming", suggestion: "Rename" },
        { severity: "critical", category: "risk", issue: "Data loss", suggestion: "Add backups" },
      ],
    };
    const md = renderFindings(result);
    expect(md).toContain("Overall solid.");
    expect(md).toContain("Critical");
    expect(md).toContain("Minor");
    // critical section appears before minor section
    expect(md.indexOf("Critical")).toBeLessThan(md.indexOf("Minor"));
    expect(md).toContain("Data loss");
    expect(md).toContain("Add backups");
  });

  it("states when there are no findings", () => {
    const md = renderFindings({ summary: "Great plan.", findings: [] });
    expect(md).toContain("Great plan.");
    expect(md.toLowerCase()).toContain("no issues");
  });
});
