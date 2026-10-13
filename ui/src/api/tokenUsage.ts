import type { TokenUsageResponse, TokenUsageWindow } from "@paperclipai/shared";
import { api } from "./client";

export const tokenUsageApi = {
  get: (companyId: string, window: TokenUsageWindow, signal?: AbortSignal) =>
    api.get<TokenUsageResponse>(`/companies/${companyId}/token-usage?window=${window}`, { signal, cache: "no-store" }),
};
