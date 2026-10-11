import {
  codexLocalReasoningEffortsForModel,
  type CodexLocalReasoningEffort,
} from "@paperclipai/adapter-codex-local";

const CODEX_REASONING_EFFORT_LABELS: Record<CodexLocalReasoningEffort, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "X-High",
  max: "Max",
  ultra: "Ultra",
};

export function codexReasoningEffortOptions(
  model: string | null | undefined,
  defaultLabel = "Default",
) {
  // DeepSeek on the Codex harness accepts only low/high/max; the Codex-native
  // model list does not apply and would offer unsupported values.
  const isDeepSeek = typeof model === "string" && model.toLowerCase().includes("deepseek");
  const values: CodexLocalReasoningEffort[] = isDeepSeek
    ? ["low", "high", "max"]
    : [...codexLocalReasoningEffortsForModel(model)];
  return [
    { value: "", label: defaultLabel },
    ...values.map((value) => ({
      value,
      label: CODEX_REASONING_EFFORT_LABELS[value],
    })),
  ];
}
