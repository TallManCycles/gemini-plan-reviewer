import { z } from "zod";

export const SeveritySchema = z.enum(["critical", "major", "minor"]);

export const FindingSchema = z.object({
  severity: SeveritySchema,
  category: z.string().min(1),
  issue: z.string().min(1),
  suggestion: z.string().min(1),
});

export const ReviewResultSchema = z.object({
  summary: z.string(),
  findings: z.array(FindingSchema),
});

// Raw shape reused directly as the MCP tool inputSchema.
export const reviewPlanInputShape = {
  plan: z.string().trim().min(1, "plan must not be empty"),
  focus_areas: z.array(z.string()).optional(),
  model: z.string().optional(),
} as const;

export const ReviewPlanInputSchema = z.object(reviewPlanInputShape);

export type Severity = z.infer<typeof SeveritySchema>;
export type Finding = z.infer<typeof FindingSchema>;
export type ReviewResult = z.infer<typeof ReviewResultSchema>;
export type ReviewPlanInput = z.infer<typeof ReviewPlanInputSchema>;
