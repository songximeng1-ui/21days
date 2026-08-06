export type ProviderRuntimeProfile = Readonly<{
  model: string;
  thinking?: Readonly<{ type: "disabled" }>;
}>;

const DEEPSEEK_HOST = "api.deepseek.com";
const DEEPSEEK_V4_MODELS = new Set([
  "deepseek-v4-flash",
  "deepseek-v4-pro",
]);

export function resolveProviderRuntimeProfile(
  normalizedBaseUrl: string,
  configuredModel: string,
): ProviderRuntimeProfile {
  const host = new URL(normalizedBaseUrl).hostname.toLowerCase();
  if (host !== DEEPSEEK_HOST) return { model: configuredModel };
  if (configuredModel === "deepseek-reasoner") {
    throw new Error("Invalid AI provider model configuration");
  }
  const model = configuredModel === "deepseek-chat"
    ? "deepseek-v4-flash"
    : configuredModel;
  return DEEPSEEK_V4_MODELS.has(model)
    ? { model, thinking: { type: "disabled" } }
    : { model };
}
