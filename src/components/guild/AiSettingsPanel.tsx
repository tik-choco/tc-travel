import "@tik-choco/mistai/ui.css";
import "./settingsAi.css";
import { useEffect, useState } from "preact/hooks";
import { LlmSettings, Switch, type LlmSettingsLocale } from "@tik-choco/mistai/preact";
import { getLanguage, useT } from "../../lib/i18n";
import { aiLocalAdapter, loadAiSettings, saveAiSettings, subscribeAiSettings } from "../../lib/ai/aiSettings";
import { setAiSettingsOpen } from "./AiRuntime";
import { AI_MESSAGES } from "./aiMessages";

export function AiSettingsPanel() {
  useT(); // react to the app language selector
  const [settings, setSettings] = useState(loadAiSettings);
  useEffect(() => subscribeAiSettings(() => setSettings(loadAiSettings())), []);
  useEffect(() => { setAiSettingsOpen(true); return () => setAiSettingsOpen(false); }, []);
  const language = getLanguage();
  const locale: LlmSettingsLocale = language === "zh"
    ? (/zh-(TW|HK|Hant)/i.test(navigator.language) ? "zh-TW" : "zh-CN")
    : language === "ja" ? "ja" : "en";
  const messages = AI_MESSAGES[locale];
  return <div class="ai-settings">
    <LlmSettings locale={locale} localSettings={aiLocalAdapter}
      tasks={[
        { id: "orchestrator", label: messages.plan, tip: messages.planTip, reasoning: true },
        { id: "worker", label: messages.response, tip: messages.responseTip, reasoning: true },
      ]} voice={{ tts: {} }} extraSections={tab => tab === "tasks" && <>
        <div class="field">
          <label for="settings-ai-persona">{messages.persona}</label>
          <textarea id="settings-ai-persona" class="input" rows={3} value={settings.persona ?? ""}
            onInput={e => saveAiSettings({ ...loadAiSettings(), persona: e.currentTarget.value })} />
        </div>
        <div class="provider-card-heading">
          <Switch checked={settings.ttsEnabled} label={messages.ttsEnabled}
            onChange={next => saveAiSettings({ ...loadAiSettings(), ttsEnabled: next })} />
          <span>{messages.ttsEnabled}</span>
        </div>
      </>} />
  </div>;
}
