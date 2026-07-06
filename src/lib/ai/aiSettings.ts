// Local-only settings for the AI companion feature (mist room id to reach a
// provider on, plus optional model/voice/persona overrides). Pattern mirrors
// personal.ts's localStorage-backed settings: never touch storage at module
// load (vitest's default node test environment has none), swallow write
// failures (quota, private browsing) rather than surfacing them to the caller.

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

/** Loads settings from localStorage, falling back to defaults for a missing
 *  key, corrupt JSON, or a value with the wrong shape. */
export function loadAiSettings(): AiCompanionSettings {
  try {
    const raw = localStorage.getItem(AI_SETTINGS_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isRecord(parsed)) {
        return {
          roomId: typeof parsed.roomId === "string" ? parsed.roomId : DEFAULT_SETTINGS.roomId,
          ...(typeof parsed.model === "string" ? { model: parsed.model } : {}),
          ...(typeof parsed.voice === "string" ? { voice: parsed.voice } : {}),
          ...(typeof parsed.persona === "string" ? { persona: parsed.persona } : {}),
          ttsEnabled: typeof parsed.ttsEnabled === "boolean" ? parsed.ttsEnabled : DEFAULT_SETTINGS.ttsEnabled,
        };
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
}

/** Whether the feature has enough configuration to attempt a connection. */
export function isAiConfigured(settings?: AiCompanionSettings): boolean {
  const s = settings ?? loadAiSettings();
  return s.roomId.trim() !== "";
}
