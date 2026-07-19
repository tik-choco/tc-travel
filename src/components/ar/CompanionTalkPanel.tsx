// Bottom-sheet chat panel for talking to the live VRM companion: text in,
// streamed LLM reply out, optionally spoken aloud with lip-sync driving the
// companion's mouth. Mounted by the Avatar hub (../avatar/AvatarScreen) whenever
// a VRM companion is on the stage and the AI is configured; kept mounted across
// open/close so the mist connection (see connect()/disconnect() below) and chat
// history survive panel toggles — only the hub unmounting tears it down.

import "./ar.i18n";
import "./ar.css";
import { useEffect, useRef, useState } from "preact/hooks";
import { CircleStop, Send, X } from "lucide-preact";
import { getLanguage, useT } from "../../lib/i18n";
import { loadAiSettings, isAiConfigured, resolveAiRoomId, resolveTaskModel } from "../../lib/ai/aiSettings";
import { getCompanionClient, type CompanionStatus } from "../../lib/ai/companionClient";
import { runNetworkTask } from "../../lib/ai/networkTask";
import { splitSpeechLines, speakLines } from "../../lib/ai/speech";
import { attachLipSync, type LipSyncHandle } from "../../lib/ai/lipSync";
import type { Companion } from "./companion";

interface CompanionTalkPanelProps {
  open: boolean;
  onClose: () => void;
  /** Live ref to the currently-mounted companion, so the mouth driver always
   *  targets whichever companion instance is on screen right now. */
  companionRef: { current: Companion | null };
}

interface ChatBubble {
  role: "user" | "assistant";
  text: string;
}

const HISTORY_LIMIT = 12;

/** English names for the system prompt — kept separate from the user-facing
 *  LANGUAGE_LABELS (native script), since this text is only ever read by the LLM. */
const LANGUAGE_ENGLISH_NAMES: Record<string, string> = {
  en: "English",
  ja: "Japanese",
  zh: "Chinese",
  ko: "Korean",
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese",
};

function buildSystemPrompt(persona: string | undefined): string {
  const languageName = LANGUAGE_ENGLISH_NAMES[getLanguage()] ?? "English";
  const base =
    `You are the user's avatar companion in a travel app, appearing as their VRM ` +
    `character. Reply in ${languageName}. Keep replies short and conversational ` +
    `(1–3 sentences). Plain text only — no markdown, no emoji spam.`;
  return persona?.trim() ? `${base}\n${persona.trim()}` : base;
}

/** Context handed to runNetworkTask's workers: the companion persona/system
 *  prompt (workers never see buildSystemPrompt directly, since runNetworkTask
 *  builds its own worker system prompt) plus the recent chat history,
 *  rendered as compact "role: text" lines. */
function buildContextText(persona: string | undefined, history: ChatBubble[]): string {
  const parts = [`Persona/system context:\n${buildSystemPrompt(persona)}`];
  const historyLines = history.map((m) => `${m.role}: ${m.text}`).join("\n");
  if (historyLines) parts.push(`Recent conversation:\n${historyLines}`);
  return parts.join("\n\n");
}

