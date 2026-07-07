import { useMemo, useState } from "preact/hooks";
import { ImageOff, Plus } from "lucide-preact";
import { useMembers } from "../../lib/store";
import { useProfile } from "../../lib/personal";
import { useAlbumPhotos, removeAlbumPhoto } from "../../lib/memories";
import { useT } from "../../lib/i18n";
import type { Member } from "../../lib/types";
import { PhotoThumb } from "./PhotoThumb";
import { PhotoViewer } from "./PhotoViewer";
import { AddPhotoSheet } from "./AddPhotoSheet";
import "./album.i18n";
import "./album.css";

export function AlbumScreen() {
  const t = useT();
  // Unified album: the active room's photos AND every solo photo, newest first,
  // with no session gate — the grimoire is always open now.
  const photos = useAlbumPhotos();
  const members = useMembers();
  const [profile] = useProfile();
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  // useMembers() is empty without a room, so fold the local profile in as a
  // synthetic member: your own solo photos then read as *yours* (name + emoji)
  // in the viewer instead of "a fellow traveler". In a room your real member
  // record already exists, so this never overrides it.
  const memberById = useMemo(() => {
    const map = new Map<string, Member>(members.map((m) => [m.id, m]));
    if (!map.has(profile.id)) {
      map.set(profile.id, {
        id: profile.id,
        name: profile.name,
        color: profile.color,
        avatarEmoji: profile.avatarEmoji,
        joinedAt: 0,
      });
    }
    return map;
  }, [members, profile.id, profile.name, profile.color, profile.avatarEmoji]);

  return (
    <div class="screen album-screen">
      <header class="album-header">
        <h1 class="title-ornate">{t("album.title")}</h1>
      </header>

      {photos.length === 0 ? (
        <div class="empty-state panel">
          <div class="empty-state-icon">
            <ImageOff size={28} />
          </div>
          <p class="empty-state-title">{t("album.empty.title")}</p>
          <p class="empty-state-hint">{t("album.empty.hint")}</p>
        </div>
      ) : (
        <div class="album-grid">
          {photos.map((photo, i) => (
            <PhotoThumb key={photo.id} photo={photo} index={i} onOpen={() => setViewerIndex(i)} />
          ))}
        </div>
      )}

      <button type="button" class="fab" onClick={() => setAddOpen(true)} aria-label={t("album.addPhoto")}>
        <Plus size={22} />
        <span class="fab-label">{t("album.addPhoto")}</span>
      </button>

      {addOpen && <AddPhotoSheet onClose={() => setAddOpen(false)} />}

      {viewerIndex !== null && photos[viewerIndex] && (
        <PhotoViewer
          photos={photos}
          index={viewerIndex}
          memberById={memberById}
          ownId={profile.id}
          onClose={() => setViewerIndex(null)}
          onIndexChange={setViewerIndex}
          onDelete={(photo) => {
            removeAlbumPhoto(photo);
            setViewerIndex(null);
          }}
        />
      )}
    </div>
  );
}
