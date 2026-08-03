const PROVIDER_PATHS: Record<string, ReadonlySet<string>> = {
  "api.deepseek.com": new Set(["", "/", "/v1"]),
  "dashscope.aliyuncs.com": new Set(["/compatible-mode/v1"]),
};

export function normalizeProviderBaseUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Invalid AI provider endpoint");
  }

  const allowedPaths = PROVIDER_PATHS[url.hostname];
  const path = url.pathname.replace(/\/+$/, "") || "";
  if (
    url.protocol !== "https:" ||
    !allowedPaths?.has(path) ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    throw new Error("Invalid AI provider endpoint");
  }

  return `${url.origin}${path}`;
}
