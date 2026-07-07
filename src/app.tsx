import "./app.css";
import { useEffect, useRef, useState } from "preact/hooks";
import { ErrorBoundary } from "./components/shell/ErrorBoundary";
import { Header } from "./components/shell/Header";
import { TabBar, ROOM_TABS, SOLO_TABS, type RoomTab } from "./components/shell/TabBar";
import { ProfileSetup } from "./components/room/ProfileSetup";
import { Home } from "./components/room/Home";
import { SoloShareSheet } from "./components/room/SoloShareSheet";
import { useProfile } from "./lib/personal";
import { useSession, usePhotos, joinRoom } from "./lib/store";
import { hasLocalMemories } from "./lib/local/localMemories";
import { autoExportPhotos } from "./lib/drive/autoExport";
import { parseJoinInput } from "./lib/qr";
import { MapScreen } from "./components/map/MapScreen";
import { AlbumScreen } from "./components/album/AlbumScreen";
import { DiaryScreen } from "./components/diary/DiaryScreen";
import { ARCameraLazy } from "./components/ar/ARCameraLazy";
import { PostScreen } from "./components/post/PostScreen";
import { GuildScreen } from "./components/guild/GuildScreen";
import { CelebrationHost } from "./components/common/CelebrationHost";

export function App() {
  const [profile] = useProfile();
  const session = useSession();
  const photos = usePhotos();
  const [tab, setTab] = useState<RoomTab>("home");
  const [hashHandled, setHashHandled] = useState(false);

  const hasProfile = profile.name.trim().length > 0;

  // Keep the drive copy of the album in sync automatically — every photo
  // (own and received) is exported without the manual PhotoViewer button.
  useEffect(() => {
    if (photos.length > 0) autoExportPhotos(photos);
  }, [photos]);

  // On entering a room, offer (once per room, this session) to bring solo
  // memories into the party — but only when there's something to share. The
  // publish itself is explicit and user-initiated inside the sheet; here we
  // just surface the invitation without ever touching the P2P path on our own.
  const soloOfferedRef = useRef<Set<string>>(new Set());
  const [shareOpen, setShareOpen] = useState(false);
  useEffect(() => {
    if (!session) return;
    if (soloOfferedRef.current.has(session.roomId)) return;
    soloOfferedRef.current.add(session.roomId);
    if (hasLocalMemories()) setShareOpen(true);
  }, [session?.roomId]);

  // Consume a "#/join/<roomId>" deep link once a local profile exists, then
  // clear the hash so it doesn't re-trigger on refresh or back-navigation.
  useEffect(() => {
    if (!hasProfile || hashHandled) return;
    setHashHandled(true);
    if (location.hash.includes("/join/")) {
      const roomId = parseJoinInput(location.href);
      history.replaceState(null, "", location.pathname + location.search);
      if (roomId) {
        joinRoom(roomId).catch((err) => {
          console.error("tc-travel: join via link failed", err);
        });
      }
    }
  }, [hasProfile, hashHandled]);

  // Solo vs. room picks the tab lineup (see TabBar): `home` is the solo landing,
  // and `post` (card exchange) only belongs inside a party. The *active* tab is
  // derived rather than reset via an effect, so switching modes can never strand
  // you on a tab the current set lacks — it falls back to that set's first entry
  // (home when solo, map in a room), matching the pre-solo default landing.
  const tabs = session ? ROOM_TABS : SOLO_TABS;
  const activeTab = tabs.includes(tab) ? tab : tabs[0];

  let content;
  if (!hasProfile) {
    content = <ProfileSetup />;
  } else {
    content = (
      <>
        <Header />
        <div class="app-content">
          {activeTab === "home" && <Home onStartJourney={() => setTab("map")} />}
          {activeTab === "map" && <MapScreen />}
          {activeTab === "album" && <AlbumScreen />}
          {activeTab === "diary" && <DiaryScreen />}
          {activeTab === "camera" && <ARCameraLazy />}
          {activeTab === "post" && <PostScreen />}
          {activeTab === "guild" && <GuildScreen />}
        </div>
        <TabBar active={activeTab} tabs={tabs} onSelect={setTab} />
      </>
    );
  }

  return (
    <ErrorBoundary>
      <div class="app-shell">{content}</div>
      {/* App-wide reward layer: fires wherever progress is made, and surfaces
          any threshold crossed while away on the next launch. */}
      {hasProfile && <CelebrationHost />}
      {shareOpen && <SoloShareSheet onClose={() => setShareOpen(false)} />}
    </ErrorBoundary>
  );
}
