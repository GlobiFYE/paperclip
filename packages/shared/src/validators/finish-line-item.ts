import { z } from "zod";

export const finishLineItemStatusSchema = z.enum(["open", "done"]);

export const finishLineItemTaskSchema = z.object({
  id: z.string().guid(),
  title: z.string().min(1),
  status: z.string().min(1),
});

export const finishLineItemSchema = z.object({
  id: z.string().guid(),
  companyId: z.string().guid(),
  projectId: z.string().guid(),
  title: z.string().min(1),
  description: z.string().nullable(),
  status: finishLineItemStatusSchema,
  position: z.number().int(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  tasks: z.array(finishLineItemTaskSchema).optional(),
});

export const finishLineItemSummarySchema = z.object({
  id: z.string().guid(),
  projectId: z.string().guid(),
  title: z.string().min(1),
  status: finishLineItemStatusSchema,
  position: z.number().int(),
  tasks: z.array(finishLineItemTaskSchema).optional(),
});

export const createFinishLineItemSchema = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().max(2000).optional().nullable(),
  status: finishLineItemStatusSchema.optional(),
  position: z.number().int().min(0).optional().nullable(),
});

export const updateFinishLineItemSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    description: z.string().trim().max(2000).optional().nullable(),
    status: finishLineItemStatusSchema.optional(),
    position: z.number().int().min(0).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one finish-line item field is required",
  });

export type CreateFinishLineItem = z.infer<typeof createFinishLineItemSchema>;
export type UpdateFinishLineItem = z.infer<typeof updateFinishLineItemSchema>;
