import { useEffect, useState } from "preact/hooks";
import { useLlmConfig, useRoomProviders } from "@tik-choco/mistai/preact";
import { loadAiSettings, subscribeAiSettings } from "../../lib/ai/aiSettings";
import { aiRooms } from "../../lib/ai/rooms";

const listeners = new Set<(open: boolean) => void>();
export function setAiSettingsOpen(open: boolean) { listeners.forEach(fn => fn(open)); }

export function AiRuntime() {
  const [local, setLocal] = useState(loadAiSettings);
  const { config } = useLlmConfig();
  const [settingsOpen, setOpen] = useState(false);
  useEffect(() => subscribeAiSettings(() => setLocal(loadAiSettings())), []);
  useEffect(() => { listeners.add(setOpen); return () => { listeners.delete(setOpen); }; }, []);
  useRoomProviders({ config, consumers: aiRooms, roomProvide: local.roomProvide,
    taskRefs: Object.values(local.tasks).map(task => task.ref), settingsOpen });
  return null;
}
