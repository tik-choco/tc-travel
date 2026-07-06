import "./app.css";
import { useEffect, useState } from "preact/hooks";
import { ErrorBoundary } from "./components/shell/ErrorBoundary";
import { Header } from "./components/shell/Header";
import { TabBar, type RoomTab } from "./components/shell/TabBar";
import { ProfileSetup } from "./components/room/ProfileSetup";
import { Home } from "./components/room/Home";
import { useProfile } from "./lib/personal";
import { useSession, usePhotos, joinRoom } from "./lib/store";
import { autoExportPhotos } from "./lib/drive/autoExport";
import { parseJoinInput } from "./lib/qr";
import { WorldMap } from "./components/map/WorldMap";
import { AlbumScreen } from "./components/album/AlbumScreen";
import { DiaryScreen } from "./components/diary/DiaryScreen";
import { ARCameraLazy } from "./components/ar/ARCameraLazy";
import { GuildScreen } from "./components/guild/GuildScreen";

export function App() {
  const [profile] = useProfile();
  const session = useSession();
  const photos = usePhotos();
  const [tab, setTab] = useState<RoomTab>("map");
  const [hashHandled, setHashHandled] = useState(false);

  const hasProfile = profile.name.trim().length > 0;

  // Keep the drive copy of the album in sync automatically — every photo
  // (own and received) is exported without the manual PhotoViewer button.
  useEffect(() => {
    if (photos.length > 0) autoExportPhotos(photos);
  }, [photos]);

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

  let content;
  if (!hasProfile) {
    content = <ProfileSetup />;
  } else if (!session) {
    content = <Home />;
  } else {
    content = (
      <>
        <Header />
        <div class="app-content">
          {tab === "map" && <WorldMap />}
          {tab === "album" && <AlbumScreen />}
          {tab === "diary" && <DiaryScreen />}
          {tab === "camera" && <ARCameraLazy />}
          {tab === "guild" && <GuildScreen />}
        </div>
        <TabBar active={tab} onSelect={setTab} />
      </>
    );
  }

  return (
    <ErrorBoundary>
      <div class="app-shell">{content}</div>
    </ErrorBoundary>
  );
}