export function CompanionTalkPanel({ open, onClose, companionRef }: CompanionTalkPanelProps) {
  const t = useT();
  const client = getCompanionClient();

  const [status, setStatus] = useState<CompanionStatus>(client.status);
  const [messages, setMessages] = useState<ChatBubble[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connectedOnceRef = useRef(false);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const lipSyncRef = useRef<LipSyncHandle | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => client.onStatusChange(setStatus), [client]);

  // Connect the first time the panel is opened; later opens/closes reuse the
  // same connection (connect() itself is a no-op if already on this room).
  useEffect(() => {
    if (!open || connectedOnceRef.current) return;
    connectedOnceRef.current = true;
    client.connect(resolveAiRoomId());
  }, [open, client]);

  // Auto-scroll to the newest message.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Abort any in-flight generation/speech if the component goes away.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      lipSyncRef.current?.dispose();
    };
  }, []);

  function stopSpeaking(): void {
    abortRef.current?.abort();
    lipSyncRef.current?.dispose();
    lipSyncRef.current = null;
    companionRef.current?.setMouthLevel?.(0);
    setBusy(false);
  }

  async function handleSend(): Promise<void> {
    const text = input.trim();
    if (!text || status.phase !== "connected" || busy) return;

    const settings = loadAiSettings();
    const contextText = buildContextText(settings.persona, messages.slice(-HISTORY_LIMIT));
    const orchestratorModel = resolveTaskModel("orchestrator", settings);
    const workerModel = resolveTaskModel("worker", settings);

    setInput("");
    setError(null);
    setMessages((prev) => [...prev, { role: "user", text }, { role: "assistant", text: "" }]);
    setBusy(true);

    const requestId = ++requestIdRef.current;
    const abort = new AbortController();
    abortRef.current = abort;
    const isCurrent = () => requestIdRef.current === requestId && !abort.signal.aborted;

    const updateAssistantBubble = (text: string) => {
      setMessages((prev) => {
        const next = prev.slice();
        next[next.length - 1] = { role: "assistant", text };
        return next;
      });
    };

    try {
      const result = await runNetworkTask({
        client,
        orchestratorModel,
        workerModel,
        input: text,
        contextText,
        signal: abort.signal,
        onDelta: (full) => {
          if (isCurrent()) updateAssistantBubble(full);
        },
      });
      if (!isCurrent()) return;
      const reply = result.text;
      updateAssistantBubble(reply);

      if (settings.ttsEnabled && reply.trim()) {
        const lines = splitSpeechLines(reply);
        await speakLines(
          lines,
          (line) => client.requestTts({ text: line, voice: settings.voice || undefined }),
          abort.signal,
          {
            onAudioStart: (audio) => {
              lipSyncRef.current?.dispose();
              lipSyncRef.current = attachLipSync(audio, (level) => companionRef.current?.setMouthLevel?.(level));
              const endLipSync = () => {
                lipSyncRef.current?.dispose();
                lipSyncRef.current = null;
              };
              audio.addEventListener("ended", endLipSync, { once: true });
              audio.addEventListener("error", endLipSync, { once: true });
            },
          },
        );
      }
    } catch (err) {
      if (!isCurrent()) return;
      console.warn("tc-travel: companion chat request failed", err);
      setMessages((prev) => prev.slice(0, -1));
      setError(t("ar.talk.error.request"));
    } finally {
      if (isCurrent()) {
        setBusy(false);
        lipSyncRef.current?.dispose();
        lipSyncRef.current = null;
        companionRef.current?.setMouthLevel?.(0);
      }
    }
  }

  if (!open) return null;

  const dotClass =
    status.phase === "connected"
      ? "is-connected"
      : status.phase === "error"
        ? "is-error"
        : status.phase === "joining" || status.phase === "searching"
          ? "is-pending"
          : "";

  const statusLabel =
    status.phase === "error" && status.message ? status.message : t(`ar.talk.status.${status.phase}`);

  const configured = isAiConfigured();

  return (
    <div class="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label={t("ar.talk.title")}>
      <div class="modal-card" onClick={(e) => e.stopPropagation()}>
        <div class="ai-talk-panel-inner">
          <div class="sheet-handle" />
          <div class="ai-talk-header">
            <div class="ai-talk-header-title">
              <p class="title-ornate">{t("ar.talk.title")}</p>
              <span class={`ai-talk-status-dot ${dotClass}`} aria-hidden="true" />
              <span class="ai-talk-status-text">{statusLabel}</span>
            </div>
            <button type="button" class="btn btn-icon" aria-label={t("common.close")} onClick={onClose}>
              <X aria-hidden="true" />
            </button>
          </div>

          {error && <div class="ai-talk-error-row">{error}</div>}
          {!configured && <p class="ai-talk-not-configured">{t("ar.talk.notConfigured")}</p>}

          <div class="ai-talk-messages" ref={listRef}>
            {messages.map((m, i) => (
              <div key={i} class={`ai-talk-bubble ${m.role === "user" ? "is-user" : "is-assistant"}`}>
                {m.text}
              </div>
            ))}
          </div>

          <div class="ai-talk-footer">
            <input
              class="input"
              type="text"
              value={input}
              placeholder={t("ar.talk.placeholder")}
              disabled={status.phase !== "connected"}
              onInput={(e) => setInput((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSend();
              }}
            />
            {busy ? (
              <button type="button" class="btn btn-icon" aria-label={t("ar.talk.stopSpeaking")} onClick={stopSpeaking}>
                <CircleStop aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                class="btn btn-icon btn-primary"
                aria-label={t("ar.talk.send")}
                disabled={status.phase !== "connected" || !input.trim()}
                onClick={() => void handleSend()}
              >
                <Send aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
