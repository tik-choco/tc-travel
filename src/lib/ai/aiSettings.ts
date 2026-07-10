// Local-only settings for the AI companion feature (mist room id to reach a
// provider on, plus optional model/voice/persona overrides). Pattern mirrors
// personal.ts's localStorage-backed settings: never touch storage at module
// load (vitest's default node test environment has none), swallow write
// failures (quota, private browsing) rather than surfacing them to the caller.
//
// `roomId` is a local override of the AI Network room; when empty, the
// effective room falls back to the family-wide shared config's
// `network.roomId` (tc-shared-llm-config-v1, see ../drive/llmConfig.ts) so a
// room set once in another app (e.g. tc-mistllm as provider) can be reused
// here without re-entering it. Whenever a non-empty local roomId is
// known (on load or save) and the shared room is still unset, it is
// merge-written to the shared config (never overwrites an existing shared
// room — merge-never-delete per the llm-config contract).

import { emptyLlmConfig, loadLlmConfig, saveLlmConfig } from "../drive/llmConfig";

export interface AiCompanionSettings {
  /** provider が announce している mist ルーム id。空文字 = 機能未設定 */
  roomId: string;
  model?: string; // LLM モデル名(空/undefined = provider 既定)
  voice?: string; // TTS ボイス名(同上)
  persona?: string; // システムプロンプトに足すキャラ設定自由文
  ttsEnabled: boolean; // 既定 true
}

export const AI_SETTINGS_KEY = "tc-travel:aiCompanion";

const DEFAULT_SETTINGS: AiCompanionSettings = { roomId: "", ttsEnabled: true };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Merge-never-delete seed: if `roomId` is non-empty and the shared config's
 *  `network.roomId` is still unset, publishes it there so other apps in the
 *  family can discover the same AI Network room. No-op otherwise. Never
 *  throws (loadLlmConfig/saveLlmConfig already swallow storage errors). */
function seedSharedRoomId(roomId: string): void {
  const trimmed = roomId.trim();
  if (!trimmed) return;
  const shared = loadLlmConfig() ?? emptyLlmConfig();
  if (shared.network.roomId.trim() !== "") return;
  shared.network = { roomId: trimmed };
  saveLlmConfig(shared);
}

/** Loads settings from localStorage, falling back to defaults for a missing
 *  key, corrupt JSON, or a value with the wrong shape. */
export function loadAiSettings(): AiCompanionSettings {
  try {
    const raw = localStorage.getItem(AI_SETTINGS_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isRecord(parsed)) {
        const result: AiCompanionSettings = {
          roomId: typeof parsed.roomId === "string" ? parsed.roomId : DEFAULT_SETTINGS.roomId,
          ...(typeof parsed.model === "string" ? { model: parsed.model } : {}),
          ...(typeof parsed.voice === "string" ? { voice: parsed.voice } : {}),
          ...(typeof parsed.persona === "string" ? { persona: parsed.persona } : {}),
          ttsEnabled: typeof parsed.ttsEnabled === "boolean" ? parsed.ttsEnabled : DEFAULT_SETTINGS.ttsEnabled,
        };
        seedSharedRoomId(result.roomId);
        return result;
      }
    }
  } catch {
    // fall through to defaults
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveAiSettings(settings: AiCompanionSettings): void {
  try {
    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn("tc-travel: failed to persist aiCompanion settings", error);
  }
  seedSharedRoomId(settings.roomId);
}

/** Effective AI Network room: the local override (`settings.roomId`) if set,
 *  else the family-wide shared config's `network.roomId`. Empty string if
 *  neither is set. */
export function resolveAiRoomId(settings?: AiCompanionSettings): string {
  const s = settings ?? loadAiSettings();
  const local = s.roomId.trim();
  if (local) return local;
  return loadLlmConfig()?.network.roomId.trim() ?? "";
}

/** Whether the feature has enough configuration to attempt a connection
 *  (local roomId or a shared-config fallback room). */
export function isAiConfigured(settings?: AiCompanionSettings): boolean {
  return resolveAiRoomId(settings) !== "";
}
