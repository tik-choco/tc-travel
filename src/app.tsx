import "./app.css";
import { useEffect, useRef, useState } from "preact/hooks";
import { ErrorBoundary } from "./components/shell/ErrorBoundary";
import { Header } from "./components/shell/Header";
import { TabBar, ROOM_TABS, SOLO_TABS, type RoomTab } from "./components/shell/TabBar";
import { ProfileSetup } from "./components/room/ProfileSetup";
import { Home } from "./components/room/Home";
import { SoloShareSheet } from "./components/room/SoloShareSheet";
import { Onboarding } from "./components/room/Onboarding";
import { useProfile } from "./lib/personal";
import { useSession, joinRoom } from "./lib/store";
import { useAlbumPhotos } from "./lib/memories";
import { useCards } from "./lib/cards";
import { hasLocalMemories } from "./lib/local/localMemories";
import { markOnboardingDone, shouldShowOnboarding, subscribeOnboardingRequests } from "./lib/onboarding";
import { scheduleDriveAutoExport } from "./lib/drive/autoExport";
import { parseJoinInput } from "./lib/qr";
import { MapScreen } from "./components/map/MapScreen";
import { AlbumScreen } from "./components/album/AlbumScreen";
import { DiaryScreen } from "./components/diary/DiaryScreen";
import { AvatarScreenLazy } from "./components/avatar/AvatarScreenLazy";
import { PostScreen } from "./components/post/PostScreen";
import { GuildScreen } from "./components/guild/GuildScreen";
import { CelebrationHost } from "./components/common/CelebrationHost";

export function App() {
  const [profile] = useProfile();
  const session = useSession();
  const albumPhotos = useAlbumPhotos();
  const cards = useCards();
  const [tab, setTab] = useState<RoomTab>("home");
  const [hashHandled, setHashHandled] = useState(false);

  const hasProfile = profile.name.trim().length > 0;

  // First-run wizard: shown once on a genuinely fresh install, and re-openable
  // from the Guild settings screen. Closing it (any path) marks onboarding done.
  const [showOnboarding, setShowOnboarding] = useState(() => shouldShowOnboarding());
  useEffect(() => subscribeOnboardingRequests(() => setShowOnboarding(true)), []);
  function closeOnboarding() {
    markOnboardingDone();
    setShowOnboarding(false);
  }

  // Keep the drive copy of the album and card collection in sync
  // automatically — no manual save buttons anywhere: every photo (room +
  // local, own and received) and every card (received + your own) is
  // exported/re-exported whenever its content changes. Debounced inside
  // scheduleDriveAutoExport so a burst of adds coalesces into one sync pass.
  // Runs once on mount too (backlog sync), after mist init since
  // syncDriveExports awaits ensureMistNode itself.
  useEffect(() => {
    if (!hasProfile) return;
    scheduleDriveAutoExport();
  }, [hasProfile, albumPhotos, cards, profile]);

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

  // Solo vs. room picks the tab lineup (see TabBar): `home` is the solo
  // landing and is hidden inside a room, where `map` takes over as the
  // landing instead. The *active* tab is derived rather than reset via an
  // effect, so switching modes can never strand you on a tab the current set
  // lacks — it falls back to that set's first entry (home when solo, map in
  // a room), matching the pre-solo default landing.
  const tabs = session ? ROOM_TABS : SOLO_TABS;
  const activeTab = tabs.includes(tab) ? tab : tabs[0];

  // Shared "start your journey" CTA — used by both the empty-state welcome on
  // Home and the onboarding wizard's closing step.
  const goToMap = () => setTab("map");

  let content;
  if (!hasProfile) {
    content = <ProfileSetup />;
  } else {
    content = (
      <>
        <Header />
        <div class="app-content">
          {activeTab === "home" && (
            <Home onStartJourney={goToMap} onOpenAvatar={() => setTab("avatar")} onOpenDiary={() => setTab("diary")} />
          )}
          {activeTab === "map" && <MapScreen />}
          {activeTab === "album" && <AlbumScreen />}
          {activeTab === "diary" && <DiaryScreen />}
          {activeTab === "avatar" && <AvatarScreenLazy />}
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
      {hasProfile && showOnboarding && <Onboarding onClose={closeOnboarding} onStartJourney={goToMap} />}
      {shareOpen && <SoloShareSheet onClose={() => setShareOpen(false)} />}
    </ErrorBoundary>
  );
}
