// Recognizes the `mist-network://` pseudo-provider convention (see
// tc-docs/drafts/llm-settings-common-v1.md §2.2 and tc-translate's
// src/lib/networkModels.ts): a provider whose baseUrl uses this scheme
// represents a model discovered via an AI Network room rather than a
// connection the user configured directly.
//
// tc-travel itself never *writes* such a provider (it has no
// useNetworkModelSync-equivalent that mirrors AI Network models into the
// shared config as presets - see docs/ai-companion.md), but the shared
// `tc-shared-llm-config-v1` key is co-owned by every tik-choco app at the
// same origin, so a sibling app (e.g. tc-translate/tc-pdf-viewer acting as a
// network consumer) may have already written one. This guard exists purely
// so the AI接続 tab renders such a row informatively instead of trying to
// edit/save a baseUrl for it as if it were a normal HTTP connection.
export const NETWORK_PROVIDER_URL_PREFIX = "mist-network://";

export function isNetworkProviderBaseUrl(baseUrl: string): boolean {
  return baseUrl.trim().startsWith(NETWORK_PROVIDER_URL_PREFIX);
}
