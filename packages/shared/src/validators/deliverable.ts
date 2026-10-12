import { z } from "zod";

export const COMPANY_DELIVERABLES_DEFAULT_LIMIT = 30;
export const COMPANY_DELIVERABLES_MAX_LIMIT = 100;

export const deliverableGenerationStatusSchema = z.enum(["pending", "generating", "retry_scheduled", "generated", "stale", "failed_final"]);

export const deliverableProductKindSchema = z.enum([
  "preview_url",
  "runtime_service",
  "pull_request",
  "branch",
  "commit",
  "artifact",
  "document",
]);

export const companyDeliverablesQuerySchema = z.object({
  projectId: z.string().guid().optional(),
  /** Inclusive ISO lower bound on the issue completion date. */
  from: z.string().min(1).optional(),
  /** Exclusive ISO upper bound on the issue completion date. */
  to: z.string().min(1).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(COMPANY_DELIVERABLES_MAX_LIMIT)
    .optional()
    .default(COMPANY_DELIVERABLES_DEFAULT_LIMIT),
  cursor: z.string().min(1).optional(),
});

export type CompanyDeliverablesQuery = z.infer<typeof companyDeliverablesQuerySchema>;

export const deliverableIssueSummarySchema = z.object({
  id: z.string().guid(),
  identifier: z.string(),
  title: z.string(),
});

export const deliverableProjectSummarySchema = z.object({
  id: z.string().guid(),
  name: z.string(),
});

export const deliverableActorSchema = z.object({
  kind: z.enum(["agent", "user"]),
  id: z.string().min(1),
  name: z.string(),
});

export const deliverableProductSchema = z.object({
  kind: deliverableProductKindSchema,
  title: z.string(),
  target: z.string().nullable(),
  href: z.string().nullable(),
  unavailable: z.boolean(),
});

export const companyDeliverableSchema = z.object({
  id: z.string().guid(),
  summary: z.string().nullable(),
  generationState: deliverableGenerationStatusSchema,
  nextAttemptAt: z.string().datetime().nullable(),
  fallback: z.string(),
  summaryFromTaskDetails: z.boolean(),
  issue: deliverableIssueSummarySchema,
  project: deliverableProjectSummarySchema.nullable(),
  product: deliverableProductSchema.nullable(),
  doneBy: deliverableActorSchema.nullable(),
  verifiedBy: deliverableActorSchema.nullable(),
  completedAt: z.string().datetime(),
});

export const companyDeliverablesResponseSchema = z.object({
  summariesEnabled: z.boolean(),
  deliverables: z.array(companyDeliverableSchema),
  nextCursor: z.string().nullable(),
});
