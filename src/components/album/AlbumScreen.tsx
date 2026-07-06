import { useMemo, useState } from "preact/hooks";
import { ImageOff, Plus, ScrollText } from "lucide-preact";
import { useSession, useMembers, usePhotos, removePhoto } from "../../lib/store";
import { useProfile } from "../../lib/personal";
import { useT } from "../../lib/i18n";
import { PhotoThumb } from "./PhotoThumb";
import { PhotoViewer } from "./PhotoViewer";
import { AddPhotoSheet } from "./AddPhotoSheet";
import "./album.i18n";
import "./album.css";

export function AlbumScreen() {
  const t = useT();
  const session = useSession();
  const photos = usePhotos();
  const members = useMembers();
  const [profile] = useProfile();
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  if (!session) {
    return (
      <div class="screen album-screen">
        <div class="empty-state panel">
          <div class="empty-state-icon">
            <ScrollText size={28} />
          </div>
          <p class="empty-state-title">{t("album.needSessionTitle")}</p>
          <p class="empty-state-hint">{t("album.needSession")}</p>
        </div>
      </div>
    );
  }

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
          onDelete={(id) => {
            removePhoto(id);
            setViewerIndex(null);
          }}
        />
      )}
    </div>
  );
}
