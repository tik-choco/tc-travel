import { streamChatCompletion, type ChatMessage, type ConsumerStatus } from "@tik-choco/mistai";
import { providerKind, resolveVoice, roomIdFromBaseUrl, networkVoiceModelParam, subscribeLlmConfig } from "@tik-choco/mistai/llm-config";
import { loadSharedAiConfig, resolveTaskTarget, subscribeAiSettings, type AiTaskRole } from "./aiSettings";
import { aiRooms } from "./rooms";

export type CompanionStatus = ConsumerStatus;

// App adapter only: discovery, routing across peers and providing belong to
// mistai. A request resolves its task ref at invocation time, including fallback.
export class CompanionClient {
  get status(): CompanionStatus {
    const target = resolveTaskTarget("worker");
    if (!target) return { phase: "idle" };
    return providerKind(target) === "http"
      ? { phase: "connected", providerId: target.providerId, providers: [] }
      : aiRooms.roomConsumer(roomIdFromBaseUrl(target.baseUrl)).status;
  }
  onStatusChange(listener: (status: CompanionStatus) => void): () => void {
    let stopRoom: (() => void) | undefined;
    const sync = () => {
      stopRoom?.();
      const target = resolveTaskTarget("worker");
      if (target && providerKind(target) === "room")
        stopRoom = aiRooms.roomConsumer(roomIdFromBaseUrl(target.baseUrl)).onStatusChange(listener);
      listener(this.status);
    };
    const stopLocal = subscribeAiSettings(sync);
    const stopShared = subscribeLlmConfig(sync);
    sync();
    return () => { stopLocal(); stopShared(); stopRoom?.(); };
  }
  connect(): void {
    for (const role of ["orchestrator", "worker"] as const) {
      const target = resolveTaskTarget(role);
      if (target && providerKind(target) === "room") {
        const room = roomIdFromBaseUrl(target.baseUrl);
        void aiRooms.roomConsumer(room).connect(room);
      }
    }
  }
  async requestChat(messages: ChatMessage[], options?: {
    task?: AiTaskRole; onDelta?: (delta: string, full: string) => void;
  }): Promise<string> {
    const target = resolveTaskTarget(options?.task ?? "worker");
    if (!target) throw new Error("No usable model configured");
    if (providerKind(target) === "room") {
      return aiRooms.requestRoomChat(roomIdFromBaseUrl(target.baseUrl), messages, {
        model: target.model, reasoningEffort: target.reasoningEffort, onDelta: options?.onDelta,
      });
    }
    let full = "";
    return streamChatCompletion(target, messages, delta => { full += delta; options?.onDelta?.(delta, full); });
  }
  async requestTts(params: { text: string }): Promise<Blob> {
    const target = resolveVoice(loadSharedAiConfig(), "tts");
    if (!target) throw new Error("No usable TTS model configured");
    if (providerKind(target) === "room") return aiRooms.requestRoomTts(roomIdFromBaseUrl(target.baseUrl), {
      text: params.text, model: networkVoiceModelParam(target.model), voice: target.voice,
    });
    const response = await fetch(`${target.baseUrl.replace(/\/+$/, "")}/audio/speech`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${target.apiKey}` },
      body: JSON.stringify({ model: target.model, input: params.text, voice: target.voice,
        ...(target.speed !== undefined ? { speed: target.speed } : {}) }),
    });
    if (!response.ok) throw new Error(`TTS HTTP ${response.status}`);
    return response.blob();
  }
}
const client = new CompanionClient();
export const getCompanionClient = () => client;
