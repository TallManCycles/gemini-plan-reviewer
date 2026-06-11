const JSON_CONTRACT = `Respond with ONLY a single JSON object and nothing else. Do not include explanatory prose. Do not wrap it in markdown code fences or backticks. The JSON object MUST match this exact shape:

{
  "summary": "<one-paragraph overall assessment of the plan>",
  "findings": [
    {
      "severity": "critical" | "major" | "minor",
      "category": "<short category, e.g. completeness, risk, feasibility, security, clarity>",
      "issue": "<what is wrong, missing, or risky>",
      "suggestion": "<a concrete, actionable improvement>"
    }
  ]
}

If the plan is already solid, return an empty "findings" array and say so in the summary.`;

export function buildReviewPrompt(focusAreas?: string[], strict = false): string {
  const strictPrefix = strict
    ? "IMPORTANT: Your previous response could not be parsed as JSON. Return ONLY raw JSON — no prose, no markdown fences, no backticks.\n\n"
    : "";

  const focusLine =
    focusAreas && focusAreas.length > 0
      ? `\n\nPay particular attention to these focus areas: ${focusAreas.join(", ")}.`
      : "";

  return `${strictPrefix}The text above (provided via stdin) is a software implementation plan or specification.

Review it as an experienced staff engineer. Identify gaps, risks, incorrect assumptions, missing edge cases, unclear requirements, and concrete opportunities to make the plan stronger. For every point, give an actionable suggestion.${focusLine}

${JSON_CONTRACT}`;
}
