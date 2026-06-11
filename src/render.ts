import type { ReviewResult, Severity } from "./schema.js";

const SEVERITY_ORDER: Severity[] = ["critical", "major", "minor"];
const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  major: "Major",
  minor: "Minor",
};

export function renderFindings(result: ReviewResult): string {
  const lines: string[] = ["## Gemini Plan Review", "", result.summary, ""];

  if (result.findings.length === 0) {
    lines.push("No issues found.");
    return lines.join("\n");
  }

  for (const severity of SEVERITY_ORDER) {
    const group = result.findings.filter((f) => f.severity === severity);
    if (group.length === 0) continue;

    lines.push(`### ${SEVERITY_LABEL[severity]}`, "");
    for (const f of group) {
      lines.push(`- **${f.category}** — ${f.issue}`);
      lines.push(`  - Suggestion: ${f.suggestion}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
