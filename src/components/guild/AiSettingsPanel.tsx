// AI companion settings, restructured to match the tik-choco family's common
// 3-tab layout (AI接続 / AI Network / タスク + hover-tooltip task rows) - see
// tc-docs/drafts/llm-settings-common-v1.md. tc-travel's AI companion only
// ever talks to a provider over the AI Network room (there is no direct HTTP
// call path anywhere in this app - see companionClient.ts/networkTask.ts),
// so this panel intentionally omits two things every dual-mode reference app
// (tc-translate/tc-lingo/tc-pdf-viewer) has: a model-list fetch/connection
// test in AI接続 (model ids are entered by hand), and a "provide AI to the
// network" role card in AI Network (tc-travel never advertises as a
// provider). See §5.3 checklist item 7 - the goal is to reshape the UI
// around this app's actual capabilities, not to add network features it
// doesn't have.
import "./guild.i18n";
import "../ar/ar.i18n";
import "./settingsAi.css";
import { useEffect, useState } from "preact/hooks";
import { Network, Plus, X } from "lucide-preact";
import { useT } from "../../lib/i18n";
import {
  loadAiSettings,
  saveAiSettings,
  type AiCompanionSettings,
  type AiTaskRole,
} from "../../lib/ai/aiSettings";
import {
  emptyLlmConfig,
  loadLlmConfig,
  saveLlmConfig,
  subscribeLlmConfig,
  type LlmProviderV1,
  type ModelPresetV1,
  type SharedLlmConfigV1,
} from "../../lib/drive/llmConfig";
import {
  createPreset,
  createProvider,
  deletePreset,
  deleteProvider,
  patchPreset,
  patchProvider,
} from "../../lib/drive/llmConfigEdit";
import { isNetworkProviderBaseUrl } from "../../lib/drive/networkModels";
import { getCompanionClient, type CompanionStatus } from "../../lib/ai/companionClient";

type SettingsTab = "connection" | "network" | "tasks";

const TABS: SettingsTab[] = ["connection", "network", "tasks"];
const TAB_LABEL_KEY: Record<SettingsTab, string> = {
  connection: "settings.ai.tab.connection",
  network: "settings.ai.tab.network",
  tasks: "settings.ai.tab.tasks",
};

// Internal role id -> user-facing label/tooltip. See aiSettings.ts's
// AiTaskRole comment: "orchestrator"/"worker" never appear in the UI text.
const TASK_ROLES: AiTaskRole[] = ["orchestrator", "worker"];
const TASK_LABEL_KEY: Record<AiTaskRole, string> = {
  orchestrator: "settings.ai.tasks.plan",
  worker: "settings.ai.tasks.response",
};
const TASK_TIP_KEY: Record<AiTaskRole, string> = {
  orchestrator: "settings.ai.tasks.planTip",
  worker: "settings.ai.tasks.responseTip",
};

function getHostLabel(baseUrl: string): string {
  try {
    return new URL(baseUrl).host || baseUrl;
  } catch {
    return baseUrl;
  }
}

function statusDotClass(phase: CompanionStatus["phase"]): string {
  if (phase === "connected") return "is-connected";
  if (phase === "error") return "is-error";
  if (phase === "joining" || phase === "searching") return "is-pending";
  return "";
}

