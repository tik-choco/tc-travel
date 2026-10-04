import {
  createRoomProvider, emptyLlmConfig, isModelRef, loadLlmConfig,
  migrateSharedLlmConfig, presetIdToRef, providerKind, resolveModel, saveLlmConfig,
  type ModelRefV1,
} from "@tik-choco/mistai/llm-config";
import { REASONING_EFFORT_OPTIONS, type LlmLocalSettings, type TaskModelV1 } from "@tik-choco/mistai/preact";

export type AiTaskRole = "orchestrator" | "worker";
export type AiTaskModelSetting = TaskModelV1;
export interface AiCompanionSettings extends LlmLocalSettings {
  tasks: Record<AiTaskRole, TaskModelV1>;
  persona?: string;
  ttsEnabled: boolean;
  modelsMigrated: true;
}
export const AI_SETTINGS_KEY = "tc-travel:aiCompanion";
const listeners = new Set<() => void>();
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
const refs = (value: unknown): ModelRefV1[] => Array.isArray(value) ? value.filter(isModelRef) : [];

export function loadSharedAiConfig() {
  const config = loadLlmConfig() ?? emptyLlmConfig();
  if (migrateSharedLlmConfig(config).changed) saveLlmConfig(config);
  return config;
}

// Only the legacy load path consumes preset IDs. The marker prevents cleared
// task/default/voice choices from being restored on subsequent launches.
export function loadAiSettings(): AiCompanionSettings {
  let parsed: Record<string, unknown> = {};
  try { parsed = record(JSON.parse(localStorage.getItem(AI_SETTINGS_KEY) ?? "{}")); } catch { /* defaults */ }
  const config = loadSharedAiConfig();
  const legacy = parsed.modelsMigrated !== true;
  const taskData = record(parsed.tasks);
  const tasks = {} as AiCompanionSettings["tasks"];
  for (const role of ["orchestrator", "worker"] as const) {
    const task = record(taskData[role]);
    const preset = legacy ? config.presets.find(p => p.id === task.presetId) : undefined;
    const ref = isModelRef(task.ref) ? task.ref : preset ? presetIdToRef(config, preset.id) : undefined;
    const effort = task.reasoningEffort ?? preset?.reasoningEffort;
    tasks[role] = {
      ...(ref ? { ref } : {}),
      reasoningEffort: REASONING_EFFORT_OPTIONS.includes(effort as TaskModelV1["reasoningEffort"])
        ? effort as TaskModelV1["reasoningEffort"] : "none",
    };
  }
  const roomProvide: LlmLocalSettings["roomProvide"] = {};
  for (const [id, value] of Object.entries(record(parsed.roomProvide))) {
    const room = record(value);
    roomProvide[id] = { enabled: room.enabled === true, shared: refs(room.shared) };
  }
  if (legacy) {
    const localRoomId = typeof parsed.roomId === "string" ? parsed.roomId.trim() : "";
    const roomId = config.network.roomId.trim() || localRoomId;
    if (roomId) {
      const before = config.providers.length;
      const { id } = createRoomProvider(config, { roomId });
      const targetRoomId = localRoomId || roomId;
      const targetProviderId = targetRoomId === roomId ? id : createRoomProvider(config, { roomId: targetRoomId }).id;
      let changed = before !== config.providers.length;
      if (!roomProvide[id]) {
        const oldIds = parsed.networkProviderPresetIds ?? parsed.networkSharedPresetIds;
        const ids = Array.isArray(oldIds) ? oldIds : [];
        roomProvide[id] = { enabled: parsed.networkProviderEnabled === true, shared: ids
          .map(old => typeof old === "string" ? presetIdToRef(config, old) : undefined)
          .filter((ref): ref is ModelRefV1 => !!ref && config.providers.some(p => p.id === ref.providerId && providerKind(p) === "http")) };
      }
      // Old free-text room overrides become explicit refs, without replacing
      // any task preset assignment or the family's existing default.
      if (typeof parsed.model === "string" && parsed.model.trim()) {
        for (const role of ["orchestrator", "worker"] as const)
          if (!tasks[role].ref) tasks[role].ref = { providerId: targetProviderId, model: parsed.model.trim() };
      }
      if (!config.tts && typeof parsed.voice === "string" && parsed.voice.trim()) {
        config.tts = { providerId: targetProviderId, model: "network-auto", voice: parsed.voice.trim() };
        changed = true;
      }
      if (changed) saveLlmConfig(config);
    }
  }
  const result: AiCompanionSettings = {
    tasks, roomProvide, recentModels: refs(parsed.recentModels).slice(0, 8),
    ttsEnabled: typeof parsed.ttsEnabled === "boolean" ? parsed.ttsEnabled : true,
    ...(typeof parsed.persona === "string" ? { persona: parsed.persona } : {}), modelsMigrated: true,
  };
  if (legacy) persist(result);
  return result;
}

function persist(settings: AiCompanionSettings): void {
  try { localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private storage */ }
}
export function saveAiSettings(settings: AiCompanionSettings): void {
  persist(settings);
  listeners.forEach(fn => fn());
}
export function subscribeAiSettings(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (event: StorageEvent) => { if (event.key === AI_SETTINGS_KEY || event.key === null) cb(); };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => { listeners.delete(cb); if (typeof window !== "undefined") window.removeEventListener("storage", onStorage); };
}
export const aiLocalAdapter = {
  get: loadAiSettings,
  set(next: LlmLocalSettings) { saveAiSettings({ ...loadAiSettings(), ...next, tasks: next.tasks as AiCompanionSettings["tasks"] }); },
  subscribe: subscribeAiSettings,
};
export function resolveTaskTarget(role: AiTaskRole, settings = loadAiSettings()) {
  const target = resolveModel(loadSharedAiConfig(), settings.tasks[role].ref);
  return target ? { ...target, reasoningEffort: settings.tasks[role].reasoningEffort } : null;
}
export function isAiConfigured(settings = loadAiSettings()): boolean {
  return resolveTaskTarget("worker", settings) !== null;
}
