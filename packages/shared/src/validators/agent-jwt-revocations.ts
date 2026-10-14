import { z } from "zod";

export const revokeAgentJwtSchema = z.object({
  handle: z.string().regex(/^(?:jti:[A-Za-z0-9_-]{1,128}|sha256:[a-f0-9]{64})$/),
  reason: z.string().trim().min(1).max(1000),
}).strict();
export type RevokeAgentJwt = z.infer<typeof revokeAgentJwtSchema>;