export function AiSettingsPanel() {
  const t = useT();
  const [activeTab, setActiveTab] = useState<SettingsTab>("connection");
  const [aiSettings, setAiSettings] = useState<AiCompanionSettings>(() => loadAiSettings());
  const [sharedConfig, setSharedConfig] = useState<SharedLlmConfigV1>(() => loadLlmConfig() ?? emptyLlmConfig());
  const [status, setStatus] = useState<CompanionStatus>(() => getCompanionClient().status);

  useEffect(() => getCompanionClient().onStatusChange(setStatus), []);

  // Cross-tab/cross-app updates to the shared config (another app adding a
  // provider, or this app's own seedSharedRoomId write triggered from
  // updateAiSettings below) keep this panel's view in sync.
  useEffect(() => subscribeLlmConfig((next) => setSharedConfig(next ?? emptyLlmConfig())), []);

  const updateAiSettings = (patch: Partial<AiCompanionSettings>) => {
    setAiSettings((prev) => {
      const next = { ...prev, ...patch };
      saveAiSettings(next);
      return next;
    });
    // saveAiSettings may have merge-seeded network.roomId into the shared
    // config (see aiSettings.ts's seedSharedRoomId) - refresh so the Network
    // tab's fallback hint reflects it immediately.
    setSharedConfig(loadLlmConfig() ?? emptyLlmConfig());
  };

  const updateTaskPreset = (role: AiTaskRole, presetId: string) => {
    updateAiSettings({ tasks: { ...aiSettings.tasks, [role]: { presetId } } });
  };

  const persistSharedConfig = (mutate: (config: SharedLlmConfigV1) => void) => {
    setSharedConfig((prev) => {
      const next: SharedLlmConfigV1 = JSON.parse(JSON.stringify(prev)) as SharedLlmConfigV1;
      mutate(next);
      saveLlmConfig(next);
      return next;
    });
  };

  // Clears any task's presetId that no longer resolves to a real preset
  // (mirrors tc-pdf-viewer's clearOrphanedTaskPresetIds), so a stale
  // dangling id never lingers as an invisible task assignment.
  const clearOrphanedTaskPresetIds = (remainingPresetIds: Set<string>) => {
    setAiSettings((prev) => {
      let changed = false;
      const nextTasks = { ...prev.tasks };
      for (const role of TASK_ROLES) {
        if (nextTasks[role].presetId && !remainingPresetIds.has(nextTasks[role].presetId)) {
          nextTasks[role] = { presetId: "" };
          changed = true;
        }
      }
      if (!changed) return prev;
      const next = { ...prev, tasks: nextTasks };
      saveAiSettings(next);
      return next;
    });
  };

  // --- 接続先 (provider) ------------------------------------------------

  const handleAddProvider = () => {
    persistSharedConfig((config) => createProvider(config, ""));
  };

  const handleProviderPatch = (id: string, patch: Partial<Omit<LlmProviderV1, "id">>) => {
    persistSharedConfig((config) => patchProvider(config, id, patch));
  };

  const handleRemoveProvider = (provider: LlmProviderV1) => {
    const linkedPresets = sharedConfig.presets.filter((preset) => preset.providerId === provider.id);
    if (linkedPresets.length > 0) {
      const ok = window.confirm(t("settings.ai.connection.deleteProviderConfirm", { count: linkedPresets.length }));
      if (!ok) return;
    }
    const linkedIds = new Set(linkedPresets.map((preset) => preset.id));
    persistSharedConfig((config) => {
      deleteProvider(config, provider.id);
      for (const presetId of linkedIds) deletePreset(config, presetId);
    });
    const remaining = new Set(sharedConfig.presets.filter((preset) => !linkedIds.has(preset.id)).map((preset) => preset.id));
    clearOrphanedTaskPresetIds(remaining);
  };

  // --- モデル (preset) ---------------------------------------------------

  const handleAddPreset = () => {
    const providerId = sharedConfig.providers[0]?.id;
    if (!providerId) return;
    persistSharedConfig((config) => createPreset(config, providerId, ""));
  };

  const handlePresetPatch = (id: string, patch: Partial<Omit<ModelPresetV1, "id">>) => {
    persistSharedConfig((config) => patchPreset(config, id, patch));
  };

  const handleRemovePreset = (preset: ModelPresetV1) => {
    const ok = window.confirm(t("settings.ai.connection.deletePresetConfirm"));
    if (!ok) return;
    persistSharedConfig((config) => deletePreset(config, preset.id));
    const remaining = new Set(sharedConfig.presets.filter((entry) => entry.id !== preset.id).map((entry) => entry.id));
    clearOrphanedTaskPresetIds(remaining);
  };

  const isNetworkPresetProvider = (providerId: string): boolean => {
    const provider = sharedConfig.providers.find((entry) => entry.id === providerId);
    return provider ? isNetworkProviderBaseUrl(provider.baseUrl) : false;
  };

  const getPresetBadges = (preset: ModelPresetV1): string[] => {
    const badges: string[] = [];
    if (sharedConfig.defaultPresetId === preset.id) badges.push(t("settings.ai.connection.defaultBadge"));
    for (const role of TASK_ROLES) {
      if (aiSettings.tasks[role].presetId === preset.id) badges.push(t(TASK_LABEL_KEY[role]));
    }
    if (isNetworkPresetProvider(preset.providerId)) badges.push(t("settings.ai.connection.networkBadge"));
    return badges;
  };

  const getProviderLabel = (providerId: string): string => {
    const provider = sharedConfig.providers.find((entry) => entry.id === providerId);
    return provider ? provider.label || getHostLabel(provider.baseUrl) : "";
  };

  function renderProviderRow(provider: LlmProviderV1) {
    const isNetwork = isNetworkProviderBaseUrl(provider.baseUrl);
    return (
      <div class="model-row model-row-editing" key={provider.id}>
        <div class="model-row-edit-fields">
          <input
            class="input"
            value={provider.label}
            placeholder={t("settings.ai.connection.labelPlaceholder")}
            autoComplete="off"
            onInput={(e) => handleProviderPatch(provider.id, { label: (e.target as HTMLInputElement).value })}
          />
          {isNetwork ? (
            <p class="model-row-model">{t("settings.ai.connection.networkNote")}</p>
          ) : (
            <>
              <input
                class="input"
                value={provider.baseUrl}
                placeholder="https://..."
                autoComplete="off"
                onInput={(e) => handleProviderPatch(provider.id, { baseUrl: (e.target as HTMLInputElement).value })}
              />
              <input
                class="input"
                type="password"
                value={provider.apiKey}
                placeholder={t("settings.ai.connection.apiKeyPlaceholder")}
                autoComplete="off"
                onInput={(e) => handleProviderPatch(provider.id, { apiKey: (e.target as HTMLInputElement).value })}
              />
            </>
          )}
        </div>
        <span
          class="model-row-remove"
          role="button"
          tabIndex={0}
          title={t("settings.ai.connection.deleteProvider")}
          onClick={() => handleRemoveProvider(provider)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleRemoveProvider(provider);
            }
          }}
        >
          <X size={13} />
        </span>
      </div>
    );
  }

  function renderPresetRow(preset: ModelPresetV1) {
    const badges = getPresetBadges(preset);
    return (
      <div class="model-row model-row-editing" key={preset.id}>
        <div class="model-row-edit-fields">
          <input
            class="input"
            value={preset.label}
            placeholder={t("settings.ai.connection.labelPlaceholder")}
            autoComplete="off"
            onInput={(e) => handlePresetPatch(preset.id, { label: (e.target as HTMLInputElement).value })}
          />
          <select
            class="input"
            value={preset.providerId}
            onChange={(e) => handlePresetPatch(preset.id, { providerId: (e.target as HTMLSelectElement).value })}
          >
            {sharedConfig.providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label || getHostLabel(provider.baseUrl)}
              </option>
            ))}
          </select>
          <input
            class="input"
            value={preset.model}
            placeholder={t("settings.ai.connection.modelPlaceholder")}
            autoComplete="off"
            onInput={(e) => handlePresetPatch(preset.id, { model: (e.target as HTMLInputElement).value })}
          />
        </div>
        {badges.length > 0 && (
          <span class="model-row-badges">
            {badges.map((badge) => (
              <span class="task-badge" key={badge}>
                {badge}
              </span>
            ))}
          </span>
        )}
        <span
          class="model-row-remove"
          role="button"
          tabIndex={0}
          title={t("settings.ai.connection.deletePreset")}
          onClick={() => handleRemovePreset(preset)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleRemovePreset(preset);
            }
          }}
        >
          <X size={13} />
        </span>
      </div>
    );
  }

  function renderConnectionTab() {
    return (
      <div class="settings-tab-panel" role="tabpanel">
        <p class="hint">{t("settings.ai.connection.hint")}</p>

        <div class="server-list-header">
          <label>{t("settings.ai.connection.providersHeading")}</label>
        </div>
        <div class="settings-flat-section settings-flat-section-connection">
          {sharedConfig.providers.length === 0 && <p class="hint">{t("settings.ai.connection.noProviders")}</p>}
          {sharedConfig.providers.map((provider) => renderProviderRow(provider))}
          <button type="button" class="grid-add-tile" onClick={handleAddProvider}>
            <Plus size={16} />
            <span>{t("settings.ai.connection.addProviderTile")}</span>
          </button>
        </div>

        <div class="server-list-header">
          <label>{t("settings.ai.connection.presetsHeading")}</label>
        </div>
        <div class="settings-flat-section settings-flat-section-models">
          {sharedConfig.providers.length === 0 ? (
            <p class="hint">{t("settings.ai.connection.noPresetsNoProvider")}</p>
          ) : (
            sharedConfig.presets.length === 0 && <p class="hint">{t("settings.ai.connection.noPresets")}</p>
          )}
          {sharedConfig.presets.map((preset) => renderPresetRow(preset))}
          <button
            type="button"
            class="grid-add-tile"
            disabled={sharedConfig.providers.length === 0}
            title={sharedConfig.providers.length === 0 ? t("settings.ai.connection.addPresetNeedProvider") : undefined}
            onClick={handleAddPreset}
          >
            <Plus size={16} />
            <span>{t("settings.ai.connection.addPresetTile")}</span>
          </button>
        </div>
      </div>
    );
  }

  function renderNetworkTab() {
    const sharedRoomId = sharedConfig.network.roomId.trim();
    return (
      <div class="settings-tab-panel" role="tabpanel">
        <p class="hint">{t("settings.ai.network.hint")}</p>

        <div class="field">
          <label for="settings-ai-room" data-tip={t("settings.ai.roomIdTip")}>
            {t("settings.ai.roomId")}
          </label>
          <input
            id="settings-ai-room"
            class="input"
            type="text"
            value={aiSettings.roomId}
            placeholder={aiSettings.roomId === "" && sharedRoomId !== "" ? sharedRoomId : undefined}
            onInput={(e) => updateAiSettings({ roomId: (e.target as HTMLInputElement).value })}
          />
          {aiSettings.roomId === "" && (
            <span class="settings-label">
              {sharedRoomId !== ""
                ? t("settings.ai.roomIdSharedHint", { roomId: sharedRoomId })
                : t("settings.ai.network.roomIdSharedEmptyHint")}
            </span>
          )}
        </div>

        <div class="settings-role-card">
          <span class="settings-role-title">
            <Network size={15} />
            {t("settings.ai.network.consumerTitle")}
          </span>
          <p class="settings-role-desc">{t("settings.ai.network.consumerDesc")}</p>
          <div class="settings-role-body">
            <span class={`ai-status-dot ${statusDotClass(status.phase)}`} aria-hidden="true" />
            <span>{status.phase === "error" && status.message ? status.message : t(`ar.talk.status.${status.phase}`)}</span>
          </div>
        </div>
      </div>
    );
  }

  function renderTasksTab() {
    return (
      <div class="settings-tab-panel" role="tabpanel">
        {TASK_ROLES.map((role) => (
          <div class="task-model-item" key={role}>
            <span data-tip={t(TASK_TIP_KEY[role])}>{t(TASK_LABEL_KEY[role])}</span>
            <div class="task-model-fields">
              <div class="task-model-field">
                <select
                  class="input"
                  aria-label={t(TASK_LABEL_KEY[role])}
                  value={aiSettings.tasks[role].presetId}
                  onChange={(e) => updateTaskPreset(role, (e.target as HTMLSelectElement).value)}
                >
                  <option value="">{t("settings.ai.tasks.presetUnset")}</option>
                  {sharedConfig.presets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label || preset.model}
                      {getProviderLabel(preset.providerId) ? ` (${getProviderLabel(preset.providerId)})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div class="ai-settings">
      <div class="settings-tab-bar" role="tablist" aria-label={t("settings.ai.title")}>
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            class={`settings-tab ${activeTab === tab ? "active" : ""}`}
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
          >
            {t(TAB_LABEL_KEY[tab])}
          </button>
        ))}
      </div>

      {activeTab === "connection" && renderConnectionTab()}
      {activeTab === "network" && renderNetworkTab()}
      {activeTab === "tasks" && renderTasksTab()}

      <div class="field" style={{ marginTop: "1rem" }}>
        <label for="settings-ai-voice">{t("settings.ai.voice")}</label>
        <input
          id="settings-ai-voice"
          class="input"
          type="text"
          value={aiSettings.voice ?? ""}
          onInput={(e) => updateAiSettings({ voice: (e.target as HTMLInputElement).value })}
        />
      </div>

      <div class="field">
        <label for="settings-ai-persona">{t("settings.ai.persona")}</label>
        <textarea
          id="settings-ai-persona"
          class="input"
          rows={3}
          value={aiSettings.persona ?? ""}
          onInput={(e) => updateAiSettings({ persona: (e.target as HTMLTextAreaElement).value })}
        />
      </div>

      <div class="settings-row">
        <label style={{ display: "flex", alignItems: "center", gap: "0.6rem", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={aiSettings.ttsEnabled}
            onChange={(e) => updateAiSettings({ ttsEnabled: (e.target as HTMLInputElement).checked })}
          />
          <span class="settings-label">{t("settings.ai.ttsEnabled")}</span>
        </label>
      </div>
    </div>
  );
}
